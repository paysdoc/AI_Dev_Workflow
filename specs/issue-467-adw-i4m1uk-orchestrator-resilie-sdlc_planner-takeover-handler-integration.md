# Feature: takeoverHandler integration — single decision tree for every candidate arriving at an issue

## Metadata
issueNumber: `467`
adwId: `i4m1uk-orchestrator-resilie`
issueJson: `{"number":467,"title":"orchestrator-resilience: takeoverHandler integration (HITL)","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nBuild the `takeoverHandler` integration module — the deepest and most consequential part of this refactor. Its public interface is `evaluateCandidate({ issueNumber, repoInfo }) → CandidateDecision` returning one of `spawn_fresh`, `take_over_adwId`, `defer_live_holder`, `skip_terminal`. Internally it composes `spawnGate`, `processLiveness`, `agentState`, `remoteReconcile`, and `worktreeReset` per the decision tree in the PRD.\n\nBoth cron and webhook paths route through `evaluateCandidate` before spawning. All dependencies are injected so the decision tree can be exhaustively unit-tested in isolation.\n\nThis is **HITL** because it is the integration point where every coordination primitive converges and a mistake strands or duplicates real work. The review must validate the decision-tree branches against the live cron and webhook call sites.\n\nSee \"New modules to build → takeoverHandler\" and \"Takeover decision tree\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/triggers/takeoverHandler.ts` exports `evaluateCandidate({ issueNumber, repoInfo })` with all composed dependencies injected\n- [ ] Decision tree implements all five branches of the PRD spec:\n  - no state file → `spawn_fresh`\n  - `completed` / `discarded` → `skip_terminal`\n  - `abandoned` → `take_over_adwId` (worktreeReset → remoteReconcile → resume)\n  - `*_running` with live PID not holding lock → SIGKILL → `take_over_adwId`\n  - `*_running` with dead PID → `take_over_adwId`\n- [ ] `paused` stage is a no-op (pause queue scanner remains sole resumer)\n- [ ] Cron trigger routes every candidate through `evaluateCandidate` before spawning\n- [ ] Webhook handler routes every candidate through `evaluateCandidate` before spawning\n- [ ] Unit tests cover every decision-tree branch with injected doubles for `spawnGate`, `agentState`, `processLiveness`, `remoteReconcile`, `worktreeReset`\n- [ ] Integration test exercises a simulated takeover end-to-end against a fixture `abandoned` state\n\n## Blocked by\n\n- Blocked by #456\n- Blocked by #461\n- Blocked by #463\n- Blocked by #457\n- Blocked by #458\n\n## User stories addressed\n\n- User story 1\n- User story 6\n- User story 9\n- User story 15\n- User story 22","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-04-20T11:06:04Z","comments":[],"actionableComment":null}`

## Feature Description

Build the `takeoverHandler` integration module at `adws/triggers/takeoverHandler.ts` — the deep module that encodes the full takeover decision tree from the orchestrator-coordination-resilience PRD. Its single public entry point is `evaluateCandidate({ issueNumber, repoInfo }) → CandidateDecision`, where `CandidateDecision` is a discriminated union of `spawn_fresh`, `take_over_adwId`, `defer_live_holder`, and `skip_terminal`.

Internally `evaluateCandidate` composes every coordination primitive already built by the earlier slices in this refactor: `spawnGate` (per-issue file lock), `processLiveness` (PID+start-time authoritative liveness), `AgentStateManager` (top-level state reader), `remoteReconcile` (authoritative remote-state derivation), and `worktreeReset` (deterministic worktree reset to `origin/<branch>`). The decision tree is expressed as a linear sequence of branches; every decision path returns a `CandidateDecision` without executing the spawn itself. Callers (the cron filter loop and `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts`) read the decision and dispatch accordingly.

Both cron and webhook entry points route every candidate through `evaluateCandidate` before spawning a new orchestrator. This replaces the current ad-hoc pattern where the trigger first acquires the spawn lock, classifies, checks `isAdwRunningForIssue`, then spawns — a pattern that cannot distinguish "no prior work" from "work abandoned and worktree dirty" from "work running in another process". After this slice, the trigger asks one question (`evaluateCandidate`) and acts on one answer.

All external side effects — the top-level state read, the liveness check, `SIGKILL` to a rogue live PID, worktree reset, remote reconcile, the spawn lock itself — are passed in as a `TakeoverDeps` interface with a `buildDefaultTakeoverDeps()` factory that wires production implementations. This makes every branch of the decision tree testable with pure doubles, matching the PRD's testing policy ("Tests that inspect private state or match on specific implementation details are avoided").

## User Story

As an ADW developer, I want a deep `takeoverHandler` module that encapsulates the full decision tree for evaluating a candidate against an existing claim, so that cron, webhook, and resume paths all use the same logic. (User story 9)

