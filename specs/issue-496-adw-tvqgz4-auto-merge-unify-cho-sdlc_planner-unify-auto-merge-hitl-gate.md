# Feature: Unify auto-merge under stateless `(no hitl) OR approved` gate; fix empty-string `reviewDecision` fallback

## Metadata
issueNumber: `496`
adwId: `tvqgz4-auto-merge-unify-cho`
issueJson: `{"number":496,"title":"auto-merge: unify chore + SDLC under stateless (no hitl) OR approved gate; fix empty-string reviewDecision fallback","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-04-26T09:01:19Z"}`

## Feature Description

Restore the original human-in-the-loop semantics of ADW auto-merge by reducing the merge gate to a single, stateless boolean evaluated at every cron tick:

```
gate_open = (no hitl on issue) OR (PR is approved)
```

Three changes are required to deliver this end-to-end:

1. **`adws/github/prApi.ts:333-354`** — `fetchPRApprovalState` currently treats only `null` as "no decision". `gh pr view --json reviewDecision` returns the empty string `""` (verified — `jq -r '.reviewDecision | type'` reports `string` length `0`) on repos without branch protection, including `paysdoc/AI_Dev_Workflow` itself. The current `if (reviewDecision !== null && reviewDecision !== undefined) return false;` short-circuits to `false` on `""`, making the per-reviewer-aggregation fallback dead code on every unprotected repo. Fix: replace the pair of guards with `if (reviewDecision === 'APPROVED') return true; if (reviewDecision) return false;` so any falsy value (including `""`, `null`, `undefined`) flows to `isApprovedFromReviewsList`.
2. **`adws/adwMerge.tsx:128-135`** — replace the current "approval-only" gate (introduced by #488/#489) with the unified `hitlOnIssue && !isApproved → defer` rule. State stays `awaiting_merge`; no comment is posted on defer (log only, matching the existing silent-skip pattern); cron re-evaluates every tick.
3. **`adws/adwChore.tsx`** — add a conditional `approvePR` call after the chore pipeline completes (covers both the `safe` and `regression_possible` exit paths), gated on `!issueHasLabel(issueNumber, 'hitl')`. The chore already exits in `awaiting_merge` (`adws/adwChore.tsx:153`), so all merge paths now flow through `adwMerge.tsx`'s unified gate — one merge path, one gate.

The four canonical rules then fall out of the single gate condition:

1. **No `hitl` label on the issue** → `gate_open = true` → auto-merge fires (any issue type — chore, bug, feature).
2. **`hitl` on issue, PR not approved** → `gate_open = false` → defer.
3. **`hitl` on issue, PR approved** → `gate_open = true` → auto-merge fires (order of events irrelevant).
4. **`hitl` removed (with or without approval)** → falls back to rule 1 → auto-merge becomes eligible again on the next cron tick.

## User Story

As an **ADW operator** managing automated GitHub workflows
I want a **single, predictable merge gate** that evaluates `(no hitl) OR approved` statelessly on every cron tick, applied uniformly to chore, bug, and feature pipelines
So that **(a) I can pause auto-merge on any issue by adding `hitl`, (b) I can unblock a paused merge by either removing `hitl` or approving the PR, and (c) the chore pipeline does not bypass the gate that protects feature/bug merges.**

## Problem Statement

Three distinct defects, all rooted in drift from the original auto-merge intent:

1. **Wrong gate condition in `adwMerge.tsx`.** Issue #488/#489 replaced the original `issueHasLabel('hitl')` gate with `fetchPRApprovalState`. Approval was meant to be one of two ways to satisfy the gate, not a replacement. Today, an unlabeled chore PR on a repo with no branch protection cannot auto-merge unless a human approves it — defeating the purpose of an unattended chore pipeline.
2. **Two parallel merge paths with two different gate conditions.** `adwMerge.tsx` runs the (broken) approval-only gate; the chore pipeline historically called `approvePR + mergePR` inline with no gate. The current `adws/adwChore.tsx` exits to `awaiting_merge` (so it does flow into `adwMerge`), but it never calls `approvePR` at all on the `safe` path — meaning a chore without a `hitl` label cannot satisfy the current approval-only gate either. Result: chore PRs sit in `awaiting_merge` forever on unprotected repos.
3. **`fetchPRApprovalState` empty-string bug.** `gh pr view --json reviewDecision` returns `""` (not `null`) on unprotected repos. The current type-narrow guard `reviewDecision !== null && reviewDecision !== undefined` evaluates to `true` for `""`, so the function returns `false` instead of falling back to `isApprovedFromReviewsList`. Even an explicit human approval cannot unblock a `hitl`-deferred PR on `paysdoc/AI_Dev_Workflow` itself — rule 3 is broken.

## Solution Statement

Three coordinated edits, ordered so each builds on the previous:

1. **Fix `fetchPRApprovalState`** (hard prerequisite — without this, the new rule 3 cannot work on unprotected repos):
   ```ts
   if (reviewDecision === 'APPROVED') return true;
   if (reviewDecision) return false;            // any non-empty value other than APPROVED
   return isApprovedFromReviewsList(reviews || []);
   ```

2. **Restore `hitl` as the first-class gate in `adwMerge.tsx`**, layered with approval as the second satisfier. Inject `issueHasLabel` into `MergeDeps` so the unit-test surface mirrors `fetchPRApprovalState`. Replace the existing approval-only block with:
   ```ts
   const hitlOnIssue = deps.issueHasLabel(issueNumber, 'hitl', repoInfo);
   const isApproved = deps.fetchPRApprovalState(prNumber, repoInfo);
   if (hitlOnIssue && !isApproved) {
     log(`Issue #${issueNumber} has hitl label and PR #${prNumber} is not approved — deferring`, 'info');
     return { outcome: 'abandoned', reason: 'hitl_blocked_unapproved' };
   }
   ```
   No state write, no PR/issue comment, no label mutation — pure log-and-return. Cron re-checks on the next tick.

3. **Add chore-level conditional approval in `adwChore.tsx`.** After the existing `executePRPhase` call and before `AgentStateManager.writeTopLevelState(... 'awaiting_merge')`, insert:
   ```ts
   const hitlOnIssue = issueHasLabel(issueNumber, 'hitl', repoInfo);
   if (!hitlOnIssue && config.ctx.prUrl) {
     const prNumber = extractPrNumber(config.ctx.prUrl);
     if (prNumber) approvePR(prNumber, repoInfo);
   }
   ```
   Race accepted: a human can add `hitl` between this approval and the next cron tick, but the gate is permissive in that case (rule 3 — approval still satisfies). The `regression_possible` path also runs `executeReviewPhase`, which already approves on review-pass — that approval remains untouched (idempotent against the chore-level approval). Skipping the chore-level approval when `hitl` is present prevents auto-bypass of an in-progress human review.

What stays unchanged:

- `hitl` lives on the **issue** only (never read from PR labels).
- The pipeline never adds or removes `hitl` — humans/external processes only. (Note: `executeAutoMergePhase` at `adws/phases/autoMergePhase.ts:69-88` still adds `hitl` as an "informational marker" — this phase is invoked by review-pipeline orchestrators, not by chore. Unchanged in this issue; tracked separately in #488 scenarios.)
- `## Cancel` semantics unchanged. After cancel + re-run, the new run's gate evaluates the **current** label state (the gate is stateless — rule 4).
- `CHANGES_REQUESTED` reviews continue to set `reviewDecision !== 'APPROVED'` and therefore do not satisfy approval — humans must use `hitl` to gate.
- No grace period after PR creation; the disciplined workflow remains "pre-add `hitl` on the issue before the orchestrator opens the PR."
- The diff evaluator's `safe` vs `regression_possible` classification still routes which automated phases run inside the chore pipeline; it no longer affects merge-or-not.
- `adwPrReview` (PR-comment-driven patch flow) is not involved in the merge gate — it pushes commits, the merge still flows through `adwMerge`.

