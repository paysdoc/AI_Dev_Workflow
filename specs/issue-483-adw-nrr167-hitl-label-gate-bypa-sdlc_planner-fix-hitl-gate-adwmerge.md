# Bug: hitl label gate bypassed on awaiting-merge handoff path

## Metadata
issueNumber: `483`
adwId: `nrr167-hitl-label-gate-bypa`
issueJson: `{"number":483,"title":"hitl label gate bypassed on awaiting-merge handoff path","body":"## Summary\n\nThe `hitl` label no longer blocks auto-merge. Issue #467 was labeled `hitl` but was merged anyway.\n\n## Root cause\n\nFeature `bpn4sv` (orchestrators-awaiting-merge-handoff) removed `executeAutoMergePhase` from all four review orchestrators (`adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`). Orchestrators now approve the PR inline, write `workflowStage: 'awaiting_merge'`, and exit. The cron trigger then spawns `adwMerge.tsx` to perform the merge.\n\nThe `hitl` check lives only in `adws/phases/autoMergePhase.ts:69`, which is no longer called by any orchestrator. `adwMerge.tsx` merges without consulting the label (see lines 122–175).\n\nAdditionally, the auto-labeling behavior in `executeAutoMergePhase` (apply `hitl` when no approved review exists) is also dead on this path, since orchestrators now approve the PR themselves before handoff.\n\n## Expected behavior\n\nIf an issue has the `hitl` label, `adwMerge.tsx` (and/or the orchestrators before they write `awaiting_merge`) must refuse to merge and leave the PR open for human action.\n\n## Fix sketch\n\n- Add `issueHasLabel(issueNumber, 'hitl', repoInfo)` guard in `adwMerge.tsx` immediately after PR lookup; on hit, skip merge and leave state as `awaiting_merge` (or introduce `blocked_hitl`).\n- Decide whether orchestrators should refuse to transition to `awaiting_merge` at all when `hitl` is set.\n- Extend `features/hitl_label_gate_automerge.feature` to cover `adwMerge.tsx`; current coverage tests only the now-unused `executeAutoMergePhase`.\n\n## Related\n\n- Feature that introduced the regression: `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md`\n- Original hitl gate feature: `app_docs/feature-fygx90-hitl-label-gate-automerge.md`\n- Affected issue: #467","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-04-21T12:19:15Z","comments":[],"actionableComment":null}`

## Bug Description