As an ADW operator, I want a crashed orchestrator to be automatically picked up on the next cron cycle, so that I don't have to manually triage every rate-limit or OOM event. (User story 1)

As an ADW operator, I want two simultaneous cron/webhook candidates for the same issue to deterministically resolve to a single orchestrator spawn, so that I don't get two PRs or two branches competing for the same issue. (User story 6)

As an ADW developer, I want a paused orchestrator's resume path to verify it still owns the canonical claim before proceeding, so that the manual-edit-state or split-brain case doesn't produce two orchestrators continuing the same work. (User story 15)

As an ADW developer, I want deep modules — `processLiveness`, `takeoverHandler`, `remoteReconcile`, `worktreeReset` — to have their logic fully covered by unit tests using injected dependencies, so that refactors don't silently break recovery behavior. (User story 22)

## Problem Statement

Every coordination primitive built in issues #456 (`processLiveness`), #461 (state schema extension), #463 (spawnGate orchestrator-lifetime lock), #457 (`remoteReconcile`), and #458 (`worktreeReset`) is individually unit-tested but not yet wired into the trigger layer. The cron and webhook paths today still reason about candidate eligibility in piecemeal fashion: `cronIssueFilter.evaluateIssue` checks for `abandoned` / `completed` / `paused` via state-file stage strings; `classifyAndSpawnWorkflow` acquires a short-lived trigger-side spawn lock around classification and spawns unconditionally if `isAdwRunningForIssue` returns false. There is no single place that answers the PRD's canonical takeover question:

> Given a candidate (issue, repo), what should happen — spawn fresh, take over an existing adwId, defer to a live holder, or skip because the work is terminal?

Without a central answer, the five coordination primitives cannot cooperate. `processLiveness` knows how to decide "is this PID live" but there is no code that asks it the right question at the right time. `remoteReconcile` can derive a stage from remote artifacts but nothing calls it before deciding whether a fresh spawn is warranted. `worktreeReset` can clean a worktree deterministically but no call site invokes it on the takeover boundary. The integration gap is the entire point of this slice.

A practical failure mode this slice closes: an orchestrator that dies between writing the PR-open phase and writing `awaiting_merge`. Its top-level state shows `abandoned`. Today, the cron sweeper's `isRetriableStage('abandoned') === true` admits it and `classifyAndSpawnWorkflow` spawns a fresh SDLC — producing a duplicate branch, a duplicate plan run, and a ghost orchestrator because the worktree on disk still holds half-written phase artifacts from the dead run. After this slice, `evaluateCandidate` for that issue returns `take_over_adwId` with the existing adwId; the caller invokes `worktreeReset` to clean the worktree, `remoteReconcile` to derive the true stage (likely `awaiting_merge` because the PR is actually open on origin), and resumes into the merge orchestrator path rather than re-running SDLC.

## Solution Statement

Create `adws/triggers/takeoverHandler.ts` exporting a single public function `evaluateCandidate(input, deps?)` and the `CandidateDecision` discriminated union type. The function implements the five-branch decision tree from the PRD's "Takeover decision tree" section exactly as written, with each branch returning a `CandidateDecision` value.

```ts
export type CandidateDecision =
  | { readonly kind: 'spawn_fresh' }
  | { readonly kind: 'take_over_adwId'; readonly adwId: string; readonly derivedStage: WorkflowStage }
  | { readonly kind: 'defer_live_holder'; readonly holderPid: number }
  | { readonly kind: 'skip_terminal'; readonly adwId: string; readonly terminalStage: 'completed' | 'discarded' };
```

The decision tree in code:

1. Attempt `spawnGate.acquireIssueSpawnLock(repoInfo, issueNumber, process.pid)`. If the lock is held by a live holder (acquire returns `false` because `processLiveness.isProcessLive` said the recorded PID+pidStartedAt is alive), return `defer_live_holder` with the recorded PID.
2. With the lock acquired, resolve the canonical adwId for this issue from the latest ADW comment (`extractLatestAdwId`, already used by `cronStageResolver`). If no adwId exists, read the top-level state as null and proceed.
3. Read `AgentStateManager.readTopLevelState(adwId)`. If null (no state file yet), release the spawn lock and return `spawn_fresh`.
4. Inspect `state.workflowStage`:
   - `completed` or `discarded` → release lock, return `skip_terminal`.
   - `paused` → release lock, return `spawn_fresh` with a no-op note (pause queue scanner is the sole resumer; we do *not* take over paused workflows, per PRD "Further Notes").
   - `abandoned` → worktreeReset → remoteReconcile → return `take_over_adwId` (lock stays held; the caller's spawn keeps it).
   - stage ends with `_running` or is `starting`/`resuming`: check the recorded `state.pid` / `state.pidStartedAt` via `processLiveness.isProcessLive`. Two sub-branches:
     - live PID that was not the lock holder (we now hold the lock, so the process was running without the lock held — stale from pre-#463 era or a split-brain) → `process.kill(pid, 'SIGKILL')`, then worktreeReset → remoteReconcile → `take_over_adwId`.
     - dead PID → worktreeReset → remoteReconcile → `take_over_adwId`.
   - any other stage → fall through to `spawn_fresh` (defensive default).

All I/O boundaries are expressed as a `TakeoverDeps` interface:

```ts
export interface TakeoverDeps {
  readonly acquireIssueSpawnLock: (repoInfo: RepoInfo, issueNumber: number, ownPid: number) => boolean;
  readonly releaseIssueSpawnLock: (repoInfo: RepoInfo, issueNumber: number) => void;
  readonly readSpawnLockRecord: (repoInfo: RepoInfo, issueNumber: number) => { pid: number; pidStartedAt: string } | null;
  readonly resolveAdwId: (issueNumber: number, repoInfo: RepoInfo) => string | null;
  readonly readTopLevelState: (adwId: string) => AgentState | null;
  readonly isProcessLive: (pid: number, pidStartedAt: string) => boolean;
  readonly killProcess: (pid: number) => void;
  readonly resetWorktree: (worktreePath: string, branch: string) => void;
  readonly deriveStageFromRemote: (issueNumber: number, adwId: string, repoInfo: RepoInfo) => WorkflowStage;
  readonly getWorktreePath: (branchName: string, baseRepoPath?: string) => string;
}

export function buildDefaultTakeoverDeps(): TakeoverDeps { … }
```

A small read-only helper `readSpawnLockRecord(repoInfo, issueNumber)` is added to `spawnGate.ts` so `evaluateCandidate` can report the holder PID in a `defer_live_holder` result (the existing `acquireIssueSpawnLock` does not surface the holder). This is a read of the same file path and does not change any write behavior.

Wire the two call sites:

- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow` currently calls `acquireIssueSpawnLock` → classify → spawn. Replace with `evaluateCandidate` at the top; branch on the decision to (a) exit early for `defer_live_holder` / `skip_terminal`, (b) classify + spawn for `spawn_fresh`, (c) skip classification and spawn the resume path for `take_over_adwId` using the existing adwId and the derived stage. The lock is already held by `evaluateCandidate` on the `spawn_fresh` / `take_over_adwId` paths and is transferred to the child orchestrator (which re-acquires it for its lifetime per issue #463's `acquireOrchestratorLock`). On the deferral paths, release.
- `adws/triggers/trigger_cron.ts` — the spawn loop at `trigger_cron.ts:118-154` currently calls `classifyAndSpawnWorkflow` directly for `action === 'spawn'`. That call site continues to work unchanged because `classifyAndSpawnWorkflow` itself now routes through `evaluateCandidate`. The `action === 'merge'` path (line 122) stays as-is — `awaiting_merge` candidates dispatch to `adwMerge.tsx`, which has its own coordination story in other issues.

This layering means the integration is single-sourced: `classifyAndSpawnWorkflow` is the one function that calls `evaluateCandidate`, and both cron and webhook reach it. This matches the PRD's "single well-defined recovery path" goal.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/orchestrator-coordination-resilience.md` — parent PRD. "New modules to build → takeoverHandler" and "Takeover decision tree" sections are authoritative.
- `adws/triggers/spawnGate.ts` — existing per-issue lock module with `acquireIssueSpawnLock` / `releaseIssueSpawnLock`. Will gain a new read-only helper `readSpawnLockRecord` (or `getSpawnLockHolder`) so `evaluateCandidate` can surface the holder PID in a `defer_live_holder` result.
- `adws/core/processLiveness.ts` — `isProcessLive(pid, recordedStartTime)` used in the decision tree for the `*_running` branches. No changes.
- `adws/core/remoteReconcile.ts` — `deriveStageFromRemote(issueNumber, adwId, repoInfo, deps?)` already returns a `WorkflowStage`. `evaluateCandidate` invokes this on the `abandoned` and `*_running` branches after `worktreeReset`. No changes.
- `adws/vcs/worktreeReset.ts` — `resetWorktreeToRemote(worktreePath, branch)`. Called before `remoteReconcile` on takeover branches to ensure the worktree is a clean copy of `origin/<branch>`. No changes.
- `adws/vcs/worktreeOperations.ts` — `getWorktreePath(branchName, baseRepoPath?)` used to resolve the worktree path for `resetWorktreeToRemote`. No changes.
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState(adwId)` used on every decision-tree branch. No changes.
- `adws/types/agentTypes.ts` — existing `AgentState` already has `pid`, `pidStartedAt`, `lastSeenAt`, `branchName` (from issue #461). No changes.
- `adws/types/workflowTypes.ts` — existing `WorkflowStage` already has `abandoned`, `discarded`, `awaiting_merge`. No changes.
- `adws/triggers/cronStageResolver.ts` — `extractLatestAdwId(comments)` used inside `evaluateCandidate` to resolve the canonical adwId for an issue. No changes.
- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow` is the single call site that routes through `evaluateCandidate`. Will be refactored to branch on the decision and spawn fresh / resume / defer / skip accordingly.
- `adws/triggers/trigger_cron.ts` — reaches `classifyAndSpawnWorkflow` at line 153; indirectly routes through `evaluateCandidate` after the refactor. Verify no regression in the `awaiting_merge` path (line 122) which bypasses the gate deliberately.
- `adws/triggers/trigger_webhook.ts` — reaches `classifyAndSpawnWorkflow` at lines 165 and 219; same indirect routing. No direct changes required.
- `adws/github/issueApi.ts` (via `fetchIssueCommentsRest`) — used by the default `resolveAdwId` dep to fetch comments and call `extractLatestAdwId`. No changes.
- `adws/github/githubApi.ts` — `RepoInfo` type. No changes.
- `adws/triggers/__tests__/spawnGate.test.ts` — reference pattern for the new `takeoverHandler.test.ts` (vitest, `vi.mock`, tmpDir fixture, injected mocks for I/O).
- `adws/triggers/__tests__/webhookHandlers.test.ts` — reference pattern for the integration test (factory-builder deps, `AgentState` fixture builder).
- `app_docs/feature-djtyv4-remote-reconcile-module.md` — conditional doc; read before wiring `deriveStageFromRemote`.
- `app_docs/feature-xlv8zk-process-liveness-module.md` — conditional doc; read before using `isProcessLive`.
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — conditional doc; read before modifying `classifyAndSpawnWorkflow`.
- `app_docs/feature-yxo18t-spawngate-lifetime-pid-liveness.md` — conditional doc; explains the orchestrator-lifetime lock contract (`acquireOrchestratorLock`) that `evaluateCandidate` cooperates with.
- `app_docs/feature-eantbn-orchestrator-resilie-worktree-reset-module.md` — conditional doc; explains `resetWorktreeToRemote` semantics used on takeover branches.
- `app_docs/feature-guimqa-extend-top-level-state-schema.md` — conditional doc; explains `AgentState.pid` / `pidStartedAt` / `lastSeenAt` used by the decision tree.
- `app_docs/feature-jcwqw7-extend-top-level-state-schema.md` — conditional doc; second schema slice, same fields.
- `app_docs/feature-zy5s32-heartbeat-module-tracer-integration.md` — conditional doc; explains heartbeat-driven `lastSeenAt` which the takeover handler reads (indirectly via `readTopLevelState`).
- `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` — conditional doc; explains `discarded` as terminal-non-retriable, which the `skip_terminal` branch must respect.

### New Files

- `adws/triggers/takeoverHandler.ts` — the new module. Exports `evaluateCandidate`, `CandidateDecision`, `TakeoverDeps`, `buildDefaultTakeoverDeps`.
- `adws/triggers/__tests__/takeoverHandler.test.ts` — unit tests covering every decision-tree branch with injected doubles.
- `adws/triggers/__tests__/takeoverHandler.integration.test.ts` — integration test for the `abandoned` takeover path end-to-end against a fixture state file and a stubbed GitHub reconcile, asserting that `worktreeReset` and `deriveStageFromRemote` are invoked in order and that the resulting decision carries the derived stage.

## Implementation Plan

### Phase 1: Foundation

Add the small read-only helper to `spawnGate.ts` that surfaces the current lock holder's `pid` without mutating the lock. Define the `CandidateDecision` union and `TakeoverDeps` interface in `adws/triggers/takeoverHandler.ts` (new file, skeleton only). Write the minimum set of unit tests in `takeoverHandler.test.ts` that fail (red) because `evaluateCandidate` is not yet implemented — one test per decision-tree branch.

### Phase 2: Core Implementation

Implement `evaluateCandidate` to make every unit test pass, one branch at a time in this order:

1. Lock-held-by-live-holder → `defer_live_holder`.
2. No state file / null adwId → `spawn_fresh`.
3. `completed` / `discarded` → `skip_terminal` (releasing the lock because the caller will not spawn).
4. `paused` → `spawn_fresh`-with-release semantics (lock released; caller treats as "nothing to do here; pause queue scanner owns it"). Note: the decision kind here is still `spawn_fresh`-like in that it tells the caller to not try to take over, but the PRD specifies "no-op" — we encode this by returning `skip_terminal`-with-kind-note? Actually the cleanest model is a dedicated branch that looks like `skip_terminal` semantically (caller does nothing), but the stage is `paused` not terminal. Keep simple: return `defer_live_holder`-like result with a distinct kind `paused_noop`, OR extend `skip_terminal` to also carry `paused` as a terminal-to-this-handler stage. Decision for this slice: extend the `skip_terminal` kind to include `paused` as a terminalStage value — the handler treats it as terminal even though the pause queue scanner may resume it later. This is the minimal additive change and matches the PRD's "paused stage is a no-op" language.
5. `abandoned` → worktreeReset → remoteReconcile → `take_over_adwId` with derivedStage.
6. `*_running` with live PID not holding lock → SIGKILL → worktreeReset → remoteReconcile → `take_over_adwId`.
7. `*_running` / `starting` / `resuming` with dead PID → worktreeReset → remoteReconcile → `take_over_adwId`.
8. Any other stage (defensive): `spawn_fresh`.

Implement `buildDefaultTakeoverDeps()` wiring each dep to its production implementation (spawnGate primitives, processLiveness.isProcessLive, AgentStateManager.readTopLevelState, deriveStageFromRemote with default reconcile deps, resetWorktreeToRemote, getWorktreePath, and a small default `killProcess` that calls `process.kill(pid, 'SIGKILL')` with a try/catch to tolerate ESRCH).

### Phase 3: Integration

Refactor `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts` to call `evaluateCandidate` as its first step and branch on the decision:

- `defer_live_holder` → log and return (no spawn).
- `skip_terminal` → log and return (no spawn).
- `spawn_fresh` → proceed with classification + spawn using a freshly generated adwId (existing behavior).
- `take_over_adwId` → skip classification, reuse the resolved adwId, spawn the same orchestrator script that owned this adwId (resolve via the top-level state's `orchestratorScript` field set during `initializeWorkflow`), pass `--issue-type` from the state or re-classify if absent.

The existing `acquireIssueSpawnLock` call inside `classifyAndSpawnWorkflow` is replaced by the one `evaluateCandidate` already performed. Release semantics: on `defer_live_holder` and `skip_terminal`, the handler released the lock internally. On `spawn_fresh` and `take_over_adwId`, the lock remains held; the caller's `spawnDetached` inherits no file descriptor for it (it's a file-lock, not a flock), and the child orchestrator re-acquires it via `acquireOrchestratorLock` (issue #463). The brief handoff window is acceptable because both acquisitions target the same file path via `wx` atomicity and `processLiveness.isProcessLive` correctly identifies either the parent or the child as the live holder.

Write the integration test exercising the `abandoned` takeover end-to-end with real file-system state and stubbed GitHub reconcile.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Read conditional docs relevant to this slice

- Read `app_docs/feature-djtyv4-remote-reconcile-module.md` (deriveStageFromRemote wiring).
- Read `app_docs/feature-xlv8zk-process-liveness-module.md` (isProcessLive contract).
- Read `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` (classifyAndSpawnWorkflow spawn-dedup pattern).
- Read `app_docs/feature-yxo18t-spawngate-lifetime-pid-liveness.md` (orchestrator-lifetime lock contract; this slice must not fight it).
- Read `app_docs/feature-eantbn-orchestrator-resilie-worktree-reset-module.md` (resetWorktreeToRemote semantics).
- Read `app_docs/feature-guimqa-extend-top-level-state-schema.md` and `app_docs/feature-jcwqw7-extend-top-level-state-schema.md` (AgentState.pid/pidStartedAt/lastSeenAt).
- Read `app_docs/feature-zy5s32-heartbeat-module-tracer-integration.md` (heartbeat writes lastSeenAt; this handler does not yet use it directly, but must not assume its presence).
- Read `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` (discarded terminal-never-retriable).

### 2. Add a read-only helper to spawnGate.ts

- Add `export function readSpawnLockRecord(repoInfo: RepoInfo, issueNumber: number): { pid: number; pidStartedAt: string } | null` that reads the existing lock file and returns `{ pid, pidStartedAt }` if parseable, else null. Do not change any existing exports.
- Add a unit test to `spawnGate.test.ts`: `readSpawnLockRecord returns the written record after a successful acquire`, and `readSpawnLockRecord returns null when no lock file exists`.

### 3. Create adws/triggers/takeoverHandler.ts skeleton

- Module header comment describing the decision tree and injection contract.
- Export `CandidateDecision` union as specified above.
- Export `EvaluateCandidateInput = { readonly issueNumber: number; readonly repoInfo: RepoInfo }`.
- Export `TakeoverDeps` interface.
- Export `buildDefaultTakeoverDeps(): TakeoverDeps` that wires production implementations (spawnGate.acquireIssueSpawnLock, spawnGate.releaseIssueSpawnLock, spawnGate.readSpawnLockRecord, a resolveAdwId dep that calls fetchIssueCommentsRest + extractLatestAdwId, AgentStateManager.readTopLevelState, processLiveness.isProcessLive, processLiveness.getProcessStartTime not needed directly, killProcess wrapping process.kill, resetWorktreeToRemote, deriveStageFromRemote with default reconcile deps, getWorktreePath).
- Export `evaluateCandidate(input: EvaluateCandidateInput, deps?: TakeoverDeps): CandidateDecision` as a stub throwing `not_implemented`.

### 4. Write takeoverHandler unit tests (RED)

Create `adws/triggers/__tests__/takeoverHandler.test.ts` using the vitest + injected-deps pattern from `spawnGate.test.ts` / `webhookHandlers.test.ts`. One describe block per decision-tree branch. Each test builds a `TakeoverDeps` stub with the relevant calls mocked via `vi.fn()` and asserts the returned `CandidateDecision`. Cover at minimum:

- `defer_live_holder` — acquireIssueSpawnLock returns false; readSpawnLockRecord returns a holder record; expect `{ kind: 'defer_live_holder', holderPid: … }` and release was NOT called (we didn't acquire).
- `spawn_fresh` — acquire returns true; resolveAdwId returns null; expect `{ kind: 'spawn_fresh' }` and lock remains held (release not called internally).
- `spawn_fresh` (no state file) — acquire returns true; resolveAdwId returns an adwId; readTopLevelState returns null; expect `{ kind: 'spawn_fresh' }`.
- `skip_terminal` `completed` — state.workflowStage = 'completed'; expect skip + release called.
- `skip_terminal` `discarded` — state.workflowStage = 'discarded'; expect skip + release called.
- `paused` no-op — state.workflowStage = 'paused'; expect skip + release called with terminalStage 'paused' (or dedicated kind, see Phase 2 decision).
- `take_over_adwId` from abandoned — state.workflowStage = 'abandoned' with branchName; expect resetWorktree called with correct path, deriveStageFromRemote called, then `{ kind: 'take_over_adwId', adwId, derivedStage }`.
- `take_over_adwId` from *_running with live non-holder PID — state has stage 'build_running' with pid + pidStartedAt; isProcessLive → true; expect killProcess called then resetWorktree + remoteReconcile then take_over.
- `take_over_adwId` from *_running with dead PID — isProcessLive → false; expect no killProcess, then resetWorktree + remoteReconcile then take_over.
- `take_over_adwId` from starting/resuming with dead PID — same as above with stage 'starting'.
- Defensive fallthrough — unknown stage → `spawn_fresh`.
- No branchName on state — abandoned with no branchName field: expect the handler to skip the worktreeReset step (nothing to reset) but still invoke remoteReconcile and return take_over (remoteReconcile handles the missing-branch case by falling back to state-file value).

### 5. Implement evaluateCandidate (GREEN)

Implement the function so all unit tests pass. Use a linear if/else decision tree matching the PRD exactly. Surface every external call through `deps.*` so the tests remain in control.

### 6. Wire evaluateCandidate into classifyAndSpawnWorkflow

Refactor `adws/triggers/webhookGatekeeper.ts::classifyAndSpawnWorkflow`:

- Remove the in-function `acquireIssueSpawnLock` call and replace it with `evaluateCandidate({ issueNumber, repoInfo: resolvedRepoInfo })` at the top.
- Branch on the decision:
  - `defer_live_holder` / `skip_terminal` → log with the specific reason and return without spawning.
  - `spawn_fresh` → keep the existing classification + spawn block; existing `existingAdwId` param continues to work.
  - `take_over_adwId` → look up the stored `orchestratorScript` from the top-level state (already persisted by `initializeWorkflow` per PRD "Implementation Decisions → agentState extension"). If absent, fall back to re-classification (log warning). Spawn the same orchestrator script with the existing adwId and, when available, the derived `workflowStage` passed via a new `--resume-stage` CLI flag (future slice may consume it; for this slice, simply log the derived stage — the orchestrator itself re-reads the top-level state on resume per existing recovery semantics).
- Preserve the existing `isAdwRunningForIssue` check only on the `spawn_fresh` path (defense in depth against a very late-arriving competing webhook). On `take_over_adwId`, skip it: we already hold the canonical lock, and `isAdwRunningForIssue` inspects ADW comments which would still show the dead orchestrator's comment.

### 7. Verify cron and webhook call sites implicitly route through evaluateCandidate

- In `trigger_cron.ts`, confirm line 153 still calls `classifyAndSpawnWorkflow` and therefore inherits the routing. No code change.
- In `trigger_webhook.ts`, confirm lines 165 and 219 still call `classifyAndSpawnWorkflow`. No code change.
- Add inline comments above each call site noting "takeover decision handled inside classifyAndSpawnWorkflow" so a future maintainer does not re-introduce a pre-check.

### 8. Update webhookHandlers.test.ts and webhookGatekeeper call-site tests

- The existing `classifyAndSpawnWorkflow` is not currently tested directly (no `webhookGatekeeper.test.ts` exists). Do NOT introduce one in this slice — the decision logic is fully tested in `takeoverHandler.test.ts` and the integration test below exercises the wiring.
- Update any existing mocks in `webhookHandlers.test.ts` that assume the old trigger-side lock acquire-and-release sequence. Grep for `acquireIssueSpawnLock` references across `__tests__/` and adjust only where the mock breaks the new code path.

### 9. Write the integration test for the abandoned takeover

Create `adws/triggers/__tests__/takeoverHandler.integration.test.ts`:

- Set up a temp dir with `AGENTS_STATE_DIR` pointed at it (the existing `vi.mock('../../core/config')` pattern from spawnGate.test.ts).
- Write a fixture top-level state file at `{tmpDir}/fixture-adwid/state.json` with `workflowStage: 'abandoned'`, `branchName: 'feature/issue-999-fixture'`, no `pid` (so no SIGKILL needed).
- Inject a `TakeoverDeps` where:
  - `acquireIssueSpawnLock` returns `true`.
  - `resolveAdwId` returns `'fixture-adwid'`.
  - `readTopLevelState` reads from the fixture file.
  - `getWorktreePath` returns a tmpDir path.
  - `resetWorktree` is a vi.fn() (does not actually execute git commands).
  - `deriveStageFromRemote` returns `'awaiting_merge'`.
- Call `evaluateCandidate({ issueNumber: 999, repoInfo })`.
- Assert: `resetWorktree` was invoked with the tmpDir worktree path and `'feature/issue-999-fixture'`; `deriveStageFromRemote` was invoked with `999`, `'fixture-adwid'`, `repoInfo`; the returned decision is `{ kind: 'take_over_adwId', adwId: 'fixture-adwid', derivedStage: 'awaiting_merge' }`; the lock was NOT released (caller keeps it for the spawn).

### 10. Run validation commands

Run the full set of validation commands from the `## Validation Commands` section. Fix any lint, type, or test failures surfaced. Zero regressions in the existing `spawnGate.test.ts`, `cronIssueFilter.test.ts`, `cronStageResolver.test.ts`, and `webhookHandlers.test.ts` suites is required.

## Testing Strategy

### Unit Tests

Unit tests live in `adws/triggers/__tests__/takeoverHandler.test.ts` using vitest + the injected-deps pattern established by `spawnGate.test.ts` and `webhookHandlers.test.ts`. Every branch of the decision tree has at least one test; every test asserts both the returned `CandidateDecision` and the set of dep calls (order and arguments) that the branch is expected to make. The test file does no real file-system or network I/O — all boundaries are mocked via `vi.fn()` passed in through `TakeoverDeps`.

In addition, `spawnGate.test.ts` gains two tests for the new `readSpawnLockRecord` helper covering the happy path and the missing-file path.

### Edge Cases

- **Lock race between two evaluateCandidate calls in the same process.** First call acquires, second call sees the lock held and returns `defer_live_holder`. Covered by a concurrency-style test with two back-to-back calls using the same mocked spawnGate.
- **State file with `workflowStage: 'abandoned'` but no `branchName` field.** Handler proceeds to `remoteReconcile` and returns `take_over_adwId`, skipping `resetWorktree` (no branch to reset). This case exists because older state files written before issue #461 do not carry `branchName`.
- **State file with `*_running` stage but no `pid` field.** Treat as dead PID (cannot confirm liveness). Fall through to worktreeReset + remoteReconcile + `take_over_adwId`.
- **`process.kill(pid, 'SIGKILL')` raises ESRCH** because the process died between `isProcessLive` and the kill. Caught and swallowed; handler proceeds to worktreeReset. Test asserts that a post-kill `isProcessLive`-style doublecheck is not re-run (we've committed to takeover).
- **Multiple adwIds in comments history.** `extractLatestAdwId` already returns the newest; this slice does not change that. Older adwIds with `completed` state are ignored because only the newest adwId is read.
- **`paused` state with a live PID.** PRD says the takeover handler is a no-op for paused; the handler returns its paused-skip decision regardless of PID liveness. Test covers: paused + live PID → skip, not take_over.
- **`completed` state with a live PID.** Terminal stage wins over liveness. Returns `skip_terminal`. (This guards against the pathological case where state is `completed` but an orchestrator is still running — we trust the state file because `completed` is written only at the end of the workflow.)
- **`deriveStageFromRemote` throws** (e.g. GitHub API outage). Test covers: handler surfaces the error to the caller rather than returning a bogus decision. No silent fall-back to `spawn_fresh` in this case — the caller retries next cron cycle.
- **`resetWorktreeToRemote` throws** (e.g. the worktree directory no longer exists on disk). Test covers: handler surfaces the error. Do not silently skip reset — a failed reset means we cannot safely take over.

## Acceptance Criteria

- `adws/triggers/takeoverHandler.ts` exports `evaluateCandidate({ issueNumber, repoInfo })` with `TakeoverDeps` injected (default via `buildDefaultTakeoverDeps()`).
- The `CandidateDecision` discriminated union covers `spawn_fresh`, `take_over_adwId`, `defer_live_holder`, `skip_terminal`, and the `paused`-no-op is encoded under one of these kinds.
- Decision tree implements all five branches from the PRD exactly as specified:
  - no state file → `spawn_fresh`
  - `completed` / `discarded` → `skip_terminal`
  - `abandoned` → `take_over_adwId` (worktreeReset → remoteReconcile → resume)
  - `*_running` with live PID not holding lock → SIGKILL → `take_over_adwId`
  - `*_running` with dead PID → `take_over_adwId`
- `paused` stage is a no-op (pause queue scanner remains sole resumer).
- Cron trigger routes every standard (non-merge) candidate through `evaluateCandidate` via `classifyAndSpawnWorkflow`.
- Webhook handler routes every candidate through `evaluateCandidate` via `classifyAndSpawnWorkflow` (both `issues.opened` and `issue_comment` paths).
- Unit tests cover every decision-tree branch with injected doubles for `spawnGate`, `agentState`, `processLiveness`, `remoteReconcile`, `worktreeReset`.
- Integration test exercises a simulated takeover end-to-end against a fixture `abandoned` state, asserting the `worktreeReset` → `remoteReconcile` → `take_over_adwId` sequence.
- No regressions: existing `spawnGate.test.ts`, `cronIssueFilter.test.ts`, `cronStageResolver.test.ts`, `webhookHandlers.test.ts`, and `adwMerge.test.ts` suites pass unchanged (except the mock adjustment called out in step 8).
- All validation commands below pass with zero errors.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — run linter to check for code quality issues.
- `bunx tsc --noEmit` — type-check the full project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type-check scoped to the `adws/` tree.
- `bun run test:unit` — run the full unit-test suite (vitest). Expect the new `takeoverHandler.test.ts` and `takeoverHandler.integration.test.ts` to pass, and existing triggers / core / vcs tests to pass unchanged.
- `bun run build` — build the application to verify no build errors.
- Targeted vitest run: `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/takeoverHandler.integration.test.ts adws/triggers/__tests__/spawnGate.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/cronStageResolver.test.ts` — focused run covering every file affected by this slice.

## Notes

- No new libraries are required. All dependencies are already in the project.
- The PRD explicitly scopes the `hungOrchestratorDetector` (which consumes `lastSeenAt` for live-but-wedged detection) to a separate slice. This slice does NOT read `lastSeenAt`; it reads only `pid` + `pidStartedAt` for the dead-vs-live decision. That is correct per the PRD: a wedged-but-live orchestrator is invisible to `evaluateCandidate` and will be surfaced by the hung-detector slice, which then writes `abandoned` and lets the next cron cycle re-enter `evaluateCandidate` via the normal abandoned path.
- `classifyAndSpawnWorkflow`'s `existingAdwId` parameter (used by the cron resume path) remains in place. On the `take_over_adwId` branch, the resolved adwId is passed through as `existingAdwId` to the spawn step, so the child orchestrator re-enters with the same identity and `acquireOrchestratorLock` re-acquires the same lock file path the parent `evaluateCandidate` already holds.
- `adwPrReview.tsx` is explicitly out of scope per the PRD: it is keyed by PR number, has no top-level state, and does not pass through `classifyAndSpawnWorkflow`. Its direct `spawnDetached` sites in `trigger_webhook.ts` (lines 110, 123) and `trigger_cron.ts` (line 169) are intentionally not routed through `evaluateCandidate`.
- The `awaiting_merge` cron path at `trigger_cron.ts:122` dispatches to `adwMerge.tsx` directly and bypasses `classifyAndSpawnWorkflow`. This is intentional: `adwMerge` has its own coordination story tracked in other issues. `evaluateCandidate` therefore also does not need to return a `dispatch_merge` decision — the cron filter already classifies and routes merge candidates before reaching the standard spawn path.
- The test runner is vitest (not bun test), consistent with the existing `spawnGate.test.ts`, `cronStageResolver.test.ts`, `webhookHandlers.test.ts`, etc. All new tests must use vitest primitives (`describe`, `it`, `expect`, `vi.fn()`, `vi.mock()`).
- Per `.adw/project.md`, unit tests are enabled for this project. The integration test sits alongside unit tests in `adws/triggers/__tests__/` and is run by the same `bun run test:unit` command.
- This slice is labeled **HITL** in the issue. The PR review must validate that every branch of the decision tree matches the PRD specification, that the cron and webhook call sites correctly route through `evaluateCandidate`, and that the lock-handoff between `evaluateCandidate` (trigger process) and `acquireOrchestratorLock` (child orchestrator) is race-safe. Reviewer should walk the five decision-tree branches against the live call sites in `trigger_cron.ts`, `trigger_webhook.ts`, and `webhookGatekeeper.ts`.
