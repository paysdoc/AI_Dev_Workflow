# Bug: adwMerge dead-ends issues at the merge step — `no_pr_found` and `merge_failed` leave no recovery path

## Metadata
issueNumber: `527`
adwId: `22y8n3-adwmerge-dead-ends-i`
issueJson: `{"number":527,"title":"adwMerge dead-ends issues at the merge step — no_pr_found and merge_failed leave no recovery path","body":"## What's broken\n\nThe merge handoff (adws/adwMerge.tsx) silently kills issues that have reached awaiting_merge. Two distinct failures, both observed in production:\n\n- no_pr_found → writes abandoned on the first miss. PR resolution uses defaultFindPRByBranch (adws/github/prApi.ts), which queries gh pr list --state all ... --limit 5 and blindly returns prs[0] — no filter to the single open/mergeable PR.\n- merge_failed (conflict resolution exhausted after MAX_AUTO_MERGE_ATTEMPTS) → writes terminal discarded (#460) and comments \"merge manually\". discarded is non-retriable, so ADW is permanently out of the loop.\n\n## Desired behaviour\n1. PR resolution — defaultFindPRByBranch filters to the single open PR for the branch. If >1 open, take most recent.\n2. Bounded retry, then escalate — no_pr_found stays awaiting_merge, increments a retry counter, only after 3 misses escalate.\n3. New merge_blocked stage — escalation target for both no_pr_found (exhausted) and merge_failed. Not retriable; ineligible for spawn in cronIssueFilter.evaluateIssue.\n4. ## Retry re-entry — new comment command (mirrors ## Cancel) resets merge_blocked → awaiting_merge and clears the retry counter.\n5. Revise #460 for merge_failed — route it to merge_blocked instead of discarded. pr_closed stays discarded.\n\n## Out of scope\n- processedSpawns-above-retriable ordering (#449). #524 (branchName re-fire).","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-26T17:35:07Z"}`

## Bug Description

The merge handoff orchestrator (`adws/adwMerge.tsx`) terminates issues that have reached the `awaiting_merge` stage on the **first** sign of trouble, with no path back into automation. Two distinct failure modes both observed in production:

- **`no_pr_found`** — `executeMerge` calls `defaultFindPRByBranch` (`adws/github/prApi.ts:21`) to resolve the PR for the workflow branch. That helper runs `gh pr list --head <branch> --state all --json ... --limit 5` and blindly returns `prs[0]`. With `--state all` and no open-filter, a branch carrying more than one PR (e.g. one closed + one open) returns the *wrong* PR, and a transient `gh` hiccup returns `null`. On `null`, `executeMerge` immediately writes terminal-ish `abandoned` and exits. Because the issue is mechanically already merge-ready, this is a permanent dead-end for the cron sweep within a process lifetime.