## Relevant Files

Use these files to implement the feature:

### Files to modify

- `adws/github/prApi.ts` — Contains `fetchPRApprovalState` (lines 333-354). Must change the `null/undefined` guard at line 346 to a falsy guard so empty string `""` flows to the `isApprovedFromReviewsList` fallback. Per-reviewer-aggregation helper `isApprovedFromReviewsList` (lines 293-315) is unchanged.
- `adws/adwMerge.tsx` — Contains `executeMerge` (lines 64-195) and the current approval-only gate at lines 128-135. Must add `issueHasLabel` to the `MergeDeps` interface (lines 44-58), wire it in `buildDefaultDeps` (lines 198-214), and replace the approval-only check with the unified `(no hitl) OR approved` condition. Imports at line 30 must add `issueHasLabel`.
- `adws/adwChore.tsx` — Contains the chore orchestrator's main loop (lines 78-179). Must import `issueHasLabel`, `approvePR`, and `extractPrNumber` (the latter from `adws/adwBuildHelpers.ts`), and insert a conditional `approvePR` call between the existing `executePRPhase` (line 151) and the `writeTopLevelState('awaiting_merge')` write (line 153). The unconditional `awaiting_merge` write is correct and must remain.
- `adws/__tests__/adwMerge.test.ts` — Existing Vitest suite for `executeMerge`. Must add `issueHasLabel: vi.fn().mockReturnValue(false)` to `makeDeps` defaults, and add a new `describe('executeMerge — hitl × approved gate matrix', ...)` block covering all four (hitl × approved) cells per acceptance criteria. The existing `describe('executeMerge — approval gate', ...)` (lines 262-316) must be updated since the `awaiting_approval` reason is replaced by `hitl_blocked_unapproved` and only fires when both `hitl` is on the issue AND the PR is not approved.
- `adws/github/__tests__/prApi.test.ts` — Existing Vitest suite for `fetchPRApprovalState` (lines 91-184). Must add cases covering `reviewDecision === ""`: (a) empty string + empty reviews → `false`, (b) empty string + single APPROVED review → `true`, (c) empty string + CHANGES_REQUESTED → `false`. Also add `reviewDecision === undefined` for completeness.
- `README.md` — Currently mentions `## Cancel` (line 122) but does not document the four `hitl` rules or the disciplined pre-add workflow. Add a new `## Auto-merge gate` (or extend the existing operator section) with the four rules, the gate condition, and the cancel/re-run interaction.
- `UBIQUITOUS_LANGUAGE.md` — Line 22 currently defines `HITL` as "When present at auto-merge time, the Orchestrator skips PR approval and merge, leaving the PR open for human review." This is still correct under the new rules but should be tightened to mention that approval also satisfies the gate (rule 3) and that the check is real-time (no cached state).

### New files