The `hitl` (human-in-the-loop) GitHub label is intended to block ADW from auto-merging a PR, leaving it open for a human to review and merge manually. The gate still fires inside `executeAutoMergePhase`, but that phase is no longer called by any orchestrator — the `bpn4sv` refactor removed it from `adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, and `adwPlanBuildTestReview.tsx`. Orchestrators now write `workflowStage: 'awaiting_merge'` after PR creation and exit; the cron trigger then spawns `adws/adwMerge.tsx` to merge. `adwMerge.tsx` performs the merge with no label check, so an issue labeled `hitl` gets its PR merged anyway. Observed with issue #467.

**Actual:** label present on issue → `adwMerge` calls `mergeWithConflictResolution` → PR merged.

**Expected:** label present on issue → `adwMerge` skips the merge, the PR stays open, state stays `awaiting_merge` so the next cron cycle re-checks; once the label is removed the merge proceeds on the following cycle.

## Problem Statement

`adws/adwMerge.tsx` is the single point through which `awaiting_merge` PRs are merged under the post-`bpn4sv` architecture, but it does not consult the `hitl` label before invoking `mergeWithConflictResolution`. The label check must move (or be duplicated) to the actual merge point so the gate functions again.

## Solution Statement

Add a HITL gate to `executeMerge` in `adws/adwMerge.tsx`, placed between the terminal PR-state branches (`MERGED`, `CLOSED`) and the open-PR merge block. On hit:

1. Log a single info line (matching the existing autoMergePhase wording).
2. Return `{ outcome: 'abandoned', reason: 'hitl_blocked' }` without touching the state file, so `workflowStage` remains `awaiting_merge`. The next cron cycle re-enters `adwMerge`, re-checks the label, and either skips again (label still present) or proceeds to merge (label removed).
3. Do NOT post a comment — silent skip, matching the "no comment floods on re-entry" rule already established in `autoMergePhase`.

Inject `issueHasLabel` through the existing `MergeDeps` seam so the new branch is unit-testable without mocking the `gh` CLI. Keep the label name `'hitl'` hardcoded at the call site (same as `autoMergePhase.ts`).

Orchestrators are intentionally NOT modified. Three reasons:
- `reviewPhase` already approves the PR before orchestrators see `ctx.prUrl`; the HITL decision window that matters is at actual merge time.
- `adwMerge` runs every cron cycle until merge/close, so the real-time check catches labels added after orchestrator exit.
- Adding a duplicate check to four orchestrators only prevents the `awaiting_merge` write but does not stop merge if the label is added post-handoff — so it is not load-bearing.

Rejected alternative — introducing a `blocked_hitl` terminal stage: would require cron filter changes (`cronStageResolver.ts`, `cronIssueFilter.ts`), a manual "re-enter after label removal" mechanism, and new integration tests. The bug description offers this as an option, but `awaiting_merge` re-entry per cron cycle is cheap (one `gh issue view` + exit) and matches the existing silent-skip semantics from `autoMergePhase`. Minimal fix wins.

Extend `features/hitl_label_gate_automerge.feature` with new `@adw-483 @regression` scenarios asserting:
- `adws/adwMerge.tsx` imports `issueHasLabel`.
- `adwMerge.tsx` calls `issueHasLabel` before `mergeWithConflictResolution` (i.e. before the actual merge).
- `adwMerge.tsx` calls `findPRByBranch` before `issueHasLabel` — the issue's "immediately after PR lookup" ordering requirement.
- The hitl branch in `adwMerge.tsx` does NOT call `mergeWithConflictResolution` or `commentOnIssue`.
- The hitl branch does NOT write `workflowStage: 'completed'` — state stays `awaiting_merge` so the next cron cycle re-checks the label.
- The hitl branch returns an outcome whose `reason` contains `"hitl"` (matches the `hitl_blocked` literal without over-constraining it).
- The hitl branch logs a message containing "hitl".

Add unit tests to `adws/__tests__/adwMerge.test.ts` covering the four new cases (hitl on OPEN PR, hitl on MERGED PR, hitl on CLOSED PR, no hitl on OPEN PR).

## Steps to Reproduce

1. Open an issue in a target repo and add the `hitl` label.
2. Run an orchestrator that terminates in `awaiting_merge` (e.g. `bunx tsx adws/adwSdlc.tsx <issueNumber>`).
3. After the orchestrator writes `workflowStage: 'awaiting_merge'` and exits, trigger the cron sweep (either via `adws/triggers/trigger_cron.ts` or wait for the next scheduled cycle).
4. Observe that `adws/adwMerge.tsx` is spawned and immediately calls `mergeWithConflictResolution` — the PR gets merged despite the `hitl` label.

Alternative fast-path repro (unit test): call `executeMerge` with a `MergeDeps` stub that returns a non-HITL-aware `findPRByBranch` and assert that `mergeWithConflictResolution` is called. (Current test file at `adws/__tests__/adwMerge.test.ts` demonstrates this path.)

## Root Cause Analysis

Pre-`bpn4sv`, the HITL gate lived inside `executeAutoMergePhase` (`adws/phases/autoMergePhase.ts:69`), and every review orchestrator called that phase after PR creation, so the gate always ran before `mergeWithConflictResolution`.

The `bpn4sv` refactor (`app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md`) moved merge execution out of the orchestrators. All four review orchestrators were changed to:

1. Call `executePRPhase` to open the PR.
2. Write `workflowStage: 'awaiting_merge'` via `AgentStateManager.writeTopLevelState`.
3. Exit.

Merge is now performed by `adws/adwMerge.tsx` when the cron (`adws/triggers/cronIssueFilter.ts:92`) picks up the `awaiting_merge` issue and spawns the merge orchestrator. `adwMerge.tsx` reads state, finds the PR, and — for OPEN PRs — calls `mergeWithConflictResolution` directly (`adws/adwMerge.tsx:142-151`). No label check exists anywhere on this path.

`executeAutoMergePhase` was retained as a module but is now dead code on the SDLC path. The `bpn4sv` feature doc explicitly called out "preserved for webhook use" — but `adws/triggers/autoMergeHandler.ts` does not call `executeAutoMergePhase` either (the webhook path only fires on human-submitted `pull_request_review` approved events, which is covered by the existing "webhook path unaffected" note in the HITL feature doc). So the HITL gate is effectively dead across all paths that matter.

## Relevant Files

Use these files to fix the bug:

- `adws/adwMerge.tsx` — primary fix site. `executeMerge` (lines 63–185) is where the HITL guard goes, injected via `MergeDeps`. Also exposes the `MergeDeps` interface that needs a new `issueHasLabel` field.
- `adws/__tests__/adwMerge.test.ts` — existing unit-test suite for `executeMerge`. Add hitl cases using the same `makeDeps` factory pattern already present.
- `adws/phases/autoMergePhase.ts` — reference implementation of the HITL check (lines 67–72). Match the log message and silent-skip behavior exactly to preserve semantics.
- `adws/github/issueApi.ts` — defines `issueHasLabel(issueNumber, labelName, repoInfo)`. Already exported from `adws/github/index.ts`.
- `adws/github/index.ts` — barrel export already exposes `issueHasLabel`; `adwMerge.tsx` imports from here, so no new export surface needed.
- `features/hitl_label_gate_automerge.feature` — existing BDD feature. Add a new section covering `adws/adwMerge.tsx` under a new sub-tag (e.g. `@adw-483` alongside `@adw-329-hitl-label-gate`).
- `features/step_definitions/hitlLabelGateAutomergeSteps.ts` — existing step definitions. Most new scenarios reuse existing steps (`the phase skips "X" when the hitl label is detected`, `the phase logs a message containing "hitl" when the label is detected`). Extend this file with TWO NEW step definitions: `the hitl early-return block does not write workflowStage {string}` and `the hitl early-return block returns an outcome with reason containing {string}`, both built on the existing `extractHitlBlockBody` helper.
- `features/step_definitions/autoApproveMergeAfterReviewSteps.ts` — reference only. Defines the generic `{string} is called before {string}` step used by the ordering scenarios; no changes needed.
- `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` — context for the regression-introducing refactor.
- `app_docs/feature-fygx90-hitl-label-gate-automerge.md` — context for the original gate design (fail-open, silent re-entry, real-time check).
- `adws/triggers/cronIssueFilter.ts` — reference only, no changes. Confirms that `awaiting_merge` is the gate cron uses to re-spawn `adwMerge` each cycle (line 92); leaving state as `awaiting_merge` on hitl hit is the mechanism that lets the label be re-checked.

### New Files

None. All changes extend existing files.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Extend `MergeDeps` and `executeMerge` in `adws/adwMerge.tsx`

- Add `issueHasLabel` to the imports from `./github` (the barrel already re-exports it).
- Add a new field to the `MergeDeps` interface:
  ```ts
  readonly issueHasLabel: typeof issueHasLabel;
  ```
- In `buildDefaultDeps()`, wire the production import:
  ```ts
  issueHasLabel,
  ```
- In `executeMerge`, after the `CLOSED` branch (step 5) and before the "PR is open — ensure worktree and merge" block (step 6), insert:
  ```ts
  // 5b. HITL gate — leave state as awaiting_merge so the next cron cycle re-checks.
  //     Silent skip (no comment) to avoid flooding the issue on every cron cycle.
  if (deps.issueHasLabel(issueNumber, 'hitl', repoInfo)) {
    log(`hitl label detected on issue #${issueNumber}, skipping merge`, 'info');
    return { outcome: 'abandoned', reason: 'hitl_blocked' };
  }
  ```
- Do NOT call `writeTopLevelState` in this branch — the existing `awaiting_merge` stage must persist so the cron re-spawns `adwMerge` next cycle.
- Update `main()` exit code logic if needed: the `main()` function already exits `0` for any `abandoned` outcome whose reason is not `merge_failed` — `hitl_blocked` falls through to exit `0`, which is correct (skip is not a failure).
- Re-read the updated numbering: after this insertion the comment block "// 6. PR is open — ensure worktree and merge" stays at the original index but is now reached only when HITL is not set; no other code movement needed.

### 2. Update unit tests in `adws/__tests__/adwMerge.test.ts`

- Extend `makeDeps` to default `issueHasLabel: vi.fn().mockReturnValue(false)` so existing tests continue to pass unchanged.
- Add a new `describe('executeMerge — hitl label gate', ...)` suite with these cases:
  1. **HITL present on OPEN PR → hitl_blocked**: stub `issueHasLabel` to return `true`; assert `result.outcome === 'abandoned'`, `result.reason === 'hitl_blocked'`, `deps.writeTopLevelState` NOT called, `deps.mergeWithConflictResolution` NOT called, `deps.ensureWorktree` NOT called, `deps.commentOnIssue` NOT called, `deps.commentOnPR` NOT called.
  2. **HITL present on MERGED PR → completed (terminal state wins)**: stub `findPRByBranch` to return a MERGED PR AND stub `issueHasLabel` to return `true`; assert `result.outcome === 'completed'` and `result.reason === 'already_merged'`. This guards the ordering — the MERGED branch must run before the HITL check.
  3. **HITL present on CLOSED PR → discarded (terminal state wins)**: analogous to case 2 with `state: 'CLOSED'`; assert `result.outcome === 'abandoned'` and `result.reason === 'pr_closed'`.
  4. **HITL absent on OPEN PR → merge proceeds**: stub `issueHasLabel` to return `false`; assert `deps.mergeWithConflictResolution` IS called (this case overlaps with the existing "successful merge" test but makes the hitl-specific path explicit).
- Verify `issueHasLabel` is called with the correct arguments (`(issueNumber, 'hitl', repoInfo)`).

### 3. Extend `features/hitl_label_gate_automerge.feature`

- Add a new section under a clear heading, e.g. `# ── adwMerge.tsx hitl gate (issue #483) ──`.
- Add scenarios tagged `@adw-329-hitl-label-gate @adw-483 @regression` (the final `logs hitl label detection` scenario omits `@regression`):
  1. `adwMerge.tsx imports issueHasLabel`
     - `Given "adws/adwMerge.tsx" is read`
     - `Then the file imports "issueHasLabel"`
  2. `adwMerge.tsx checks for hitl label before calling mergeWithConflictResolution`
     - `Then "issueHasLabel" is called before "mergeWithConflictResolution"`
  3. `adwMerge.tsx hitl check runs after PR lookup` — pins the issue's "immediately after PR lookup" ordering.
     - `Then "findPRByBranch" is called before "issueHasLabel"`
  4. `adwMerge.tsx skips mergeWithConflictResolution when hitl label is detected`
     - `Then the phase skips "mergeWithConflictResolution" when the hitl label is detected`
  5. `adwMerge.tsx hitl gate is silent — no issue comment on hitl detection`
     - `Then the phase skips "commentOnIssue" when the hitl label is detected`
  6. `adwMerge.tsx hitl early-return does not transition state to completed` — enforces the issue's "leave state as `awaiting_merge`" requirement so cron re-entry keeps working.
     - `Then the hitl early-return block does not write workflowStage "completed"`
  7. `adwMerge.tsx hitl early-return returns an abandoned outcome tagged with hitl` — pins the `reason: 'hitl_blocked'` signal used by `main()` exit-code logic.
     - `Then the hitl early-return block returns an outcome with reason containing "hitl"`
  8. `adwMerge.tsx logs hitl label detection`
     - `Then the phase logs a message containing "hitl" when the label is detected`