- **`merge_failed`** — when `mergeWithConflictResolution` exhausts `MAX_AUTO_MERGE_ATTEMPTS`, `executeMerge` writes terminal `discarded` (the #460 routing) and comments "merge manually" on the PR. `discarded` is explicitly **non-retriable** (`cronStageResolver.isRetriableStage` returns true only for `abandoned`), so ADW is permanently out of the loop. The only recourse is a manual merge, which loses ADW's post-merge bookkeeping (state write to `completed`, completion comment, dependency unblocking via the `completed` path).

**Expected behaviour:** PR resolution should prefer the single open PR; transient `no_pr_found` should retry a bounded number of times before escalating to a new human-recoverable `merge_blocked` stage; conflict-exhausted `merge_failed` should escalate to `merge_blocked` (not the dead-end `discarded`); and a human should be able to post `## Retry` to push a `merge_blocked` issue back into `awaiting_merge` so the cron re-dispatches `adwMerge`.

**Actual behaviour:** First-miss `abandoned` (no_pr_found) and terminal `discarded` (merge_failed), both with no automated recovery.

### Gate semantics (unchanged — confirming intent)
Autonomous merge stays `gate_open = (no hitl on issue) OR (PR approved)`. For `no hitl` issues, manually approving the PR has no effect because approval was never part of the gate — the merge was failing purely on PR resolution. Once PR resolution is fixed, unapproved open PRs on `no hitl` issues merge immediately, by design. This plan does not touch the gate (`adwMerge.tsx:131-139`).

## Problem Statement

`adws/adwMerge.tsx` must stop treating `no_pr_found` and `merge_failed` as instant terminal exits. Specifically:

1. `defaultFindPRByBranch` must return the single **open** PR for a branch (most recent if several), and only fall back to a closed/merged PR when no open PR exists (so the idempotent `already_merged` and `pr_closed` paths still function).
2. `no_pr_found` must retry up to 3 times (staying `awaiting_merge`, counter persisted in top-level state) before escalating to a new `merge_blocked` stage.
3. `merge_failed` must escalate to `merge_blocked` (a *conscious reversal* of #460's `discarded` routing) while preserving #460's anti-loop intent — `merge_blocked` recovers **only** via explicit human `## Retry`, never automatically.
4. `merge_blocked` must be a first-class `WorkflowStage`: non-retriable and ineligible for spawn in the cron filter.
5. A new `## Retry` comment directive (mirroring `## Cancel`) must reset `merge_blocked → awaiting_merge` and clear the retry counter, so the existing `awaiting_merge` cron hoist re-dispatches `adwMerge` on the next tick.

`pr_closed` stays `discarded` (deliberate operator intent — unchanged). The 6 transient error exits stay `abandoned` (unchanged).

## Solution Statement

- **PR resolution (`adws/github/prApi.ts`)**: keep `--state all` in the `gh` query (so merged/closed PRs remain visible for the idempotent paths) but add `updatedAt` to the JSON fields and route the result through a new pure, exported `selectPreferredPR(entries)` helper: prefer the most-recently-updated **OPEN** PR; if none are open, return the most-recently-updated PR overall. This fixes the "wrong PR" bug from #508 (two PRs → pick the open one) without breaking `already_merged`/`pr_closed`.

- **New stage + state field**: add `'merge_blocked'` to the `WorkflowStage` union (`adws/types/workflowTypes.ts`) and a `mergeRetryCount?: number` field to `AgentState` (`adws/types/agentTypes.ts`). `isRetriableStage` stays `abandoned`-only (verified, with a clarifying comment).

- **`adwMerge.tsx` exits**: introduce `MAX_PR_RESOLUTION_ATTEMPTS = 3`. On `no_pr_found`, increment `mergeRetryCount`; while `< 3` re-write `awaiting_merge` (no comment, exit 0); on the 3rd miss write `merge_blocked` + post an explanatory issue comment. On `merge_failed`, write `merge_blocked` + post the explanatory issue comment (replacing the old PR "merge manually" comment and the `discarded` write). On `merged`/`already_merged`, clear the counter (`mergeRetryCount: 0`). `pr_closed` and the transient errors are untouched.

- **Cron filter (`adws/triggers/cronIssueFilter.ts`)**: add an explicit `merge_blocked` ineligibility guard (mirroring the existing `discarded` guard) so a `merge_blocked` issue is deterministically excluded from spawn, bypassing the grace period.

- **`## Retry` directive**: add `RETRY_COMMENT_PATTERN` + `isRetryComment` to `adws/core/workflowCommentParsing.ts` (mirror of `CANCEL_COMMENT_PATTERN`/`isCancelComment`), re-export through the `core` and `github` barrels, add a lightweight `adws/triggers/retryHandler.ts::handleRetryDirective` (mirror of `cancelHandler.ts` but state-only: reset `merge_blocked → awaiting_merge`, clear counter), and wire it into the `## Cancel` scan sites in `trigger_cron.ts` and `trigger_webhook.ts`. Recovery rides the existing `awaiting_merge` hoist (`cronIssueFilter.ts:89`) + the on-disk merge spawn lock (`shouldDispatchMerge`). **No change to `processedSpawns` ordering** (#449, out of scope).

- **Tests**: unit tests for `selectPreferredPR`, each new `adwMerge` exit, the `merge_blocked` cron ineligibility, `isRetryComment` parsing, and `handleRetryDirective` reset; plus a `@regression` BDD scenario for the `merge_blocked → ## Retry → merged` round-trip.

- **Docs**: a `known_issues.md` entry, an inline comment at the `merge_failed` site recording the #460 reversal rationale, and `UBIQUITOUS_LANGUAGE.md` term additions.

## Steps to Reproduce

1. **Wrong-PR resolution (#508 class):** create a branch with two PRs — one closed, one open (the closed one created first so it sorts to `prs[0]` under `--state all`). Call `defaultFindPRByBranch(branch, repoInfo)`. It returns the **closed** PR (`prs[0]`), so `executeMerge` takes the `pr_closed → discarded` path instead of merging the open PR. (Demonstrated by the new `selectPreferredPR` unit tests: the pre-fix `prs[0]` logic fails them.)
2. **First-miss abandon:** put an issue in `awaiting_merge`, then make `findPRByBranch` return `null` once (e.g. transient `gh` failure or a stale branch name). The current `executeMerge` writes `abandoned` immediately (`adwMerge.tsx:103-107`) — no retry. (Demonstrated by the existing test `returns abandoned when no PR is found`, `adwMerge.test.ts:105`.)
3. **Conflict dead-end:** put an issue in `awaiting_merge` with a PR that cannot be auto-merged; `mergeWithConflictResolution` returns `{ success: false }`. The current `executeMerge` writes terminal `discarded` (`adwMerge.tsx:182`). `cronIssueFilter.evaluateIssue` then permanently skips it (`reason: 'discarded'`), and there is no comment directive to recover it. (Demonstrated by the existing test `writes discarded ... when merge fails`, `adwMerge.test.ts:208`.)

Run `bun run test:unit` — the new red tests encode the desired post-fix behaviour and fail against the current code.

## Root Cause Analysis

- **`defaultFindPRByBranch` (`adws/github/prApi.ts:21-32`)** queries `--state all` and returns `prs[0]` with no ordering or open-filter. `gh pr list` ordering is not guaranteed to surface the open/mergeable PR first, so multi-PR branches resolve to the wrong PR, and any `gh` failure resolves to `null`.

- **`executeMerge` `no_pr_found` branch (`adws/adwMerge.tsx:103-107`)** treats a single `null` as terminal, writing `abandoned`. There is no notion of a transient miss vs. a genuine dead-end, and no retry budget.

- **`executeMerge` `merge_failed` branch (`adws/adwMerge.tsx:178-198`)** writes `discarded` per #460. `discarded` was introduced specifically as a *non-retriable* terminal to stop infinite respawn loops (`cronStageResolver.isRetriableStage`, `adws/triggers/cronStageResolver.ts:80-82`). #460 reused it for `merge_failed`, which over-applied the anti-loop hammer: conflict-exhausted merges are human-recoverable, but `discarded` removes them from automation forever. The correct fix is a *new* escalation stage that is non-retriable by the **automatic** path but re-entrant via an **explicit human** directive — preserving #460's anti-loop guarantee while restoring recoverability.

- **No human re-entry primitive for merge escalations.** `## Cancel` exists (scorched-earth reset) but is too heavy and routes to a full re-spawn, not a targeted merge re-attempt. There is no lightweight "push this back to `awaiting_merge`" directive.

## Relevant Files

Use these files to fix the bug:

- `adws/adwMerge.tsx` — **primary fix site.** `executeMerge` exit map: rewrite the `no_pr_found` branch (bounded retry → `merge_blocked`), change the `merge_failed` write from `discarded` to `merge_blocked` + explanatory issue comment, clear the counter on success. Add `MAX_PR_RESOLUTION_ATTEMPTS` and a `buildMergeBlockedComment` helper. `main()`'s exit-code logic (`merge_failed → 1`) needs no change.
- `adws/github/prApi.ts` — rewrite `defaultFindPRByBranch` to add `updatedAt` to the query and delegate to a new exported pure helper `selectPreferredPR` (prefer most-recent OPEN, else most-recent overall). Add an internal `RawPRListEntry` type (extends `RawPR` with `updatedAt`).
- `adws/types/workflowTypes.ts` — add `'merge_blocked'` to the `WorkflowStage` union (in the "Terminal / handoff stages" group, alongside `awaiting_merge`/`discarded`).
- `adws/types/agentTypes.ts` — add `mergeRetryCount?: number` to `AgentState` (top-level workflow state), documented as the PR-resolution retry counter for the merge handoff.
- `adws/triggers/cronIssueFilter.ts` — add an explicit `merge_blocked` ineligibility guard in `evaluateIssue` (after the `discarded` guard at line 98-100), returning `{ eligible: false, reason: 'merge_blocked' }`.
- `adws/triggers/cronStageResolver.ts` — no behaviour change; extend the `isRetriableStage` JSDoc to name `merge_blocked` as intentionally non-retriable (recoverable only via `## Retry`).
- `adws/core/workflowCommentParsing.ts` — add `RETRY_COMMENT_PATTERN = /^## Retry$/mi` and `isRetryComment(body)`, mirroring `CANCEL_COMMENT_PATTERN`/`isCancelComment` (lines 108-114).
- `adws/core/index.ts` — re-export `RETRY_COMMENT_PATTERN`, `isRetryComment` from `./workflowCommentParsing` (alongside the cancel exports at lines 187-188).
- `adws/github/workflowComments.ts` — re-export `RETRY_COMMENT_PATTERN`, `isRetryComment` from `../core/workflowCommentParsing` (alongside cancel exports at lines 15-16).
- `adws/github/index.ts` — re-export `RETRY_COMMENT_PATTERN`, `isRetryComment` from `./workflowComments` (alongside cancel exports at lines 72-73).
- `adws/triggers/trigger_cron.ts` — wire `## Retry` into the pre-filter comment scan loop (lines 212-218): `else if (latestComment && isRetryComment(latestComment.body)) handleRetryDirective(...)`. Do **not** add to `cancelledThisCycle` (the issue must be re-evaluated this cycle so the now-`awaiting_merge` hoist dispatches `adwMerge`).
- `adws/triggers/trigger_webhook.ts` — wire `## Retry` into the `issue_comment` handler (after the `isCancelComment` block at lines 154-165): on match call `handleRetryDirective`, respond `{ status: 'retry_reset', issue }`. The next cron tick re-dispatches.
- `adws/core/agentState.ts` — reference only: `writeTopLevelState` shallow-merges top-level fields (so `{ workflowStage, mergeRetryCount }` merges correctly) and `readTopLevelState` returns the parsed state. No change required.

Test files:
- `adws/github/__tests__/prApi.test.ts` — add a `selectPreferredPR` describe block (no `defaultFindPRByBranch` test exists today).
- `adws/__tests__/adwMerge.test.ts` — update the `no_pr_found` and `merge_failed` expectations; add bounded-retry, escalation, and counter-reset tests.
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — add a `merge_blocked` skip-terminal describe block (mirror the `discarded` block at lines 299-339).

### New Files
- `adws/triggers/retryHandler.ts` — `handleRetryDirective(issueNumber, comments, deps?)`: extracts the latest adwId (`extractLatestAdwId`), reads top-level state; if `workflowStage === 'merge_blocked'`, writes `{ workflowStage: 'awaiting_merge', mergeRetryCount: 0 }` and logs success; otherwise logs a no-op and returns false. Injectable `RetryHandlerDeps` (`readTopLevelState`, `writeTopLevelState`) for unit testing. Mirrors `cancelHandler.ts` structure but is state-only (no process kill / worktree removal / comment clearing).
- `adws/triggers/__tests__/retryHandler.test.ts` — unit tests: resets `merge_blocked → awaiting_merge` + clears counter; no-op for non-`merge_blocked` stages; no-op when no adwId / no state.
- `adws/core/__tests__/workflowCommentParsing.test.ts` — focused tests for `isRetryComment` (matches `## Retry`, case-insensitive, multiline; rejects `## Retrying`, prose containing "retry", `## Cancel`). (No such test file exists yet.)
- `features/regression/smoke/merge_blocked_retry.feature` — `@regression @smoke` round-trip scenario (see Task 13).
- `test/fixtures/jsonl/manifests/merge-blocked-retry.json` — claude-cli-stub manifest seeding top-level state at `merge_blocked` (modelled on `test/fixtures/jsonl/manifests/cancel-directive.json`), if the chosen step wiring requires a manifest rather than the `G6` state-seed step.

### Conditional docs to read before implementing (from `.adw/conditional_docs.md`)
- `app_docs/feature-29w5wf-reclassify-abandoned-discarded-call-sites.md` — `adwMerge.tsx` exit paths, `pr_closed`/`merge_failed` writes, and the `MergeRunResult.outcome` (dispatcher label) vs `workflowStage` (cron-sweeper classification) distinction. Directly governs this change.
- `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` — terminal vs. retriable stage semantics; `cronIssueFilter.evaluateIssue` / `cronStageResolver.isRetriableStage`. Read before adding `merge_blocked`.
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — `adwMerge.tsx` spawn flow, `cronIssueFilter.ts`/`cronStageResolver.ts`, and adding a handoff stage that bypasses the cron grace period.
- `app_docs/feature-djtyv4-remote-reconcile-module.md` — the `defaultFindPRByBranch`/`RawPR` shared helpers in `adws/github/prApi.ts` and the `discarded` literal.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — `AgentStateManager` top-level state methods and `workflowStage` transitions; relevant to the new `mergeRetryCount` field.
- `app_docs/feature-9jpn7u-replace-clear-with-cancel.md` — `isCancelComment`/`CANCEL_COMMENT_PATTERN`, `handleCancelDirective`, and cancel-directive wiring in `trigger_cron.ts`/`trigger_webhook.ts`. The template for `## Retry`.
- `app_docs/feature-yipjb0-fix-cancel-per-cycle-skip.md` — the cancel-scan loop + per-cycle set pattern in `trigger_cron.ts`; clarifies why `## Retry` must **not** join `cancelledThisCycle`.
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — the `hitl` gate and `MergeDeps` shape in `adwMerge.tsx` (confirm the gate stays unchanged).
- `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` — `workflowStage: 'awaiting_merge'` transitions and the approve-and-handoff exit pattern.
- `app_docs/feature-2evbnk-bdd-smoke-surface-scenarios.md` — `features/regression/smoke|surfaces` authoring and the manifest fixture schema; read before writing the BDD scenario.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Add the `merge_blocked` stage and `mergeRetryCount` field (foundational types)
- In `adws/types/workflowTypes.ts`, add `| 'merge_blocked'` to the `WorkflowStage` union in the "Terminal / handoff stages" group (next to `abandoned`, `discarded`, `awaiting_merge`). Add a short comment: escalation target for exhausted `no_pr_found` and `merge_failed`; non-retriable; recoverable only via `## Retry`.
- In `adws/types/agentTypes.ts`, add `mergeRetryCount?: number;` to `AgentState` with a JSDoc line: "PR-resolution retry counter for the merge handoff (adwMerge). Incremented on each `no_pr_found` miss; escalates to `merge_blocked` at `MAX_PR_RESOLUTION_ATTEMPTS`; cleared on merge success and on `## Retry`."
- Verify `bunx tsc --noEmit -p adws/tsconfig.json` still passes (no exhaustiveness breakage; `workflowStage` is typed `string` in `AgentState`, so this is additive).

### Task 2 — Fix PR resolution in `defaultFindPRByBranch`
- In `adws/github/prApi.ts`, add an internal type `interface RawPRListEntry extends RawPR { readonly updatedAt: string; }`.
- Add an exported pure helper:
  ```ts
  /**
   * Picks the PR ADW should act on for a branch.
   * Prefers the most-recently-updated OPEN PR (fixes #508: multi-PR branches must
   * resolve to the open one, never a stale closed/merged PR). Falls back to the
   * most-recently-updated PR overall when none are open, so the idempotent
   * already_merged / pr_closed paths in adwMerge still function.
   */
  export function selectPreferredPR(prs: readonly RawPRListEntry[]): RawPRListEntry | null {
    if (prs.length === 0) return null;
    const open = prs.filter((p) => p.state === 'OPEN');
    const pool = open.length > 0 ? open : prs;
    return [...pool].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }
  ```
- Rewrite `defaultFindPRByBranch` to add `updatedAt` to the `--json` fields, keep `--state all`, raise `--limit` to `20`, parse into `RawPRListEntry[]`, and `return selectPreferredPR(prs);`. Keep the `try/catch → null` boundary. Update the JSDoc to state it prefers the open PR.
- Confirm `RawPR` itself is unchanged (so existing `adwMerge.test.ts` mocks that build `RawPR`-shaped objects without `updatedAt` keep compiling); `defaultFindPRByBranch` still declares `: RawPR | null`.

### Task 3 — Bounded `no_pr_found` retry + `merge_blocked` escalation in `executeMerge`
- In `adws/adwMerge.tsx`, add a module constant near the top: `const MAX_PR_RESOLUTION_ATTEMPTS = 3;` with a comment referencing #527.
- Add a private helper `buildMergeBlockedComment(cause: string, adwId: string): string` that returns the explanatory issue comment with header `## ADW Merge Blocked`, the supplied **Cause** line, a **Remedy** line instructing the operator to comment `## Retry` on the issue (ADW resets to `awaiting_merge` and re-attempts on the next cron tick), and an `**ADW ID:** \`<adwId>\`` footer.
- Rewrite the `no_pr_found` branch (currently `adwMerge.tsx:103-107`):
  ```ts
  if (!pr) {
    const attemptCount = (topLevelState.mergeRetryCount ?? 0) + 1;
    if (attemptCount >= MAX_PR_RESOLUTION_ATTEMPTS) {
      log(`adwMerge: no PR for '${branchName}' after ${attemptCount} attempts — escalating to merge_blocked`, 'error');
      deps.writeTopLevelState(adwId, { workflowStage: 'merge_blocked', mergeRetryCount: attemptCount });
      deps.commentOnIssue(issueNumber, buildMergeBlockedComment(
        `No open pull request was found for branch \`${branchName}\` after ${attemptCount} attempts. The PR may have been closed/merged out-of-band, or the stored branch name may be stale.`,
        adwId,
      ), repoInfo);
      return { outcome: 'abandoned', reason: 'no_pr_found_blocked' };
    }
    log(`adwMerge: no PR for '${branchName}' (attempt ${attemptCount}/${MAX_PR_RESOLUTION_ATTEMPTS}) — staying awaiting_merge`, 'warn');
    deps.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge', mergeRetryCount: attemptCount });
    return { outcome: 'abandoned', reason: 'no_pr_found' };
  }
  ```
  Trace: miss 1 → count 1 (stay), miss 2 → count 2 (stay), miss 3 → count 3 ≥ 3 (escalate). The "stay" path writes no comment (avoids flooding, mirroring the `hitl` defer) and exits 0.

### Task 4 — Route `merge_failed` to `merge_blocked` (revise #460)
- In `adws/adwMerge.tsx`, rewrite the merge-failed tail (currently `adwMerge.tsx:178-198`):
  - Change `deps.writeTopLevelState(adwId, { workflowStage: 'discarded' });` to `deps.writeTopLevelState(adwId, { workflowStage: 'merge_blocked' });`.
  - Replace the PR "Auto-merge failed / merge manually" `commentOnPR` block with a single `deps.commentOnIssue(issueNumber, buildMergeBlockedComment(<cause from lastError>, adwId), repoInfo)`. Cause = `Automated merge of PR #${prNumber} failed after multiple conflict-resolution attempts.` plus `Last error: <lastError truncated to 500>` when present. The Remedy line tells the operator to resolve conflicts (or merge manually) then comment `## Retry` so ADW re-attempts the merge **and its post-merge bookkeeping**.
  - Keep `return { outcome: 'abandoned', reason: 'merge_failed' };` unchanged so `main()`'s existing exit-code mapping (`merge_failed → exit 1`) is preserved without edits.
  - Add an inline comment documenting the **conscious reversal of #460**: "merge_failed now escalates to the human-recoverable merge_blocked instead of terminal discarded (#460). Anti-loop intent preserved: merge_blocked recovers only via explicit `## Retry`, never automatically. pr_closed remains discarded."
