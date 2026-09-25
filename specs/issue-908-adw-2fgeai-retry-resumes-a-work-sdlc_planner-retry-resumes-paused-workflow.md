# Feature: `## Retry` resumes a workflow stranded in the `paused` stage

## Metadata
issueNumber: `908`
adwId: `2fgeai-retry-resumes-a-work`
issueJson: `{"number":908,"title":"## Retry resumes a workflow stranded in the paused stage","body":"## Parent PRD\n\n`specs/prd/rate-limit-indefinite-retry.md`\n\n## What to build\n\nGive the operator a GitHub directive that revives a workflow stranded in the `paused` stage. See PRD section \"Directive\".\n\nToday `## Retry` acts only on `merge_blocked`; a `paused` workflow whose pause-queue entry has been evicted is classified terminal, skipped by takeover, ineligible for cron, and unreachable from GitHub (this is exactly what happened to #840 on 2026-09-22 and to #871/#872/#874–#877 on 2026-09-24).\n\nExtend the retry handler so that `## Retry` on an issue whose top-level state is `paused`:\n\n1. removes any pause-queue entry for that adwId (so the scanner cannot spawn a second orchestrator later),\n2. respawns the orchestrator resolved from top-level state via `resolveResumeSpawn`, passing the cron's own `--target-repo`,\n3. posts the existing \"resumed\" stage comment.\n\n`merge_blocked` behaviour is unchanged. `paused_auth` stays a no-op (the auth queue scanner owns it). Every running stage stays a no-op, so a human cannot duplicate an orchestrator that is alive and sleeping in-process.\n\n## Acceptance criteria\n\n- [ ] `## Retry` on a `paused` issue with a live queue entry removes the entry and spawns the orchestrator once\n- [ ] `## Retry` on a `paused` issue with no queue entry spawns the orchestrator once\n- [ ] The spawned script and args come from `resolveResumeSpawn`; `--target-repo` matches the handling cron's repo\n- [ ] `## Retry` on `paused_auth` does nothing and logs why\n- [ ] `## Retry` on any `*_running`, `starting`, or `resuming` stage does nothing\n- [ ] `## Retry` on `merge_blocked` behaves exactly as before (existing tests unchanged and green)\n- [ ] The scanner's eviction comment is NOT touched here (that text moves in the decider slice); this slice only makes the directive work\n- [ ] `bun run test`, `bun run test:unit`, and `bun run lint:git-guard` pass\n\n## Blocked by\n\nNone - can start immediately\n\n## Touched Files\n\n- adws/triggers/retryHandler.ts\n- adws/triggers/__tests__/retryHandler.test.ts\n\n## User stories addressed\n\n- User story 13\n- User story 14\n- User story 15\n- User story 16\n- User story 17\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-09-25T08:25:22Z","comments":[],"actionableComment":null}`

## Feature Description

`## Retry` is the operator's GitHub directive for reviving a workflow that automation has given up on. Today `handleRetryDirective` (`adws/triggers/retryHandler.ts`) recognises three human-gated stages and performs a state-only reset for each: `merge_blocked → awaiting_merge`, `human_gated → phase_timeout`, `review_failed → phase_timeout`. Every other stage is a silent no-op.

A workflow that hit a rate limit is parked in the `paused` stage with an entry in `agents/paused_queue.json`. The pause-queue scanner is the only thing that resumes it. When the scanner evicts the entry (three "unknown" probes), the workflow is stranded: `paused` is a `terminal`-class stage, so the takeover handler returns `skip_terminal`, the cron filter reports `paused` as ineligible, and `## Retry` ignores it. Recovery today means hand-editing the queue file on the cron host or a full `## Cancel`. This is what happened to #840 on 2026-09-22 and to #871/#872/#874–#877 on 2026-09-24.

This feature teaches the retry handler a fourth path. `## Retry` on an issue whose top-level state is `paused`:

1. removes any pause-queue entry for that adwId (before spawning, so the scanner cannot resume it a second time later),
2. respawns the orchestrator that owns the adwId, resolved via `resolveResumeSpawn(state)`, appending the handling process's own `--target-repo` args,
3. posts the existing `resumed` stage comment (`formatResumedComment`).

`merge_blocked`, `human_gated`, and `review_failed` behave exactly as before. `paused_auth` stays a no-op with a log line explaining that the auth queue scanner owns it. Every active stage (`starting`, `resuming`, any `*_running`) stays a no-op so a human cannot duplicate an orchestrator that is alive, including one that is sleeping in-process once #912 lands. The scanner's eviction comment text is untouched here (it moves in the decider slice, #910).

The handler is the shell over injected I/O seams (`RetryHandlerDeps`); the stage-to-action mapping becomes a small pure decision (`decideRetryAction`) so every branch of the directive has a table test.

## User Story

As an ADW operator
I want `## Retry` on an issue whose workflow is stranded in `paused` to drop any stale pause-queue entry and respawn the orchestrator immediately, while remaining a no-op for `paused_auth`, for every running stage, and unchanged for `merge_blocked`
So that I can revive a rate-limit-stranded workflow from GitHub without shell access to the cron host and without any risk of creating a duplicate orchestrator