- `features/unify_auto_merge_hitl_gate.feature` — New BDD feature with `@adw-496` tag. Covers the issue's stated minima (four rules-matrix scenarios, one chore unified-path scenario, one empty-string `reviewDecision` fallback scenario) plus source-file inspection scenarios that pin the import/dependency contracts (`adwMerge.tsx` imports `issueHasLabel`/`fetchPRApprovalState`; `MergeDeps` declares both; `buildDefaultDeps` wires both; the gate-closed branch returns `hitl_blocked_unapproved` and posts no comment) and documentation scenarios (README documents the four rules, the pre-add workflow, and the `## Cancel` interaction). Organised into seven sections: (1) `fetchPRApprovalState` empty-string fallback, (2) `adwMerge.tsx` unified gate, (3) the four canonical rules matrix, (4) chore unified path, (5) hitl-on-PR-is-never-read invariants, (6) README/docs assertions, (7) TypeScript type-check.
- `features/step_definitions/autoMergeUnifiedGateSteps.ts` — Step definitions for the new feature file. Reuses existing helpers from `features/step_definitions/hitlLabelGateAutomergeSteps.ts` and `features/step_definitions/autoMergeApprovedPrSteps.ts` where possible.

### Files to read for context (do not modify)

- `adws/phases/autoMergePhase.ts` — Reference implementation of the existing `hitl` gate at lines 67-88 (used by review-pipeline orchestrators). Demonstrates the `issueHasLabel + addIssueLabel + commentOnIssue` flow. **Do not modify** in this issue — its `hitl`-as-marker behavior is preserved per #488 scenarios.
- `adws/phases/reviewPhase.ts` — `executeReviewPhase` calls `approvePR` at line 110 (only when `isGitHubAppConfigured() && GITHUB_PAT && ctx.prUrl`). This approval is idempotent against the new chore-level approval and remains unchanged.
- `adws/github/issueApi.ts` — `issueHasLabel` definition at lines 264-285. Returns `false` on error (fail-open — if the check cannot complete, the gate is permissive).
- `adws/github/index.ts` — Re-exports `issueHasLabel`, `approvePR`, `fetchPRApprovalState`, etc. Confirms the import surface for `adwChore.tsx`.
- `adws/triggers/trigger_cron.ts` — Lines 156-170 show how the cron dispatches `adwMerge.tsx` for `awaiting_merge` issues. Confirms that no cron-side change is needed; the gate runs inside `adwMerge`.
- `adws/adwBuildHelpers.ts` — Exports `extractPrNumber` (used by `adwChore` to parse `ctx.prUrl`).
- `adws/types/workflowTypes.ts` — `WorkflowStage` enum (lines 6-63). The defer path returns `{ outcome: 'abandoned', reason: 'hitl_blocked_unapproved' }` without writing state, so no new stage is needed; `awaiting_merge` is preserved across the defer.
- `features/hitl_label_gate_automerge.feature` — Existing `@adw-488` BDD feature. Several scenarios (e.g. line 105 "adwMerge.tsx no longer imports issueHasLabel", line 110 "adwMerge.tsx no longer references the hitl label", line 117 "MergeDeps interface drops issueHasLabel", line 124 "buildDefaultDeps does not return an object containing issueHasLabel", line 188 "no call to issueHasLabel is made") **directly contradict** this issue's acceptance criteria. These contradicting scenarios in the existing `.feature` file must be removed or rewritten to reflect that `issueHasLabel` is now a first-class dependency in the unified gate.
- `features/auto_merge_approved_pr.feature` — Existing `@adw-cwiuik` and `@adw-lvakyr` scenarios about approval-driven merge. Verify these still hold under the new gate (they should — approval still satisfies the gate via rule 3).
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — Conditional doc per `.adw/conditional_docs.md:11-17`. Documents the original `hitl` gate from #483. This doc describes a behavior we are partially restoring — useful background, do not edit unless the doc becomes inaccurate after this change.
- `app_docs/feature-29w5wf-reclassify-abandoned-discarded-call-sites.md` — Conditional doc per `.adw/conditional_docs.md:27-33`. Distinguishes `MergeRunResult.outcome` (dispatcher label) from `workflowStage` (cron-sweeper classification). The new defer path uses `outcome: 'abandoned'` with no state write — this matches the existing documented pattern.
- `guidelines/coding_guidelines.md` — Project-wide coding standards. Strict TypeScript mode, no `any`, isolate side effects, prefer pure functions. Apply throughout.
- `.adw/project.md` — Confirms unit tests are enabled (`## Unit Tests: enabled`).
- `.adw/scenarios.md` — Confirms BDD scenario directory (`features/`) and tag-run command.

## Implementation Plan

### Phase 1: Foundation — fix the empty-string `reviewDecision` bug

Without this fix, the new rule 3 cannot work on `paysdoc/AI_Dev_Workflow` itself or any unprotected target repo: an approval cannot unblock a `hitl`-deferred PR. Land this first so subsequent gate-logic work has a working approval signal.

### Phase 2: Core Implementation — unified gate in `adwMerge.tsx`

Add `issueHasLabel` to `MergeDeps`, wire it in `buildDefaultDeps`, and replace the existing approval-only block (lines 128-135) with the unified `(no hitl) OR approved` condition. Update the `adwMerge` Vitest suite to cover all four (hitl × approved) cells.

### Phase 3: Integration — conditional approval in `adwChore.tsx` and BDD coverage

Add the conditional `approvePR` call in `adwChore.tsx` after `executePRPhase`, gated on `!issueHasLabel('hitl')`. Then add the new `@adw-496` BDD feature with six scenarios (four-rule matrix + chore unified path + empty-string fallback), update the contradicting scenarios in `features/hitl_label_gate_automerge.feature`, and update the README and `UBIQUITOUS_LANGUAGE.md` documentation.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1 — Fix `fetchPRApprovalState` empty-string bug

- Open `adws/github/prApi.ts`.
- In `fetchPRApprovalState` (lines 333-354), replace lines 345-349 with:
  ```ts
  if (reviewDecision === 'APPROVED') return true;
  if (reviewDecision) return false;            // any non-empty value other than APPROVED
  return isApprovedFromReviewsList(reviews || []);
  ```
