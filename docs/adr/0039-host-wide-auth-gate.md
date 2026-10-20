---
status: accepted
date: 2026-05-13
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-504-adw-x5qlsu-auth-classify-401-as-sdlc_planner-auth-hitl-gate-401-classify.md
  - kind: contemporaneous
    source: commit 523f0650 (#504), merged by PR #505 on 2026-05-13
supersedes: []
superseded-by: []
---

# An expired Claude login closes a host-wide gate until a human logs in again

## Context and Problem Statement

On 2026-05-13 the Claude CLI on the ADW host lost its login. CLI version 2.1.132 reported this as an `api_retry` envelope with `error: "authentication_failed"` and `error_status: 401`. The stream parser knew only `authentication_error`, so the failure fell into the generic server-error branch and was raised as a rate limit. The triggers queued the affected issues for pause and resume ([ADR-0025](0025-rate-limit-pause-and-resume-queue.md)), although, in the words of the plan, "no orchestrator can recover without a human running `claude auth login`".

A rate limit is per workflow and clears by itself. A lost login affects every agent on the host and needs a person. The plan: "There is no machinery for a Human-In-The-Loop event distinct from rate-limit pause."

The decision covers `adws/core/claudeStreamParser.ts`, `adws/agents/claudeAgent.ts`, `adws/core/authGate.ts`, `adws/phases/authPause.ts`, `adws/triggers/scanAuthQueue.ts`, both triggers and the orchestrator entry points.

## Decision Drivers

* Stop spending compute on agent runs that must fail.
* Tell the operator, and do not flood them.
* Resume the affected issues without manual work once the login is back, under their original adwId.

## Considered Options

* Fix the parser only, so that 401 is recognised as an authentication failure.
* A host-wide gate file, a stage of its own, and a Slack notification.
* Fold authentication failures into the existing pause queue.

## Decision Outcome

Chosen option: "host-wide gate file", because the recovery is host-wide and needs a human. The parser-only fix was judged unsafe on its own: the branch-name agent never checked for failure, and with the misclassification gone it "would silently call `extractSlugFromOutput('')`, produce a corrupt slug, and continue". Folding into the pause queue was left out of scope for "different scope/semantics"; the plan calls the gate "a parallel mechanism, not a unification".

The parts:

* The parser treats `error_status === 401` or an `error` that starts with `authentication` as an authentication failure, checked before the overload and server-error branches. The status code is the backstop against a change in the error string.
* `runClaudeAgentWithCommand` throws `AuthRequiredError` when its one retry after an auth status check is exhausted.
* The orchestrator catches the error, writes the gate file `agents/.auth_gate` (write to temp, then rename), sets the stage `paused_auth` and exits with code 0.
* Every spawn path reads the gate. The webhook answers `200 ignored` while it is set.
* The cron tick reads the gate first. While it is set, the tick runs `claude auth status --json`, sends SIGTERM to live orchestrators and marks them `paused_auth`, sends a Slack message at most once per two hours, and does nothing else.
* When the login is back, the tick removes the gate, sends one recovery message, and `scanAuthQueue` rewrites each `paused_auth` workflow to `abandoned` and passes it to the takeover handler ([ADR-0034](0034-coordination-kernel.md)), which keeps the adwId.
* The takeover handler itself treats `paused_auth` as terminal and skips it.

### Consequences

* Good, because one failed login stops all spawns on the host within one cron tick.
* Good, because an authentication failure can no longer sit in the pause queue and be probed as if it were a rate limit.
* Good, because resumption reuses the takeover decision tree, with its lock and liveness checks.
* Bad, because there are two pause mechanisms with two scanners.
* Bad, because the gate is a local file and covers one host, in line with [ADR-0035](0035-single-host-per-repo.md).
* Bad, because a running agent may make one more API call before it is stopped; the plan accepts a window of up to 20 seconds.
* Bad, because the notification depends on `SLACK_WEBHOOK_URL`. Other channels were deferred for lack of infrastructure.

### Confirmation

Checked on 2026-09-29.

* `adws/core/authGate.ts` exists with `AUTH_GATE_PATH = 'agents/.auth_gate'`, an atomic writer and a cooldown of two hours.
* `readAuthGate` is called in `trigger_cron.ts` (`handleAuthGateTick`, first step of the tick), in `trigger_webhook.ts` (four handlers) and in `webhookGatekeeper.ts`.
* `classifyApiSignal` in `adws/core/claudeStreamParser.ts` returns `auth` for the documented value `authentication_failed` or for status 401, ahead of every other signal. The prefix match of #504 was replaced by this exact match in #907.
* `AuthRequiredError` is referenced in thirteen scripts under `adws/`, including `adwPrReview.tsx` and `adwDocument.tsx`. `adwMerge.tsx` and `adwUpgrade.tsx` do not reference it; why is not recorded.
* `paused_auth` is in the `terminal` class of `adws/core/stageClassifier.ts` ([ADR-0036](0036-stage-taxonomy-and-exhaustive-classifier.md)).
* `adws/core/__tests__/authGate.test.ts` was run with Vitest and passed. `scanAuthQueue.test.ts` and `slackNotifier.test.ts` exist but were not run.
* Whether the Slack message is delivered on the production host was not checked.

## More Information

* The PRD for [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md) confirmed this decision on 2026-09-25: "The auth gate, `paused_auth`, and the auth queue scanner remain the sole path for expired logins", and `## Retry` leaves `paused_auth` alone. It also corrected PR #903, which had classified an authentication failure in the pause-queue probe as a rate limit.
* `scanAuthQueue` sends resumed workflows through the `abandoned` branch of the takeover handler. Since [ADR-0047](0047-resume-in-place.md) that branch reuses a healthy worktree; the plan for #504 still describes a reset.
* `adws/known_issues.md` has the entry `oauth-token-expired` with the patterns this decision recognises.