## Problem Statement

`paused` is the one recoverable stage with no human recovery path. The stage classifier puts it in the `terminal` class, the cron filter excludes it (`reason: 'paused'`), `evaluateCandidate` returns `skip_terminal`, and the retry handler's fallthrough logs "not human-gated ... ignoring". The design assumption was that the pause-queue scanner is the sole resumer, but the scanner can evict an entry (a misclassified probe, a stale worktree path, a diverged claim) and once it has, nothing in the system will ever touch that adwId again. Meanwhile the stranded workflow keeps counting against `MAX_CONCURRENT_PER_REPO` and starves the issues behind it.

The retry handler also cannot spawn anything today: its deps expose only `readTopLevelState` and `writeTopLevelState`, and neither call site (`trigger_cron.ts:353`, `trigger_webhook.ts:217`) passes it the launch boundary or the process's `--target-repo` args that every other spawn path (`classifyAndSpawnWorkflow`, the cron takeover branch, `scanAuthQueue`, `resumeWorkflow`) receives.

## Solution Statement

Keep `handleRetryDirective` as a thin shell and give it the seams the paused path needs, following the `scanAuthQueue` / takeover-branch pattern already in `adws/triggers/`:

1. **Pure decision.** Add `decideRetryAction(stage)` to `retryHandler.ts`, a total function from the persisted `workflowStage` string to a discriminated union: `reset_merge_blocked`, `rearm_phase_timeout` (from `human_gated` or `review_failed`), `resume_paused`, or `noop` with a reason (`no_state`, `paused_auth`, `active`, `not_retriable`). `active` is derived from `classifyStageString(stage) === 'active'`, which is exactly `starting`, `resuming`, and every literal or dynamic `*_running` stage.
2. **Widened deps.** Extend `RetryHandlerDeps` with `findPauseQueueEntry`, `removeFromPauseQueue`, `acquireIssueSpawnLock`, `releaseIssueSpawnLock`, `spawnDetached`, `postStageComment`, and the caller's `targetRepoArgs`. Replace the parameterless `defaultDeps()` with an exported `buildRetryHandlerDeps(boundary, targetRepoArgs)` factory that binds the spawn lock and comment poster to the boundary's `repoId` / `providers`. `deps` becomes a required parameter; existing test cases already pass it explicitly.
3. **Resume branch.** For `resume_paused`: verify the state belongs to this issue, acquire the per-issue spawn lock (skip with a log if a live holder owns it), look up and remove the queue entry, spawn `bunx tsx <script> <issueNumber> <adwId> ...targetRepoArgs` where `{ script, args }` come from `resolveResumeSpawn(state)`, release the lock so the child can take its lifetime lock, then post the `resumed` comment. No top-level state is written on this path; the child orchestrator rewrites its stage at init exactly as it does after a scanner resume.
4. **Explicit no-ops.** `paused_auth` and `active` get their own log lines naming the reason, satisfying "does nothing and logs why".
5. **Call sites.** `trigger_cron.ts` passes `buildRetryHandlerDeps(boundary, targetRepoArgs)` (hoisting its existing `targetRepoArgs` above the directive loop); `trigger_webhook.ts` passes `buildRetryHandlerDeps(commentBoundary, webhookTargetRepoArgs)`.
6. **Tests and docs.** Table tests for the decider, seam tests for the resume branch (spawn once, args from `resolveResumeSpawn`, `--target-repo` appended, lock ordering, removal before spawn, comment after spawn, failure paths), explicit no-op tests for `paused_auth` and active stages, and the existing `merge_blocked` / `human_gated` / `review_failed` cases untouched. Correct the four doc sentences that currently say `paused` has no `## Retry` path.

## Relevant Files

Use these files to implement the feature:

- `adws/triggers/retryHandler.ts` — the handler to extend. Gains `decideRetryAction`, the widened `RetryHandlerDeps`, `buildRetryHandlerDeps`, and the `resumePausedWorkflow` helper. Must stay under 300 lines with nesting depth ≤ 2 (guard clauses, named helpers).
- `adws/triggers/__tests__/retryHandler.test.ts` — existing vitest suite (11 cases). Its `makeDeps` fixture gains the new seams as `vi.fn()` stubs; the existing `it(...)` blocks stay byte-for-byte. New describe blocks cover the decider, the paused resume path, `paused_auth`, and active stages.
- `adws/triggers/trigger_cron.ts` — call site at line ~353 inside `checkAndTrigger`. `boundary` is in scope; `targetRepoArgs` (`buildTargetRepoArgs()`) is declared at line ~381 and must be hoisted above the directive loop.
- `adws/triggers/trigger_webhook.ts` — call site at line ~217 inside the `issue_comment` branch of `dispatchWebhookEvent`. `commentBoundary` (non-null at that point) and `webhookTargetRepoArgs` are in scope.
- `adws/core/resolveResumeSpawn.ts` — read-only. `resolveResumeSpawn(state)` → `{ script, args: [String(issueNumber), adwId] }`, defaulting to `adws/adwSdlc.tsx`. The spawned script and positional args must come from here.
- `adws/core/pauseQueue.ts` — read-only. `readPauseQueue()`, `removeFromPauseQueue(adwId)` (idempotent; no-op when absent), `PausedWorkflow` (`pausedAtPhase` feeds the resumed comment).
- `adws/triggers/spawnGate.ts` — read-only. `acquireIssueSpawnLock(repoId, issueNumber, ownPid)` / `releaseIssueSpawnLock(repoId, issueNumber)`; the same per-issue lock the child orchestrator takes as its lifetime lock in `runWithOrchestratorLifecycle`.
- `adws/triggers/webhookGatekeeper.ts` — read-only. `spawnDetached(command, args)` resolves relative `adws/*.tsx` paths against `REPO_ROOT`, spawns detached with `cwd: REPO_ROOT`, and `unref()`s. Used by the cron takeover branch and `scanAuthQueue`; reuse it here.
- `adws/phases/phaseCommentHelpers.ts` — read-only. `postIssueStageComment(providers, issueNumber, stage, ctx)`; catches and logs its own failures.
- `adws/forge/workflowCommentsIssue.ts` — read-only. `formatResumedComment(ctx)` is reached via stage `'resumed'`; `WorkflowContext` requires only `issueNumber` and `adwId`, with optional `pausedAtPhase`.
- `adws/core/stageClassifier.ts` — read-only. `classifyStageString(stage) === 'active'` is the definition of "running" used by the decider.
- `adws/core/launchGitContext.ts` — read-only. `LaunchBoundary { gitContext, repoId, providers }`; `buildRetryHandlerDeps` reads `repoId` and `providers` only. Never construct a boundary inside the handler (guard rule `unsanctioned-construction`).
- `adws/core/agentState.ts` / `adws/types/agentTypes.ts` — read-only. `readTopLevelState` / `writeTopLevelState` (shallow merge); `AgentState.workflowStage`, `orchestratorScript`, `issueNumber`.
- `adws/triggers/pauseQueueScanner.ts` — read-only reference for the resume pattern (`resumeWorkflow`: verification lock → claim check → release → spawn → remove entry → resumed comment). Do NOT edit: its eviction comment text belongs to the decider slice (#910) and its ownership/remove-before-spawn changes belong to #911.
- `adws/triggers/scanAuthQueue.ts` and `adws/triggers/__tests__/scanAuthQueue.test.ts` — read-only precedent for a deps-injected handler that spawns via `spawnDetached` and releases the spawn lock after spawning, and for the test style (plain `vi.fn()` deps objects, no module mocks).
- `adws/triggers/cronStageResolver.ts` — read-only. `extractLatestAdwId` (already imported by the handler).
- `adws/core/workflowCommentParsing.ts` — read-only. `isRetryComment` (`/^## Retry$/mi`) is how both triggers detect the directive; unchanged.
- `specs/prd/rate-limit-indefinite-retry.md` — the parent PRD. Section "Directive" and user stories 13–17 are the contract for this slice.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — conditional doc; owns `retryHandler.test.ts`. Lines 22, 43, 49, and 62 describe `## Retry` and state that `paused` has no `## Retry` path; update.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — conditional doc; owns `retryHandler.ts`. Its `handleRetryDirective` bullet must mention the paused path and the new deps factory.
- `app_docs/feature-9gjajh-cron-triggers.md`, `app_docs/feature-9gjajh-webhook-triggers.md` — conditional docs for the two call sites (read for context; a one-line touch each where they describe the `## Retry` call).
- `app_docs/feature-9gjajh-pause-and-auth-queues.md` — conditional doc for `pauseQueue.ts` (read-only context).
- `README.md` — line 16 ("`## Retry` resets a `merge_blocked` workflow to `awaiting_merge` ...") and the tree entry at line ~816 for `retryHandler.ts`; both need the paused path added.
- `.adw/coding_guidelines.md` — guard clauses, max nesting ~2, immutability, no restating comments, files under 300 lines.

No new files are needed.

## Implementation Plan

### Phase 1: Foundation

Restructure `retryHandler.ts` so the decision and the I/O are separable before any new behaviour lands:

- Introduce `RetryAction` and the pure `decideRetryAction(stage: string | undefined): RetryAction`. It reproduces today's three resets exactly, adds `resume_paused` for `'paused'`, `noop/paused_auth` for `'paused_auth'`, `noop/active` for `classifyStageString(stage) === 'active'`, `noop/no_state` for an absent stage, and `noop/not_retriable` for everything else.
- Widen `RetryHandlerDeps` and add `buildRetryHandlerDeps(boundary, targetRepoArgs)`. Remove the parameterless `defaultDeps()`; the third parameter becomes required. Update the test file's `makeDeps` fixture so the existing cases compile (the root `tsconfig.json` type-checks `__tests__`).
- Rewrite the body of `handleRetryDirective` as: resolve adwId → read state (guard null) → `decideRetryAction` → `switch` on `action.kind`. The three existing branches keep their exact writes and log lines. Run the existing suite: 11 green, unchanged.

### Phase 2: Core Implementation

Add the `resume_paused` branch as a named helper `resumePausedWorkflow(issueNumber, adwId, state, deps): boolean`:

1. Guard: `state.issueNumber !== issueNumber` → warn (`top-level state for adwId=… belongs to issue #… not #…; ignoring`) and return `false`. This covers a null `issueNumber` and keeps `resolveResumeSpawn` (which reads `state.issueNumber`) honest.
2. `deps.acquireIssueSpawnLock(issueNumber)`; on `false` → warn (`spawn lock held for issue #… — a live orchestrator or an in-flight resume owns it; ignoring`) and return `false`. Nothing else is touched on this path (the queue entry stays so a scanner mid-resume is not disturbed).
3. `const entry = deps.findPauseQueueEntry(adwId)`; `deps.removeFromPauseQueue(adwId)` unconditionally (idempotent). Log whether an entry was evicted. Removal happens before the spawn, per PRD user story 14/21.
4. `const { script, args } = resolveResumeSpawn(state)`; in a `try`: `deps.spawnDetached('bunx', ['tsx', script, ...args, ...deps.targetRepoArgs])`; on throw → error log, return `false`; `finally`: `deps.releaseIssueSpawnLock(issueNumber)` so the child's `runWithOrchestratorLifecycle` can take the lifetime lock (the same release-after-spawn the cron takeover branch and `scanAuthQueue` do).
5. `deps.postStageComment(issueNumber, 'resumed', { issueNumber, adwId, pausedAtPhase: entry?.pausedAtPhase })`; success log; return `true`.

Add the explicit `noop` logging in the shell: `paused_auth` → `Retry #N: adwId=… is paused_auth; the auth queue scanner resumes it automatically once login is restored, ignoring`; `active` → `Retry #N: adwId=… is active (stage=…); a running orchestrator cannot be duplicated, ignoring`; `no_state` / `not_retriable` → the existing "not human-gated (stage=…), ignoring" wording.

### Phase 3: Integration

- `trigger_cron.ts`: hoist `const targetRepoArgs = buildTargetRepoArgs();` above the `## Cancel` / `## Retry` loop and call `handleRetryDirective(issue.number, issue.comments, buildRetryHandlerDeps(boundary, targetRepoArgs))`. Keep the comment explaining why there is no `cancelledThisCycle.add` (the `awaiting_merge` hoist). A respawned `paused` workflow is still `paused` on disk during this tick, so `filterEligibleIssues` keeps excluding it; on later ticks the child's `starting`/`resuming` stage is `active`, and the child's lifetime lock makes any takeover attempt `defer_live_holder`.
- `trigger_webhook.ts`: call `handleRetryDirective(issueNumber, allComments, buildRetryHandlerDeps(commentBoundary, webhookTargetRepoArgs))`. Keep the `{ status: 'retry_reset', issue }` response shape unchanged.
- Docs: correct the sentences in `README.md`, `app_docs/feature-9gjajh-takeover-and-coordination.md`, and `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` that say `## Retry` acts only on the three human-gated stages or that `paused` has no `## Retry` path. `.adw/conditional_docs.md` needs no change (no new files).

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Add the pure retry decision to `adws/triggers/retryHandler.ts`

- Define `export type RetryAction = { kind: 'reset_merge_blocked' } | { kind: 'rearm_phase_timeout'; from: 'human_gated' | 'review_failed' } | { kind: 'resume_paused' } | { kind: 'noop'; reason: 'no_state' | 'paused_auth' | 'active' | 'not_retriable' }` with `readonly` fields.
- Define `export function decideRetryAction(stage: string | undefined): RetryAction` as a flat sequence of guard clauses: `undefined`/`''` → `no_state`; `'merge_blocked'` → reset; `'human_gated'` / `'review_failed'` → rearm with `from`; `'paused'` → resume; `'paused_auth'` → noop `paused_auth`; `classifyStageString(stage) === 'active'` → noop `active`; otherwise noop `not_retriable`. No I/O, no logging.
- Import `classifyStageString` from `../core/stageClassifier`.
- Update the file's header comment to list four recovery paths (the three resets plus `paused → respawn`) and the no-op rules for `paused_auth` and active stages. Do not cite issue numbers in comments.

### 2. Widen `RetryHandlerDeps` and add `buildRetryHandlerDeps`

- Extend the interface:
  - `findPauseQueueEntry: (adwId: string) => PausedWorkflow | null`
  - `removeFromPauseQueue: (adwId: string) => void`
  - `acquireIssueSpawnLock: (issueNumber: number) => boolean` (bound to the handling process's `repoId` and `process.pid` inside the factory)
  - `releaseIssueSpawnLock: (issueNumber: number) => void`
  - `spawnDetached: (command: string, args: string[]) => void`
  - `postStageComment: (issueNumber: number, stage: WorkflowStage, ctx: WorkflowContext) => void`
  - `targetRepoArgs: readonly string[]`
- Delete `defaultDeps()`. Add `export function buildRetryHandlerDeps(boundary: LaunchBoundary, targetRepoArgs: readonly string[]): RetryHandlerDeps` wiring: `AgentStateManager.readTopLevelState` / `writeTopLevelState`; `findPauseQueueEntry: (id) => readPauseQueue().find(e => e.adwId === id) ?? null`; `removeFromPauseQueue`; `acquireIssueSpawnLock: (n) => acquireIssueSpawnLock(boundary.repoId, n, process.pid)`; `releaseIssueSpawnLock: (n) => releaseIssueSpawnLock(boundary.repoId, n)`; `spawnDetached` from `./webhookGatekeeper`; `postStageComment: (n, stage, ctx) => postIssueStageComment(boundary.providers, n, stage, ctx)`; `targetRepoArgs`.
- Change the signature to `handleRetryDirective(issueNumber: number, comments: readonly { body: string }[], deps: RetryHandlerDeps): boolean` (third parameter required).
- Imports: `readPauseQueue`, `removeFromPauseQueue`, `type PausedWorkflow` from `../core/pauseQueue`; `acquireIssueSpawnLock`, `releaseIssueSpawnLock` from `./spawnGate`; `spawnDetached` from `./webhookGatekeeper`; `postIssueStageComment` from `../phases/phaseCommentHelpers`; `resolveResumeSpawn` from `../core/resolveResumeSpawn`; `type LaunchBoundary` from `../core`; `type WorkflowStage` from `../types/workflowTypes`; `type WorkflowContext` from `../forge/workflowCommentsIssue`.

### 3. Restructure the shell around the decision (behaviour-preserving)

- Body: `extractLatestAdwId` guard (unchanged log) → `const state = deps.readTopLevelState(adwId)`; if `null` → log the existing "not human-gated (stage=none), ignoring" line and return `false` → `const action = decideRetryAction(state.workflowStage)` → `switch (action.kind)`.
- `reset_merge_blocked` and `rearm_phase_timeout` keep their exact `writeTopLevelState` payloads and log strings from today (`merge_blocked → awaiting_merge, cleared retry counter`; `human_gated → phase_timeout, cleared resume counter`; `review_failed → phase_timeout, cleared resume counter`).
- Run `bunx vitest run adws/triggers/__tests__/retryHandler.test.ts` after updating the `makeDeps` fixture (step 5a) — all 11 existing cases must be green before step 4.

### 4. Implement the `resume_paused` branch and the explicit no-ops

- Add `function resumePausedWorkflow(issueNumber: number, adwId: string, state: AgentState, deps: RetryHandlerDeps): boolean` implementing Phase 2 steps 1–5 verbatim (issue-mismatch guard → lock → find + remove entry → `resolveResumeSpawn` → `spawnDetached('bunx', ['tsx', script, ...args, ...deps.targetRepoArgs])` in try/finally releasing the lock → `postStageComment(issueNumber, 'resumed', { issueNumber, adwId, pausedAtPhase: entry?.pausedAtPhase })` → return `true`).
- Keep the helper flat: one guard per line, the `try`/`catch`/`finally` around the spawn is the only nested block.
- Wire the `switch`: `resume_paused` → `return resumePausedWorkflow(...)`; `noop` → a small `logRetryNoop(issueNumber, adwId, stage, reason)` helper that emits the `paused_auth` and `active` messages from Phase 2 and the existing wording for the other reasons; return `false`.
- Never write top-level state on the paused path; never touch `pauseQueueScanner.ts`.

### 5. Update `adws/triggers/__tests__/retryHandler.test.ts`

- **5a. Fixture only.** Extend `makeDeps(state)` to return the widened deps: `findPauseQueueEntry: vi.fn().mockReturnValue(null)`, `removeFromPauseQueue: vi.fn()`, `acquireIssueSpawnLock: vi.fn().mockReturnValue(true)`, `releaseIssueSpawnLock: vi.fn()`, `spawnDetached: vi.fn()`, `postStageComment: vi.fn()`, `targetRepoArgs: ['--target-repo', 'acme/widgets']`. Accept an optional `overrides: Partial<RetryHandlerDeps>`. Leave every existing `it(...)` block untouched.
- **5b. Decider table** (`describe('decideRetryAction')`): `merge_blocked` → reset; `human_gated` / `review_failed` → rearm with the matching `from`; `paused` → resume; `paused_auth` → noop `paused_auth`; `starting`, `resuming`, `build_running`, `plan_running`, `step-def_running` → noop `active`; `completed`, `abandoned`, `awaiting_merge`, `phase_timeout`, `review_passed`, `build_completed` → noop `not_retriable`; `undefined` → noop `no_state`.
- **5c. Paused with a live queue entry:** state `{ workflowStage: 'paused', orchestratorScript: 'adws/adwChore.tsx', issueNumber: 42 }`, `findPauseQueueEntry` returns an entry with `pausedAtPhase: 'build'`. Assert: returns `true`; `removeFromPauseQueue` called once with `'test-adw-id'`; `spawnDetached` called exactly once with `('bunx', ['tsx', 'adws/adwChore.tsx', '42', 'test-adw-id', '--target-repo', 'acme/widgets'])`; `postStageComment` called once with `(42, 'resumed', expect.objectContaining({ adwId: 'test-adw-id', issueNumber: 42, pausedAtPhase: 'build' }))`; `writeTopLevelState` not called.
- **5d. Paused with no queue entry:** same, `findPauseQueueEntry` → `null`. Assert one spawn, `removeFromPauseQueue` still called once (idempotent), comment posted without `pausedAtPhase`, returns `true`.
- **5e. Script and args come from `resolveResumeSpawn`:** state without `orchestratorScript` spawns `DEFAULT_RESUME_SCRIPT` (`adws/adwSdlc.tsx`); a PR-review state spawns `adws/adwPrReview.tsx`; positional args are exactly `[String(issueNumber), adwId]` and precede the flags; with `targetRepoArgs: []` (webhook self-host) the args end after the adwId; with `['--target-repo', 'acme/widgets', '--clone-url', 'https://…']` all four flags are appended in order.
- **5f. Lock semantics:** `acquireIssueSpawnLock` → `false`: no `removeFromPauseQueue`, no `spawnDetached`, no `postStageComment`, no `releaseIssueSpawnLock`, returns `false`. Happy path: `acquireIssueSpawnLock` invoked before `removeFromPauseQueue`, `removeFromPauseQueue` before `spawnDetached`, `spawnDetached` before `releaseIssueSpawnLock`, `releaseIssueSpawnLock` before `postStageComment` (compare `mock.invocationCallOrder`).
- **5g. Spawn throws:** `spawnDetached` throws → `releaseIssueSpawnLock` still called, `postStageComment` not called, returns `false`.
- **5h. Issue mismatch:** state `issueNumber: 99` with directive issue 42 → no lock, no spawn, returns `false`; state `issueNumber: null` → same.
- **5i. `paused_auth`:** mock `../../core/logger` (`vi.mock('../../core/logger', () => ({ log: vi.fn() }))`) at the top of the file; assert returns `false`, no write / remove / spawn / comment, and `log` was called with a message matching `/paused_auth/` and `/auth queue/`.
- **5j. Active stages:** for `starting`, `resuming`, `build_running`, `plan_running` (dynamic phaseRunner string): returns `false`, nothing called on any seam, `log` message matches `/running orchestrator cannot be duplicated/`.
- **5k. `merge_blocked` regression pin:** one additional case asserting that on `merge_blocked` none of the new seams (`findPauseQueueEntry`, `removeFromPauseQueue`, `acquireIssueSpawnLock`, `spawnDetached`, `postStageComment`) is called.

### 6. Wire the cron call site in `adws/triggers/trigger_cron.ts`

- Import `buildRetryHandlerDeps` alongside `handleRetryDirective`.
- Move `const targetRepoArgs = buildTargetRepoArgs();` from below `filterEligibleIssues` to just above the `for (const issue of issues)` directive loop; delete the later duplicate declaration so the rest of `checkAndTrigger` reuses the hoisted value.
- Replace `handleRetryDirective(issue.number, issue.comments)` with `handleRetryDirective(issue.number, issue.comments, buildRetryHandlerDeps(boundary, targetRepoArgs))`. Keep the existing comment about `cancelledThisCycle`.

### 7. Wire the webhook call site in `adws/triggers/trigger_webhook.ts`

- Import `buildRetryHandlerDeps`.
- Replace `handleRetryDirective(issueNumber, allComments)` with `handleRetryDirective(issueNumber, allComments, buildRetryHandlerDeps(commentBoundary, webhookTargetRepoArgs))`. The JSON response stays `{ status: 'retry_reset', issue: issueNumber }`.

### 8. Update the docs that now state the opposite

- `README.md` line 16: extend the "Retry and Cancel directives" bullet: `## Retry` also respawns a `paused` workflow (drops its pause-queue entry first, spawns via `resolveResumeSpawn` with the handling process's `--target-repo`, posts the resumed comment); no-op for `paused_auth` and running stages. Line ~816 tree comment for `retryHandler.ts`: add "; respawns `paused` workflows".
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: line 22 (list the fourth path and `buildRetryHandlerDeps`), line 43 (`paused` is resumable by the scanner **or** by `## Retry`; `paused_auth` stays scanner-only), line 49 (add the paused action; note no state write), line 62 (remove "with no `## Retry` path"). Add one Gotcha: the retry handler removes the queue entry before spawning and never rewrites `workflowStage`; the child's lifetime lock is the guard against a duplicate.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: extend the `handleRetryDirective` bullet with the paused path and the new required `deps` built by `buildRetryHandlerDeps(boundary, targetRepoArgs)`.
- `app_docs/feature-9gjajh-cron-triggers.md` line 29 and `app_docs/feature-9gjajh-webhook-triggers.md` line 22: one-line touches noting `## Retry` also respawns `paused`.
- Do not touch `.adw/conditional_docs.md` (no new files) and do not touch the scanner's eviction comment or `adws/known_issues.md`.

### 9. Run the validation commands

- Run every command in `Validation Commands`; all must exit 0 with no new warnings. Fix anything that fails before reporting completion.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`; the framework is vitest (`bun run test:unit`). All tests live in the existing `adws/triggers/__tests__/retryHandler.test.ts` and drive the handler through injected `RetryHandlerDeps` (no module mocks other than the logger), matching the `scanAuthQueue.test.ts` style.

- **Decider table:** every `WorkflowStage` family maps to the expected `RetryAction` (see step 5b), including dynamic `*_running` strings the classifier handles via `endsWith`.
- **Paused resume, entry present / absent:** exactly one spawn; entry removal before spawn; comment after spawn; no state write.
- **Spawn descriptor:** script and positional args equal `resolveResumeSpawn(state)`'s output for SDLC-default, chore, and PR-review states; `targetRepoArgs` appended verbatim after the positional args, including the empty (webhook self-host) case.
- **Lock discipline:** held lock → full no-op; happy path ordering acquire → remove → spawn → release → comment; release runs even when the spawn throws.
- **Guards:** issue mismatch / null issue number → no-op before the lock.
- **No-ops with reasons:** `paused_auth` and every active stage touch no seam and log why.
- **Regression pins:** the 11 existing cases unchanged; `merge_blocked` additionally proven not to touch any new seam.

### BDD seams (for the scenario and step-definition phases)

The per-issue scenarios (`features/per-issue/feature-908.feature`, tag `@adw-908`) can observe this slice without reading source:

- Seed a top-level state file via `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'paused', issueNumber, orchestratorScript: <absolute fixture script> })`; `spawnDetached` passes absolute script paths through untouched, so a fixture script that records its `argv` and stays alive (the feature-902 §3 pattern) observes the launch. Kill it in an `After` hook.
- Seed `agents/paused_queue.json` with the registered phrase G20 (`a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}`) and assert removal by reading `readPauseQueue()`; save and restore any pre-existing queue file.
- Drive the directive with `handleRetryDirective(issueNumber, [{ body: '**ADW ID:** \`<adwId>\`' }, { body: '## Retry' }], buildRetryHandlerDeps(boundary, ['--target-repo', 'acme/widgets']))` using a boundary built for the fictional `acme/widgets` repo; route the resumed comment to the mock GitHub API / `gh` shadow as feature-902-queue.steps.ts does (G1, T2, T3, T14).
- Assert the fixture's invocation log holds exactly one launch whose args end with `--target-repo acme/widgets`; re-post `## Retry` while the fixture holds the spawn lock (acquire it in the step with the fixture's pid) and assert no second launch.

