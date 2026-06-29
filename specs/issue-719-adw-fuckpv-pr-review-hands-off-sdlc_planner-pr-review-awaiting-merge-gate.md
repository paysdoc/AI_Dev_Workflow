# Feature: PR-review hands off to awaiting_merge (gated on reviewPassed)

## Metadata
issueNumber: `719`
adwId: `fuckpv-pr-review-hands-off`
issueJson: `{"number":719,"title":"PR-review hands off to awaiting_merge (gated on reviewPassed)","body":"## Parent PRD\n\n`specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md`\n\n## What to build\n\nMake a clean PR-review run hand the PR off to the merge path, end-to-end. Today `adwPrReview` finishes at an inert terminal stage and never writes `awaiting_merge`, so cron never merges the addressed PR (the #712 / PR #715 stuck-state). Introduce a shared post-review-outcome gate and have PR-review write `awaiting_merge` **only when the review passed**. PR-review keeps its own generated adwId for this slice (consolidation is later). See PRD §Solution item 1 and §Implementation Decisions \"Post-review outcome gate\".\n\n## Acceptance criteria\n\n- [ ] A pure `decidePostReviewOutcome(reviewPassed)` module exists: pass → `awaiting_merge`+proceed, fail → stop (no `awaiting_merge`)\n- [ ] On a clean PR-review run, the top-level workflow stage is `awaiting_merge` at completion\n- [ ] When the PR-review review did not pass, `awaiting_merge` is NOT written (today's inert behavior preserved for the fail case)\n- [ ] cron's existing merge dispatch merges the PR with no new merge mechanism introduced\n- [ ] Unit tests for `decidePostReviewOutcome`; regression/BDD green\n\n## Blocked by\n\nNone - can start immediately\n\n## Touched Files\n\n- adws/adwPrReview.tsx\n- adws/phases/prReviewCompletion.ts\n- adws/phases/decidePostReviewOutcome.ts\n- adws/phases/__tests__/decidePostReviewOutcome.test.ts\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 3\n- User story 17","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-06-29T12:33:45Z","comments":[],"actionableComment":null}`

## Feature Description
The PR-review orchestrator (`adwPrReview.tsx`) addresses unaddressed review comments on an open PR: it re-plans, re-implements, regenerates step definitions, re-runs unit and BDD scenario tests, and runs a bounded review→patch→retest loop. When that work is done it calls `completePRReviewWorkflow`, which posts a `pr_review_completed` comment to the PR and marks the orchestrator's own execution state as complete — **but it never writes a top-level `awaiting_merge` workflow stage**.

That terminal stage is inert. The cron sweeper merges a PR only when an issue resolves to a top-level state whose `workflowStage === 'awaiting_merge'` (see `adws/triggers/cronIssueFilter.ts`, which returns `{ action: 'merge' }` for that stage). Because PR-review never writes `awaiting_merge`, the cron never dispatches `adwMerge` for the PR it just fixed up, and the PR sits forever — the observed `#712` / PR `#715` stuck-state.

This feature introduces a small **pure post-review-outcome gate**, `decidePostReviewOutcome(reviewPassed)`, and wires it into the PR-review completion path so that:

- a **clean** PR-review run (review passed) writes `workflowStage: 'awaiting_merge'` to its top-level state, handing the PR to the existing cron merge dispatch; and
- a PR-review run whose review **did not pass** behaves exactly as today (no `awaiting_merge` is written — the run stays inert and the PR is not auto-merged).

No new merge mechanism is introduced: the gate only decides whether to write the handoff stage that cron already knows how to act on. This mirrors the established approve-and-handoff exit pattern already used by `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, and `adwChore.tsx`, all of which end with `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge' })`.

Per the parent PRD, this slice deliberately keeps PR-review's **own generated adwId**; making PR-review reuse the originating issue's adwId is a separate, later consolidation slice.

## User Story
As the ADW automation operator
I want a clean PR-review run to hand its PR off to the merge path
So that PRs whose review comments have been addressed are actually merged by cron instead of getting stuck in an inert terminal state.

