# Feature: Point build continuation prompt at committed state

## Metadata
issueNumber: `561`
adwId: `6uquvb-point-build-continua`
issueJson: `{"number":561,"title":"Point build continuation prompt at committed state","body":"## Parent PRD\n\n`specs/prd/build-context-reset-progress-gate.md`\n\n## What to build\n\nNow that the progress gate (#559) commits the worktree at every checkpoint, a restarted build agent has a durable, lossless record of completed work in git. Change the build continuation prompt so the fresh agent is directed to inspect **committed state** (`git log` / `git diff` against base) as the authoritative record of what is already done, instead of relying on a truncated text summary of the previous agent's output.\n\nEach continuation agent starts with a fresh context window, so it has ample room to read committed state. This protects the gate from churn caused by an agent redoing or reverting earlier work it could not remember.\n\nSee the PRD's **Implementation Decisions → Continuation prompt** section.\n\n## Acceptance criteria\n\n- [ ] The build continuation prompt directs the fresh agent to inspect committed state (`git log`/`git diff` against base) as the source of truth for completed work.\n- [ ] The prompt no longer relies solely on the truncated previous-agent output tail for \"what's already done\".\n- [ ] Behavior is unchanged when there are no prior checkpoint commits (first build pass).\n\n## Blocked by\n\n- Blocked by #559\n\n## User stories addressed\n\n- User story 10","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-09T16:23:30Z","comments":[],"actionableComment":null}`

## Feature Description

The build phase (`adws/phases/buildPhase.ts`) runs a Claude Code build agent that is gracefully terminated and restarted whenever it approaches its token budget (`tokenLimitExceeded`) or Claude Code compacts its context window (`compactionDetected`). On each restart, a **continuation prompt** is built by `buildContinuationPrompt()` (in `adws/phases/planPhase.ts`) and handed to a brand-new agent so it can pick up where the previous one stopped.

Today that continuation prompt tells the fresh agent "what's already done" by embedding the **last 5000 characters of the previous agent's stdout** inside a `<previous-agent-output>` block. This tail is lossy and unreliable: it is truncated, it is prose rather than a precise record, and (in the compaction case) it summarizes an agent whose own memory was already lossily compacted. A fresh agent trusting this tail can redo work that is already complete or revert work it cannot "see" — exactly the churn that the novelty progress gate (#559) is designed to catch and abort on.

Issue #559 changed the build loop so the worktree is **committed at every batch boundary** via the `/commit` agent. As a result there is now a durable, lossless record of completed work in git: the plan commit plus one checkpoint commit per novel batch boundary. Within the current batch, the most recent agent's edits are present in the worktree as **uncommitted changes** on disk. Between the two, git holds the authoritative "what's already done" — far better than a truncated text tail.

This feature rewrites `buildContinuationPrompt()` so the fresh agent is directed to **inspect git state first** — committed checkpoints via `git log` / `git diff` against the base branch, plus uncommitted working-tree changes via `git status` / `git diff` — and to treat that as the source of truth, demoting the previous-output tail to a secondary, possibly-stale hint. Each continuation agent starts with a fresh context window, so it has ample room to read committed state.

## User Story

As an **ADW operator running long, token-heavy build phases that restart across multiple context resets**
I want **each restarted build agent to learn what is already done from the committed git state rather than a truncated text summary**
So that **the agent resumes accurately instead of redoing or reverting earlier work, which keeps the novelty progress gate from aborting a build that is actually making progress.**

## Problem Statement

`buildContinuationPrompt(originalPlanContent, previousOutput, reason)` in `adws/phases/planPhase.ts` constructs the restart prompt by appending a `## Continuation Context` section whose only signal about completed work is the truncated `previousOutput` tail:

```
<previous-agent-output>
{last 5000 chars of previous agent stdout}
</previous-agent-output>
```

This is the **sole** "what's already done" input. It has three weaknesses:

1. **Lossy** — truncated to the last `MAX_CONTINUATION_OUTPUT_LENGTH` (5000) characters; earlier work scrolls out of view.
2. **Imprecise** — free-text narration, not a record of which files/lines actually changed.
3. **Self-defeating under compaction** — when the restart reason is `compaction`, the previous agent's own context was already lossily compacted, so its tail is doubly unreliable.

A fresh agent that over-trusts this tail can re-implement completed steps or revert committed work it cannot account for. Because #559 now keys the progress gate on worktree **tree-hash novelty**, that kind of redo/revert churn can push the tree back to a previously-seen state and trigger a `no_progress` abort — killing a build that was, in reality, progressing.