- Update the JSDoc above the function to mention that `""` (empty string), `null`, and `undefined` all flow to the `isApprovedFromReviewsList` fallback.
- Update the inline comment "// reviewDecision is null — fall back to per-reviewer aggregation" to "// reviewDecision is null/undefined/empty — fall back to per-reviewer aggregation".

### Step 2 — Extend `prApi.test.ts` with empty-string fallback cases

- Open `adws/github/__tests__/prApi.test.ts`.
- In the `describe('fetchPRApprovalState', ...)` block (line 93), add the following cases under the existing `it('returns false when reviewDecision is null and empty reviews list', ...)`:
  - `it('returns false when reviewDecision is "" and empty reviews list', ...)` — mock `{ reviewDecision: '', reviews: [] }`, expect `false`.
  - `it('returns true when reviewDecision is "" and a single APPROVED review (unprotected repo)', ...)` — mock `{ reviewDecision: '', reviews: [makeReview('alice', 'APPROVED', '...')] }`, expect `true`.
  - `it('returns false when reviewDecision is "" and a CHANGES_REQUESTED review', ...)` — mock `{ reviewDecision: '', reviews: [makeReview('alice', 'CHANGES_REQUESTED', '...')] }`, expect `false`.
  - `it('returns false when reviewDecision is undefined (treated as no decision)', ...)` — mock `{ reviewDecision: undefined, reviews: [] }`, expect `false`.
  - `it('returns true when reviewDecision is undefined and a single APPROVED review', ...)` — mock `{ reviewDecision: undefined, reviews: [makeReview('alice', 'APPROVED', '...')] }`, expect `true`.

### Step 3 — Run `prApi.test.ts` to confirm Step 1+2 work

- Run `bun run test:unit -- adws/github/__tests__/prApi.test.ts`.
- All existing tests must still pass; the five new tests must pass.

### Step 4 — Add `issueHasLabel` to `MergeDeps` in `adwMerge.tsx`

- Open `adws/adwMerge.tsx`.
- Add `issueHasLabel` to the imports from `./github` at line 30.
- In the `MergeDeps` interface (lines 44-58), add:
  ```ts
  readonly issueHasLabel: (issueNumber: number, labelName: string, repoInfo: RepoInfo) => boolean;
  ```
- In `buildDefaultDeps` (lines 198-214), add `issueHasLabel,` to the returned object.

### Step 5 — Replace the approval-only gate with the unified `(no hitl) OR approved` gate in `adwMerge.tsx`