### Edge Cases

- `paused` with a live queue entry → entry removed before the spawn; one spawn; resumed comment carries `pausedAtPhase`.
- `paused` with no queue entry (already evicted) → one spawn; removal call is a harmless no-op.
- `paused` while the per-issue spawn lock is held by a live process (a scanner mid-resume, or an orchestrator that already restarted) → nothing happens, queue untouched, returns `false`.
- `paused` and `spawnDetached` throws → lock released, no comment, returns `false`; the queue entry is already gone, so the operator re-posts `## Retry` (logged at `error`).
- `paused` and the top-level state names a different issue, or a null issue → no-op before any lock or removal.
- `paused` and `orchestratorScript` absent (pre-resolver state) → spawns `adws/adwSdlc.tsx` (the `resolveResumeSpawn` default).
- `paused_auth` → no-op; log names the auth queue scanner as the owner.
- `starting`, `resuming`, `build_running`, `plan_running`, `step-def_running`, `install_running` → no-op; log says a running orchestrator cannot be duplicated (covers the future in-process sleeping orchestrator of #912, whose stage stays `*_running`).
- `merge_blocked`, `human_gated`, `review_failed` → identical writes and logs to today; no new seam touched.
- `completed`, `abandoned`, `awaiting_merge`, `phase_timeout`, `review_passed`, `discarded`, missing state, missing adw-id, empty comments → unchanged no-ops.
- `targetRepoArgs` empty (webhook event with no named repository) → spawn args end after the adwId; the orchestrator resolves self-host, consistent with every other webhook spawn.
- Same `## Retry` seen by both the webhook and the next cron tick → the second call finds the child's lifetime lock (or the handler's own lock) held and no-ops; if it lands in the brief release-to-child-acquire gap, the losing duplicate exits at `runWithOrchestratorLifecycle` (the system-wide accepted gap, identical to `resumeWorkflow` and `scanAuthQueue`).