- Scenarios 1, 2, 4, 5, and 8 reuse existing step definitions (`the file imports`, `{string} is called before {string}`, `the phase skips "X" when the hitl label is detected`, `the phase logs a message containing "X" when the label is detected`). Scenario 3 reuses the generic ordering step `{string} is called before {string}` (defined in `features/step_definitions/autoApproveMergeAfterReviewSteps.ts`).
- Scenarios 6 and 7 require two NEW step definitions to be added to `features/step_definitions/hitlLabelGateAutomergeSteps.ts`:
  - `the hitl early-return block does not write workflowStage {string}` — locates the hitl if-block via the existing `extractHitlBlockBody` helper and asserts the block body does NOT contain `workflowStage: '<stage>'` (or `writeTopLevelState(... workflowStage: '<stage>' ...)`).
  - `the hitl early-return block returns an outcome with reason containing {string}` — locates the hitl if-block via `extractHitlBlockBody` and asserts the block body contains `reason: '...<substring>...'` (substring match on the reason literal inside the returned object).
- Do NOT modify the existing `autoMergePhase` scenarios — they are still valid assertions on `autoMergePhase.ts` as a preserved module.

### 4. Type-check and lint

- Run `bunx tsc --noEmit -p adws/tsconfig.json` and fix any type errors.
- Run `bun run lint` and address any warnings on edited files.

