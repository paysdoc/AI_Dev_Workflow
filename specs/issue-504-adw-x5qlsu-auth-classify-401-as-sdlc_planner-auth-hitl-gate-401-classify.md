# Feature: Auth HITL gate — classify 401 as auth failure, kill in-flights, Slack notify

## Metadata
issueNumber: `504`
adwId: `x5qlsu-auth-classify-401-as`
issueJson: `{"number":504,"title":"auth: classify 401 as HITL event; gate triggers, kill in-flights, Slack notify (replaces rate-limit misclassification)","state":"OPEN","author":"paysdoc","labels":["bug","enhancement"],"createdAt":"2026-05-13T13:47:11Z"}`

## Feature Description
Classify HTTP 401 / `authentication_failed` Claude CLI errors as a host-wide Human-In-The-Loop (HITL) event end to end, instead of misclassifying them as rate-limit / API outage. The May 13 2026 incident showed that CLI v2.1.132 emits `api_retry` envelopes with `error: "authentication_failed"` and `error_status: 401`; the current parser falls through to the generic server-error branch and throws `RateLimitError`. Triggers then queue the issue for pause/resume even though no orchestrator can recover without a human running `claude auth login`.

The feature introduces:
1. A parser fix that routes both legacy and new auth error strings (and any `error_status === 401`) to `authErrorDetected`.
2. A new `AuthRequiredError` thrown from `runClaudeAgentWithCommand` when the existing one-shot auth-status retry exhausts, eliminating the silent-garbage-slug failure mode in `runGenerateBranchNameAgent`.
3. A host-wide gate file `agents/.auth_gate` (atomic temp + rename) consulted by every spawn path.
4. A new `paused_auth` workflow stage and a `takeoverHandler` branch 4b that maps it to `skip_terminal`.
5. A pre-tick gate enforcement in `trigger_cron.ts` that probes `claude auth status --json`, SIGTERMs live orchestrators on `loggedIn=false`, sends Slack with a 2 h cooldown, and clears the gate + fires one-shot recovery Slack on `loggedIn=true`.
6. A new `scanAuthQueue` cron probe that re-triggers `paused_auth` orchestrators by routing them through `takeoverHandler` branch 5 (`abandoned`), preserving the original adwId.
7. A pre-spawn gate check in `trigger_webhook.ts` that returns `200 ignored` when gated.

## User Story
As an ADW operator running the cron + webhook triggers on a host whose Claude CLI OAuth token has expired,
I want the system to detect the 401, halt all in-flight and queued agent spawns, and Slack-notify me to re-authenticate,
So that no further compute is wasted on doomed retries and the originally-impacted issues automatically resume once I run `claude auth login`.

## Problem Statement
At `adws/core/claudeStreamParser.ts:197-208`, only `error === 'authentication_error'` is matched as an auth signal. CLI v2.1.132 emits `error === 'authentication_failed'` with `error_status: 401` on the same `api_retry` envelope. The parser drops into the generic branch; on `attempt >= 2` it sets `serverErrorDetected`, which `adws/agents/agentProcessHandler.ts:102-109` kills as a rate-limit. `runClaudeAgentWithCommand` then throws `RateLimitError` (`adws/agents/claudeAgent.ts:149-151`).

Downstream consequences:
- `runGenerateBranchNameAgent` (`adws/agents/gitAgent.ts:48-77`) never checks `result.success`; on `authExpired: true` it would silently call `extractSlugFromOutput('')`, produce a corrupt slug, and continue. The current 401-misroute hides this with a loud `RateLimitError`, but a parser-only fix would expose silent corruption.
- `runPhase` (`adws/core/phaseRunner.ts:174,222`) only catches `RateLimitError` and routes to `handleRateLimitPause`. The pre-phase agents called from `workflowInit.ts` (`runGenerateBranchNameAgent` at line 199 and 220) run **outside** `runPhase` entirely.
- The trigger's classifier `runClaudeAgentWithCommand` call at `adws/core/issueClassifier.ts:155` runs inside the cron tick itself — a 401 there fails the classification, the trigger falls back to label-based routing, and the orchestrator is spawned regardless. Every subsequent agent in the same tick repeats the failure.

There is no machinery for a Human-In-The-Loop event distinct from rate-limit pause (which is host-shared but per-issue queued for auto-resume via probe). Auth recovery is host-wide and requires a human.

## Solution Statement
Introduce a single host-wide auth gate (`agents/.auth_gate`) consulted by every spawn path. Detection is loud: parser routes 401 to `authErrorDetected`, agent runner throws `AuthRequiredError` after exhausting the existing retry. Every agent caller propagates the error to its outer `main()`, which writes the gate, marks the orchestrator state `paused_auth`, and exits 0. The cron tick checks the gate first; while gated it probes `claude auth status --json`, kills any live orchestrators (their stream parsers will also detect the 401 within ≤ 20 s anyway), sends Slack with a 2 h cooldown, and skips the rest of the tick. On clear, it removes the gate, sends a one-shot recovery Slack, and runs `scanAuthQueue` to walk `paused_auth` state files and re-spawn them through `takeoverHandler` branch 5 (`abandoned` → `worktreeReset` → `deriveStageFromRemote` → `take_over_adwId`). The original adwId is preserved.