Meanwhile the authoritative record already exists in the worktree and is going unused by the prompt:
- **Committed checkpoints** — the plan commit plus one commit per novel batch boundary (created by the #559 commit-if-dirty step at line ~225 of `buildPhase.ts`).
- **Uncommitted working-tree changes** — the most recent agent's not-yet-checkpointed edits (within-batch restarts at line ~219 do **not** commit, so this work lives on disk).

## Solution Statement

Rewrite the `## Continuation Context` section produced by `buildContinuationPrompt()` so it directs the fresh agent to inspect git state as the source of truth, and plumb the base branch through so the prompt can name a concrete diff base:

1. **Add an optional `baseBranch?: string` parameter** to `buildContinuationPrompt()`. Both call sites in `buildPhase.ts` pass `config.defaultBranch` (already a field on `WorkflowConfig`). The parameter is optional so the function stays trivially testable and degrades gracefully if a base is ever unavailable.
2. **Rewrite the prompt body** to instruct the agent, before writing any code, to:
   - inspect **committed work** against the base — `git log --oneline --stat origin/<base>..HEAD` and `git diff origin/<base>...HEAD` — as the authoritative record of completed work; and
   - inspect **uncommitted, not-yet-checkpointed work** — `git status`, `git diff`, `git diff --staged` — for edits the previous agent made within the current batch;
   - treat the union of those as already implemented and resume the plan from the first not-yet-done step, **without redoing or reverting** existing work.
3. **Demote the previous-output tail** to an explicitly-labelled secondary, possibly-stale hint. It is retained (so no information is lost) but is no longer the source of truth — satisfying "no longer relies *solely* on the truncated tail."
4. **Keep the first-build-pass behavior unchanged.** The continuation prompt is only ever built on a restart; the very first build agent invocation still receives the raw plan (`planContent`), untouched. When there are no checkpoint commits yet (early in the first batch), the committed-state instructions degrade gracefully — `git log origin/<base>..HEAD` simply shows only the plan commit, and the agent still sees in-progress work via the working-tree commands. The prompt is phrased to expect "there may be only the plan commit," so it never misleads.

<!-- ADW-WARNING: Unresolvable conflict with the BDD scenarios (features/per-issue/feature-561.feature, §2). The scenarios require the committed-state direction to appear ONLY when the build branch carries checkpoint commits beyond the base, and to be OMITTED — old previous-output-only prompt retained — when there are none (e.g. "A continuation prompt for the first build pass does not direct the agent to inspect committed git state"). This plan instead emits the committed-state direction UNCONDITIONALLY from a pure, git-unaware buildContinuationPrompt() and relies on graceful runtime degradation, so it cannot omit the direction in the no-checkpoint case and would fail that scenario. The issue does not adjudicate: AC1/AC2 are phrased unconditionally ("directs the fresh agent to inspect committed state … as the source of truth") while AC3 requires "Behavior is unchanged when there are no prior checkpoint commits (first build pass)" — these contradict each other precisely in the no-checkpoint region. A maintainer must decide. If the scenarios govern, buildContinuationPrompt() must become git-state-aware (a "checkpoint-commits-present" signal plumbed from buildPhase.ts via the #559 git helpers) rather than remaining a pure string function, and Steps 1–3, the tests, and the acceptance criteria above must be revised accordingly. -->


`buildContinuationPrompt()` remains a **pure** function (string in, string out, no I/O), so it is unit-testable without mocks. The `MAX_CONTINUATION_OUTPUT_LENGTH` truncation is preserved. No changes are needed to the re-export sites (`adws/phases/index.ts`, `adws/workflowPhases.ts`) because the signature change is an appended optional parameter. The progress gate, the test/review compaction-recovery path, and the build loop's control flow are all unchanged — this is a prompt-content + parameter-plumbing change only.

## Relevant Files

Use these files to implement the feature:

- `adws/phases/planPhase.ts` — **primary change site.** Defines `buildContinuationPrompt()` (line ~166) and `MAX_CONTINUATION_OUTPUT_LENGTH` (line ~161). Add the optional `baseBranch?: string` parameter and rewrite the `## Continuation Context` string to direct git-state inspection and demote the previous-output tail. Keep the function pure and keep the truncation logic.
- `adws/phases/buildPhase.ts` — **call sites.** `buildContinuationPrompt(planContent, buildResult.output, restartTrigger)` is called at the within-batch restart (line ~219) and the post-checkpoint restart (line ~240). Add `defaultBranch` to the `config` destructure (line ~41) and pass it as the 4th argument at both call sites. No control-flow changes. (File sits at ~298 lines; these edits extend existing lines and add no new ones, staying within the ≤300-line guideline.)
- `adws/phases/workflowInit.ts` — defines `WorkflowConfig` with `defaultBranch: string` (line ~73), confirming the base branch is already resolved and available on `config` (no plumbing beyond the build phase needed). Reference only.
- `adws/vcs/branchOperations.ts` — `getDefaultBranch(cwd?)` (line ~146) and the `origin/<defaultBranch>` fetch/merge/reset idiom used by `workflowInit`; confirms `origin/<base>` is the canonical, locally-available base ref to diff against. Reference only.
- `adws/phases/progressGate.ts` — the #559 pure gate keyed on worktree tree-hash novelty; the mechanism whose churn this feature protects against. Reference only (not modified).
- `adws/agents/buildAgent.ts` — `runBuildAgent()`, which the build loop calls with `currentPlanContent` (the continuation prompt). Reference only (not modified) — confirms the prompt is delivered to a fresh agent each restart.
- `known_issues.md` (repo root) — prose Known Issues registry. The #559 residual notes already live here; no new entry is required for this feature, but read for context on the gate's churn sensitivity.

### New Files

- `adws/phases/__tests__/planPhase.test.ts` — vitest unit tests for `buildContinuationPrompt()` (none exist today). Pure-string assertions, no mocks.

### Conditional Documentation (per `.adw/conditional_docs.md`)

- `app_docs/feature-9zcqhw-detect-compaction-restart-build-agent.md` — **directly relevant**: its conditions include "When modifying `buildContinuationPrompt()` or the `buildPhase.ts` continuation while loop" and the `compaction_recovery` restart path. Read before editing the prompt.
- `app_docs/feature-qej3f4-novelty-progress-gate.md` — **directly relevant**: documents the #559 progress gate that commits the worktree at every checkpoint (the durable record this feature points the prompt at) and the `getHeadTreeHash` / `hasUncommittedChanges` helpers. Read to understand the committed-vs-uncommitted distinction across batch boundaries.

## Implementation Plan

### Phase 1: Foundation
Extend `buildContinuationPrompt()` in `adws/phases/planPhase.ts` with the optional `baseBranch?: string` parameter and rewrite its `## Continuation Context` body to direct the fresh agent at git state (committed checkpoints against the base, plus uncommitted working-tree changes), demoting the previous-output tail to a secondary hint. Preserve purity and the `MAX_CONTINUATION_OUTPUT_LENGTH` truncation.

### Phase 2: Core Implementation
Add unit tests in `adws/phases/__tests__/planPhase.test.ts` covering the new prompt content, the base-branch substitution, the graceful no-base fallback, the preserved truncation, and the `token_limit`/`compaction` reason variants.

### Phase 3: Integration
Wire the base branch through at both `buildContinuationPrompt()` call sites in `adws/phases/buildPhase.ts` by destructuring `defaultBranch` from `config` and passing it as the 4th argument. Run all validation commands to confirm zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Rewrite `buildContinuationPrompt()` to point at committed state

In `adws/phases/planPhase.ts`:

- Add an optional 4th parameter `baseBranch?: string` to `buildContinuationPrompt()`, after `reason`. Update the JSDoc to describe it ("base/default branch to diff committed work against, e.g. `dev`; when omitted, falls back to generic branch-history inspection").
- Keep `MAX_CONTINUATION_OUTPUT_LENGTH` and the existing `truncatedOutput` slice logic unchanged.
- Keep the existing `reasonMessage` (`token_limit` vs `compaction`) logic unchanged.
- Compute a concrete base ref: `const baseRef = baseBranch ? \`origin/${baseBranch}\` : '';` and select committed-state instructions accordingly:
  - **With base** — instruct `git log --oneline --stat <baseRef>..HEAD` and `git diff <baseRef>...HEAD`, naming the base branch.
  - **Without base (fallback)** — instruct `git log --oneline --stat -30` and inspecting the current diff, without emitting a literal `origin/undefined`.
- Replace the `## Continuation Context` body so the fresh agent is told:
  1. The git state of this worktree is the **authoritative record** of what is already done — not the summary below.
  2. Before writing code, inspect **committed work** (the source of truth) using the base-relative `git log`/`git diff` commands above (noting there may be only the plan commit early in the build).
  3. Also inspect **uncommitted, not-yet-checkpointed work** via `git status`, `git diff`, and `git diff --staged`.
  4. Treat the union as already implemented; resume the plan from the first not-yet-done step; do **not** redo or revert existing work.
  5. The `<previous-agent-output>` block remains, but is explicitly marked a secondary, possibly-stale hint.

  Target shape (wording may be refined during implementation):
  ```ts
  return `${originalPlanContent}

  ## Continuation Context

  You are a fresh build agent resuming an in-progress implementation. The previous build agent was ${reasonMessage}.

  **The git state of this worktree is the authoritative record of what is already done — not the summary at the bottom of this prompt.** Earlier agents commit their progress at checkpoints, so completed work is durably recorded in git. Before writing any code, inspect that state and resume from the first step that is not yet done. Do NOT redo or revert work that is already present.

  Inspect committed work (the source of truth for completed work):
  ${committedStateInstructions}

  Also inspect any uncommitted, not-yet-checkpointed work:
  - \`git status\` and \`git diff\` (and \`git diff --staged\`) — edits a previous agent made within the current batch but had not yet committed.

  Treat the union of the committed diff and the current working-tree changes as already implemented, then continue the plan from where it leaves off.

  <previous-agent-output note="secondary hint only — may be stale or truncated; the git state above is authoritative">
  ${truncatedOutput}
  </previous-agent-output>`;
  ```
  where `committedStateInstructions` is the with-base or fallback variant described above.

### 2. Add unit tests for `buildContinuationPrompt()`

- Create `adws/phases/__tests__/planPhase.test.ts` (vitest; pure function, no mocks). Import `buildContinuationPrompt` and `MAX_CONTINUATION_OUTPUT_LENGTH` from `../planPhase`.
- Cover:
  1. **Plan preserved** — output contains the full `originalPlanContent`.
  2. **Committed-state direction with base** — given `baseBranch: 'dev'`, output contains `git log` and `git diff` against `origin/dev` (e.g. `origin/dev..HEAD` and `origin/dev...HEAD`).
  3. **Uncommitted-state direction** — output contains `git status` (and `git diff --staged`) guidance.
  4. **Authoritative-state framing** — output states the git state is authoritative / the source of truth for completed work (asserts the tail is no longer the sole signal).
  5. **Tail demoted but present** — the `<previous-agent-output>` block still appears and carries the previous output, with the secondary/possibly-stale marker.
  6. **Truncation preserved** — a `previousOutput` longer than `MAX_CONTINUATION_OUTPUT_LENGTH` is sliced to its last `MAX_CONTINUATION_OUTPUT_LENGTH` chars in the output; a short output is included whole.
  7. **Reason variants** — `reason: 'compaction'` yields the compaction message; default/`'token_limit'` yields the token-limit message.
  8. **No-base fallback** — when `baseBranch` is omitted, output still gives git-inspection guidance and does **not** contain the literal string `origin/undefined`.

### 3. Wire the base branch through the build-phase call sites

In `adws/phases/buildPhase.ts`:

- Add `defaultBranch` to the `config` destructure at the top of `executeBuildPhase` (line ~41), alongside the existing fields.
- At the within-batch restart call (line ~219), change `buildContinuationPrompt(planContent, buildResult.output, restartTrigger)` to `buildContinuationPrompt(planContent, buildResult.output, restartTrigger, defaultBranch)`.
- At the post-checkpoint restart call (line ~240), make the same change.
- Make no other changes to the loop, the gate wiring, the commit-if-dirty step, or the success path.

### 4. Run the validation commands

- Execute every command in **Validation Commands** below and ensure each exits cleanly with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`buildContinuationPrompt()` (`adws/phases/__tests__/planPhase.test.ts`)** — the eight cases enumerated in Step 2: plan preserved; committed-state direction names `git log`/`git diff` against `origin/<base>`; uncommitted-state direction names `git status`; authoritative-state framing present; previous-output tail retained but demoted; `MAX_CONTINUATION_OUTPUT_LENGTH` truncation preserved (long vs short output); `token_limit` vs `compaction` reason messages; no-base fallback emits no `origin/undefined`. Pure function — no mocks.

These unit tests are the validation surface for this slice. The `buildPhase.ts` wiring (passing `config.defaultBranch`) and the end-to-end restart behavior are exercised by the ADW pipeline's per-issue BDD scenarios generated separately for issue #561; the unit tests above lock down the pure prompt content and its parameters.

### Edge Cases
- **First build pass** — the continuation prompt is never built on the first agent invocation (it receives raw `planContent`); behavior is literally unchanged. (AC #3.)
- **First within-batch continuation (no checkpoint commits yet)** — only the plan commit exists; `git log origin/<base>..HEAD` shows just the plan commit, and the previous within-batch agent's work is visible via `git status`/`git diff`. The prompt expects "there may be only the plan commit," so it does not mislead.
- **Post-checkpoint continuation** — one or more checkpoint commits exist; `git log`/`git diff` against the base show the cumulative committed work.
- **Compaction restart (lossy memory)** — git state is authoritative, directly addressing the doubly-unreliable tail in the compaction case.
- **Empty / missing `baseBranch`** — falls back to generic branch-history inspection; never emits `origin/undefined`.
- **Very large previous output** — truncation to the last `MAX_CONTINUATION_OUTPUT_LENGTH` chars is preserved; the tail is secondary, so its lossiness no longer drives correctness.

## Acceptance Criteria
- [ ] `buildContinuationPrompt()` directs the fresh agent to inspect committed state (`git log` / `git diff` against the base branch) as the source of truth for completed work.
- [ ] The prompt also directs inspection of uncommitted working-tree changes (`git status` / `git diff`), covering within-batch restarts where the previous agent's work is not yet committed.
- [ ] The prompt no longer relies solely on the truncated previous-agent output tail for "what's already done" — the tail is retained but explicitly demoted to a secondary, possibly-stale hint.
- [ ] `buildContinuationPrompt()` accepts the base branch (via a new optional `baseBranch?: string` parameter); both `buildPhase.ts` call sites pass `config.defaultBranch`.
- [ ] Behavior is unchanged when there are no prior checkpoint commits (first build pass): the first build agent still receives the raw plan, and the no-checkpoint case degrades gracefully without misleading the agent.
- [ ] `buildContinuationPrompt()` remains a pure function and preserves the `MAX_CONTINUATION_OUTPUT_LENGTH` truncation.
- [ ] The progress gate (`progressGate.ts`), the build-loop control flow, and the test/review compaction-recovery path are unchanged.
- [ ] `buildContinuationPrompt()` is unit-tested (`adws/phases/__tests__/planPhase.test.ts`) for: plan preserved; committed-state direction against `origin/<base>`; uncommitted-state direction; authoritative-state framing; tail retained-but-demoted; truncation preserved; reason variants; no-base fallback.
- [ ] All validation commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Run from the repo root (the `adws/` worktree).

- `bun run lint` — ESLint (`eslint .`); zero errors.
- `bunx tsc --noEmit` — root type check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check (Additional Type Checks); zero errors.
- `bun run build` — `tsc` build; succeeds.
- `bun run test:unit` — `vitest run`; all suites pass, including the new `adws/phases/__tests__/planPhase.test.ts`.

Targeted run while iterating (optional):
- `bunx vitest run adws/phases/__tests__/planPhase.test.ts`

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep `buildContinuationPrompt()` pure (string in, string out, no I/O); favor guard clauses for the with-base vs no-base branch; strict TypeScript (the new parameter is `string | undefined`, no `any`); keep `planPhase.ts` and `buildPhase.ts` ≤300 lines (these edits add only a handful of lines to `planPhase.ts` and none to `buildPhase.ts`).
- **Base ref choice**: the prompt uses `origin/<base>` rather than the bare branch name because `workflowInit` syncs the worktree against `origin/<defaultBranch>` (fetch/merge/reset) and the remote-tracking ref is reliably present and shared across worktrees via the common `.git`. Two-dot `..` is used for `git log` (commits on HEAD not on base) and three-dot `...` for `git diff` (net changes HEAD introduced since divergence) — the standard idioms.
- **Retaining vs removing the tail**: this plan retains the `<previous-agent-output>` block as a demoted secondary hint (lowest-risk; preserves any intent/notes not visible in a diff while satisfying "no longer solely"). An acceptable alternative is to remove it entirely; if a reviewer prefers that, delete the block and drop the now-unused `truncatedOutput`/`MAX_CONTINUATION_OUTPUT_LENGTH` (and their test). Retention is the recommended default.
- **Scope discipline**: no changes to the progress gate, the build loop's control flow, the commit-if-dirty boundary commit, `runBuildAgent`, or the test/review compaction path. This is a continuation-prompt content + parameter-plumbing change only. The re-exports in `adws/phases/index.ts` and `adws/workflowPhases.ts` need no edits (appended optional parameter).
- **No new libraries.** All work uses existing modules; vitest is already configured. Library install command if ever needed: `bun add <package>` (per `.adw/commands.md`).
- **Missing PRD**: the issue references `specs/prd/build-context-reset-progress-gate.md`, which is **not present** in the repository (consistent with the #559 plan's note). This plan is derived from the issue body and the already-merged #559 implementation (`app_docs/feature-qej3f4-novelty-progress-gate.md`). If the PRD is later added, reconcile its "Implementation Decisions → Continuation prompt" section with this plan's committed-vs-uncommitted handling and base-ref choice.