- Leave `pr_closed` (`adwMerge.tsx:125-129` → `discarded`) and all 6 transient-error `abandoned` writes untouched.

### Task 5 — Clear the retry counter on merge success
- In `adwMerge.tsx`, the `already_merged` write (`adwMerge.tsx:115`) and the successful-`merged` write (`adwMerge.tsx:169`) change from `{ workflowStage: 'completed' }` to `{ workflowStage: 'completed', mergeRetryCount: 0 }`, satisfying "counter resets on success".

### Task 6 — Make `merge_blocked` ineligible for spawn in the cron filter
- In `adws/triggers/cronIssueFilter.ts::evaluateIssue`, add immediately after the `discarded` guard (after line 100):
  ```ts
  // merge_blocked bypasses grace period — escalated merge awaiting an explicit
  // human `## Retry`. Never auto-spawned; recovery resets it to awaiting_merge.
  if (resolution.stage === 'merge_blocked') {
    return { eligible: false, reason: 'merge_blocked' };
  }
  ```
- In `adws/triggers/cronStageResolver.ts`, extend the `isRetriableStage` JSDoc (lines 73-79) to add: "`merge_blocked` is likewise NOT retriable — it is recoverable only via an explicit human `## Retry`, which resets it to `awaiting_merge`." No code change to the function body.