Reuse:
- Atomic temp+rename mirrors `adws/core/pauseQueue.ts:55-60`.
- `scanAuthQueue` mirrors the cycle-gated scanner shape of `adws/triggers/pauseQueueScanner.ts` but routes resumes through the existing takeoverHandler decision tree rather than spawning directly, so all liveness/spawn-lock invariants are enforced by one module.
- Slack notifier is a new minimal module (`adws/core/slackNotifier.ts`) — `SLACK_WEBHOOK_URL` already flows through env (propagated to target repos in `adws/phases/depauditSetup.ts:18`), but no sender exists yet in `adws/`.

## Relevant Files
Use these files to implement the feature:

- `README.md` — Project overview.
- `.adw/coding_guidelines.md` — Coding standards (TypeScript strict, modularity, max nesting ~2, declarative over imperative, files under 300 lines).
- `.adw/project.md` — Project config. Unit tests **enabled**. Library install: `bun add <pkg>`. Script runner: `bunx tsx`.
- `.adw/commands.md` — Validation commands.
- `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` — Reference pattern for pause-queue / probe cron loop; the new auth gate is a parallel mechanism, not a unification.
- `app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md` — The takeoverHandler integration contract; `paused_auth` adds branch 4b.
- `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` — Reference for adding a new `WorkflowStage` value and writing terminal-stage semantics.

