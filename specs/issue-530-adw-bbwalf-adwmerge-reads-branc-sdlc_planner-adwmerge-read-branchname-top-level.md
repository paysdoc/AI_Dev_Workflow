# Feature: adwMerge resolves branchName from top-level state (read/write site reconciliation)

## Metadata
issueNumber: `530`
adwId: `bbwalf-adwmerge-reads-branc`
issueJson: `{"number":530,"title":"adwMerge reads branchName from orchestrator state, but #524 persists it to top-level state — the fix never reaches the merge path","body":"## Summary\n\n`adwMerge` cannot find the branch to merge because the branchName **persistence** and the branchName **read** target different state files:\n\n- **Persistence (#524 / PR #525, commit 14c04cd):** `adws/phases/branchNameResolution.ts` and `workflowInit.ts` write branchName to the **top-level** state via `AgentStateManager.writeTopLevelState(adwId, { branchName })` (`agents/<adwId>/state.json`).\n- **Read (`adwMerge.tsx:102-114`):** reads branchName from the **orchestrator-specific** state resolved by `findOrchestratorStatePath(adwId)` (`agents/<adwId>/<orchestrator>/state.json`), with no fallback to top-level.\n\nSo the #524 fix never reaches the merge path. A missing branchName at the read site trips the `no_branch_name` guard → `adwMerge` writes `abandoned` (terminal, non-`merge_blocked`, so `## Retry` cannot recover it).\n\n## Evidence (issue #508 / PR #526, 2026-05-26)\n\n#508's SDLC run started 2026-05-26T22:52, **after** #524 merged (10:24), yet:\n- `sdlc-orchestrator/state.json` — **no branchName**\n- top-level `state.json` — **no branchName** either\n\nResult: `abandoned`, PR #526 left open + conflicting. Recovered manually by writing branchName into the orchestrator state files + setting `awaiting_merge`.\n\n## Proposed fix\n\nMake the read and write sites agree. Simplest: have `adwMerge` read branchName from **top-level** state first (where #524 persists it), falling back to orchestrator state. Optionally also write branchName into the orchestrator state at branch-creation time. Add a regression test asserting `adwMerge` resolves branchName from a top-level-persisted value.\n\n## Related\n- #524 (branchName persistence) — CLOSED; persists to top-level only\n- Bug: `findOrchestratorStatePath` shadowing (separate issue) — compounding cause on #508\n- `## Retry` / `merge_blocked`: #527 / #528\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-27T09:28:59Z","comments":[],"actionableComment":null}`

## Feature Description
`adwMerge` is the thin orchestrator that performs the `awaiting_merge` → merge handoff dispatched by the cron. Before it can look up and merge a PR, it must resolve the workflow's git branch name. Today it reads that name **only** from the orchestrator-specific state file (`agents/<adwId>/<orchestrator>/state.json`), resolved via `findOrchestratorStatePath(adwId)`.

But the branchName persistence contract introduced by #524 (PR #525, commit `14c04cd`) writes the name to the **top-level** state file (`agents/<adwId>/state.json`) via `AgentStateManager.writeTopLevelState(adwId, { branchName })`. The orchestrator state file is never written with a branchName at all. The read site and the write site therefore target different files, so the #524 persistence fix never reaches the merge path.