## Acceptance Criteria

- `## Retry` on a `paused` issue with a live queue entry removes the entry (before the spawn) and spawns the orchestrator exactly once.
- `## Retry` on a `paused` issue with no queue entry spawns the orchestrator exactly once.
- The spawned script and positional args are exactly `resolveResumeSpawn(state)`'s `{ script, args }`, and the handling process's own `--target-repo` args (cron: `buildTargetRepoArgs()`; webhook: `webhookTargetRepoArgs`) follow them verbatim.
- The existing `resumed` stage comment (`formatResumedComment`) is posted after a successful spawn; no top-level state is written on the paused path.
- `## Retry` on `paused_auth` performs no I/O and logs that the auth queue scanner owns recovery.
- `## Retry` on `starting`, `resuming`, or any `*_running` stage performs no I/O and logs why.
- `## Retry` on `merge_blocked`, `human_gated`, and `review_failed` behaves exactly as before; the 11 existing test cases are unchanged and green (only the `makeDeps` fixture is extended).
- A held per-issue spawn lock makes the paused path a no-op; the lock is released after the spawn even when the spawn throws.
- `pauseQueueScanner.ts` and its eviction comment text are untouched.
- `decideRetryAction` is pure and covered by a table test; `retryHandler.ts` stays under 300 lines with nesting depth ≤ 2.
- `bun run test`, `bun run test:unit`, `bun run lint`, `bun run lint:git-guard`, and `bunx tsc --noEmit -p adws/tsconfig.json` pass.
- README and the two owning app docs no longer claim that `paused` has no `## Retry` path.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/triggers/__tests__/retryHandler.test.ts` — the handler suite: 11 existing cases plus the new decider, paused-resume, lock, no-op, and regression-pin cases all green.
- `bun run test:unit` — full vitest run (`.adw/commands.md` "Run Tests"); confirms the widened deps broke no other suite (e.g. `trigger_cron.test.ts`, `webhookHandlers.test.ts`).
- `bun run test` — `bunx tsc --noEmit` over the whole repo, including `__tests__` (required by the issue).
- `bunx tsc --noEmit -p adws/tsconfig.json` — the auxiliary type check from `.adw/commands.md`.
- `bun run lint` — eslint over the repo; zero errors or warnings.
- `bun run lint:git-guard` — the git/gh shell-out, cwd-derived-identity, and unsanctioned-construction guard (required by the issue; the handler must receive its boundary, never build one).
- `bun run lint:docs-index` — the living-docs index gate; must stay green since no files were added or removed.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-908"` — the per-issue scenarios once the scenario phase has written `features/per-issue/feature-908.feature` (reports 0 scenarios and exits 0 if the file does not exist yet).