### Task 7 — Add the `## Retry` comment parser
- In `adws/core/workflowCommentParsing.ts`, directly below the cancel parser (after line 114), add:
  ```ts
  /** Pattern matching the `## Retry` heading that re-enters a merge_blocked issue into awaiting_merge. */
  export const RETRY_COMMENT_PATTERN = /^## Retry$/mi;

  /** Returns true if the comment body contains the `## Retry` directive heading (case-insensitive). */
  export function isRetryComment(commentBody: string): boolean {
    return RETRY_COMMENT_PATTERN.test(commentBody);
  }
  ```

### Task 8 — Re-export `isRetryComment` through the barrels
- `adws/core/index.ts`: add `RETRY_COMMENT_PATTERN,` and `isRetryComment,` to the `from './workflowCommentParsing'` block (next to the cancel exports, lines 187-188).
- `adws/github/workflowComments.ts`: add the same two to the `from '../core/workflowCommentParsing'` re-export (lines 15-16).
- `adws/github/index.ts`: add the same two to the `from './workflowComments'` re-export (lines 72-73).

### Task 9 — Add `handleRetryDirective` (new `retryHandler.ts`)
- Create `adws/triggers/retryHandler.ts` mirroring the structure/doc-style of `cancelHandler.ts`, but state-only:
  ```ts
  import { log } from '../core/logger';
  import { AgentStateManager } from '../core/agentState';
  import { extractLatestAdwId } from './cronStageResolver';
  import type { AgentState } from '../types/agentTypes';

  export interface RetryHandlerDeps {
    readTopLevelState: (adwId: string) => AgentState | null;
    writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  }

  function defaultDeps(): RetryHandlerDeps {
    return {
      readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
      writeTopLevelState: (id, state) => AgentStateManager.writeTopLevelState(id, state),
    };
  }

  /**
   * Handles a `## Retry` directive: if the issue's latest workflow is in
   * `merge_blocked`, reset it to `awaiting_merge` and clear the PR-resolution
   * retry counter so the cron re-dispatches adwMerge on the next tick. No-op for
   * any other stage (so `## Retry` cannot disturb an active or completed workflow).
   * Returns true only when a reset was performed.
   */
  export function handleRetryDirective(
    issueNumber: number,
    comments: readonly { body: string }[],
    deps: RetryHandlerDeps = defaultDeps(),
  ): boolean {
    const adwId = extractLatestAdwId([...comments]);
    if (!adwId) {
      log(`Retry directive on issue #${issueNumber}: no adw-id in comments, ignoring`, 'warn');
      return false;
    }
    const state = deps.readTopLevelState(adwId);
    if (!state || state.workflowStage !== 'merge_blocked') {
      log(`Retry #${issueNumber}: adwId=${adwId} not in merge_blocked (stage=${state?.workflowStage ?? 'none'}), ignoring`);
      return false;
    }
    deps.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge', mergeRetryCount: 0 });
    log(`Retry #${issueNumber}: reset adwId=${adwId} merge_blocked → awaiting_merge, cleared retry counter`, 'success');
    return true;
  }
  ```
- Note: `extractLatestAdwId` (`cronStageResolver.ts:31`) takes `{ body: string }[]`; spread the readonly array to satisfy the signature.

### Task 10 — Wire `## Retry` into the cron trigger
- In `adws/triggers/trigger_cron.ts`, import `isRetryComment` from `../github` (add to the existing import on line 15) and `handleRetryDirective` from `./retryHandler` (add next to the `./cancelHandler` import on line 24).
- In the pre-filter comment-scan loop (lines 212-218), change the `if (isCancelComment)` into a cancel/retry branch:
  ```ts
  if (latestComment && isCancelComment(latestComment.body)) {
    handleCancelDirective(issue.number, issue.comments, cronRepoInfo, cancelCwd, { spawns: processedSpawns });
    cancelledThisCycle.add(issue.number);
  } else if (latestComment && isRetryComment(latestComment.body)) {
    handleRetryDirective(issue.number, issue.comments);
    // No cancelledThisCycle add: the reset to awaiting_merge must be picked up
    // this cycle by filterEligibleIssues (the awaiting_merge hoist re-dispatches adwMerge).
  }
  ```
