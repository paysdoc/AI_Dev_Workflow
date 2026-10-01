---
status: accepted
date: 2026-04-20
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/orchestrator-coordination-resilience.md
  - kind: contemporaneous
    source: specs/issue-449-adw-0cv18u-cron-webhook-can-dou-sdlc_planner-fix-cross-trigger-spawn-dedup.md
  - kind: contemporaneous
    source: specs/issue-454-*.md to specs/issue-467-*.md
supersedes: []
superseded-by: []
---

# A coordination kernel: lifetime lock, OS liveness, heartbeat, and takeover reconciled against the remote

## Context and Problem Statement

Orchestrators crashed, stalled or were started twice, and the system had no single way to recover. The PRD lists what operators saw: an issue "sits in `abandoned` but nothing picks it up", an issue retried forever, two orchestrators on overlapping branches, a merged PR whose workflow never completed. On 2026-04-18 the cron trigger and the webhook each spawned an orchestrator for the same issue (paysdoc/depaudit #6), because classification took about five minutes and no guard crossed the process boundary (#449). A branch name produced by the LLM and altered by a regex created a "ghost" orchestrator that wrote to a worktree path that did not exist.

The decision covers every orchestrator that writes top-level state, the cron and webhook triggers, and the modules named below. `adwPrReview`, `adwClearComments` and `adwDocument` were out of scope.

## Decision Drivers

* One orchestrator per repo and issue at any time.
* One recovery path for a crash, a rate-limit death, a wedged process and a defensive exit.
* The decision logic must be testable without real processes, git or GitHub.

## Considered Options

* A canonical-registration protocol in issue comments. The PRD says it was "explored in depth during design".
* An extended file lock with the state file as the record, OS-level liveness, and reconciliation against the remote.
* Hard timeouts per phase.

## Decision Outcome

Chosen option: "extended file lock with state-file truth", because the comment protocol was "rejected in favor of extended file-lock + state-file truth once the single-host-per-repo invariant was accepted" ([ADR-0035](0035-single-host-per-repo.md)). Hard timeouts per phase were not introduced, because "the heartbeat + hung-detector recovery path covers wedged processes".

The PRD grounds the design in four statements: one host per repo; the operating system is the authority on whether a process is alive; the remote is the authority on how far the work has come, and the state file is a cache; a terminal failure is not a transient one ([ADR-0036](0036-stage-taxonomy-and-exhaustive-classifier.md)).

The parts:

* `spawnGate`: a per-issue lock file created with the `wx` flag. #449 introduced it for the window between classification and spawn. The orchestrator now takes it after initialisation and holds it for its whole life.
* `processLiveness`: a process is alive only when `kill -0` succeeds and its start time equals the recorded one, so a reused PID is not mistaken for the old process.
* `heartbeat`: writes `lastSeenAt` to top-level state every 30 seconds, independent of phase progress.
* `hungOrchestratorDetector`: a pure query for `*_running` workflows whose PID is alive and whose heartbeat is older than 3 minutes. The cron trigger kills them and writes `abandoned`.
* `remoteReconcile`: derives the stage from branch and PR state on the remote, reads a second time before it answers, and falls back to the state file when the reads keep disagreeing.
* `worktreeReset`: aborts a merge or rebase in progress, then `git reset --hard origin/<branch>` and `git clean -fdx`. Unpushed work is lost on purpose.
* `takeoverHandler`: `evaluateCandidate` is the one decision tree for every candidate that arrives at an issue, from cron or webhook. It answers `spawn_fresh`, `take_over_adwId`, `defer_live_holder` or `skip_terminal`.
* A shared wrapper, `runWithOrchestratorLifecycle`, gives each orchestrator lock, heartbeat and release.
* The LLM produces only the slug of a branch name. Code assembles `<prefix>-issue-<N>-<slug>`.
* A resume from the pause queue first checks that the lock is free and that the adwId in state still matches (#466).

### Consequences

* Good, because a dead orchestrator is reclaimed on the next cron cycle and a live one makes every other candidate defer.
* Good, because the decision tree is unit-tested through injected dependencies.
* Bad, because the design is correct on one host only.
* Bad, because takeover discards unpushed local work. [ADR-0047](0047-resume-in-place.md) narrowed this.
* Bad, because exits through `process.exit` skip the `finally` block, so the lock file stays on disk until the next caller finds its holder dead.
* Bad, because Windows is not supported by `processLiveness`.

### Confirmation

Checked on 2026-09-29.

* These files exist and were read: `adws/triggers/spawnGate.ts`, `adws/triggers/takeoverHandler.ts`, `adws/core/processLiveness.ts`, `adws/core/heartbeat.ts`, `adws/core/hungOrchestratorDetector.ts`, `adws/core/remoteReconcile.ts`, `adws/phases/orchestratorLock.ts`.
* `evaluateCandidate` is called from `trigger_cron.ts`, `webhookGatekeeper.ts` and `scanAuthQueue.ts`.
* Thirteen orchestrators call the lifecycle wrapper: those named in the PRD except `adwInit`, which no longer exists, plus `adwUpgrade`. `adwPrReview`, `adwDocument` and `adwClearComments` do not.
* `HEARTBEAT_TICK_INTERVAL_MS` is 30,000 and `HEARTBEAT_STALE_THRESHOLD_MS` is 180,000 in `adws/core/config.ts`.
* Vitest run of `processLiveness.test.ts` and `hungOrchestratorDetector.test.ts` passed. `takeoverHandler.test.ts`, `spawnGate.test.ts`, `remoteReconcile.test.ts` and `heartbeat.test.ts` could not be loaded, because `@paysdoc/devplatform` is not installed in the checkout used for this record. Their results are unverified.
* No CI workflow runs the unit tests.

## More Information

Later decisions changed parts of the PRD. These are recorded in their own ADRs and the PRD text is stale on these points:

* Takeover of an `abandoned` or `phase_timeout` workflow reuses a healthy worktree. The hard reset is the fallback, and still the rule for a workflow in an active stage. See [ADR-0047](0047-resume-in-place.md).
* The reset itself is executed by the git context of `@paysdoc/devplatform`; `adws/vcs/worktreeReset.ts` is an empty file kept for its path. See [ADR-0046](0046-gitcontext-as-sole-git-authority.md) and [ADR-0051](0051-forge-agnostic-core-and-devplatform-dependency.md).
* `paused` is still skipped by the takeover handler, but `## Retry` can respawn it. See [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md).
* A per-agent timeout was added after all, on 2026-05-21. See [ADR-0023](0023-context-exhaustion-is-a-reset.md).
* `cronProcessGuard`, which keeps one cron process per repo on a host, was left unchanged by the PRD and still uses the older `isProcessAlive` check.

The PRD records that migration of in-flight issues was "scrapped per operator preference". State fields are described in [ADR-0029](0029-top-level-state-file-as-source-of-truth.md), the triggers in [ADR-0012](0012-webhook-gatekeeper-cron-sweeper.md).