## Problem Statement
`adwPrReview.tsx` finishes by calling `completePRReviewWorkflow`, a terminal handler that:
1. builds the cost section,
2. posts a `pr_review_completed` comment to the PR, and
3. writes `execution: completed` to the **orchestrator agent** state file (`orchestratorStatePath`).

It never writes a **top-level** `workflowStage` (the `agents/<adwId>/state.json` file that `cronStageResolver` reads via `AgentStateManager.readTopLevelState`). The cron merge dispatch in `cronIssueFilter.ts` only fires when that top-level stage resolves to `awaiting_merge`. Result: a successfully-addressed PR is never merged.

A secondary defect compounds this: the orchestrator's review→patch retry loop in `adwPrReview.tsx` `break`s on success but **discards** the `reviewResult.reviewPassed` value — there is no surviving variable that records whether the review ultimately passed. Any gate decision needs that value, so the loop must be made to capture it (this is exactly how `adwSdlc.tsx` and the other orchestrators already capture `reviewPassed`).

## Solution Statement
Add a pure decision module and wire it into the completion path:

1. **New pure module `adws/phases/decidePostReviewOutcome.ts`** exposing `decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome`. It returns, for `true`, an outcome that instructs the caller to write `awaiting_merge`; for `false`, an outcome that instructs the caller to do nothing (inert). It performs no I/O — pure input → output, matching the existing pure-gate convention (e.g. `shouldTriggerUpgrade` in `adws/phases/upgradeGate.ts`).

2. **`adwPrReview.tsx`** captures `reviewPassed` from the review loop (assign it inside the loop, as `adwSdlc.tsx` already does), computes `const outcome = decidePostReviewOutcome(reviewPassed)` after the commit/push phase, and passes `outcome` to `completePRReviewWorkflow`.

3. **`adws/phases/prReviewCompletion.ts`** — `completePRReviewWorkflow` accepts an optional `outcome` argument (defaulting to the inert outcome for backward compatibility). After its existing terminal work, when `outcome.writeAwaitingMerge` is true it calls `AgentStateManager.writeTopLevelState(config.base.adwId, { workflowStage: outcome.workflowStage })` to hand the PR off to cron. When false, behaviour is unchanged from today.

4. **Merge** is performed by the **existing** cron `awaiting_merge` → `adwMerge` dispatch path. Nothing new is built for merging.

The fail-case behaviour (no `awaiting_merge`) is preserved naturally because the default outcome is inert and the gate returns inert for `reviewPassed === false`. `'awaiting_merge'` is already a member of the `WorkflowStage` union (`adws/types/workflowTypes.ts`), so no type change is needed. `writeTopLevelState` performs a partial merge-write (`{ ...existing, ...state }`), so writing only `workflowStage` is safe and does not clobber other state fields.

## Relevant Files
Use these files to implement the feature:

- `adws/adwPrReview.tsx` — PR-review orchestrator entrypoint. Its review→patch retry loop currently discards `reviewPassed`; must capture it, then call `decidePostReviewOutcome` and pass the result to `completePRReviewWorkflow`. (Touched file.)
- `adws/phases/prReviewCompletion.ts` — contains `completePRReviewWorkflow` (the inert terminal handler) and `handlePRReviewWorkflowError`. The gated `awaiting_merge` write lands here. (Touched file.)
- `adws/phases/prReviewPhase.ts` — defines `PRReviewWorkflowConfig` (has `base: WorkflowConfig`, which carries `adwId`, `orchestratorStatePath`, and `topLevelStatePath`). Confirms `config.base.adwId` is the PR-review's generated id used for the top-level write. Re-exports `completePRReviewWorkflow` from `prReviewCompletion`.
- `adws/phases/reviewPhase.ts` — `executeReviewPhase` returns `{ reviewPassed: boolean; reviewIssues: ReviewIssue[]; ... }`; `reviewPassed` is the single source of truth fed to the gate.
- `adws/core/agentState.ts` — `AgentStateManager.writeTopLevelState(adwId, Partial<AgentState>)` is the partial merge-write used for the handoff; `readTopLevelState` is what cron reads. Reference for the exact API and merge semantics.
- `adws/types/workflowTypes.ts` — `WorkflowStage` union already includes `'awaiting_merge'`; reused, not extended.
- `adws/triggers/cronIssueFilter.ts` — confirms the existing merge dispatch: `resolution.stage === 'awaiting_merge'` → `{ eligible: true, action: 'merge', adwId }`. This is the consumer of the new write (AC #4); read-only reference, do not modify.
- `adws/triggers/cronStageResolver.ts` — shows how cron resolves an issue → adwId (via `extractLatestAdwId(comments)`) → `readTopLevelState(adwId)` → stage. Important context for the AC #4 discoverability note (see Notes); read-only reference.
- `adws/phases/upgradeGate.ts` — convention reference for a pure decision helper (`shouldTriggerUpgrade`) co-located with its companion `__tests__/upgradeGate.test.ts`.
- `adws/adwSdlc.tsx` (lines ~86–127), `adws/adwPlanBuildReview.tsx` (lines ~81–114) — canonical "capture `reviewPassed` + write `awaiting_merge`" exit pattern to mirror.
- `features/regression/surfaces/row-26-adwPrReview-commitPushPhase-happy.feature` — existing adwPrReview regression surface scenario and harness pattern (`the "pr-review" orchestrator is invoked with adwId ... and issue ...`); shows how to drive the orchestrator and what fixtures/manifests are used. The clean-run scenario here will now additionally write `awaiting_merge` — verify it stays green.
- `test/fixtures/jsonl/payloads/review-agent.json` (passing/LGTM) and `test/fixtures/jsonl/payloads/review-agent-structured.json` — review-agent fixtures used to drive review pass vs. fail in BDD.
- `.adw/scenarios.md` — per-issue scenarios live in `features/per-issue/`, regression in `features/regression/`, tag convention `@adw-{issueNumber}`, run-by-tag command, vocabulary registry at `features/regression/vocabulary.md`.

### Conditional Documentation (from `.adw/conditional_docs.md`)
Included because the task matches their conditions (post-PR `awaiting_merge` write, `prReviewCompletion.ts`, cron `awaiting_merge` dispatch, top-level `workflowStage` writes):

- `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` — the approve-and-handoff exit pattern and `workflowStage: 'awaiting_merge'` transitions (closest precedent for this change). *(May be a stub/empty in this checkout; rely on the live `adwSdlc.tsx` exit code as the canonical reference if so.)*
- `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` — `adwPrReview.tsx`, `prReviewPhase.ts`, and `prReviewCompletion.ts` structure and the phaseRunner/closure-wrapper conventions.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — reading/writing top-level `workflowStage` transitions and `AgentStateManager` top-level state methods.
- `app_docs/feature-ni6fpk-serialize-overlapping-region-issues.md` — cron `awaiting_merge` dispatch, `deriveOrchestratorScript`, and the "awaiting_merge issues not being picked up by the cron" troubleshooting surface (AC #4 context).

### New Files
- `adws/phases/decidePostReviewOutcome.ts` — the pure gate module: `decidePostReviewOutcome(reviewPassed)` + the `PostReviewOutcome` type.
- `adws/phases/__tests__/decidePostReviewOutcome.test.ts` — unit tests for the pure gate (vitest).
- `features/per-issue/feature-719.feature` — BDD scenarios tagged `@adw-719`: clean review run writes `awaiting_merge`; failing review run does not.
- `features/per-issue/step_definitions/feature-719.steps.ts` — step definitions for the above (only the steps not already provided by the shared/surface harness; add a `Then` that reads the top-level state and asserts the `workflowStage`).

## Implementation Plan
### Phase 1: Foundation — the pure gate
Create `decidePostReviewOutcome.ts` with no dependencies beyond the `WorkflowStage` type. Define the `PostReviewOutcome` shape and the pure function. Write its unit tests first/alongside (red → green). This module is self-contained and independently testable, satisfying AC #1 in isolation.

### Phase 2: Core Implementation — capture `reviewPassed` and gate the handoff
1. In `adwPrReview.tsx`, hoist a `let reviewPassed = false;` before the review→patch loop and assign `reviewPassed = reviewResult.reviewPassed;` on each iteration (mirroring `adwSdlc.tsx`). The existing `if (reviewResult.reviewPassed) break;` becomes `if (reviewPassed) break;`.
2. After the commit/push phase, compute `const outcome = decidePostReviewOutcome(reviewPassed);` and pass it to `completePRReviewWorkflow(config, tracker.totalModelUsage, outcome)`.
3. In `prReviewCompletion.ts`, extend `completePRReviewWorkflow` with an optional third parameter `outcome: PostReviewOutcome = decidePostReviewOutcome(false)` (inert default = today's behaviour). After the existing terminal work, add a guard-claused gated write: if `outcome.writeAwaitingMerge && outcome.workflowStage`, call `AgentStateManager.writeTopLevelState(config.base.adwId, { workflowStage: outcome.workflowStage })`, append a log line, and emit a success log ("PR Review handed off — awaiting merge via cron").

### Phase 3: Integration — cron merge dispatch (existing) + tests
No code change for merging: the cron's existing `awaiting_merge` → `adwMerge` dispatch (`cronIssueFilter.ts`) is the consumer. Add the per-issue BDD scenarios that drive the PR-review orchestrator with a passing review fixture (asserting top-level `workflowStage === 'awaiting_merge'`) and with a failing review fixture (asserting `awaiting_merge` is **not** written). Confirm the existing adwPrReview regression surfaces stay green (the inert-default keeps their call sites working; the clean-run surface now additionally writes `awaiting_merge`, which their assertions do not forbid). Run the full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Create the pure gate module
- Create `adws/phases/decidePostReviewOutcome.ts`.
- Define and export `interface PostReviewOutcome { writeAwaitingMerge: boolean; workflowStage: WorkflowStage | null; }` (import `WorkflowStage` from `../types/workflowTypes`).
- Implement and export `export function decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome` using a guard clause: `if (!reviewPassed) return { writeAwaitingMerge: false, workflowStage: null };` then `return { writeAwaitingMerge: true, workflowStage: 'awaiting_merge' };`.
- Add a concise JSDoc explaining the gate and that it is pure (no I/O).

### 2. Write unit tests for the gate (vitest)
- Create `adws/phases/__tests__/decidePostReviewOutcome.test.ts`.
- Assert: `decidePostReviewOutcome(true)` deep-equals `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' }`.
- Assert: `decidePostReviewOutcome(false)` deep-equals `{ writeAwaitingMerge: false, workflowStage: null }`.
- Assert purity/idempotence: calling twice with the same input returns equal results and the function reads no external state.
- Run `bun run test:unit` (or the file-scoped form) and confirm green.

### 3. Wire the gate into completion (`prReviewCompletion.ts`)
- Import `decidePostReviewOutcome` and `type PostReviewOutcome` from `./decidePostReviewOutcome`.
- Change the signature to `completePRReviewWorkflow(config: PRReviewWorkflowConfig, modelUsage?: ModelUsageMap, outcome: PostReviewOutcome = decidePostReviewOutcome(false)): Promise<void>`.
- Keep all existing terminal work (cost section, `pr_review_completed` comment, `writeState(orchestratorStatePath, ...)`, `appendLog`, banner logs) unchanged.
- After that work, add the gated handoff write using a guard clause:
  - `if (!outcome.writeAwaitingMerge || !outcome.workflowStage) return;`
  - else `AgentStateManager.writeTopLevelState(config.base.adwId, { workflowStage: outcome.workflowStage });` + `AgentStateManager.appendLog(orchestratorStatePath, 'PR Review handed off to ' + outcome.workflowStage);` + `log('PR Review handed off — awaiting merge via cron', 'success');`.
- Ensure the re-export of `completePRReviewWorkflow` from `prReviewPhase.ts` and the barrel in `adws/workflowPhases.ts` still resolve (signature change is additive/back-compatible).

### 4. Capture `reviewPassed` and call the gate (`adwPrReview.tsx`)
- Import `decidePostReviewOutcome` from `./phases/decidePostReviewOutcome`.
- Introduce `let reviewPassed = false;` before the review→patch `for` loop; assign `reviewPassed = reviewResult.reviewPassed;` inside the loop; change the break to `if (reviewPassed) break;`.
- After `await runPhase(config.base, tracker, _ => executePRReviewCommitPushPhase(config), 'pr_review_commit_push');`, compute `const outcome = decidePostReviewOutcome(reviewPassed);`.
- Replace `await completePRReviewWorkflow(config, tracker.totalModelUsage);` with `await completePRReviewWorkflow(config, tracker.totalModelUsage, outcome);`.
- Leave the fail-path otherwise untouched (commit/push still runs on exhaustion, as today — only the `awaiting_merge` write is gated).

### 5. Add per-issue BDD scenarios
- Create `features/per-issue/feature-719.feature`, tagged `@adw-719` (plus the project's `@adw-<adwId>` convention tag), with two scenarios:
  - **Clean run hands off:** invoke the `pr-review` orchestrator with a passing review fixture (`review-agent.json` LGTM) and a clean worktree; **Then** the top-level workflow stage for the run's adwId is `awaiting_merge`.
  - **Failed review stays inert:** invoke the `pr-review` orchestrator with a failing/blocker review fixture (e.g. `review-agent-structured.json`) such that `reviewPassed` is false; **Then** the top-level workflow stage for the run's adwId is **not** `awaiting_merge` (today's inert behaviour preserved).
- Prefer the existing shared/surface harness steps (`the "pr-review" orchestrator is invoked with adwId {string} and issue {int}`, fixture/manifest/worktree Given steps). Only add new step definitions for what is missing.

### 6. Add step definitions (only the missing ones)
- Create `features/per-issue/step_definitions/feature-719.steps.ts`.
- Add a `Then` step that asserts the top-level `workflowStage` for a given adwId by reading the run's top-level state (`AgentStateManager.readTopLevelState(adwId)`), following the existing per-issue step patterns (e.g. `feature-639.steps.ts`, `feature-660.steps.ts`) — both an `is "awaiting_merge"` and an `is not "awaiting_merge"` form.
- Reuse the shared orchestrator-invocation / fixture-loading Given/When steps already used by the adwPrReview surface scenarios; do not duplicate them.
- Run a `--dry-run` to confirm no undefined or ambiguous steps.

### 7. Validate (zero regressions)
- Run every command in the Validation Commands section.
- Specifically confirm the `@adw-719` scenarios pass and the full `@regression` suite (including the existing adwPrReview surfaces, rows 24–26) is green.

## Testing Strategy
### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope (vitest, run via `bun run test:unit`).

- `adws/phases/__tests__/decidePostReviewOutcome.test.ts`:
  - `reviewPassed === true` → `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' }`.
  - `reviewPassed === false` → `{ writeAwaitingMerge: false, workflowStage: null }`.
  - Purity: repeated calls with the same argument yield equal results; the function touches no filesystem/global state (it is a total function over a boolean).
- No new unit test is added for `completePRReviewWorkflow` itself (it is a side-effectful terminal handler validated through BDD); the gate's logic — the only branching introduced — is fully covered by the pure-module tests. The handoff write is exercised end-to-end by the BDD scenarios.

### Edge Cases
- **Review never passes / loop exhausts `MAX_REVIEW_RETRY_ATTEMPTS`:** `reviewPassed` stays `false` → inert outcome → no `awaiting_merge` (AC #3).
- **Review passes on the first attempt:** loop breaks immediately, `reviewPassed === true` → `awaiting_merge` written (AC #2).
- **Default-argument back-compat:** existing callers of `completePRReviewWorkflow` that omit `outcome` get the inert default → no behaviour change → existing adwPrReview regression surfaces stay green.
- **Partial-write safety:** `writeTopLevelState` merges, so writing only `{ workflowStage: 'awaiting_merge' }` preserves prior top-level fields (adwId, issueNumber, branchName, phases, metadata).
- **No double-overwrite:** `completePRReviewWorkflow` writes execution-completed to `orchestratorStatePath` (the agent state), not a top-level `'completed'` stage, so the `awaiting_merge` top-level write is not clobbered (unlike the SDLC `completeWorkflow` caveat — that caveat does not apply here).

## Acceptance Criteria
- A pure `decidePostReviewOutcome(reviewPassed)` module exists in `adws/phases/decidePostReviewOutcome.ts`: `true` → `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' }` (proceed/handoff), `false` → `{ writeAwaitingMerge: false, workflowStage: null }` (stop, no `awaiting_merge`).
- On a clean PR-review run (review passed), the top-level workflow stage (`agents/<adwId>/state.json`) is `awaiting_merge` at completion.
- When the PR-review review did not pass, `awaiting_merge` is NOT written — the run's top-level stage remains whatever the last phase left (today's inert behaviour).
- The PR is merged by cron's existing `awaiting_merge` → `adwMerge` dispatch; no new merge mechanism is introduced (this slice only adds the gated write of the existing handoff stage). See Notes for the adwId-discoverability dependency on the later consolidation slice.
- Unit tests for `decidePostReviewOutcome` pass; the `@adw-719` BDD scenarios pass; the full `@regression` suite is green.
- `bun run lint`, `bunx tsc --noEmit` (root and `adws/tsconfig.json`), and `bun run build` all pass with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — lint for code-quality issues.
- `bunx tsc --noEmit` — type-check the repo.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type-check for the `adws/` package.
- `bun run build` — verify no build errors.
- `bun run test:unit` — run unit tests (includes the new `decidePostReviewOutcome.test.ts`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-719"` — run this feature's BDD scenarios (clean-run handoff + failed-review inert).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run the regression suite (confirm adwPrReview surfaces rows 24–26 and all others stay green).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the gate a small pure function (purity, single responsibility, immutability); use guard clauses and early returns rather than nested conditionals; avoid `any`; prefer explicit types. The change is intentionally minimal and additive.
- **No new `WorkflowStage` value:** `'awaiting_merge'` already exists in the union (`adws/types/workflowTypes.ts`).
- **No new dependency / install command needed** (`bun add <package>` per `.adw/commands.md` if one were ever required — it is not here).
- **AC #4 — discoverability dependency (flagged hypothesis, verify before relying on it as fully end-to-end):** cron's merge dispatch resolves an issue → adwId by scanning the **issue's** comments (`extractLatestAdwId` in `cronStageResolver.ts`), then reads `agents/<adwId>/state.json`. This slice keeps PR-review's **own generated adwId** (per the PRD), and PR-review currently posts its stage comments to the **PR** (`commentOnPullRequest`), not the issue. So writing `awaiting_merge` under the PR-review adwId is correct and necessary, but whether the cron's issue-poll can *find* that adwId to dispatch the merge depends on the originating-issue adwId-reuse work, which the PRD scopes as a **separate, later consolidation slice** ("PR-review keeps its own generated adwId for this slice"). This plan implements the write + relies on the existing dispatch mechanism (no new merge code) — exactly what AC #4 asks — and the BDD scenarios verify the *write* (the directly-drivable contract). The full cron-finds-it-and-merges path should be confirmed once the adwId-reuse slice lands; do not assert end-to-end merge as proven by this slice alone. (Per memory: BDD harness cannot drive the real cron issue-poll → merge; assert the top-level state write, not `getRecordedRequests`-style cron behaviour.)
- **Pattern parity:** the implementation mirrors the approve-and-handoff exit already in `adwSdlc.tsx`/`adwPlanBuildReview.tsx`; the only deliberate difference is the **gate** — PR-review writes `awaiting_merge` *only when* `reviewPassed`, whereas the SDLC orchestrators write it unconditionally after a bounded review loop.
- **Backward compatibility:** the new `outcome` parameter on `completePRReviewWorkflow` defaults to the inert outcome, so any existing call site (and the existing adwPrReview regression surfaces) is unaffected.
- **Out of scope for this slice (later PRD slices):** the new cron-excluded `review_failed` stage, per-adwId orchestrator-script resume routing, and PR-review reusing the originating issue's adwId.