## Notes

- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.
- **Scope note on touched files.** The issue lists only `retryHandler.ts` and its test, but the handler cannot spawn without the launch boundary and the process's `--target-repo` args, so the two call sites (`trigger_cron.ts` line ~353, `trigger_webhook.ts` line ~217) each change by one call plus, in the cron, hoisting the existing `targetRepoArgs` declaration. No other production file changes; `pauseQueueScanner.ts` is explicitly off-limits (owned by sibling slices #910 and #911).
- **Why the third parameter becomes required.** The old `defaultDeps()` could be parameterless because it only touched state files. The paused path needs a `repoId` for the spawn lock and `providers` for the comment, and a cwd-derived fallback would reintroduce the wrong-repo bug class the guard forbids. Existing test cases already pass `deps` explicitly, so only the `makeDeps` fixture changes.
- **Why no top-level state write on the paused path.** Writing `resuming` (active class) would make a failed spawn look like a live orchestrator until the grace period elapses; writing `abandoned` (retriable) would let the very next cron tick take the adwId over while the child is still booting. The scanner's `resumeWorkflow` writes nothing either; the child rewrites its stage at init, and idempotency comes from the spawn lock plus the resumed comment becoming the latest comment (so the cron stops seeing `## Retry` as latest).
- **Accepted spawn gap.** The lock is released right after `spawnDetached` returns so the child can acquire it as its lifetime lock. A concurrent directive landing in that gap spawns a duplicate whose `runWithOrchestratorLifecycle` fails to acquire the lock and exits. This is the same window `resumeWorkflow`, `scanAuthQueue`, and the cron takeover branch accept today; do not "fix" it here.
- **`spawnDetached` versus the scanner's readiness-window spawn.** The scanner keeps the queue entry until the child survives two seconds so the next probe can retry automatically. The retry path is a human-driven one-shot: the entry is removed first (PRD user story 14), and a child that dies at startup shows up as an issue with no progress comment, which the operator answers with another `## Retry`. The stale spawn lock is reclaimed by PID liveness.
- **Empty queue file side effect.** `removeFromPauseQueue` on a missing `agents/paused_queue.json` writes `[]`; the scanner treats an empty array as "nothing to scan", so this is harmless and keeps the removal unconditional and simple.
- **Sibling slices from the same PRD:** #907 (structured rate-limit facts), #909 (envelope conformance gate), #910 (pause-queue decider and eviction comment text), #911 (per-repo ownership, remove-before-spawn in the scanner), #912 (in-process wait). This slice depends on none of them and must not pre-empt their files.
- No new library is required (`bun add` is not needed).