- Because `resolveIssueWorkflowStage` reads the state file fresh inside `filterEligibleIssues`, the reset written by `handleRetryDirective` is observed in the same cycle → the issue is dispatched via the `awaiting_merge` path (guarded by `shouldDispatchMerge`).

### Task 11 — Wire `## Retry` into the webhook trigger
- In `adws/triggers/trigger_webhook.ts`, add `isRetryComment` to the `../github` import (line 13) and `handleRetryDirective` to the `./retryHandler` import (next to `handleCancelDirective`, line 14).
- In the `issue_comment` handler, immediately after the `isCancelComment` block (lines 154-165), add:
  ```ts
  if (isRetryComment(commentBody)) {
    const allComments = webhookRepoInfo ? fetchIssueCommentsRest(issueNumber, webhookRepoInfo) : [];
    handleRetryDirective(issueNumber, allComments);
    jsonResponse(res, 200, { status: 'retry_reset', issue: issueNumber });
    return;
  }
  ```
  The webhook only resets state; the cron's `awaiting_merge` hoist performs the actual `adwMerge` re-dispatch on the next tick (≤20s), so no spawn happens here.

### Task 12 — Unit tests
- **`adws/github/__tests__/prApi.test.ts`** — add `describe('selectPreferredPR', …)`:
  - returns `null` for an empty list.
  - single OPEN PR → returns it.
  - OPEN + CLOSED (closed newer) → returns the OPEN one (the #508 regression: open must win even when older).
  - two OPEN PRs → returns the most-recently-updated.
  - no OPEN (one CLOSED, one MERGED) → returns the most-recently-updated overall (so `already_merged`/`pr_closed` still resolve).
  - (Optional) a `defaultFindPRByBranch` test that mocks `execWithRetry` to return a two-PR JSON payload and asserts the open PR is returned, plus the `--state open`-vs-`prs[0]` regression; mock `../core` like `triggerCronAwaitingMerge.test.ts` does.
- **`adws/__tests__/adwMerge.test.ts`**:
  - Add `mergeRetryCount` support to `makeState` overrides (already supported via `Partial<AgentState>`).
  - Update `returns abandoned when no PR is found` (line 105): with default state (`mergeRetryCount` undefined → attempt 1), assert it now writes `{ workflowStage: 'awaiting_merge', mergeRetryCount: 1 }` and `reason === 'no_pr_found'` (not the old `abandoned`).
  - Add: with `readTopLevelState` returning `mergeState({ mergeRetryCount: 2 })` and `findPRByBranch → null`, assert it writes `{ workflowStage: 'merge_blocked', mergeRetryCount: 3 }`, calls `commentOnIssue` with text containing `Merge Blocked` and `## Retry`, and `reason === 'no_pr_found_blocked'`.
  - Add: `mergeRetryCount: 1` + `null` PR → writes `awaiting_merge` with `mergeRetryCount: 2`, no comment.
  - Update the failed-merge tests (lines 208-241): assert `writeTopLevelState` called with `{ workflowStage: 'merge_blocked' }` (not `discarded`); assert `commentOnIssue` (not `commentOnPR`) called with text containing `Merge Blocked`, `## Retry`, and the last error; assert `reason === 'merge_failed'`.
  - Update `already_merged` (line 119) and `merged` (line 159) write assertions to `{ workflowStage: 'completed', mergeRetryCount: 0 }`.
  - Keep the `pr_closed`, worktree-error, and hitl-gate tests asserting unchanged behaviour (they are part of the regression contract).
- **`adws/triggers/__tests__/cronIssueFilter.test.ts`** — add `describe('evaluateIssue — merge_blocked skip-terminal', …)` mirroring the `discarded` block (lines 299-339): `merge_blocked` → `{ eligible: false, reason: 'merge_blocked', action: undefined }`; precedence over grace period (recent activity still excluded); `filterEligibleIssues` annotates `#N(merge_blocked)`.
- **`adws/triggers/__tests__/retryHandler.test.ts`** (new) — inject `RetryHandlerDeps`:
  - `merge_blocked` state → writes `{ workflowStage: 'awaiting_merge', mergeRetryCount: 0 }`, returns `true`.
  - `awaiting_merge`/`completed`/`abandoned` state → no write, returns `false`.
  - `readTopLevelState → null` → no write, returns `false`.
  - comments without an adw-id → no read/write, returns `false`. (Supply comments containing `**ADW ID:** \`x\`` to exercise extraction.)
- **`adws/core/__tests__/workflowCommentParsing.test.ts`** (new) — `isRetryComment`: matches `## Retry`, `## retry`, and `## Retry` embedded on its own line in a multiline body; rejects `## Retrying`, `please retry`, and `## Cancel`. Add a parity assertion that `isCancelComment('## Retry') === false` and `isRetryComment('## Cancel') === false`.

### Task 13 — BDD regression scenario for the `merge_blocked → ## Retry → merged` round-trip
- Add a new When step phrase to `features/regression/step_definitions/whenSteps.ts` (phase-import pattern): **`the ## Retry directive is processed for issue {int} with adwId {string}`** → imports `handleRetryDirective` from `adws/triggers/retryHandler` and calls it with the harness's top-level state dir in effect (same state-dir wiring used by the existing `G6`/`T1` steps), passing a synthetic comments array containing the adwId (`[{ body: '**ADW ID:** \`<adwId>\`' }]`). Document the phrase in `features/regression/vocabulary.md` (next free `W#`), classified as the **phase-import** execution pattern, assertion target = top-level state file artefact. (Optionally add a `T#` phrase **`the state file for adwId {string} records mergeRetryCount {int}`** for the counter-reset assertion, documented the same way; reuse `T1` if a separate counter phrase is not warranted.)
- Add `features/regression/smoke/merge_blocked_retry.feature` (`@regression @smoke`):
  ```gherkin
  @regression @smoke
  Feature: ADW Merge — merge_blocked recovers via ## Retry and merges

    Scenario: a merge_blocked issue is re-entered by ## Retry and then merges
      Given an issue 527 exists in the mock issue tracker
      And the worktree for adwId "retry-smoke-527" is initialised at branch "retry-527"
      And a state file exists for adwId "retry-smoke-527" at stage "merge_blocked"
      And the mock GitHub API is configured to accept issue comments
      When the ## Retry directive is processed for issue 527 with adwId "retry-smoke-527"
      Then the state file for adwId "retry-smoke-527" records workflowStage "awaiting_merge"
      Given the mock GitHub API is configured to return PR 527 as merged
      When the "merge" orchestrator is invoked with adwId "retry-smoke-527" and issue 527
      Then the state file for adwId "retry-smoke-527" records workflowStage "completed"
      And the orchestrator subprocess exited 0
  ```
  This reuses existing phrases `G4` (issue exists), `G11` (worktree init), `G6` (state file at stage), `G1` (accept comments), `G10` (return PR as merged), `W1` (invoke merge orchestrator), `T1` (assert workflowStage), `T5` (exit code), plus the one new `## Retry` When phrase. The "merged" terminal is reached via the idempotent `already_merged` path (PR returned as merged → `executeMerge` writes `completed`), which is a legitimate round-trip endpoint and avoids requiring a new merge-execution mock.
