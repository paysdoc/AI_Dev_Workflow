# Auth HITL Gate — Classify 401, Kill In-Flights, Slack Notify

**ADW ID:** x5qlsu-auth-classify-401-as
**Date:** 2026-05-13
**Specification:** specs/issue-504-adw-x5qlsu-auth-classify-401-as-sdlc_planner-auth-hitl-gate-401-classify.md

## Overview

Classifies HTTP 401 / `authentication_failed` Claude CLI errors as a host-wide Human-In-The-Loop (HITL) event instead of misclassifying them as rate-limits. When the gate fires, all in-flight orchestrators are SIGTERMed and marked `paused_auth`, new spawns are blocked, a Slack notification is sent (with 2 h cooldown), and issues automatically resume once `claude auth login` is run on the host.

## What Was Built

- **Parser fix** — `claudeStreamParser.ts` now routes `error_status === 401` or `error.startsWith('authentication')` to `authErrorDetected` before the overloaded/server-error branches, covering both `authentication_error` (legacy) and `authentication_failed` (CLI v2.1.132+)
- **`AuthRequiredError` class** — new error type in `agentTypes.ts`; thrown by `runClaudeAgentWithCommand` when the OAuth-retry path exhausts (status probe returns `loggedIn: false`, probe throws, or retry still has `authExpired: true`)
- **`adws/core/authGate.ts`** — host-wide gate file (`agents/.auth_gate`) with atomic temp+rename writes; exports `readAuthGate`, `writeAuthGate`, `clearAuthGate`, `markGateSlackNotified`, `shouldSendDetectionSlack`
- **`adws/core/slackNotifier.ts`** — `sendSlackDetectionNotification` and `sendSlackRecoveryNotification`; reads `SLACK_WEBHOOK_URL` from env, no-op with warn log if unset, swallows fetch errors
- **`paused_auth` workflow stage** — added to `WorkflowStage` union and `CandidateDecision.skip_terminal` in `takeoverHandler.ts` (branch 4b)
- **`adws/phases/authPause.ts`** — `handleAuthRequiredPause(config, err)` writes the gate, marks `workflowStage: 'paused_auth'`, logs, exits 0; `markStatePausedAuthForLiveOrchestrator` for cron SIGTERM path
- **`adws/triggers/scanAuthQueue.ts`** — walks `agents/*/state.json` for `paused_auth`, rewrites to `abandoned`, routes through `evaluateCandidate` → `take_over_adwId`, spawns with original adwId preserved
- **`trigger_cron.ts` gate integration** — `handleAuthGateTick` probes `claude auth status --json` when gate set; on `loggedIn=false` SIGTERMs live PIDs and sends cooldown-respecting Slack; on `loggedIn=true` clears gate, sends recovery Slack, runs `scanAuthQueue`; `AuthRequiredError` catch inside the tick candidate loop writes the gate and short-circuits
- **`trigger_webhook.ts` gate integration** — early-return `200 { status: 'ignored', reason: 'auth_gate_set' }` when gate set; `AuthRequiredError` catch writes gate and returns `200 { reason: 'auth_required_caught' }`
- **`webhookGatekeeper.ts` defense layer** — `classifyAndSpawnWorkflow` returns early if gate is set (belt-and-braces)
- **15 orchestrator entrypoints** — all catch `AuthRequiredError` before `handleWorkflowError` and call `handleAuthRequiredPause`
- **Belt-and-braces in `gitAgent.ts`** — `runGenerateBranchNameAgent` throws `AuthRequiredError` if result is `!success || authExpired`, preventing silent garbage-slug extraction
- **Comprehensive test suite** — new unit tests for `authGate`, `slackNotifier`, `claudeAgent`, `scanAuthQueue`; extended tests for `claudeStreamParser`, `gitAgent`, `takeoverHandler`; BDD scenarios in `features/per-issue/feature-504.feature`

## Technical Implementation

### Files Modified

- `adws/core/claudeStreamParser.ts`: Added 401-backstop and `authentication_failed` detection before the overloaded/server-error branch
- `adws/agents/claudeAgent.ts`: Throws `AuthRequiredError` at all three exit points of the OAuth-retry path
- `adws/agents/gitAgent.ts`: Belt-and-braces guard against calling `extractSlugFromOutput` on a failed/auth-expired result
- `adws/types/agentTypes.ts`: Added `AuthRequiredError` class adjacent to `RateLimitError`
- `adws/types/workflowTypes.ts`: Added `'paused_auth'` to `WorkflowStage` union
- `adws/triggers/takeoverHandler.ts`: Added branch 4b (`paused_auth` → `skip_terminal`) and extended `CandidateDecision.skip_terminal.terminalStage`
- `adws/triggers/trigger_cron.ts`: Prepended `handleAuthGateTick`, added `scanAuthQueue` call after `scanPauseQueue`, wrapped candidate-loop spawns in `AuthRequiredError` catch
- `adws/triggers/trigger_webhook.ts`: Gate check at each spawn branch entry; `AuthRequiredError` catch wrapping `classifyAndSpawnWorkflow`
- `adws/triggers/webhookGatekeeper.ts`: Early-return in `classifyAndSpawnWorkflow` if gate set
- `adws/adwSdlc.tsx`, `adwInit.tsx`, `adwPlan.tsx`, `adwBuild.tsx`, `adwChore.tsx`, `adwDocument.tsx`, `adwPatch.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildDocument.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`, `adwPrReview.tsx`, `adwTest.tsx`: Added `AuthRequiredError` catch calling `handleAuthRequiredPause` before `handleWorkflowError`
- `adws/known_issues.md`: Updated `oauth-token-expired` entry with new pattern, fix attempt 2, `linked_issues: #504`

