# PRD: Orchestrator Coordination and Resilience

## Problem Statement

ADW orchestrators (SDLC, merge, chore, and the other `adwPlan*` / `adwBuild*` / `adwTest` variants) have accumulated a set of correctness gaps that intermittently produce stuck, duplicated, or stranded work. The symptoms in production are:

- An orchestrator dies between writing the PR-open phase and writing `awaiting_merge`. Its top-level state shows `abandoned` even though a valid PR exists on the remote. Cron's backlog sweeper sees `abandoned` as retriable and spawns a fresh SDLC orchestrator instead of dispatching the merge orchestrator. That re-spawn then collides with a drifting branch-name regex, creating a ghost orchestrator writing into a worktree path that never actually exists on disk.
- An orchestrator hits rate-limit, is enqueued for pause-resume, and never gets resumed. Because the workflow lives in a file-based pause queue rather than top-level state, its stall is invisible to the backlog sweeper.
- The `abandoned` label is used for at least three semantically different situations — real crashes, merge-orchestrator defensive exits, and externally-closed PRs — but all of them flow through the same `isRetriableStage` predicate. Some paths (merge failure after retries, operator-closed PR) retry forever when they should stay terminal; some paths (merge-orchestrator's `unexpected_stage` self-guard) are labeled abandoned when a retry would have been correct.
- Spawn deduplication is currently a short-lived file lock covering only the classification-to-spawn window. The orchestrator itself runs unlocked, so any candidate arriving after spawn but before completion has no signal that work is in progress beyond the top-level state file, and has no way to detect a process that is alive but stuck.
- The LLM is currently responsible for producing full git branch names. Regex drift in post-processing produced the ghost branch `feature-issue-8-json-reporter-findings-output` for a run whose real branch was `feature-issue-8-json-reporter-findings`, orphaning the resulting orchestrator.

Operators experience this as: issue sits in `abandoned` but nothing picks it up; or issue gets retried forever; or two orchestrators operate on overlapping branches; or a PR is merged but the workflow never completes because it was killed at exactly the wrong moment.

## Solution

Introduce a small set of coordination and resilience primitives so that any orchestrator crash, rate-limit death, wedge, or defensive exit has a single well-defined recovery path. The recovery path is grounded in four observations:

1. **Single-host invariant**: for a given repo, only one host runs the ADW triggers. This is a deployment convention, not a code-enforced constraint, and the design accepts this.
2. **OS-level liveness is authoritative**: `kill -0 pid` combined with `process-start-time` is the truth of "is this process alive." The state file describes *what* the process is doing; the OS describes *whether* it's still doing it.
3. **Remote is authoritative for work state**: branch existence, PR open/closed/merged, latest commit — these are the ground truth of how far the work has progressed. The local state file is a cache that can be reconciled against the remote at any moment.
4. **Terminal vs transient failure must be distinguished**: a PR closed by a human is a terminal decision; a phase that threw an exception is transient and safe to retry. The system must stop lumping them together.

The solution is a layered refactor:

- **Spawn gate** is extended to cover the orchestrator's full lifetime, not just the spawn window. Its liveness check uses a PID+start-time tuple so PID reuse after a reboot or long uptime cannot produce false positives.
- **A heartbeat side-tick** (30s interval) writes `lastSeenAt` to the top-level state file independently of phase progress. A wedged Node event loop stops the tick even when the process remains alive, giving the cron sweeper a signal to force-recover.
- **The `abandoned` workflow stage splits into `abandoned` (retriable, transient failure) and `discarded` (terminal, not retriable).** Each existing write site is reclassified per the actual semantics of the exit.
- **A takeover handler** integrates lock acquisition, state inspection, PID+start-time liveness, remote reconciliation, and worktree reset into a single decision tree that runs whenever a new candidate arrives at an issue.
- **Remote-wins reconciliation** reads the actual remote artifacts (branch, PR, commits) on takeover and derives the workflow stage from them, rather than trusting a potentially stale state file. A mandatory re-verification read occurs right before committing to a derived stage, to guard against read-your-write lag.
- **Worktree takeover** hard-resets to `origin/<branch>` and clears merge/rebase in-progress markers, accepting that any unpushed local work is lost in favor of deterministic state.
- **Branch-name generation** narrows the LLM's responsibility to producing only the semantic slug. Full branch name is assembled in code, eliminating the regex drift that produced the recent ghost branch.

`adwPrReview` is explicitly out of scope; it is keyed by PR number, has no top-level state, and sits outside the backlog sweeper. `adwClearComments` and `adwDocument` are utility scripts with no workflow-stage interaction and are also out of scope.

## User Stories

1. As an ADW operator, I want a crashed orchestrator to be automatically picked up on the next cron cycle, so that I don't have to manually triage every rate-limit or OOM event.
2. As an ADW operator, I want an externally-closed PR to stay closed and not trigger another SDLC spawn, so that my "no, don't do that" signal is respected.
3. As an ADW operator, I want a merge that genuinely failed after all retries to surface for manual inspection rather than loop forever, so that I can spend my attention where it matters.
4. As an ADW operator, I want a hung orchestrator (process alive, event loop wedged) to be automatically detected and terminated, so that a single stuck call doesn't block an issue indefinitely.
5. As an ADW operator, I want to see at a glance from the top-level state file whether an orchestrator is currently live, who owns it (pid, start-time), and when it last made progress (`lastSeenAt`), so that I can debug without spelunking into phase subdirectories.
6. As an ADW operator, I want two simultaneous cron/webhook candidates for the same issue to deterministically resolve to a single orchestrator spawn, so that I don't get two PRs or two branches competing for the same issue.
7. As an ADW developer, I want branch-name generation to be unambiguous — the LLM produces a slug, the code assembles the full name — so that no future drift between branch-name writes and branch-name reads can strand an orchestrator on a non-existent worktree.
8. As an ADW developer, I want `abandoned` to mean exactly one thing (transient, retriable failure) and `discarded` to mean the other (terminal, manual-only), so that predicates like `isRetriableStage` don't silently lie about which exits to re-spawn.
9. As an ADW developer, I want a deep `takeoverHandler` module that encapsulates the full decision tree for evaluating a candidate against an existing claim, so that cron, webhook, and resume paths all use the same logic.
10. As an ADW developer, I want worktree takeover to always start from a known-clean state that matches origin, so that half-completed phases from a dead orchestrator don't leak into a successor's history.
11. As an ADW developer, I want remote-state derivation (branch exists, PR open, PR merged, commits ahead) to be a pure function with mandatory re-verification, so that stage reconciliation is testable and doesn't flap on API read lag.
12. As an ADW developer, I want PID reuse across process restarts to be impossible to mistake for liveness, so that an orchestrator that died after a reboot doesn't look alive just because some unrelated process inherited its PID.
13. As an ADW developer, I want the coordination lock to be held by the orchestrator process itself for its full lifetime, so that contention detection is not a two-step "spawn succeeded, now check state" dance.
14. As an ADW developer, I want each entrypoint orchestrator (`adwSdlc`, `adwMerge`, `adwChore`, etc.) to get lock acquisition, heartbeat start, and cleanup wiring via a shared wrapper, so that I don't have to replicate lifecycle boilerplate in 12 places.
15. As an ADW developer, I want a paused orchestrator's resume path to verify it still owns the canonical claim before proceeding, so that the manual-edit-state or split-brain case doesn't produce two orchestrators continuing the same work.
16. As an ADW developer, I want the cron sweeper to detect `*_running` stages whose heartbeat has gone stale and forcibly abandon them, so that wedged work is reclaimable without operator intervention.
17. As an ADW developer, I want the `handleWorkflowError` shared handler to keep emitting `abandoned` (transient crash), and a separate `handleDiscarded` helper to exist for the "don't retry" paths, so that the call site's intent is explicit at the point of writing.
18. As an ADW developer, I want `discarded` issues to be filtered by the cron backlog sweeper the same way `completed` is, so that the backlog sweep does not keep re-visiting issues that were intentionally dropped.
19. As an ADW developer, I want `adwMerge`'s eight defensive-exit paths to each be classified deliberately as either retriable or terminal, so that a transient `no_pr_found` doesn't get lumped with a real `merge_failed`.
20. As an ADW developer, I want the single-host-per-repo constraint to be documented in the README and operator guide, so that a future dev setting up a laptop cron alongside the server cron has a clear warning about the failure mode.
21. As an on-call operator, I want `## Cancel` to remain the escape hatch for any situation the automation doesn't recover from, so that I always have a manual override.
22. As an ADW developer, I want deep modules — `processLiveness`, `takeoverHandler`, `remoteReconcile`, `worktreeReset` — to have their logic fully covered by unit tests using injected dependencies, so that refactors don't silently break recovery behavior.

## Implementation Decisions

**New modules to build:**

- **`processLiveness`** is a deep module exposing `getProcessStartTime(pid)` and `isProcessLive(pid, recordedStartTime)`. On Linux it reads `/proc/<pid>/stat` field 22; on other platforms it shells out to `ps -o lstart= -p <pid>`. The liveness predicate requires both `kill -0` success and an exact start-time match against the recorded value. This single module replaces all ad-hoc `isProcessAlive` calls across `spawnGate` and `agentState`.
- **`heartbeat`** is a deep module exposing `startHeartbeat(adwId, intervalMs)` returning a `HeartbeatHandle`, and `stopHeartbeat(handle)`. It owns a single `setInterval` that writes `lastSeenAt` to the top-level state file. It has no knowledge of orchestrator flow, phases, or errors — it is purely a liveness ticker.
- **`takeoverHandler`** is the deepest module and the integration point. Its public interface is `evaluateCandidate({ issueNumber, repoInfo }) → CandidateDecision` where the decision is one of: `spawn_fresh`, `take_over_adwId`, `defer_live_holder`, or `skip_terminal`. Internally it composes `spawnGate`, `processLiveness`, `agentState`, `remoteReconcile`, and `worktreeReset`. All dependencies are injected so the decision tree can be tested in isolation.
- **`remoteReconcile`** is a deep module exposing `deriveStageFromRemote(issueNumber, adwId, repoInfo) → WorkflowStage`. It reads branch existence, PR state (open/closed/merged), and most-recent activity markers from GitHub, then maps them to a `WorkflowStage`. A mandatory re-verification read occurs immediately before returning, to detect the case where the first read was stale. If re-verification diverges, the function retries up to a small bounded limit before falling back to the state-file value.
- **`worktreeReset`** is a deep module exposing `resetWorktreeToRemote(worktreePath, branch)`. It aborts any in-progress merge or rebase (`git merge --abort`, `git rebase --abort`, falling back to removing `.git/MERGE_HEAD`, `.git/rebase-apply/`, `.git/rebase-merge/` directly), runs `git reset --hard origin/<branch>`, and runs `git clean -fdx`. Unpushed local commits are explicitly discarded.
- **`hungOrchestratorDetector`** is a deep module exposing `findHungOrchestrators(now, staleThresholdMs) → HungOrchestrator[]`. It iterates top-level state files with `*_running` stages, filters to those whose PID is live but `lastSeenAt` is stale, and returns them. Side effects (SIGKILL, state write) are the caller's responsibility; the detector is a pure query.

**Modules to extend:**

- **`spawnGate`** is extended so that the lock record carries `pidStartedAt` in addition to `pid`. Liveness checks against an existing lock use `processLiveness.isProcessLive`. Lock acquisition remains `writeFileSync` with `wx` flag for exclusive create; recovery from a stale lock is force-removal after liveness check. Lock lifetime is extended: the orchestrator process itself acquires the lock on startup (immediately after state initialization) and releases it on normal exit via a `finally` block; crash recovery is handled by the PID+start-time staleness check.
- **`agentState`** is extended so that the top-level state schema gains four fields: `pid`, `pidStartedAt`, `lastSeenAt`, and `branchName` if not already present as a top-level field. The `workflowStage` type gains the value `discarded`.
- **`cronIssueFilter` and `cronStageResolver`** are extended to skip `discarded` stages the same way `completed` is skipped. The hung-orchestrator reclaim step is wired into the per-cycle cron work, so that the sweeper forcibly terminates hung workflows and rewrites their state to `abandoned` before considering retry.
- **`workflowCompletion`** keeps its existing `handleWorkflowError` emitting `abandoned`. A new `handleWorkflowDiscarded` helper is added for the explicit non-retriable exits identified in `adwMerge`.
- **`adwMerge`** has its ten direct `writeTopLevelState` call sites reclassified: `unexpected_stage`, `no_state_file`, `no_orchestrator_state`, `no_branch_name`, `no_pr_found`, and `worktree_error` write `abandoned`; `pr_closed` and `merge_failed` write `discarded`; the two `completed` writes remain unchanged.
- **`webhookHandlers`** PR-closed path writes `discarded` instead of `abandoned`.

**Shared entrypoint wiring:**

All twelve orchestrators using `handleWorkflowError` — `adwSdlc`, `adwMerge`, `adwChore`, `adwBuild`, `adwInit`, `adwPatch`, `adwPlan`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwTest` — gain lock-acquire-on-startup, heartbeat-start-on-startup, heartbeat-stop-on-exit, and lock-release-on-exit via a shared wrapper at the phase-runner or entrypoint layer. Each orchestrator does not hand-roll this lifecycle.

**Branch-name assembly:**

The `/classify` (or equivalent) LLM prompt is narrowed to produce only the semantic slug (e.g. `json-reporter-findings`, no prefix, no issue number). Branch name assembly (`feature-issue-<N>-<slug>`) moves into code in `adws/vcs/` or the classifier helper, so that no future prompt or regex drift can produce a branch name whose reads and writes disagree.

**Takeover decision tree (encoded in `takeoverHandler`):**

1. Attempt to acquire the per-issue lock via `spawnGate`.
2. If the lock is held and the holder's PID+start-time tuple is live, emit `defer_live_holder`.
3. If the lock is held by a dead process, force-remove the lock and re-attempt acquisition.
4. With the lock acquired, read the top-level state file:
   - No state file → `spawn_fresh` (no prior work).
   - `completed` or `discarded` stage → `skip_terminal`.
   - `abandoned` stage → `take_over_adwId`. Run `worktreeReset`, then `remoteReconcile` (with mandatory re-verification) to derive the current stage, then resume.
   - `*_running` stage with a live PID that was not holding the lock → SIGKILL the PID, same `take_over_adwId` path as `abandoned`.
   - `*_running` stage with a dead PID → same `take_over_adwId` path as `abandoned`.
5. `paused` stage is a no-op for the takeover handler; the pause queue scanner remains the sole resumer of paused workflows. Resume verifies canonical claim before proceeding.

**Single-host constraint:**

Documented in the README and operator guide. No code enforcement. Operators running a laptop cron alongside the production cron for the same repo are in undefined territory and the docs say so.

**Schema changes:**

The top-level state file gains `pid: number`, `pidStartedAt: string` (ISO 8601 when possible, platform string otherwise), `lastSeenAt: string` (ISO 8601), and `branchName: string`. The `workflowStage` union gains `discarded`.

**Heartbeat parameters:**

Tick interval is 30 seconds. Staleness threshold for the hung-orchestrator detector is 3 minutes (six missed ticks). Both are defined as constants in `adws/core/config` so ops can tune them without code surgery.

## Testing Decisions

A good test in this codebase exercises observable external behavior through a module's public interface, using injected dependencies in place of real I/O. Tests that inspect private state or match on specific implementation details are avoided. Prior art includes `adws/triggers/__tests__/spawnGate.test.ts`, `adws/triggers/__tests__/cronStageResolver.test.ts`, and `adws/__tests__/adwMerge.test.ts` — each constructs minimal fake dependencies and asserts on the observable return values and the set of writes issued to injected state-writer doubles.

**Modules with full unit tests:**

- **`processLiveness`** — tested with fake `/proc` reads (or a mocked `ps` child-process) covering: alive with matching start-time, alive with mismatched start-time (PID reuse), dead process, non-existent PID. Pure input-output, no side effects.
- **`takeoverHandler`** — tested with injected doubles for `spawnGate`, `agentState` reader/writer, `processLiveness`, `remoteReconcile`, and `worktreeReset`. Covers every branch of the decision tree: fresh spawn, defer on live holder, take over on abandoned, take over on dead-PID-running, SIGKILL on live-PID-no-lock, skip on terminal, skip on discarded.
- **`remoteReconcile`** — tested with injected GitHub-read doubles. Covers: branch-only → pre-PR running stage, branch+open-PR → `awaiting_merge`, branch+merged-PR → `completed`, branch+closed-PR → `discarded`, re-verification read divergence triggers retry, post-retry persistent divergence falls back to state-file value.
- **`worktreeReset`** — tested with a shell-mocking harness. Covers: clean worktree (reset is idempotent), dirty tracked files (cleared by reset), in-progress merge state (aborted before reset), in-progress rebase state (aborted before reset), untracked files (cleared by `clean -fdx`).

**Modules with contract tests only:**

- **`heartbeat`** — a thin contract test that `startHeartbeat` writes `lastSeenAt` at least once within `intervalMs * 1.5`, and that `stopHeartbeat` stops further writes. No branch coverage needed; the module has no logic.
- **`hungOrchestratorDetector`** — a contract test with an injected clock and a fixture set of state files: assert that only the ones with live PID and stale `lastSeenAt` are returned.

**Integration tests:**

Extend existing `adwMerge.test.ts` to cover the abandoned/discarded split: each of the ten `writeTopLevelState` paths asserts the correct stage value. Extend existing `cronStageResolver.test.ts` and `cronIssueFilter.test.ts` to cover `discarded` being treated as skip-terminal.

## Out of Scope

- **`adwPrReview`** — keyed by PR number, has no top-level state, runs outside the backlog sweeper. Its own dedup (`processedPRs` in-memory) is acceptable for its lifecycle length.
- **`adwClearComments` and `adwDocument`** — utility scripts without workflow-stage interaction.
- **Worktree pruning** (the stranded-worktree cleanup idea in the memory notes) — adjacent concern, separate work item.
- **Migration of existing in-flight issues** — scrapped per operator preference. Issue #8 is handled manually; all other non-terminal state files have completed siblings and don't block new work.
- **Canonical-registration comment protocol** — explored in depth during design, rejected in favor of extended file-lock + state-file truth once the single-host-per-repo invariant was accepted.
- **Cross-host coordination** — deployment-level constraint, not code-level. The single-host convention is documented but not enforced.
- **Hard timeouts per phase** — the heartbeat + hung-detector recovery path covers wedged processes; additional per-phase hard caps are not introduced.

## Further Notes

- The `paused` stage intentionally remains a no-op for the takeover handler. The pause queue scanner is the sole resumer of paused workflows, consistent with the existing cron filter behavior that skips `paused` stages.
- The `abandoned` → `discarded` split is a semantic reclassification at the call sites; it does not introduce a migration. Existing state files that currently read `abandoned` will continue to be treated as retriable, matching their original intent for the crash/merge-defensive cases. Only new writes use the new classification.
- The PID+start-time tuple is platform-sensitive. On Linux we prefer `/proc/<pid>/stat` for speed and determinism; on macOS and BSD we fall back to `ps -o lstart=`. Windows is not supported by ADW today and the `processLiveness` module does not attempt to handle it.
- The heartbeat write to the state file is intentionally a top-level field write, not a separate file, to keep the number of files per orchestrator bounded. The write is atomic via the existing `AgentStateManager.writeTopLevelState` pattern.
- The existing `cronProcessGuard` (preventing two cron processes per repo on the same host) is unchanged. This PRD's lock changes are scoped to per-issue orchestrator coordination, not cron-process coordination.
- Operator escape hatches (`## Cancel` comment, manual state-file edit) remain functional and are documented as the last-resort recovery path.