- Ensure `G6` (`a state file exists for adwId {string} at stage {string}`) seeds the **top-level** state file that `handleRetryDirective` and `adwMerge` read (`AgentStateManager.readTopLevelState`). If the existing `G6` only seeds a worktree `.adw/state.json`, instead seed it via a new manifest `test/fixtures/jsonl/manifests/merge-blocked-retry.json` (modelled on `cancel-directive.json`, with `workflowStage: "merge_blocked"`) and the `G3` manifest step. Verify against the existing `G6`/`T1` implementations which one already targets the harness-controlled top-level state dir, and use that path. Follow the rot-prevention rule in `vocabulary.md`: assert only state-file/recorded-call **artefacts**, never source files.

### Task 14 — Documentation
- Append a `known_issues.md` entry under a new `## merge-dead-end-no-recovery` heading: pattern (no log pattern — diagnosed by `awaiting_merge` issues going `abandoned`/`discarded` with no recovery), description (the two failure modes), status `solved`, solution (prefer-open PR resolution + bounded `no_pr_found` retry + `merge_blocked` escalation + `## Retry` re-entry), `fix_attempts: 1`, `linked_issues: #527, #460, #508, #449`, `first_seen: 2026-05-26`, and a representative sample. Note explicitly that this **revises #460**: `merge_failed` now routes to `merge_blocked` (human-recoverable) instead of `discarded`, preserving #460's anti-loop intent via the explicit-`## Retry`-only recovery.
- Add the inline #460-reversal comment at the `merge_failed` site (already covered in Task 4).
- Update `UBIQUITOUS_LANGUAGE.md`: add **Merge Blocked** (Stage) — escalated merge awaiting human `## Retry`; non-retriable by automation — and **Retry Directive** (`## Retry`) — issue comment that resets a `merge_blocked` workflow to `awaiting_merge` and clears the PR-resolution retry counter. Place them next to the existing Cancel Directive / Stage entries.
- The document phase will generate the `app_docs/` feature doc; ensure it captures the #460 revision rationale (cross-reference `feature-29w5wf-reclassify-abandoned-discarded-call-sites.md`).