### New Files

- `adws/core/authGate.ts`: Auth gate primitive (read/write/clear/markSlackNotified/shouldSendDetectionSlack)
- `adws/core/slackNotifier.ts`: Slack detection and recovery notification senders
- `adws/phases/authPause.ts`: `handleAuthRequiredPause` and `markStatePausedAuthForLiveOrchestrator`
- `adws/triggers/scanAuthQueue.ts`: Auth queue scanner for resuming `paused_auth` orchestrators
- `adws/core/__tests__/authGate.test.ts`: Unit tests including atomic write concurrency
- `adws/core/__tests__/slackNotifier.test.ts`: Mocked fetch tests for payload shape and error handling
- `adws/agents/__tests__/claudeAgent.test.ts`: AuthRequiredError throw path tests
- `adws/triggers/__tests__/scanAuthQueue.test.ts`: Gate-set bail, state rewrite, spawn routing tests
- `features/per-issue/feature-504.feature`: BDD acceptance scenarios tagged `@adw-504`
- `features/per-issue/step_definitions/feature-504.steps.ts`: Step definitions for BDD scenarios

### Key Changes

- The gate file `agents/.auth_gate` is a JSON record with `firstDetectedAt`, `lastDetectedAt`, `lastSlackNotifiedAt`, `host`, and `lastDetectedBy`; written atomically (temp+rename) mirroring `pauseQueue.ts`
- `shouldSendDetectionSlack` is a pure function exported separately for testability; cooldown is 2 hours (`SLACK_DETECTION_COOLDOWN_MS`)
- `scanAuthQueue` rewrites each `paused_auth` state to `abandoned` *before* calling `evaluateCandidate` so takeoverHandler branch 5 fires and preserves the original adwId
- `AuthRequiredError` must be caught **before** `handleWorkflowError` in every orchestrator because both call `process.exit`; order is load-bearing
- The 401 parser fix checks `error_status === 401` OR `error.startsWith('authentication')` *before* the `attempt >= 2` server-error check, so attempt-1 401s are caught immediately

## How to Use

This feature is fully automatic once deployed. For operators:

1. If a 401 error occurs, ADW will write `agents/.auth_gate` and send a Slack message to `SLACK_WEBHOOK_URL` with instructions
2. Run `claude auth login` on the host named in the Slack message
3. On the next cron tick (every ~20 s), ADW will detect `loggedIn: true`, clear the gate, send a recovery Slack, and automatically resume all paused issues via `scanAuthQueue`

No manual state manipulation is required.

## Configuration

- **`SLACK_WEBHOOK_URL`** (env var): Incoming webhook URL for auth gate notifications. If unset, notifications are silently skipped (warn log only); auth gate and recovery behavior proceed normally without Slack.
- **`SLACK_DETECTION_COOLDOWN_MS`**: Hardcoded to 2 hours (7,200,000 ms). Detection Slack fires once per gate set per cooldown window; recovery Slack always fires on gate clear regardless of cooldown.

## Testing

```bash
# Unit tests (includes authGate, slackNotifier, claudeAgent, scanAuthQueue)
bun run test:unit

# BDD scenarios for issue #504
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-504"

# Regression suite (must have zero regressions)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Key unit test scenarios:
- `adws/core/__tests__/authGate.test.ts`: First write, re-write preserves `firstDetectedAt`, concurrent atomic writers, Slack cooldown helper, `clearAuthGate`
- `adws/agents/__tests__/claudeAgent.test.ts`: Throws on `loggedIn: false`, throws on status-probe failure, throws on retry-still-authExpired, happy path returns result

## Notes

- **Backwards compatibility**: The existing `authentication_error` matcher and `RateLimitError` path are unchanged. Only 401-classified errors route to the new path.
- **Out of scope**: Signal/WhatsApp channels; unifying with `pauseQueue` (different scope); remediating in-flight agents that burn one more API call before SIGTERM (≤20 s window, acknowledged residual risk).
- **Probe race**: If auth clears during a scan and a new 401 arrives, the gate is re-written as a fresh event (`firstDetectedAt` reset). Each gate lifetime is independent.
- **Corrupt gate file**: `readAuthGate` returns `null` on parse failure, treating a damaged gate as absent to avoid permanent lockout.
- **ESRCH on SIGTERM**: PIDs that exit between liveness check and kill are silently swallowed (mirror of `takeoverHandler.killProcess` pattern).
- See `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` for the parallel rate-limit pause/resume mechanism.
- See `app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md` for the takeoverHandler branch contract that `scanAuthQueue` relies on.
