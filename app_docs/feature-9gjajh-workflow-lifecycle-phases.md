# Workflow Lifecycle Phases

## Overview

This module covers the cross-cutting phases that govern the start, end, and structural integrity of every ADW orchestrator run: initialization (worktree setup, launch-boundary/forge-provider resolution, branch-name and ADW-ID recovery, and the framework upgrade gate), completion (including pause and error handling), the per-issue spawn lock, and the build progress backstop.

## Responsibilities

- `initializeWorkflow`: pre-flight checks Claude CLI presence, activates GitHub App auth, fetches and classifies the issue, resolves the ADW ID (including the branch-identity recovery fallback below), creates or reuses a worktree, creates `RepoContext`, runs the upgrade gate for target-repo workflows, initializes orchestrator and top-level state files, reads any previously completed phases for pause/resume, allocates a dev-server port, and returns a fully populated `WorkflowConfig`.
- `initializeWorkflow` constructs exactly one `LaunchBoundary` per orchestrator process (`buildLaunchBoundary`) — a `GitContext` plus the forge provider pair (`IssueTracker`/`CodeHost`) bound to the same repo identity. `resolveWorkflowProviders(boundary, callerRepoId?)` is the sole authority for which `RepoIdentifier`/`BoundProviders` pair the resulting `RepoContext` uses, and `bindWorkspaceContext(boundary, worktreePath, repoId)` (`adws/core/launchGitContext.ts`) builds that `RepoContext`. Every downstream phase reaches issue/PR/label/board operations through this provider pair, never through a forge-semantic call on a bare `GitContext`.
- `completeWorkflow`: writes final state (`completed`), posts a completion comment, and logs the banner.
- `handleRateLimitPause`: records completed phases, enqueues the workflow in the pause queue, posts a paused comment, and calls `process.exit(0)`.
- `handleWorkflowError`: posts an error comment, writes `abandoned` state, moves the issue to Blocked, and calls `process.exit(1)`.
- `handlePhaseTimeout`: posts a timeout comment, writes `phase_timeout` state, and calls `process.exit(0)`.
- `handleWorkflowDiscarded`: writes `discarded` state, posts a discard comment, moves to Blocked, notifies HITL board, and calls `process.exit(0)`.
- `runUpgradeGate`: compares the framework hash against the stored `.adw-version`; on mismatch, atomically claims the upgrade (or attaches to an existing one), parks the current issue with a dependency on the upgrade tracking issue, and returns `{ action: 'parked' }`. On match returns `{ action: 'proceed' }`. Runs after the target repo workspace is resolved but before feature-worktree setup, so a loser parks without ever creating a throwaway worktree; `buildDefaultUpgradeGateDeps(providers, worktreePath, gitCtx)` sources every forge dependency from the provider pair and derives its own git-show thunk from the passed `GitContext`.
- `acquireOrchestratorLock` / `releaseOrchestratorLock` / `runWithOrchestratorLifecycle`: wrap a workflow fn with a per-issue spawn lock and a heartbeat so hung-orchestrator detection and takeover work correctly.
- `evaluateProgressGate`: pure function that decides whether a build batch should continue, abort due to no progress (worktree returned to a previously seen state), or abort due to backstop (checkpoint ceiling exhausted).
- `resolveWorkflowBranchName`: resolves a branch name in priority order — persisted state, recovery comment, deterministic identity fallback, LLM generation — and persists the result immediately so the LLM is called at most once per ADW ID.
- Deterministic branch-identity predicates (`adws/vcs/branchIdentity.ts`): `deterministicBranchName(classifier, issueNumber)` returns `{prefix}-issue-{N}`; `branchMatchesIssue(branchName, classifier, issueNumber)` returns `true` when a branch belongs to the issue under a given classifier, ignoring the slug tail but exact on prefix and issue-number boundary.
- Identity-recovery helpers (`adws/phases/branchIdentityFallback.ts`): `findExistingBranchForIssue` scans local branches and worktrees for a slug-agnostic match to an issue; `recoverAdwIdForBranch` reverse-looks-up the owning `adwId` from `agents/<adwId>/state.json` by persisted `branchName`, tie-breaking on most-recently-active.
- ADW-ID recovery in `initializeWorkflow`: when `adwId` is absent and `recoveryState.adwId` is `null`, attempts `findExistingBranchForIssue` + `recoverAdwIdForBranch` before falling back to `generateAdwId` — issue classification runs first so this fallback has the `issueType` it needs.
- `handleAuthRequiredPause`: writes an auth gate file, marks state as `paused_auth`, and exits 0.

## Contracts & Invariants