### Task 15 — Run all validation commands
- Run every command in **Validation Commands** below and ensure each passes with zero errors and zero regressions. Fix any failures before considering the bug resolved.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. (Project-specific commands from `.adw/commands.md`.)

- `bun install` — ensure dependencies are present (no new libraries are required for this fix).
- `bun run lint` — ESLint must pass with no new errors.
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (validates the new `WorkflowStage` member, `mergeRetryCount` field, `selectPreferredPR`/`RawPRListEntry`, and `isRetryComment` exports).
- `bun run build` — `tsc` build succeeds with no errors.
- `bun run test:unit` — Vitest suite passes. Before implementation, the new/updated tests in `adwMerge.test.ts`, `prApi.test.ts`, `cronIssueFilter.test.ts`, `retryHandler.test.ts`, and `workflowCommentParsing.test.ts` are RED (encoding the desired behaviour and reproducing the bug); after implementation they are GREEN, and all pre-existing tests still pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full regression suite passes, including the new `merge_blocked_retry.feature`.
- Targeted scenario check: `NODE_OPTIONS="--import tsx" bunx cucumber-js features/regression/smoke/merge_blocked_retry.feature` — the round-trip scenario passes.

## Notes
- `.adw/coding_guidelines.md` applies: clarity over cleverness, modularity (keep files < 300 lines — `adwMerge.tsx` is ~260 lines; the new helper + retry logic keep it within budget), immutability (no in-place mutation of state objects; build new partials for `writeTopLevelState`), type safety (no `any`; prefer narrowing over `!`), purity (`selectPreferredPR` and `isRetryComment` are pure and unit-tested; side effects stay injected via `MergeDeps`/`RetryHandlerDeps`), and guard-clause/early-return style (the new `executeMerge` branches stay flat). No decorators.
- **No new library required.** If one were ever needed, the install command (from `.adw/project.md` / `.adw/commands.md`) is `bun add <package>`.
- **Out of scope (do not touch):** the `processedSpawns`-above-retriable ordering — load-bearing split-brain defense (#449); `abandoned` already retries on cron restart. And #524 (the wrong stored `branchName` re-fire) — a separate root cause for the #95 incident. File separately if pursued.
- **Gate unchanged:** `adwMerge.tsx:131-139` (`(no hitl) OR approved`) is not modified. Once PR resolution is fixed, unapproved open PRs on `no hitl` issues merge immediately — by design.
- **Anti-loop guarantee preserved:** `merge_blocked` is never auto-retried (`isRetriableStage` stays `abandoned`-only; `evaluateIssue` explicitly excludes it). Recovery happens **only** through an explicit human `## Retry`. The escalation comment "covers" any prior `## Retry` comment, so `handleRetryDirective` (idempotent — only resets from `merge_blocked`) cannot loop.
- **`MergeRunResult.outcome` is a coarse dispatcher label, not the `workflowStage`.** The bounded-retry "stay" path returns `outcome: 'abandoned'` while writing `awaiting_merge` (mirroring the existing `hitl_blocked_unapproved` defer precedent at `adwMerge.tsx:136-139`). Only `reason` distinguishes the new exits; `main()`'s exit-code mapping keys on `reason === 'merge_failed'` and needs no change.
- **Reason taxonomy** (for tests): `no_pr_found` (stay, count<3), `no_pr_found_blocked` (escalate, count≥3), `merge_failed` (escalate via conflict path), `merged`/`already_merged` (success), `pr_closed`/`hitl_blocked_unapproved`/transient errors (unchanged).