When `adwMerge` finds no branchName at its read site, it trips the `no_branch_name` guard and writes the terminal `abandoned` stage. `abandoned` is not `merge_blocked`, so the `## Retry` directive (issue #527 / PR #528) is a documented no-op against it — the workflow is stranded and can only be recovered by manual state surgery. This was observed on issue #508 / PR #526 on 2026-05-26: a fully-built PR was left open and conflicting because the merge orchestrator could not find its own branch.

This feature reconciles the read and write sites. `adwMerge` will resolve branchName from **top-level state first** (the canonical persistence target since #524), falling back to orchestrator-specific state for older runs and defense-in-depth. As secondary hardening it also (a) persists branchName into the orchestrator state at branch-creation time so both stores agree from the write side, and (b) applies the same top-level-first resolution to the one other divergent read site (the issue-closed cleanup path in `webhookHandlers.ts`), which currently reads branchName from orchestrator state only and would otherwise leak a remote branch under the identical root cause.

The value: a built, PR-ready workflow reliably reaches and completes its merge instead of silently stranding in an unrecoverable terminal state.

## User Story
As an ADW operator running the SDLC pipeline unattended
I want `adwMerge` to find the branch it needs to merge from the same state file where the branch name was actually persisted
So that a completed, PR-ready workflow is merged automatically instead of stranding in the unrecoverable `abandoned` state and requiring manual state repair.

## Problem Statement
The branchName **write** site (`branchNameResolution.persistBranchName` and `workflowInit`) persists to top-level state (`agents/<adwId>/state.json`), but the branchName **read** site in `adwMerge.executeMerge` (`adwMerge.tsx:101-115`) reads only from orchestrator-specific state (`agents/<adwId>/<orchestrator>/state.json`), with no top-level fallback. The two never agree, so:

1. The #524 persistence fix never reaches the merge path.
2. A missing branchName at the read site trips the `no_branch_name` guard → `adwMerge` writes the terminal `abandoned` stage.
3. `abandoned` is not `merge_blocked`, so `## Retry` cannot recover it; only manual state surgery can (as documented for #508).

The same divergence exists at a second, lower-traffic read site: the issue-closed cleanup path in `webhookHandlers.ts:188-199` also reads branchName from orchestrator state only, risking a stranded remote branch.

## Solution Statement
Make the read and write sites agree on the canonical store: **top-level state is the source of truth for branchName.** `remoteReconcile.deriveStageFromRemote` (`remoteReconcile.ts:66-67`) already reads branchName from top-level state and is the reference pattern; the bug is that `adwMerge` and `webhookHandlers` diverge from it.

Concretely:

1. **Core fix (required):** In `adwMerge.executeMerge`, resolve branchName from the already-read `topLevelState.branchName` first; only when that is absent, fall back to the orchestrator-specific state via the existing injected `findOrchestratorStatePath` / `readOrchestratorState` deps. All existing terminal reasons (`no_orchestrator_state`, `no_branch_name`) are preserved for the genuine "no name anywhere" case. No new `MergeDeps` fields are required — the top-level state is already read at step 1.

2. **Write-side agreement (recommended hardening):** In `workflowInit`, also persist branchName into the orchestrator `initialState` write (conditionally, mirroring the existing conditional top-level write) so both stores carry the name for new runs.

3. **Sibling read-site hardening (recommended):** Apply the same top-level-first-then-orchestrator resolution to the issue-closed cleanup path in `webhookHandlers.ts`, which already has the top-level `state` in scope.

The fix is minimal, uses guard clauses (max nesting depth 2), preserves immutability, and adds no new dependencies. Because the existing unit-test fixtures persist branchName only to orchestrator state (top-level `makeState()` has no branchName), the top-level-first-with-fallback ordering keeps every existing test green while a new regression test proves resolution from a top-level-only value.

## Relevant Files
Use these files to implement the feature:

- `adws/adwMerge.tsx` — **Primary change.** `executeMerge` (lines 89-115) reads branchName from orchestrator state only. Add top-level-first resolution with orchestrator fallback. `topLevelState` is already read at line 90; no new `MergeDeps` field is needed.
- `adws/__tests__/adwMerge.test.ts` — **Primary test change.** Existing Vitest suite for `executeMerge` with full dependency injection (`makeDeps`/`makeState`/`makePR`). Add regression + precedence + fallback cases. Existing `makeState()` has no top-level branchName, so prior tests remain valid.
- `adws/phases/workflowInit.ts` — **Secondary (hardening).** The orchestrator `initialState` write (lines 241-248) omits branchName; the top-level write (lines 232-239) includes it conditionally. Add the same conditional branchName to the orchestrator write so both stores agree.
- `adws/phases/branchNameResolution.ts` — **Reference (no change expected).** Defines the persistence contract: `persistBranchName` / `readPersistedBranchName` both target top-level state. Confirms top-level is canonical.
- `adws/core/agentState.ts` — **Reference (no change).** `AgentStateManager.readTopLevelState` / `writeTopLevelState` / `readState` / `getTopLevelStatePath`. Top-level and orchestrator state are both typed `AgentState`, so `topLevelState.branchName` is valid.
- `adws/core/stateHelpers.ts` — **Reference (no change).** `findOrchestratorStatePath` (the divergent resolver and the compounding `findOrchestratorStatePath`-shadowing concern from the separate issue). Reading top-level first sidesteps the shadowing for branchName.
- `adws/core/remoteReconcile.ts` — **Reference (no change).** `deriveStageFromRemote` already reads branchName from top-level state (lines 66-67) — the canonical pattern this fix aligns the other sites to.
- `adws/types/agentTypes.ts` — **Reference (no change).** `AgentState.branchName?: string` (line 243) is present on the shared state shape used by both files.
- `adws/triggers/webhookHandlers.ts` — **Secondary (hardening).** The issue-closed cleanup path (lines 188-199) reads branchName from orchestrator state only for remote-branch deletion; the top-level `state` is already in scope (line 171). Apply the same top-level-first fallback.
- `adws/triggers/__tests__/webhookHandlers.test.ts` — **Secondary test change.** Same DI pattern as the merge suite (`makeState()` has no top-level branchName); add a case asserting deletion uses the top-level branchName when orchestrator state lacks it.

### Conditional Documentation (read for context — matched from `.adw/conditional_docs.md`)
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — the #524 branch-name persistence contract (`resolveWorkflowBranchName`, `readPersistedBranchName`, `persistBranchName`, `workflowInit`); directly upstream of this bug.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — `agents/<adwId>/state.json` top-level state and `AgentStateManager` top-level methods.
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — `adwMerge.tsx` `MergeDeps` / `executeMerge` structure and the `awaiting_merge` cron path.
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — the `adwMerge` merge orchestrator spawn/handoff flow.
- `app_docs/feature-29w5wf-reclassify-abandoned-discarded-call-sites.md` — `adwMerge.tsx` exit paths and their `workflowStage` writes, and the `webhookHandlers.ts` PR/issue-closed state writes.

### New Files
- `features/per-issue/feature-530.feature` — per-issue BDD scenario (tag `@adw-530`) capturing the behavioral contract: a workflow whose branchName lives only in top-level state must resolve and merge rather than strand in `abandoned`. Per `.adw/scenarios.md`, per-issue scenarios live under `features/per-issue/` and are input-only (never executed by the runner; executable proof is the Vitest unit tests).

## Implementation Plan
### Phase 1: Foundation
Establish top-level state as the canonical branchName source at the merge read site. In `adwMerge.executeMerge`, change branchName resolution to prefer `topLevelState.branchName` (already read at step 1) and fall back to the orchestrator-specific state only when top-level lacks it. Preserve the existing guard-clause structure and all terminal reasons (`no_orchestrator_state` when the fallback finds no orchestrator dir, `no_branch_name` when neither store has a name). This is the load-bearing fix that closes the read/write divergence reported in #530.

### Phase 2: Core Implementation
Add Vitest coverage in `adws/__tests__/adwMerge.test.ts` proving the new contract: (a) the regression case from the issue — branchName present only in top-level state, orchestrator state absent/empty, merge proceeds; (b) precedence — top-level wins when both stores differ; (c) fallback — orchestrator value is used when top-level lacks the name (the pre-existing happy path, now asserted explicitly). Author the per-issue BDD scenario `features/per-issue/feature-530.feature` (`@adw-530`) documenting the behavior. Confirm all pre-existing `adwMerge` tests still pass unchanged.

### Phase 3: Integration
Make the write sites agree and harden the sibling read site so the whole system is consistent (the "scattered point-fixes mean the primitive is wrong" lesson from the project README):
- In `workflowInit`, also persist branchName into the orchestrator `initialState` write (conditional, mirroring the top-level write) so both stores carry it for new runs.
- In `webhookHandlers` issue-closed cleanup, resolve branchName top-level-first with orchestrator fallback before remote-branch deletion, using the top-level `state` already in scope.
- Add the matching Vitest case in `webhookHandlers.test.ts`.
- Run the full validation suite to confirm zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Implement top-level-first branchName resolution in `adwMerge.executeMerge`
- In `adws/adwMerge.tsx`, replace the "Find branch name from orchestrator-specific state" block (lines 101-115) with resolution that prefers the already-read `topLevelState.branchName`, then falls back to orchestrator state:
  - `let branchName = topLevelState.branchName;`
  - If falsy, resolve `findOrchestratorStatePath(adwId)`; if that is null, write `abandoned` and return `{ outcome: 'abandoned', reason: 'no_orchestrator_state' }` (unchanged terminal behavior for the genuine no-state case).
  - Otherwise set `branchName = deps.readOrchestratorState(orchestratorStatePath)?.branchName;`
  - After the fallback, if `branchName` is still falsy, write `abandoned` and return `{ outcome: 'abandoned', reason: 'no_branch_name' }` (unchanged).
- Keep guard-clause style (max nesting depth ~2). Update the inline comment to explain that top-level is the canonical persistence target (#524/#530) and orchestrator state is the fallback. Note that `MergeDeps` is unchanged (no new injected fields).

### Step 2: Add regression and precedence unit tests for `adwMerge`
- In `adws/__tests__/adwMerge.test.ts`, add a `describe('executeMerge — branchName resolution (issue #530)')` block:
  - **Regression (issue's explicit ask):** `readTopLevelState` returns `makeState({ branchName: 'feature-issue-530-top-level' })`; `findOrchestratorStatePath` returns `null` (and/or `readOrchestratorState` returns a state with no branchName). Assert `outcome === 'completed'`, that `findPRByBranch` and `mergeWithConflictResolution` were called with `'feature-issue-530-top-level'`, and that the run did **not** strand in `abandoned`/`no_branch_name`.
  - **Precedence:** top-level branchName `A`, orchestrator branchName `B`; assert resolution uses `A` (top-level wins) and orchestrator state need not even be consulted when top-level has the name.
  - **Fallback:** top-level state has no branchName, orchestrator state has `'feature-issue-42-abc'`; assert merge proceeds using the orchestrator value (older-run / defense-in-depth path).
- Do not modify existing tests; verify they still pass (default `makeState()` has no top-level branchName, so they exercise the fallback path exactly as before).

### Step 3: Author the per-issue BDD scenario
- Create `features/per-issue/feature-530.feature` tagged `@adw-530`, with a scenario describing: Given a workflow in `awaiting_merge` whose branchName is persisted only to top-level state, When `adwMerge` runs, Then it resolves the branch from top-level state and merges the PR (and does not write `abandoned` with reason `no_branch_name`). Prefer phrases from `features/regression/vocabulary.md` where applicable. This file is input-only and is not executed by the runner.

### Step 4: Persist branchName into orchestrator state at init (write-side agreement)
- In `adws/phases/workflowInit.ts`, extend the orchestrator `initialState` object (lines 241-248) with a conditional branchName, mirroring the existing top-level write (lines 232-239): `...(branchName ? { branchName } : {})`. This ensures both state stores carry the name for new runs without clobbering the `options.cwd` path (where `branchName` may be empty).

### Step 5: Harden the sibling read site in `webhookHandlers` issue-closed cleanup
- In `adws/triggers/webhookHandlers.ts`, in the remote-branch-deletion block (lines 188-199), resolve branchName top-level-first using the `state` already read at line 171, falling back to the orchestrator state: `const branchName = state.branchName ?? (deps.findOrchestratorStatePath(adwId) ? deps.readOrchestratorState(...)?.branchName : undefined);` (keep guard-clause style; do not delete a branch when no name is resolvable).
- Add a Vitest case in `adws/triggers/__tests__/webhookHandlers.test.ts`: top-level `state` has a branchName, orchestrator state lacks it → assert `deleteRemoteBranch` is called with the top-level branchName. Confirm the existing line-149 fallback test still passes (top-level has no branchName → orchestrator value used).

### Step 6: Run full validation
- Run the `Validation Commands` below. All must pass with zero errors and zero regressions. Target the changed suites first (`adwMerge`, `webhookHandlers`, `workflowInit`, `branchNameResolution`) then run the full unit suite and type checks.

## Testing Strategy
### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope. Tests use Vitest with full dependency injection (no real filesystem/network):

- **`adws/__tests__/adwMerge.test.ts` (primary):**
  - Regression: branchName only in top-level state (orchestrator absent/empty) → merge completes; `findPRByBranch`/`mergeWithConflictResolution` receive the top-level branchName; no `abandoned`/`no_branch_name`.
  - Precedence: top-level branchName wins over a different orchestrator branchName.
  - Fallback: top-level lacks branchName, orchestrator has it → merge completes via fallback.
  - Regression guard: all pre-existing `executeMerge` tests (missing-state, no-PR retry/escalation, already-merged, closed, hitl gate matrix, worktree error, merge failure) continue to pass unchanged.
- **`adws/triggers/__tests__/webhookHandlers.test.ts` (secondary):**
  - Issue-closed cleanup deletes the remote branch using the top-level branchName when orchestrator state lacks it; existing orchestrator-fallback deletion test stays green.
- **`adws/phases/__tests__/workflowInit.test.ts` / `branchNameResolution.test.ts` (no new assertions required):**
  - Confirm the orchestrator-state branchName write does not regress existing determinism/persistence assertions (these assert top-level state and the returned config, not orchestrator-state contents).

### Edge Cases
- branchName present only in top-level state, no orchestrator dir at all → resolves from top-level, merges (the #530 regression).
- branchName present in both stores but differing → top-level value is authoritative.
- branchName present only in orchestrator state (legacy/older run) → fallback resolves it, merges.
- branchName absent from both stores → `no_branch_name`, `abandoned` (unchanged behavior).
- Top-level lacks branchName and `findOrchestratorStatePath` returns null → `no_orchestrator_state`, `abandoned` (unchanged behavior).
- branchName is an empty string `""` → treated as absent by the `!branchName` guard (consistent with current behavior); resolution falls through to fallback / terminal.
- `options.cwd` workflow path where `branchName` stays empty in `workflowInit` → orchestrator write must remain conditional so it never writes an empty branchName.

## Acceptance Criteria
- `adwMerge.executeMerge` resolves branchName from `topLevelState.branchName` when present, regardless of orchestrator-state presence or contents (proven by the regression unit test).
- When top-level state lacks branchName, `executeMerge` falls back to orchestrator-specific state, preserving prior behavior and terminal reasons (`no_orchestrator_state`, `no_branch_name`).
- A workflow whose branchName is persisted only to top-level state (the #524 contract) no longer strands in `abandoned` with reason `no_branch_name`; it proceeds to merge.
- No new `MergeDeps` fields are introduced; the change reuses the top-level state already read by `executeMerge`.
- `workflowInit` writes branchName into both the top-level and orchestrator state files for new runs (conditionally; never an empty string).
- The issue-closed cleanup path in `webhookHandlers` resolves branchName top-level-first with orchestrator fallback for remote-branch deletion.
- All pre-existing unit tests pass unchanged; the new regression/precedence/fallback tests pass.
- `bun run lint`, `bun run build`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run test:unit` all complete with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint across the repo; zero errors.
- `bunx tsc --noEmit` — root type check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type check; zero errors.
- `bun run build` — `tsc` build; zero errors.
- `bunx vitest run adws/__tests__/adwMerge.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/branchNameResolution.test.ts` — targeted: changed suites pass, including the new #530 regression cases.
- `bun run test:unit` — full Vitest suite (`vitest run`); all tests pass with zero regressions.

## Notes
- `.adw/coding_guidelines.md` applies: clarity over cleverness, guard clauses with the happy path at the leftmost indent, max nesting depth ~2, immutability, strict typing (no `any`, prefer optional chaining over `!`). `adwMerge.tsx` stays well under the 300-line limit after this change.
- **No new libraries** are required. (Per `.adw/commands.md`, the library install command would be `bun add <package>` if one were needed.)
- **Why top-level-first ordering keeps existing tests green:** the test fixtures (`makeState()` in both `adwMerge.test.ts` and `webhookHandlers.test.ts`) do not set a top-level branchName; they persist it via `readOrchestratorState`. Top-level-first-with-orchestrator-fallback therefore exercises the fallback path for every existing test, leaving their assertions valid, while the new tests cover the top-level path.
- **Scope boundary:** Steps 1-3 are the required core fix for #530 and fully satisfy the issue's proposed fix and regression-test ask. Steps 4-5 are recommended defense-in-depth that reconcile the write side and the one sibling read site (`webhookHandlers`) sharing the identical root cause; they are low-risk and keep existing tests green, but can be deferred without invalidating the core acceptance criteria if a reviewer prefers a narrower change.
- **Out of scope / separate issues:** the `findOrchestratorStatePath` shadowing bug (which returns a failed `init-orchestrator` dir over the real `sdlc-orchestrator` dir on adwId reuse) is a distinct compounding cause filed separately; reading top-level branchName first sidesteps its effect on branchName resolution but does not fix the shadowing itself. The `## Retry` / `merge_blocked` recovery semantics are tracked in #527 / #528. This plan does not change terminal-stage taxonomy or the `## Retry` handler.