- In `executeMerge` (lines 64-195), replace lines 128-135 (the current `5b. Approval gate` block) with:
  ```ts
  // 5b. Unified gate — defer when hitl is on the issue AND the PR is not approved.
  //     Stateless: every cron tick re-evaluates the current label state and PR approval.
  //     No state write, no comment, log only — avoids flooding the issue while waiting.
  const hitlOnIssue = deps.issueHasLabel(issueNumber, 'hitl', repoInfo);
  const isApproved = deps.fetchPRApprovalState(prNumber, repoInfo);
  if (hitlOnIssue && !isApproved) {
    log(`Issue #${issueNumber} has hitl label and PR #${prNumber} is not approved — deferring`, 'info');
    return { outcome: 'abandoned', reason: 'hitl_blocked_unapproved' };
  }
  ```
- The state stays `awaiting_merge` (no write); no PR/issue comment is posted; cron will re-spawn `adwMerge` on the next tick.

### Step 6 — Update `adwMerge.test.ts` to cover the four (hitl × approved) cells

- Open `adws/__tests__/adwMerge.test.ts`.
- Add `issueHasLabel: vi.fn().mockReturnValue(false)` to `makeDeps` (lines 38-55), so existing tests continue to behave as if no `hitl` label is present.
- Update the `describe('executeMerge — approval gate', ...)` block (lines 262-316):
  - Rename the first test from `'returns awaiting_approval and skips merge when PR is not approved on OPEN PR'` to `'with no hitl label, an unapproved PR still merges (gate satisfied by rule 1)'`. Mock `issueHasLabel` → `false`, `fetchPRApprovalState` → `false`. Expect `outcome === 'completed'`, `mergeWithConflictResolution` called.
  - Keep the two terminal-state tests (`MERGED skips approval check`, `CLOSED skips approval check`).
  - Update the last test (`'proceeds to merge when PR is approved on OPEN PR'`) — assert `issueHasLabel` may return either value; the test name should explicitly be `'with no hitl and PR approved, merge proceeds'`.
- Add a new `describe('executeMerge — hitl × approved gate matrix', ...)` block with four scenarios:
  - `'rule 1: no hitl + not approved → merge (gate open)'` — `issueHasLabel: false, fetchPRApprovalState: false` → `outcome === 'completed'`, `mergeWithConflictResolution` called.
  - `'rule 2: hitl + not approved → defer with reason hitl_blocked_unapproved'` — `issueHasLabel: true, fetchPRApprovalState: false` → `outcome === 'abandoned'`, `reason === 'hitl_blocked_unapproved'`, `writeTopLevelState` NOT called, `mergeWithConflictResolution` NOT called, `commentOnIssue` NOT called, `commentOnPR` NOT called.
  - `'rule 3: hitl + approved → merge (gate satisfied by approval)'` — `issueHasLabel: true, fetchPRApprovalState: true` → `outcome === 'completed'`, `mergeWithConflictResolution` called.
  - `'rule 4: no hitl + approved → merge (gate open via rule 1)'` — `issueHasLabel: false, fetchPRApprovalState: true` → `outcome === 'completed'`, `mergeWithConflictResolution` called.
- Add one additional test: `'defer logs a message naming the issue and PR'` — `issueHasLabel: true, fetchPRApprovalState: false`. Spy on the `log` function (re-export or import from `../core` in the test) and assert the log message contains the issue number and the PR number.

### Step 7 — Run `adwMerge.test.ts` to confirm Steps 4-6 work

- Run `bun run test:unit -- adws/__tests__/adwMerge.test.ts`.
- All existing tests (with the `issueHasLabel` default mock) must still pass; the four matrix tests + log assertion must pass.

### Step 8 — Add chore-level conditional approval in `adwChore.tsx`

- Open `adws/adwChore.tsx`.
- Add imports: `issueHasLabel`, `approvePR` from `./github`; `extractPrNumber` from `./adwBuildHelpers`.
- After the existing `await runPhase(config, tracker, executePRPhase);` (line 151) and **before** `AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });` (line 153), insert:
  ```ts
  // Pre-merge approval (chore unified path): approve the PR unless the human has signalled
  // hitl on the issue at this moment. Race accepted — a human can add hitl between this
  // approval and the next cron tick; the merge gate is permissive in that case (rule 3).
  if (config.repoContext && config.ctx.prUrl) {
    const repoInfo = { owner: config.repoContext.repoId.owner, repo: config.repoContext.repoId.repo };
    const prNumber = extractPrNumber(config.ctx.prUrl);
    if (prNumber && !issueHasLabel(issueNumber, 'hitl', repoInfo)) {
      log(`Chore: pre-approving PR #${prNumber} (no hitl on issue #${issueNumber})`, 'info');
      const result = approvePR(prNumber, repoInfo);
      if (!result.success) {
        log(`Chore: pre-approval failed (non-fatal — hitl-removed humans can still approve manually): ${result.error}`, 'warn');
      }
    } else if (prNumber) {
      log(`Chore: skipping pre-approval — issue #${issueNumber} has hitl label`, 'info');
    }
  }
  ```
- The existing `writeTopLevelState('awaiting_merge')` write at line 153 stays unchanged. The cron will dispatch `adwMerge` on the next tick; `adwMerge`'s unified gate evaluates the current `hitl` and approval state.

### Step 9 — Verify no inline `mergePR` call exists in `adwChore.tsx`

- Grep `adws/adwChore.tsx` for `mergePR(`. There must be zero matches. (The chore exits to `awaiting_merge` and lets `adwMerge.tsx` perform the merge.) If a stale `mergePR` call is found, remove it.

### Step 10 — Reconcile existing BDD scenarios in `features/hitl_label_gate_automerge.feature` with the unified gate

- Open `features/hitl_label_gate_automerge.feature`.
- The file's top-level tag line must include `@adw-496` alongside `@adw-488` so the regression suite picks up the rewritten scenarios under both feature tags.
- The file's preamble must explain that #488 was a single-condition gate (approval-only) and #496 reverses it into the unified `(no hitl on issue) OR (PR is approved)` rule documented in `unify_auto_merge_hitl_gate.feature`.
- Each #488 scenario that previously asserted the *removal* of `issueHasLabel` from `adwMerge.tsx` must be inverted (and re-tagged `@adw-488 @adw-496`) so it now asserts the import, reference, and dependency contracts of the unified gate:
  - `adwMerge.tsx imports issueHasLabel for the unified hitl gate`
  - `adwMerge.tsx references the hitl label for the unified gate`
  - `MergeDeps interface declares both issueHasLabel and fetchPRApprovalState`
  - `buildDefaultDeps wires both fetchPRApprovalState and issueHasLabel`
- The gate-closed scenarios must be rewritten so the defer condition is `(hitl on issue AND PR not approved)`, the reason is `hitl_blocked_unapproved` (renamed from `awaiting_approval`), and the log message contains `deferring`. Specifically:
  - `adwMerge.tsx skips mergeWithConflictResolution when the gate is closed (hitl on issue and PR not approved)`
  - `adwMerge.tsx gate-closed branch returns abandoned with reason "hitl_blocked_unapproved"`
  - `adwMerge.tsx gate-closed branch does not call writeTopLevelState`
  - `adwMerge.tsx logs a deferring message when the gate is closed`
- The `executeMerge` behavioural defer scenario (previously asserted `awaiting_approval` on `fetchPRApprovalState=false` alone) must require `hitl` *also* present and assert `reason "hitl_blocked_unapproved"`.
- The `executeMerge` rule-3 behavioural scenario must assert that `issueHasLabel` is consulted but a true `fetchPRApprovalState` overrides the hitl block and the merge proceeds via `mergeWithConflictResolution`.
- Inline NOTE comments above each rewritten block must explain the #488 → #496 transition so future readers can see why the original assertions were inverted.

### Step 11 — Create the new `@adw-496` BDD feature file

- Create `features/unify_auto_merge_hitl_gate.feature`, tagged `@adw-496` at the top, with a preamble explaining the four canonical rules and the empty-string `reviewDecision` prerequisite, and structured into seven sections:
  1. **`fetchPRApprovalState` empty-string fallback** — six scenarios covering: source-file inspection that asserts the function treats empty-string `reviewDecision` the same as `null` and calls `isApprovedFromReviewsList` in that case; behavioural scenarios for `reviewDecision = ""` with empty reviews list (false), with single APPROVED review (true), `"APPROVED"` (true), `"REVIEW_REQUIRED"` (false); contract scenario asserting the source no longer compares `reviewDecision` against `null/undefined` exclusively.
  2. **`adwMerge.tsx` unified gate** — seven source-file inspection scenarios pinning: imports of `issueHasLabel` and `fetchPRApprovalState`; `MergeDeps` declares both fields; `buildDefaultDeps` wires both; both gate calls precede `mergeWithConflictResolution`; gate-closed branch returns reason `hitl_blocked_unapproved` and does not call `mergeWithConflictResolution` or `writeTopLevelState`; logs a `deferring` message; gate-closed branch posts no `commentOnIssue`/`commentOnPR`.
  3. **The four canonical rules — gate_open behaviour matrix** — four behavioural scenarios (one per rule) covering all cells of the (hitl × approved) matrix, including a stateless-re-evaluation scenario for rule 4 that invokes `executeMerge` twice across changing `hitl` state.
  4. **Chore unified path** — six scenarios covering: `adwChore.tsx` does not contain `mergePR`; writes `awaiting_merge` after PR approval; imports `issueHasLabel`; skips `approvePR` when the issue carries `hitl`; calls `approvePR` once when the issue does not carry `hitl`; does not contain `mergeWithConflictResolution` (only `adwMerge` dispatches the merge).
  5. **hitl-on-PR is never read** — three source-file inspection scenarios: `adwMerge.tsx` calls `issueHasLabel` with the issue number and the literal label name `"hitl"`; `adwMerge.tsx` does not contain `addIssueLabel`/`removeIssueLabel`; `adwChore.tsx` does not contain `addIssueLabel`/`removeIssueLabel`.
  6. **README/docs** — three documentation scenarios: README contains the four rules and the gate-condition phrasing `(no hitl on issue) OR`; README contains `pre-add` and `hitl`; README contains `## Cancel` and `stateless`.
  7. **TypeScript type-check** — one scenario: the ADW TypeScript type-check passes after the unified hitl/approval gate change.
- Use the wording conventions from `features/hitl_label_gate_automerge.feature` (e.g. `the issue carries the "hitl" label` rather than `has`; `awaiting_merge state file for adw-id "..."` background helpers).
- Tag every behavioural and source-inspection scenario with `@adw-496 @regression`; tag README scenarios with `@adw-496` only.
- Mirror the `Background:\n    Given the ADW codebase is checked out` structure from `features/hitl_label_gate_automerge.feature`.

### Step 12 — Create step definitions for the new feature

- Create `features/step_definitions/unifyAutoMergeHitlGateSteps.ts` (camelCase mirror of the feature filename `unify_auto_merge_hitl_gate.feature`).
- Implement the new step phrases used by the feature file: `Given the issue carries (/does not carry) the "hitl" label`, `And fetchPRApprovalState returns true(/false) for the PR`, `When executeMerge is invoked (twice) for issue NNN with the injected deps`, `Then the outcome is "abandoned" with reason "hitl_blocked_unapproved"`, `Then mergeWithConflictResolution is (not) called with the PR number`, the rule-4 two-tick variants, the chore-pipeline approval-gate evaluators, and the source-file-content assertions used by the inspection scenarios (`the file imports "X"`, `the MergeDeps interface declares a "X" field`, `"X" is called before "Y"`, `the gate-closed branch does not call "X"`, `the call to "issueHasLabel" passes the issue number ... as its first argument`, etc.).
- Reuse helpers and patterns from `features/step_definitions/hitlLabelGateAutomergeSteps.ts` (existing `@adw-488` step defs that already construct a fake `MergeDeps` and assert file-content invariants); import and extend rather than duplicate.
- For the chore source-inspection assertions and the empty-string `reviewDecision` source assertions, mirror the file-read + content-assertion pattern from `hitlLabelGateAutomergeSteps.ts`.
- For the README scenarios, reuse a `Given "README.md" is read` + `Then the file contains "..."` helper (introduce a shared one in `commonSteps.ts` if absent).

### Step 13 — Update `README.md` with the four canonical rules

- Open `README.md`.
- Add a new section after `## Single-host constraint` (or extend the existing operator guidance) titled `## Auto-merge gate`. Include:
  - The single gate condition: `gate_open = (no hitl on issue) OR (PR is approved)`.
  - The four rules as a numbered list (matching the issue's "Original intent (canonical)" section).
  - The disciplined pre-add workflow: "If you want a merge to be human-gated, add the `hitl` label to the issue **before** the orchestrator opens the PR."
  - The `## Cancel` interaction: "After cancel + re-run, the new run's gate evaluates the **current** label state — the gate is stateless, so removing `hitl` between cycles is sufficient to re-enable auto-merge."
  - A note that the chore pipeline now uses the same gate (no longer bypasses).

### Step 14 — Tighten the `HITL` definition in `UBIQUITOUS_LANGUAGE.md`

- Open `UBIQUITOUS_LANGUAGE.md`.
- Update line 22 (`HITL` row) to reflect the unified gate. Suggested wording:
  > **HITL** | A GitHub label (`hitl`) applied to an Issue to gate auto-merge. The merge gate evaluates `(no hitl on issue) OR (PR is approved)` on every cron tick. When `hitl` is present and the PR is not approved, the orchestrator defers the merge with no state write. When the PR is approved (server-computed `reviewDecision === 'APPROVED'`, or per-reviewer aggregation when no branch protection), the merge proceeds regardless of the label. The label is checked in real time via a fresh API call, not cached from Workflow start. | human-review, manual-merge, hold

### Step 15 — Run TypeScript type-check

- Run `bunx tsc --noEmit -p adws/tsconfig.json` (per `.adw/commands.md` `## Additional Type Checks`).
- Must complete with zero errors.

### Step 16 — Run the full Vitest unit-test suite

- Run `bun run test:unit`.
- All existing tests must pass; the new tests added in Steps 2 and 6 must pass.

### Step 17 — Run the new BDD scenarios for `@adw-496`

- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-496"` (per `.adw/scenarios.md`).
- All six new scenarios must pass.

### Step 18 — Run the existing `@adw-488` BDD scenarios to confirm they still pass after the rewrites in Step 10

- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-488"`.
- All scenarios must pass; the rewritten scenarios must reflect the unified gate.

### Step 19 — Run the regression suite

- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` (per `.adw/scenarios.md`).
- All regression scenarios must pass.

### Step 20 — Run the lint and build commands

- Run `bun run lint` and `bun run build`.
- Both must complete with zero errors.

### Step 21 — Final validation

- Execute every command in the `Validation Commands` section below to confirm zero regressions.

## Testing Strategy

### Unit Tests

Per `.adw/project.md` (`## Unit Tests: enabled`), add the following Vitest unit tests:

**`adws/github/__tests__/prApi.test.ts`** — extend the existing `describe('fetchPRApprovalState', ...)` block with five new cases covering empty string and undefined `reviewDecision`:
- `reviewDecision === ""` + empty reviews → `false`
- `reviewDecision === ""` + single APPROVED review → `true` (the bug-fix case — paysdoc/AI_Dev_Workflow uses this path)
- `reviewDecision === ""` + CHANGES_REQUESTED review → `false`
- `reviewDecision === undefined` + empty reviews → `false`
- `reviewDecision === undefined` + APPROVED review → `true`

**`adws/__tests__/adwMerge.test.ts`** — extend `makeDeps` with `issueHasLabel: vi.fn().mockReturnValue(false)`. Update the existing `describe('executeMerge — approval gate', ...)` block to reflect the unified gate. Add a new `describe('executeMerge — hitl × approved gate matrix', ...)` block with four scenarios covering all cells of the matrix, plus one log-content assertion. All four matrix scenarios must verify:
- The correct `outcome` and `reason`
- Whether `mergeWithConflictResolution` was called
- Whether `writeTopLevelState`, `commentOnIssue`, `commentOnPR` were called
- The order of calls (`findPRByBranch` before `issueHasLabel`/`fetchPRApprovalState`; both gate checks before `mergeWithConflictResolution`)

**`adws/__tests__/` (new test for `adwChore.tsx` chore-level approval, OPTIONAL)** — `adwChore.tsx` does not currently have a Vitest unit test; the chore pipeline is covered end-to-end by BDD scenarios. Adding a unit test for the new approval block would require extracting it into a testable helper. **Recommended approach:** skip the unit test for `adwChore.tsx` and rely on the `@adw-496` BDD "Chore unified path" scenario for coverage. If a unit test is added, extract `maybeApproveBeforeMerge(issueNumber, repoInfo, prUrl, deps)` into a small testable helper and inject `issueHasLabel`, `approvePR`, and `log`.

### Edge Cases

1. **`reviewDecision === ""` on unprotected repo + single APPROVED review** — must return `true` (this is the canonical bug being fixed; verifies rule 3 works on `paysdoc/AI_Dev_Workflow`).
2. **`reviewDecision === ""` + empty reviews list** — must return `false` (empty-string fallback must not blanket-accept).
3. **`reviewDecision === ""` + CHANGES_REQUESTED** — must return `false` (changes requested still blocks).
4. **Both `hitl` is on the issue AND the PR is approved (rule 3)** — must merge. This is the explicit human "approved despite hitl" override.
5. **`hitl` was on the issue at the moment `adwChore.tsx` checked, but a human removed it before the cron tick (race)** — chore skipped approval, but cron's gate sees no `hitl` → rule 1 fires → merge proceeds without approval. **This is intentional.** A human who removes `hitl` is signalling "let it merge."
6. **`hitl` was NOT on the issue when `adwChore.tsx` approved, but a human added it before the cron tick (race)** — chore approved, cron's gate sees `hitl + approved` → rule 3 fires → merge proceeds. **This is intentional, as documented in the issue.** A human who wants to override this race must use `## Cancel` to stop the workflow.
7. **`issueHasLabel` throws (network error)** — `issueHasLabel` returns `false` (fail-open per its implementation at `adws/github/issueApi.ts:283-284`). The gate becomes permissive (rule 1 fires). This is the existing fail-open contract; document it but do not change it.
8. **`fetchPRApprovalState` throws (network error)** — returns `false` (per existing catch at `adws/github/prApi.ts:350-353`). Combined with `issueHasLabel === true` (if `hitl` is set), the gate defers; with `issueHasLabel === false`, the gate opens via rule 1. Existing fail-open contract; unchanged.
9. **`hitl` label name case sensitivity** — `issueHasLabel` uses `l.name === labelName` (case-sensitive). The label is `'hitl'` lowercase. Document but do not change.
10. **`adwMerge.tsx` cron re-entry** — every cron tick re-spawns `adwMerge`, which re-evaluates the gate. The `awaiting_merge` state is preserved across defers. No state-machine evolution needed.
11. **Webhook auto-merge path (`adws/triggers/autoMergeHandler.ts`)** — out of scope; unchanged. The cron path (`adwMerge`) is the canonical one; the webhook handler still runs but is being phased out per `@adw-lvakyr-remove-webhook-auto`.
12. **`CHANGES_REQUESTED` reviews** — by design, do NOT satisfy approval. Humans wanting to gate must use `hitl`, per the issue's "What stays the same" section.

## Acceptance Criteria

- [ ] `adws/github/prApi.ts:fetchPRApprovalState` treats empty-string `reviewDecision` and `undefined` identically to `null` and falls back to `isApprovedFromReviewsList`.
- [ ] `adws/adwMerge.tsx:executeMerge` evaluates `hitlOnIssue && !isApproved → defer` (with no state write, no comment, log only) and merges in all other cases.
- [ ] `adws/adwMerge.tsx:MergeDeps` declares both `issueHasLabel` and `fetchPRApprovalState` as injectable dependencies; `buildDefaultDeps` wires both.
- [ ] `adws/adwChore.tsx` no longer calls `mergePR` inline (verified by grep) and continues to exit in `awaiting_merge` after PR creation.
- [ ] `adws/adwChore.tsx` calls `approvePR` only when `issueHasLabel(issueNumber, 'hitl', repoInfo)` returns `false` at chore-completion time.
- [ ] Unit tests in `adws/github/__tests__/prApi.test.ts` cover empty-string `reviewDecision`, `null`, `undefined`, `'APPROVED'`, `'CHANGES_REQUESTED'`, `'REVIEW_REQUIRED'`, and the per-reviewer-aggregation fallback path.
- [ ] Unit tests in `adws/__tests__/adwMerge.test.ts` cover all four cells of the `(hitl × approved)` matrix.
- [ ] Unit tests verify the defer log message names both the issue and the PR and mentions `hitl`.
- [ ] BDD feature `features/unify_auto_merge_hitl_gate.feature` exists, tagged `@adw-496`, with at minimum: four rule-coverage scenarios (rules 1–4), one chore unified-path scenario, and one empty-string `reviewDecision` fallback scenario; additional source-file inspection and documentation scenarios as listed in Step 11.
- [ ] Step definitions in `features/step_definitions/autoMergeUnifiedGateSteps.ts` implement all new step phrases.
- [ ] Existing `@adw-488` scenarios in `features/hitl_label_gate_automerge.feature` that asserted `issueHasLabel` was removed from `adwMerge.tsx` have been rewritten or deleted to reflect the unified gate.
- [ ] `README.md` documents the four `hitl` rules, the gate condition, the `## Cancel` interaction with `hitl`, and the disciplined pre-add workflow.
- [ ] `UBIQUITOUS_LANGUAGE.md` `HITL` definition reflects the unified `(no hitl) OR (PR approved)` gate.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` passes with zero errors.
- [ ] `bun run lint` passes with zero errors.
- [ ] `bun run build` passes with zero errors.
- [ ] `bun run test:unit` passes with zero failures (existing + new tests).
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-496"` passes with zero failures.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-488"` passes with zero failures (rewritten scenarios reflect the unified gate).
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` passes with zero failures.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Ensure dependencies are installed.
- `bun run lint` — Run linter to check for code quality issues. Must complete with zero errors.
- `bunx tsc --noEmit` — Top-level TypeScript type-check. Must complete with zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type-check (per `.adw/commands.md`). Must complete with zero errors.
- `bun run build` — Build the application to verify no build errors. Must complete with zero errors.
- `bun run test:unit -- adws/github/__tests__/prApi.test.ts` — Run the targeted prApi unit-test file (faster feedback loop). Must pass.
- `bun run test:unit -- adws/__tests__/adwMerge.test.ts` — Run the targeted adwMerge unit-test file. Must pass.
- `bun run test:unit` — Run the full Vitest unit-test suite (regression check across all unit tests). Must pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-496"` — Run the six new BDD scenarios. Must pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-488"` — Run the rewritten existing BDD scenarios. Must pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the regression scenario suite. Must pass with zero new failures.

## Notes

- **Coding guidelines** — Strictly adhere to `guidelines/coding_guidelines.md`. In particular: prefer pure functions, isolate side effects (the `issueHasLabel` and `approvePR` calls in `adwChore.tsx` are side-effects; keep them at the orchestrator boundary, do not push them into pure helpers); avoid `any`; favour explicit type narrowing over `!` non-null assertions; follow the existing functional/declarative style in `adws/`.
- **Out of scope (per the issue)** —
  - The `adws/triggers/autoMergeHandler.ts` conflict-detection bugs are tracked separately under #490 (PR #495 in flight). This issue assumes those land first or independently.
  - Recovery for issues already poisoned to `discarded` by old code paths — handled out-of-band (vestmatic#52 was manually flipped; #8 and #43 state files were removed since the issues are closed).
- **Phasing of `executeAutoMergePhase`** — `adws/phases/autoMergePhase.ts` (used by review-pipeline orchestrators, not chore) currently adds `hitl` as an "informational marker" when no APPROVED review exists. Per the issue's "What stays the same" section and the existing `@adw-488` scenario `'autoMergePhase still adds the hitl label as an informational marker'`, this behavior is preserved unchanged. The unified gate in `adwMerge` will see this marker and defer correctly via rule 2.
- **Idempotent double-approval** — In the chore `regression_possible` path, `executeReviewPhase` (line 110) already calls `approvePR` if review passes. The new chore-level approval at the end of the pipeline may double-approve. `gh pr review --approve` is idempotent; this is harmless. If reviewers want to reduce log noise, a future cleanup can route both approvals through a shared "approve-once" helper, but that is out of scope here.
- **Race window between chore approval and cron dispatch** — A human can add `hitl` between the chore-level `approvePR` and the next cron tick. The unified gate is permissive in that case (rule 3): the PR is already approved, so the merge proceeds. This is intentional per the issue. Operators wanting to truly stop a merge mid-race must use `## Cancel`.
- **Related conditional docs** — `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` (the original `hitl` gate from #483) becomes a partial historical reference; consider updating it after this issue lands so future readers see the unified gate. Deferred to a follow-up doc-pass.
- **Library installs** — None required. All dependencies (`vitest`, `cucumber-js`, `gh` CLI, etc.) are already in `package.json`. If a future helper extraction requires a new package, install via `bun add <package>` per `.adw/commands.md`.