- `initializeWorkflow` aborts with `process.exit(0)` when the upgrade gate parks the issue; no workflow comments are posted for parked issues.
- `initializeWorkflow` throws if `buildLaunchBoundary` did not produce a boundary — unreachable in production, since the boundary and the `GitContext` used earlier for auth are built from the same identity resolution and credential probe; this guards only against a test fixture that mocks one but not the other.
- `resolveWorkflowProviders` throws when a caller-supplied `repoId` names a different repository than the launch boundary, rather than silently minting a second, ad-hoc provider set — a wrong-repo call fails closed instead of operating on the wrong repo's issues/PRs.
- `handleWorkflowError` is a `never` — it always calls `process.exit(1)`.
- `handleRateLimitPause`, `handlePhaseTimeout`, `handleWorkflowDiscarded`, and `handleAuthRequiredPause` are also `never` — they always call `process.exit(0)`.
- The spawn lock is held for the full orchestrator lifetime; abnormal-exit paths (error/discard/pause) call `process.exit` synchronously, so the lock file is left on disk and reclaimed on the next cycle by staleness detection.
- `evaluateProgressGate` is pure — it never mutates its inputs and has no I/O. The caller updates `seen` and `checkpointCount` based on the returned decision.
- `resolveWorkflowBranchName` aborts with an error if the LLM-generated name disagrees with a concurrently written persisted value (race-condition guard for issue #524).
- The LLM branch-name agent is invoked at most once per `adwId` — a persisted name wins unconditionally on re-entry, and the deterministic-branch fallback is reached only when both `adwId` and `recoveryState.adwId` are absent, so the normal comment-recovery path is byte-for-byte unchanged.
- `branchMatchesIssue` is exact on issue-number boundary: `feature-issue-641` matches issue 641 but `feature-issue-64` and `feature-issue-6411` do not. A re-classification that changes the prefix (e.g. `/feature` → `/bug`) produces no match, so resolution falls through to LLM generation — a new branch is the intended outcome.
- When the deterministic fallback finds a branch but no owning `adwId` can be reverse-looked-up, the branch is still reused while `adwId` falls back to fresh-mint (best-effort).
- `resolveWorkflowBranchName` is the only production entry point for branch-name resolution; `_resolveWorkflowBranchNameForTest` is `@internal` and injects agent/finder fakes for unit tests.
- `shouldTriggerUpgrade` treats a missing `.adw-version` file (null) identically to a hash mismatch — both paths enter the upgrade flow.
- The upgrade-gate claim push targets the target repo's branch namespace, not the framework repo: `buildDefaultUpgradeGateDeps` is built from the target workspace's `GitContext`, so callers must pass the target clone root, not a feature worktree path.
- `addDependencyToBody` is idempotent: it inserts `- #N` into the first of `## Dependencies` / `## Blocked by` / `## Depends on` sections (case-insensitive), appends a new `## Blocked by` section if none exists, and is a no-op if the reference is already present.
- If the upgrade-gate loser calls `findOpenUpgradeIssue` before the winner has created its `#UPG` issue, it gets `null` and parks with `upgradeIssueNumber: null` (no body edit); the dependency is registered by the next cron sweep once `#UPG` exists.
- The `completedPhases` field on `WorkflowConfig` is populated from the top-level phases map (new format) with a fallback to legacy metadata; this is what the orchestrators use to skip already-finished phases on resume.

## Configuration

- `GITHUB_PAT` must be set when a GitHub App is configured — `initializeWorkflow` throws at startup if it is missing.
- `HEARTBEAT_TICK_INTERVAL_MS` controls the heartbeat cadence during `runWithOrchestratorLifecycle`.
- The upgrade gate is only run for `targetRepo` workflows; self-hosted framework runs skip it.
- The progress gate's `maxContextResets` and `maxCheckpoints` are caller-supplied constants from `core`.

## Gotchas

- Board setup in `initializeWorkflow` is fire-and-forget (`Promise.resolve().then(...)`) — board errors are logged as warnings and do not block the workflow.
- `findWorktreeForIssue` is skipped when a persisted branch name exists to prevent adopting a sibling worktree's branch (issue #524).
- The branch name does not embed the `adwId`: `generateBranchName`/`runGenerateBranchNameAgent` produce `{prefix}-issue-{N}-{slug}`, so recovering the `adwId` for a branch is a reverse-lookup over `agents/<adwId>/state.json` by persisted `branchName`, never branch-string parsing.
- `branchMatchesIssue` accepts both the canonical prefix and its `branchPrefixAliases` entries (e.g. `feat-issue-641-x` matches `/feature`), mirroring `findWorktreeForIssue`'s own alias handling.
- Multiple `adwId`s can end up persisting the same `branchName` after a state-aliasing incident; `recoverAdwIdForBranch` breaks ties by most-recently-active, with `null` activity sorting last.
- An empty `AGENTS_STATE_DIR` or missing state files make `recoverAdwIdForBranch` return `null` gracefully — the fallback continues to a fresh `generateAdwId`, it does not throw.
- The upgrade gate deliberately reads the remote `.adw-version` (`origin/<defaultBranch>:.adw-version`) rather than the local worktree file — a reused worktree's local copy can lag arbitrarily behind the remote, which would otherwise produce false hash mismatches. Moving the gate to run after worktree setup would reintroduce that bug.
- The upgrade gate's `spawnUpgradeOrchestrator` dep resolves relative script paths against REPO_ROOT, so the upgrade spawn works even from a target-repo worktree.
- `initializeWorkflow`'s call into `ensureTargetRepoWorkspace` passes `() => boundary.providers.codeHost.getDefaultBranch()` as a lazy thunk, not a pre-evaluated value — the thunk is only safe to invoke once the workspace is already cloned.
- `handleWorkflowDiscarded`'s board/Slack notification (`notifyBlockedTransition`) is gated on `repoContext.repoId.platform === Platform.GitHub` and reached directly through `adws/github/hitlBoardNotifier`, not through the `IssueTracker`/`CodeHost` provider pair — it is a deliberately unmigrated, GitHub-specific notification path.
- `markStatePausedAuthForLiveOrchestrator` is called by the cron's auth-gate tick path (SIGTERM sweep) to update state without firing workflow comments.
- `describeProgressGateAbort` returns distinct messages for `no_progress` and `backstop` because the corrective actions are opposite — no-progress requires issue redesign while backstop requires splitting the issue.