### Existing files to modify
- `adws/core/claudeStreamParser.ts` — Match `error_status === 401` OR `error.startsWith('authentication')` as `authErrorDetected`, before the existing `overloaded_error` and `attempt >= 2` checks.
- `adws/types/agentTypes.ts` — Add `AuthRequiredError` class next to `RateLimitError`.
- `adws/agents/claudeAgent.ts` — Throw `AuthRequiredError` (instead of returning the failed result) at the end of the existing `authExpired` retry path when `claude auth status --json` reports `loggedIn: false`, when the retry itself returns `authExpired: true`, or when the status probe fails. Re-export `AuthRequiredError`.
- `adws/types/workflowTypes.ts` — Add `'paused_auth'` to the `WorkflowStage` union.
- `adws/triggers/takeoverHandler.ts` — Add branch 4b: `paused_auth` → `skip_terminal` with `terminalStage: 'paused_auth'`. Extend the `CandidateDecision.skip_terminal` union to include `'paused_auth'`.
- `adws/agents/gitAgent.ts` — `runGenerateBranchNameAgent` must not call `extractSlugFromOutput` when `result.authExpired || !result.success`. (After §2 lands, the inner call throws and we never reach the extract; this is belt-and-braces for any caller that doesn't trip the throw.)
- `adws/triggers/trigger_cron.ts` — At the start of `checkAndTrigger`: if `agents/.auth_gate` exists, run the auth-recovery branch (probe → SIGTERM live PIDs → mark `paused_auth` → Slack cooldown → skip rest); else if a queued `scanAuthQueue` pass is due, run it; then proceed with normal tick.
- `adws/triggers/trigger_webhook.ts` — At the start of every event handler that would spawn an agent or orchestrator: if `agents/.auth_gate` exists, return `200 ignored` with `{ reason: 'auth_gate_set' }`.
- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow`: if gate set, return early without spawning (defense in depth; webhook handlers should already have early-returned).
- `adws/phases/workflowInit.ts` — No code change required if the throw propagates naturally; verify the two call sites for `runGenerateBranchNameAgent` (lines 199 and 220) are not wrapped in a try-catch that swallows `AuthRequiredError`.
- `adws/known_issues.md` — Update the `oauth-token-expired` entry: change pattern to include `authentication_failed` and `error_status: 401`; bump `fix_attempts` to 2; add `linked_issues: #504`.

Orchestrator `main()` entrypoints — wrap the existing `try/catch` in `runWithOrchestratorLifecycle(...)` (which currently catches via `handleWorkflowError`) to additionally catch `AuthRequiredError` **before** `handleWorkflowError` so the orchestrator writes `paused_auth` (not `abandoned`) and exits 0:
- `adws/adwSdlc.tsx`
- `adws/adwInit.tsx`
- `adws/adwPlan.tsx`
- `adws/adwBuild.tsx`
- `adws/adwChore.tsx`
- `adws/adwDocument.tsx`
- `adws/adwMerge.tsx`
- `adws/adwPatch.tsx`
- `adws/adwPlanBuild.tsx`
- `adws/adwPlanBuildDocument.tsx`
- `adws/adwPlanBuildReview.tsx`
- `adws/adwPlanBuildTest.tsx`
- `adws/adwPlanBuildTestReview.tsx`
- `adws/adwPrReview.tsx`
- `adws/adwTest.tsx`

The shared catch helper lives in the new `adws/phases/authPause.ts` (see New Files). Each `main()` adds one `catch (e) { if (e instanceof AuthRequiredError) return handleAuthRequiredPause(config, e); throw e; }` adjacent to the existing handler.

### New Files
- `adws/core/authGate.ts` — Primitive: `readAuthGate()`, `writeAuthGate(detection)`, `clearAuthGate()`, `markGateSlackNotified()`. Constants for gate path (`agents/.auth_gate`) and cooldown (`SLACK_DETECTION_COOLDOWN_MS = 2 * 60 * 60 * 1000`). Atomic temp+rename writer mirroring `adws/core/pauseQueue.ts:55-60`. Strict TypeScript interface for the gate JSON.
- `adws/core/slackNotifier.ts` — `sendSlackDetectionNotification(payload)` and `sendSlackRecoveryNotification(payload)`. Reads `SLACK_WEBHOOK_URL` from env; no-op (warn log) if unset. Uses `fetch` (native Bun) with a 10 s timeout. No-throw at boundary — failures are logged but never propagate.
- `adws/triggers/scanAuthQueue.ts` — `scanAuthQueue(cronRepoInfo, targetRepoArgs)`: walks `agents/*/state.json` for `workflowStage === 'paused_auth'`, runs each through `evaluateCandidate(...)` (which now sees the state as `paused_auth` → `skip_terminal` 4b, then the resume flow). Implementation: rewrite the state file to `abandoned` *before* calling `evaluateCandidate` so branch 5 fires (worktreeReset → deriveStageFromRemote → `take_over_adwId`), preserving adwId. Side effects: spawn via `spawnDetached('bunx', ['tsx', orchestratorScript, ...])`.
- `adws/phases/authPause.ts` — `handleAuthRequiredPause(config, err)` and `markStatePausedAuth(adwId)`: idempotently writes/updates `agents/.auth_gate`, marks the orchestrator's top-level state `workflowStage: 'paused_auth'`, posts an issue comment ("⏸️ Paused awaiting re-auth on host X"), and `process.exit(0)`. Mirrors the shape of `handleRateLimitPause` in `adws/phases/workflowCompletion.ts:69-134`.
- `adws/core/__tests__/authGate.test.ts` — Unit tests for atomic write under concurrent forks, first-write field population, re-detection preserving `firstDetectedAt`, Slack-cooldown timestamp updates.
- `adws/core/__tests__/claudeStreamParser.test.ts` — **Extend** with three new tests: 401 + `authentication_failed`, legacy `authentication_error`, 401 + unknown error string (backstop).
- `adws/core/__tests__/slackNotifier.test.ts` — Mocked `fetch` tests: payload shape, missing env warning, fetch failure swallowed.
- `adws/agents/__tests__/claudeAgent.test.ts` — New file. Mocks `handleAgentProcess` and `execSync` for `claude auth status`. Tests the throw path: when retry result has `authExpired: true`, throw `AuthRequiredError`; when status probe returns `loggedIn: false`, throw `AuthRequiredError`. (If the file already exists in some form, extend it.)
- `adws/agents/__tests__/gitAgent.test.ts` — **Extend** with a test that asserts `AuthRequiredError` thrown by the inner runner propagates and no slug extraction occurs.
- `adws/triggers/__tests__/takeoverHandler.test.ts` — **Extend** with a `paused_auth no-op` describe block mirroring the existing `paused no-op` block (lines 126-148).
- `adws/triggers/__tests__/scanAuthQueue.test.ts` — Walks fake state files, asserts skip-when-gated, asserts each `paused_auth` state is rewritten to `abandoned` and routes through evaluateCandidate → take_over_adwId.
- `adws/triggers/__tests__/trigger_cron.authGate.test.ts` — Integration: gate-set + `loggedIn: false` → SIGTERMs + state rewrite + Slack-once-per-2h, no spawn. Gate-set + `loggedIn: true` → gate clear + recovery Slack + scanAuthQueue called.
- `adws/triggers/__tests__/trigger_webhook.authGate.test.ts` — Webhook event handler returns 200 with `auth_gate_set` when gated.
- `features/per-issue/feature-504.feature` — Already exists; covers the end-to-end BDD scenarios. No edit unless step phrasing reveals a gap during build.

## Implementation Plan
### Phase 1: Foundation
Add the data types and primitives that every subsequent change depends on. None of these have user-visible behavior alone.
- New `AuthRequiredError` class in `agentTypes.ts`.
- `WorkflowStage` union gains `'paused_auth'`.
- `CandidateDecision.skip_terminal.terminalStage` union gains `'paused_auth'`.
- New `adws/core/authGate.ts` primitive (atomic read/write/clear/markSlackNotified).
- New `adws/core/slackNotifier.ts` minimal sender (warn-and-no-op when `SLACK_WEBHOOK_URL` unset).
- Parser fix in `claudeStreamParser.ts` (gives `authErrorDetected = true` for 401 / `authentication_failed`).

### Phase 2: Core Implementation
Wire the throw, the catch, and the host-wide gate.
- `runClaudeAgentWithCommand` throws `AuthRequiredError` instead of returning a failed result at the end of the existing OAuth-retry path (`adws/agents/claudeAgent.ts:155-183`).
- `runGenerateBranchNameAgent` guards against running `extractSlugFromOutput` on a failed result (belt-and-braces for any caller-bypassing future path).
- New `adws/phases/authPause.ts` exports `handleAuthRequiredPause(config, err)`.
- New `adws/triggers/scanAuthQueue.ts` walks state files and resumes via takeoverHandler.
- `takeoverHandler.ts` branch 4b: `paused_auth` → `skip_terminal`.
- Every orchestrator `main()` (15 files) catches `AuthRequiredError` and calls `handleAuthRequiredPause`.

### Phase 3: Integration
Make the triggers actually consult the gate.
- `trigger_cron.ts` `checkAndTrigger()`: prepend the gate check + probe + SIGTERM-sweep + Slack-cooldown logic. When the gate is absent, run `scanAuthQueue` once per cycle (mirroring `scanPauseQueue` cadence) before the normal candidate loop.
- `trigger_webhook.ts`: every event branch returns `200 { status: 'ignored', reason: 'auth_gate_set' }` when the gate exists.
- `webhookGatekeeper.classifyAndSpawnWorkflow`: defensive early-return if gated.
- Update `adws/known_issues.md` `oauth-token-expired` entry with the new sample log and fix attempt.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add `AuthRequiredError` to agent types
- In `adws/types/agentTypes.ts`, add a new exported class `AuthRequiredError extends Error` placed immediately after `RateLimitError` (around line 56). Mirror the shape: constructor takes `agentName: string`, sets `this.name = 'AuthRequiredError'`, message `Authentication required for agent: ${agentName}`. Add `readonly agentName: string` field.
- Re-export from `adws/agents/claudeAgent.ts` next to the existing `export { RateLimitError } from '../types/agentTypes'`.

### 2. Extend `WorkflowStage` and `CandidateDecision` unions
- In `adws/types/workflowTypes.ts`, add `'paused_auth'` to the `WorkflowStage` union (group it next to `'paused' | 'resumed'`).
- In `adws/triggers/takeoverHandler.ts`, update the `CandidateDecision` type so the `skip_terminal` variant's `terminalStage` union includes `'paused_auth'`.

### 3. Implement the parser fix (`claudeStreamParser.ts`)
- Replace lines 197-209 with the gate logic from the issue:
  - Compute `errorStatus = (parsed as Record<string, unknown>).error_status as number | undefined`.
  - First branch: `if (errorStatus === 401 || (error && error.startsWith('authentication'))) state.authErrorDetected = true`.
  - Else-if: `error === 'overloaded_error'` → `overloadedErrorDetected`.
  - Else: existing `attempt >= 2` → `serverErrorDetected`.
- Order matters: 401 must be checked before the attempt-based fallback so that `attempt === 1` still latches as auth.

### 4. Extend `claudeStreamParser.test.ts` with three new tests
- Test: `error: 'authentication_failed', error_status: 401, attempt: 1` sets `authErrorDetected = true` and `serverErrorDetected = false`.
- Test: legacy `error: 'authentication_error'` still sets `authErrorDetected` (the existing test on line 50 already covers this — verify the assertion explicitly checks `serverErrorDetected === false`).
- Test: `error: 'future_unknown_variant', error_status: 401, attempt: 2` sets `authErrorDetected = true` and `serverErrorDetected = false` (HTTP 401 backstop).

### 5. Throw `AuthRequiredError` from `runClaudeAgentWithCommand`
- In `adws/agents/claudeAgent.ts`, modify the auth-retry block (lines 155-183):
  - When `status.loggedIn === false` (line 164): instead of `return result`, throw `new AuthRequiredError(agentName)`.
  - When the status probe throws (catch on line 169): throw `new AuthRequiredError(agentName)`.
  - When the retry itself returns `retryResult.authExpired === true` (line 179): throw `new AuthRequiredError(agentName)` instead of `return retryResult`.
- Preserve the existing happy path: on a successful retry, return `retryResult` unchanged.

### 6. Create `adws/agents/__tests__/claudeAgent.test.ts`
- Mock `child_process.spawn` and `execSync`; mock `handleAgentProcess` to return a sequence of results.
- Test: when first `handleAgentProcess` returns `{ success: false, authExpired: true }` and `execSync` (auth status) returns `{ loggedIn: false }` JSON, `runClaudeAgentWithCommand` throws `AuthRequiredError` with the expected `agentName`.
- Test: when first call returns `{ authExpired: true }`, status check succeeds, but retry call returns `{ authExpired: true }` again, throws `AuthRequiredError`.
- Test: when `execSync` throws (timeout / non-zero exit), throws `AuthRequiredError`.
- Test: when first call succeeds (`success: true, authExpired: undefined`), returns the result without throwing.

### 7. Belt-and-braces guard in `runGenerateBranchNameAgent`
- In `adws/agents/gitAgent.ts` line 71-76, after `await runClaudeAgentWithCommand(...)`, check `if (!result.success || result.authExpired) throw new AuthRequiredError('Branch Name')`. This makes the gitAgent layer explicit even if future refactors break the throw site in `claudeAgent.ts`.
- Update `adws/agents/__tests__/gitAgent.test.ts`: stub `runClaudeAgentWithCommand` to throw `AuthRequiredError` and assert it propagates; also stub it to return `{ success: false, authExpired: true, output: '' }` and assert the layer-2 throw fires.

### 8. Implement `adws/core/authGate.ts`
- Define `AuthGateRecord` interface: `firstDetectedAt: string; lastDetectedAt: string; lastSlackNotifiedAt: string | null; host: string; lastDetectedBy: { adwId: string; issueNumber: number | null; agentName: string }`.
- Export `AUTH_GATE_PATH = 'agents/.auth_gate'` constant.
- Export `SLACK_DETECTION_COOLDOWN_MS = 2 * 60 * 60 * 1000`.
- Export `readAuthGate(): AuthGateRecord | null` — returns null on missing or unparseable file. Strict JSON parse.
- Export `writeAuthGate(detection: { adwId: string; issueNumber: number | null; agentName: string }): AuthGateRecord` — if existing record present, preserves `firstDetectedAt` and `lastSlackNotifiedAt`, overwrites `lastDetectedAt = now`, overwrites `lastDetectedBy = detection`. Atomic temp+rename.
- Export `clearAuthGate(): boolean` — unlinks the file if present; returns true if a file was removed.
- Export `markGateSlackNotified(now: Date): void` — read-modify-write to update `lastSlackNotifiedAt`. Atomic.
- Export `shouldSendDetectionSlack(record: AuthGateRecord, now: Date): boolean` — pure function: `record.lastSlackNotifiedAt === null || (now - parse(lastSlackNotifiedAt)) >= SLACK_DETECTION_COOLDOWN_MS`.
- Path resolution: use `os.hostname()` once per process for the `host` field.

### 9. Unit-test `authGate.ts`
- Write `adws/core/__tests__/authGate.test.ts` using a `tmp` directory and a process-level `cwd` change (or inject the path through a module-level override).
- Test: first `writeAuthGate` populates all fields; `lastSlackNotifiedAt` is null.
- Test: second `writeAuthGate` with different detection preserves `firstDetectedAt`, updates `lastDetectedAt` and `lastDetectedBy`.
- Test: `markGateSlackNotified` updates `lastSlackNotifiedAt` and leaves other fields intact.
- Test: `shouldSendDetectionSlack` returns true on null, false within cooldown, true past cooldown.
- Test: concurrent writers (use `Promise.all` of two `writeAuthGate` calls) — final file is parseable JSON and equals exactly one of the two attempted payloads.
- Test: `clearAuthGate` removes the file and returns true; on absence returns false.

### 10. Implement `adws/core/slackNotifier.ts`
- Export interface `AuthDetectionPayload { host: string; adwId: string; issueNumber: number | null; agentName: string; firstDetectedAt: string }`.
- Export interface `AuthRecoveryPayload { host: string; clearedAt: string; resumedCount: number }`.
- Export `sendSlackDetectionNotification(payload)` and `sendSlackRecoveryNotification(payload)`. Both:
  - Read `SLACK_WEBHOOK_URL`. If unset, `log('SLACK_WEBHOOK_URL not set; skipping Slack notification', 'warn')` and return.
  - `fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: formattedMessage }), signal: AbortSignal.timeout(10_000) })`.
  - On non-2xx or fetch throw: `log(..., 'warn')`. Never re-throw.
- Detection message format: `":lock: ADW auth gate triggered on host *${host}*\n• adwId: ${adwId}\n• issue: #${issueNumber ?? 'n/a'}\n• agent: ${agentName}\n• firstDetectedAt: ${firstDetectedAt}\n*Action:* run \`claude auth login\` on host *${host}*."`.
- Recovery message format: `":unlock: Auth restored on host *${host}* at ${clearedAt}. Resuming ${resumedCount} paused issue(s)."`.

### 11. Unit-test `slackNotifier.ts`
- Mock global `fetch`. Test: when `SLACK_WEBHOOK_URL` set, fetch is called once with method POST, JSON content-type, body containing host and adwId. Test: when unset, fetch is not called and a warn log fires. Test: fetch throw is swallowed (function returns without throwing).

### 12. Implement `adws/phases/authPause.ts`
- Export `handleAuthRequiredPause(config: WorkflowConfig, err: AuthRequiredError, costUsd?: number, modelUsage?: ModelUsageMap): never`:
  - Persist token counts if provided (mirror `handleRateLimitPause:78-80`).
  - `writeAuthGate({ adwId: config.adwId, issueNumber: config.issueNumber, agentName: err.agentName })`.
  - `AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'paused_auth' })`.
  - `AgentStateManager.writeState(config.orchestratorStatePath, { execution: { status: 'paused', startedAt: existing?.execution?.startedAt ?? now, completedAt: now }, metadata: { ...existing, pauseReason: 'auth_required', pausedAtAgent: err.agentName } })`.
  - `postIssueStageComment(repoContext, issueNumber, 'paused' /* reuse paused header; pass ctx.pauseReason = 'Awaiting re-authentication' */, ctx)` if `repoContext` is set.
  - `log(`${config.orchestratorName} workflow paused awaiting re-auth`, 'warn')`.
  - `process.exit(0)`.
- Export `markStatePausedAuthForLiveOrchestrator(adwId: string): void` — used by `trigger_cron.ts` when SIGTERMing live PIDs; performs only the state file rewrite (no comment, no Slack — those are the trigger's job).

### 13. Wire `AuthRequiredError` catch into every orchestrator `main()`
- For each of the 15 orchestrators listed in **Relevant Files**, locate the existing `try { ... } catch (error) { handleWorkflowError(config, error, ...) }` block.
- Replace with:
  ```ts
  try {
    // ... existing body ...
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      handleAuthRequiredPause(config, error, totalCostUsd, totalModelUsage);
    }
    handleWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
  ```
  (Both helpers call `process.exit` so the second line is unreachable when the first matches.)
- Add the import: `import { AuthRequiredError } from './types/agentTypes'` (or relative path) and `import { handleAuthRequiredPause } from './phases/authPause'`.
- Cost/usage variable names differ across orchestrators (`totalCostUsd` and `totalModelUsage` in `adwInit.tsx`; `tracker.totalCostUsd` / `tracker.totalModelUsage` for `runWithOrchestratorLifecycle`-based orchestrators). Match the local symbol in each file.

### 14. Add the `paused_auth` branch to `takeoverHandler.ts`
- After the existing branch 4 (`stage === 'paused'`, line 146-149), add:
  ```ts
  // Branch 4b: paused_auth — scanAuthQueue is the sole resumer; no-op here.
  if (stage === 'paused_auth') {
    releaseLock();
    return { kind: 'skip_terminal', adwId, terminalStage: 'paused_auth' };
  }
  ```
- Extend `adws/triggers/__tests__/takeoverHandler.test.ts` with two scenarios in a new `paused_auth no-op` describe block mirroring lines 126-148: classification → skip_terminal; even with live PID → still no-op.

### 15. Implement `adws/triggers/scanAuthQueue.ts`
- Export `scanAuthQueue(deps?: { /* injectable */ }): Promise<number>` returning the count of orchestrators re-triggered.
- Implementation:
  1. If `readAuthGate() !== null`, return 0 immediately.
  2. Walk `agents/*` directories, read each `state.json` (use existing `AgentStateManager.readTopLevelState(adwId)`), filter those with `workflowStage === 'paused_auth'`.
  3. For each match:
     - Write `workflowStage: 'abandoned'` to the state file.
     - Run `evaluateCandidate({ issueNumber, repoInfo })` — the takeoverHandler branch 5 will reset the worktree, reconcile remote, and return `take_over_adwId`.
     - On `take_over_adwId`: `spawnDetached('bunx', ['tsx', state.orchestratorScript ?? 'adws/adwSdlc.tsx', String(issueNumber), adwId, ...targetRepoArgs])`. Release the spawn lock.
     - On any other decision (`spawn_fresh`, `defer_live_holder`): log and continue — no spawn from `scanAuthQueue` if takeover did not fire.
  4. Return the count of `take_over_adwId` decisions actually spawned.
- Inject the candidate-evaluator and spawn function through deps so tests can drive the loop without subprocesses.

### 16. Unit-test `scanAuthQueue.ts`
- Mock `readAuthGate`, `AgentStateManager`, `evaluateCandidate`, `spawnDetached`.
- Test: gate present → returns 0 and no walks happen.
- Test: gate absent, one `paused_auth` state → state rewritten to `abandoned`, `evaluateCandidate` called, `take_over_adwId` spawns.
- Test: gate absent, `paused_auth` state but `evaluateCandidate` returns `defer_live_holder` → no spawn, returns 0.
- Test: multiple `paused_auth` states → each spawned; adwId preserved.

### 17. Wire the auth gate into `trigger_cron.ts`
- At the top of `checkAndTrigger` (line 104), before `await scanPauseQueue(cycleCount)`:
  ```ts
  if (await handleAuthGateTick(cronRepoInfo, targetRepoArgs)) {
    return; // gate handled this tick; skip everything else
  }
  ```
- Implement `handleAuthGateTick` either inline or in a new helper `adws/triggers/authGateTick.ts`:
  1. `const gate = readAuthGate()`.
  2. If `gate === null`: return false (normal tick continues; `scanAuthQueue` runs later in the tick — see step 18).
  3. Probe `claude auth status --json` via `execSync` (15 s timeout, mirror `claudeAgent.ts:157-165`).
  4. If `loggedIn === true`:
     - `clearAuthGate()`.
     - `await scanAuthQueue()` to walk and re-trigger paused_auth states.
     - `sendSlackRecoveryNotification({ host: gate.host, clearedAt: nowISO, resumedCount: <returned> })`.
     - Return true.
  5. If `loggedIn === false`:
     - Walk `agents/*/state.json` for `pid`/`pidStartedAt` whose `isProcessLive(pid, pidStartedAt) === true`. For each live one, SIGTERM and `markStatePausedAuthForLiveOrchestrator(adwId)`.
     - If `shouldSendDetectionSlack(gate, now)`:
       - `sendSlackDetectionNotification({ host, adwId: gate.lastDetectedBy.adwId, issueNumber: gate.lastDetectedBy.issueNumber, agentName: gate.lastDetectedBy.agentName, firstDetectedAt: gate.firstDetectedAt })`.
       - `markGateSlackNotified(now)`.
     - Return true.
  6. If the probe itself errors (treat as gated): just SIGTERM + skip-tick + cooldown-respecting Slack.
- After `scanPauseQueue` (line 108), add `await scanAuthQueue()` (only runs when gate absent; the function is no-op when gated, but the explicit check upstream short-circuits the rest of the tick anyway).

### 18. Integration tests for `trigger_cron.ts` auth gate
- New file `adws/triggers/__tests__/trigger_cron.authGate.test.ts`.
- Hoisted `vi.mock` for `child_process`, `fs`, `../core`, `../../core/authGate`, `../../core/slackNotifier`, `../scanAuthQueue`, `../../core/agentState`.
- Test: gate set + `loggedIn: false` + 2 live state files → both PIDs SIGTERMed, both state files rewritten `paused_auth`, Slack called once, `markGateSlackNotified` invoked, no spawn helper called.
- Test: gate set + `loggedIn: false` + Slack last sent 30 min ago → no Slack call, `markGateSlackNotified` not invoked.
- Test: gate set + `loggedIn: false` + Slack last sent > 2 h ago → exactly one Slack call.
- Test: gate set + `loggedIn: true` → `clearAuthGate` called, recovery Slack called once, `scanAuthQueue` called.
- Test: gate set + `loggedIn: true` + 1 min ago Slack → recovery Slack still fires (cooldown bypassed on clear).

### 19. Wire the auth gate into `trigger_webhook.ts`
- At the start of every event branch that spawns (the `pull_request_review_comment`, `pull_request_review`, `issue_comment`, `pull_request closed`, `issues opened`, `issues closed` branches), before the existing checks:
  ```ts
  if (readAuthGate() !== null) {
    jsonResponse(res, 200, { status: 'ignored', reason: 'auth_gate_set' });
    return;
  }
  ```
- In `webhookGatekeeper.ts`, at the top of `classifyAndSpawnWorkflow` (line 51), add the same early-return as a defense layer:
  ```ts
  if (readAuthGate() !== null) {
    log(`Issue #${issueNumber}: auth gate set, skipping spawn`, 'warn');
    releaseIssueSpawnLock(resolvedRepoInfo, issueNumber);
    return;
  }
  ```

### 20. Integration test for `trigger_webhook.ts`
- New file `adws/triggers/__tests__/trigger_webhook.authGate.test.ts`.
- Stub `readAuthGate` to return a record. Send a synthetic `issue_comment` body; assert `spawnDetached` is never called and the response is `200 { status: 'ignored', reason: 'auth_gate_set' }`.

### 21. Update `adws/known_issues.md`
- In the `oauth-token-expired` entry (lines 99-112), update:
  - `pattern`: add `authentication_failed`, `error_status: 401`.
  - `status`: change from `solved` to `solved (re-fixed in #504)`.
  - `solution`: rewrite to reference §1-§5 of issue #504 — parser 401 backstop, `AuthRequiredError`, host-wide `.auth_gate`, `paused_auth` stage, `scanAuthQueue`.
  - `fix_attempts`: 2.
  - `linked_issues`: `#213, #504`.
  - Append a new sample log block with the May 13 2026 incident JSONL excerpt.

### 22. Final validation
- Run the **Validation Commands** below in order. All must exit zero with no regressions in pre-existing tests.

## Testing Strategy
### Unit Tests
Project has `## Unit Tests: enabled` in `.adw/project.md`. New / extended unit tests:

| Module | File | Cases |
|---|---|---|
| Parser | `adws/core/__tests__/claudeStreamParser.test.ts` (extend) | 401 + `authentication_failed`; legacy `authentication_error`; 401 + unknown variant backstop |
| AuthGate | `adws/core/__tests__/authGate.test.ts` (new) | First write populates all fields; re-write preserves firstDetectedAt; concurrent writers atomicity; `markGateSlackNotified` updates only its field; cooldown helper boundaries; `clearAuthGate` |
| SlackNotifier | `adws/core/__tests__/slackNotifier.test.ts` (new) | Fetch payload shape (detection + recovery); env-unset warn-and-no-op; fetch error swallowed |
| ClaudeAgent | `adws/agents/__tests__/claudeAgent.test.ts` (new) | Throws on `loggedIn: false`; throws on status-probe failure; throws on retry-still-authExpired; happy-path returns retryResult |
| GitAgent | `adws/agents/__tests__/gitAgent.test.ts` (extend) | Propagates `AuthRequiredError` from inner runner; layer-2 throw when caller returns `authExpired: true` without throw |
| TakeoverHandler | `adws/triggers/__tests__/takeoverHandler.test.ts` (extend) | `paused_auth` → skip_terminal with `terminalStage: 'paused_auth'`; live-PID still no-op |
| ScanAuthQueue | `adws/triggers/__tests__/scanAuthQueue.test.ts` (new) | Gate-set bails out; each `paused_auth` state is rewritten to `abandoned` and spawned via take_over_adwId; non-takeover decisions don't spawn; multiple state files |
| TriggerCron | `adws/triggers/__tests__/trigger_cron.authGate.test.ts` (new) | Gate + loggedIn=false → SIGTERM + paused_auth + Slack-cooldown + skip-tick; gate + loggedIn=true → clear + recovery Slack + scanAuthQueue |
| TriggerWebhook | `adws/triggers/__tests__/trigger_webhook.authGate.test.ts` (new) | Gate set → 200 ignored, no spawn |

### Edge Cases
- **Parser**: `attempt: 1` with 401 must still latch (current parser only sets `serverErrorDetected` at `attempt >= 2`, so without the fix, attempt-1 401 would silently slip through; the 401 backstop ensures detection on first attempt).
- **Parser cross-chunk**: a JSONL line split across two `data` chunks (the existing `state.lineBuffer` mechanism handles this; verify a 401 payload that arrives across chunks still classifies). Reuse the existing buffering test pattern in `claudeStreamParser.test.ts`.
- **AuthGate**: existing gate file with corrupt JSON → `readAuthGate` returns null (treat as no gate to avoid lockout on a damaged file); `writeAuthGate` overwrites cleanly.
- **AuthGate**: concurrent writers from two cron processes — both writes succeed atomically, exactly one wins; neither leaves a partial `.tmp` because `rename` is atomic on POSIX.
- **State walking**: `agents/<adwId>/state.json` may be missing when `agents/<adwId>/` exists for an in-flight orchestrator that crashed before initializing. `scanAuthQueue` and the SIGTERM loop must skip unreadable state files without aborting the sweep.
- **Live-PID SIGTERM**: a PID that exited between the liveness check and `process.kill` (ESRCH). Mirror the existing `takeoverHandler.killProcess` swallow pattern.
- **scanAuthQueue + worktree gone**: `takeoverHandler` branch 5 calls `resetWorktreeToRemote` which can throw if the worktree is gone. Wrap in try/catch and log; mark state `abandoned` and continue.
- **Slack timeout**: `fetch` with `AbortSignal.timeout(10_000)`; on abort, log and continue.
- **Slack 5xx**: log non-2xx and continue (do not retry — the next cron tick handles repeat).
- **Probe race**: gate exists, probe says `loggedIn: true`, but during scan a new 401 arrives. The arriving orchestrator's `AuthRequiredError` catch re-writes the gate (preserving `firstDetectedAt` from the just-cleared run — but we just cleared, so this is a fresh `firstDetectedAt`). Recovery Slack already fired for the previous gate; the new gate is a new event and a new detection Slack will fire (cooldown is per-gate, `lastSlackNotifiedAt: null` on a fresh write).
- **Webhook race with concurrent gate clear**: webhook handler reads `readAuthGate() === null` between gate-clear and arriving request → spawn proceeds normally (correct behavior).
- **Orchestrator catches both `AuthRequiredError` and `RateLimitError`**: the `if (error instanceof AuthRequiredError)` check must come **before** `handleWorkflowError`. Both helpers call `process.exit`, so order matters and no fallthrough is possible.
- **CLI version regression**: if a future CLI emits 401 on something other than `api_retry` (e.g. a top-level `system` error or `result` with isError), the parser does not catch it. That is an explicit out-of-scope per the issue's "References" — track via the existing `known_issues.md` mechanism.

## Acceptance Criteria
Verbatim from issue #504, restated as completion checklist:

- [ ] Parser unit test: JSONL `{type:"system",subtype:"api_retry",error:"authentication_failed",error_status:401,attempt:1}` sets `authErrorDetected = true`, **not** `serverErrorDetected`.
- [ ] Parser unit test: JSONL with `error: "authentication_error"` (legacy) continues to set `authErrorDetected`.
- [ ] Parser unit test: JSONL with `error_status: 401` and an unknown error string sets `authErrorDetected` (backstop).
- [ ] `runClaudeAgentWithCommand` throws `AuthRequiredError` after the auth-status retry exhausts (covered by unit test that fakes the retry path).
- [ ] `runGenerateBranchNameAgent` propagates `AuthRequiredError` (no garbage slug, no silent continuation).
- [ ] takeoverHandler unit test: state with `workflowStage: 'paused_auth'` returns `{ kind: 'skip_terminal', terminalStage: 'paused_auth' }` (branch 4b).
- [ ] Gate file write is atomic under concurrent writers (temp + rename). Unit test forks two writers and asserts no corruption.
- [ ] Cron-tick integration test: with `.auth_gate` set and `claude auth status --json` stub returning `loggedIn: false`, the tick walks state files, SIGTERMs live PIDs, marks them `paused_auth`, sends Slack at most once per 2 h, and does **not** spawn anything.
- [ ] Cron-tick integration test: with `.auth_gate` set and `claude auth status --json` stub returning `loggedIn: true`, the tick clears the gate, sends one-shot recovery Slack, runs `scanAuthQueue` and re-triggers each `paused_auth` issue.
- [ ] `scanAuthQueue` integration test: a `paused_auth` state file routes through takeoverHandler → branch 5 → resume.
- [ ] Webhook integration test: when `.auth_gate` is set, an inbound `issue_comment` event spawns no agent and returns `200 { status: 'ignored', reason: 'auth_gate_set' }`.
- [ ] BDD `features/per-issue/feature-504.feature` runs with `@adw-504` tag and all scenarios pass.
- [ ] All pre-existing unit tests continue to pass with zero regressions.
- [ ] TypeScript type-check passes after additions to `WorkflowStage` and `CandidateDecision`.

## Validation Commands
Execute every command. All must exit zero.

- `bun install` — Verify dependencies install.
- `bun run lint` — ESLint clean.
- `bunx tsc --noEmit` — Top-level TypeScript type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-scope type-check (catches union-narrowing issues from `WorkflowStage` / `CandidateDecision` additions).
- `bun run build` — Production build clean.
- `bun run test:unit` — All unit tests pass (existing + new).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-504"` — Per-issue BDD scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Regression suite continues to pass (no auth-related regression introduced elsewhere).

## Notes
- **Coding guidelines compliance**: each new file stays under 300 lines (`authGate.ts` ≈ 120 LOC; `slackNotifier.ts` ≈ 80 LOC; `scanAuthQueue.ts` ≈ 150 LOC; `authPause.ts` ≈ 80 LOC). Guard clauses are used to keep nesting at most 2 levels (mirroring the takeoverHandler style). Pure helpers (`shouldSendDetectionSlack`) are exported separately so they can be tested without filesystem I/O.
- **No decorators**, per the planning guidelines.
- **Library installs**: none required — `fetch` is native Bun, `os.hostname()` is native Node, atomic file I/O reuses `fs.renameSync`. If for some reason a Slack helper library is added later, install via `bun add <pkg>`.
- **Backwards compatibility**: existing `authentication_error` matcher remains. Existing `RateLimitError` path is unchanged for non-auth rate-limits / overloaded errors.
- **Out of scope (deferred per issue)**: Signal / WhatsApp channels (no infra); unifying with `pauseQueue` (different scope/semantics); remediating the May 13 incident's stranded state (handled out-of-band).
- **Residual risk acknowledged in issue**: probe cadence at 20 s (local subprocess, negligible cost); in-flight agent burns one more API call before SIGTERM (≤ 20 s window); CLI error string drifts are covered by the 401 backstop.
- **Conditional docs**: `app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md` and `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` are the relevant prior-art docs; consult them before any takeoverHandler or pause-queue-like change.
- **BDD step definitions**: the existing `features/per-issue/feature-504.feature` references step phrases like "the JSONL stream parser processes the envelope", "runClaudeAgentWithCommand is invoked for any agent", "the cron probe runs once", "scanAuthQueue runs once", etc. The BDD step definitions for these phrases are generated by `/generate_step_definitions` after the build phase; vocabulary additions (if any) must be appended to `features/regression/vocabulary.md` if those phrases are not already registered. Check during the step-def phase rather than the build phase.