### 5. Run unit tests

- Run `bun run test:unit` and confirm the new `executeMerge — hitl label gate` suite passes and no existing tests regress.

### 6. Run BDD scenarios

- Run the new HITL scenarios specifically: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-483"` and confirm all eight pass.
- Run the full HITL feature: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate"` to confirm no regression in existing coverage.
- Run the regression suite: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to confirm no unrelated regressions.

### 7. Final validation

- Execute every command in the `Validation Commands` section below; all must exit 0.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Reproduction (before fix — expected to fail): run the new `executeMerge — hitl label gate` test suite. Before the fix it fails because the HITL branch is absent. After the fix it passes.

```bash
bun install
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-483"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- Strictly follow `guidelines/coding_guidelines.md`: type safety (add the explicit `typeof issueHasLabel` field on `MergeDeps`), purity and side-effect isolation (the new branch only logs and returns — no state write, no comment), and file-size discipline (the insertion is ~5 lines; `adws/adwMerge.tsx` stays well under 300 lines).
- The new `reason` string `'hitl_blocked'` is intentionally distinct from `'merge_failed'` and `'pr_closed'` so cron telemetry and future dashboards can distinguish a skip-for-HITL from an actual failure. `main()` already treats any `abandoned` whose reason is not `merge_failed` as exit code 0, so no dispatcher changes are required.
- The fix deliberately does NOT add a `blocked_hitl` `WorkflowStage`. Adding one would require changes to `adws/types/workflowTypes.ts`, `adws/triggers/cronStageResolver.ts`, `adws/triggers/cronIssueFilter.ts`, and the stage-derivation logic in `adws/core/remoteReconcile.ts` — plus a human-visible mechanism to re-enter the merge path after the label is removed. Leaving the stage at `awaiting_merge` uses the existing cron re-entry loop for free, and the per-cycle cost is a single `gh issue view` call plus an immediate exit.
- Orchestrators (`adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`) are intentionally not modified. The real-time label check in `adwMerge.tsx` is the single authoritative gate; a second check in the orchestrators would only prevent the `awaiting_merge` state write (not the subsequent merge if the label is added later), so it is not load-bearing and would duplicate logic for no gain.
- `executeAutoMergePhase` in `adws/phases/autoMergePhase.ts` is retained as-is. It is currently dead on the SDLC path but preserved per the `bpn4sv` note ("preserved for webhook use"). This bug fix does not change that module; removal is out of scope and should be a separate chore if/when the webhook path is confirmed unused.
- No new library required. All imports (`issueHasLabel`, existing log helper) already exist in the codebase.
- `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` describes an orchestrator-level `hitl` check in its "Post-PR block" section, but the code actually lives in `reviewPhase.ts` for approval and is missing entirely for the merge path. The doc is aspirational — treat the actual code (`adws/adwSdlc.tsx`, `adwChore.tsx`, etc.) as authoritative when reading current behaviour.
