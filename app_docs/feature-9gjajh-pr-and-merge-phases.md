# PR and Merge Phases

## Overview

These phases manage the end of a workflow's build lifecycle: creating a pull request from the worktree branch, addressing unaddressed review comments on an open PR, and automatically merging an approved PR. A single issue accumulates exactly one adwId across both its SDLC and PR-review runs — `resolvePrReviewTarget` decides whether a PR-review run reuses the issue's existing adwId, mints a fresh one, or is skipped because the PR isn't issue-linked — and `decidePostReviewOutcome` drives the terminal handoff after a review cycle: `awaiting_merge` on a passed review, or the human-gated `review_failed` stage on exhaustion, mirrored on both the PR-review and SDLC orchestrators.

## Responsibilities

- `executePRPhase`: commits any lingering uncommitted changes, generates a PR title and body via the `/pull_request` agent, pushes the branch, creates the PR via `CodeHost.createPullRequest()`, and moves the issue to the Review board status.
- `initializePRReviewWorkflow`: bootstraps a PR review run — fetches PR details, checks for unaddressed comments, creates a worktree on the PR's head branch, writes orchestrator state, allocates a dev-server port, and constructs a `PRReviewWorkflowConfig`. Takes `adwId` as a required parameter and never generates one itself; identity is always resolved upstream before this function runs.
- `resolvePrReviewTarget(pr, deps)` (`adws/core/resolvePrReviewTarget.ts`): pure resolver with injected deps (`fetchIssueComments`, `generateAdwId`). Given a PR's linked issue number, returns a discriminated union: `reuse` (issue-linked, reuses the latest adwId found in the issue's comments), `fresh` (issue-linked, no adwId yet — generates one), or `skip` (not issue-linked — no ADW review/auto-merge).
- `resolvePrReviewSpawn(prNumber, repoInfo)` (`adws/triggers/webhookHandlers.ts`): the impure caller of `resolvePrReviewTarget` — fetches PR details, and on the `fresh` path seeds the new adwId's top-level state (`{ adwId, issueNumber, branchName, orchestratorScript: 'adws/adwPrReview.tsx' }`) before returning `{ issueNumber, adwId }`; returns `null` on `skip`. Used by the cron's PR review-comment check and both webhook PR-review spawn sites, so `initializePRReviewWorkflow` always receives an already-resolved `adwId`.
- `executePRReviewPlanPhase`: reads the existing plan file (or falls back to the PR body), runs the PR review plan agent, and posts stage comments on the PR.
- `executePRReviewBuildPhase`: runs the PR review build agent with the plan output and posts stage comments.
- `executePRReviewCommitPushPhase`: commits all changes, pushes the branch, and moves the linked issue to Review.
- `completePRReviewWorkflow` (`adws/phases/prReviewCompletion.ts`): computes the terminal handoff via `decidePostReviewOutcome` and writes it to top-level state — `awaiting_merge` on a passed review, `review_failed` on exhaustion — co-stamped with `orchestratorScript: 'adws/adwPrReview.tsx'`.
- `decidePostReviewOutcome(reviewPassed)` (`adws/phases/decidePostReviewOutcome.ts`): pure, total gate consumed by `completePRReviewWorkflow`; maps the boolean review result to a `PostReviewOutcome` (`workflowStage`, `writeAwaitingMerge`, `skipDocAndPR`).
- `executeSdlcReviewFailedHandoff` (`adws/phases/sdlcReviewHandoff.ts`): the SDLC-side mirror — called by `adwSdlc.tsx` when `decidePostReviewOutcome` returns `skipDocAndPR: true`; writes `workflowStage: 'review_failed'` to top-level state and posts the branch/retry issue comment, giving SDLC runs the same human-gated stop as PR-review runs.
- `executeAutoMergePhase`: reads PR approval state from GitHub; if no approval is found, applies the `hitl` label and posts a one-time comment; if approved, calls `mergeWithConflictResolution` (up to `MAX_AUTO_MERGE_ATTEMPTS` attempts) and posts a failure comment if merging cannot complete. Merge failures are non-fatal.

## Contracts & Invariants

- `executePRPhase` commits any uncommitted changes before creating the PR, so the PR always reflects the full worktree state.
- `initializePRReviewWorkflow` exits the process immediately (`process.exit(0)`) when the PR is already CLOSED or MERGED, or when no unaddressed comments exist. The empty-comments exit is bypassed only in genuine resume mode — `isResumeMode` is evidence-based (`!!existingState?.phases && Object.keys(existingState.phases).length > 0`), so a fresh trigger-seed (which writes `branchName` but no `phases`) still hits the exit correctly.
- `resolvePrReviewTarget` is pure: no I/O, no side effects. `issueNumber === null` → `skip`; issue-linked + existing adwId → `reuse`; issue-linked + no adwId → `fresh`. Neither `fetchIssueComments` nor `generateAdwId` is called on the `skip` path. It shares `extractLatestAdwId` (`adws/core/workflowCommentParsing.ts`) — the same "newest-to-oldest scan of issue comments for an adwId" used by the cron's stage resolver — one implementation, two consumers, so a reused adwId is always the true latest.
- One adwId per issue: an issue that pre-dates this resolver and carries multiple adwIds self-heals to a single one after one PR-review cycle, since `reuse` always picks the latest.
- On the `fresh` path, `resolvePrReviewSpawn` writes `{ adwId, issueNumber, branchName, orchestratorScript }` to the new adwId's top-level state before spawning; on the `reuse` path it writes nothing, relying on the reused adwId's state already carrying `branchName` from its original SDLC run.
- An issue-less PR (`skip`) is a silent, clean no-op: no spawn, no worktree, no log directory.
- `decidePostReviewOutcome` is total and pure: `true` → `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge', skipDocAndPR: false }`; `false` → `{ writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true }`. `completePRReviewWorkflow`'s `outcome` parameter defaults to `decidePostReviewOutcome(false)`, so an inert call still lands on the safe `review_failed` path.
- `completePRReviewWorkflow` writes the terminal stage whenever `outcome.workflowStage` is non-null — both the pass and fail paths reach the write — and every such write includes `orchestratorScript: 'adws/adwPrReview.tsx'`, which is what lets a later `## Retry` resolve back to this orchestrator (`resolveResumeSpawn`, see `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`) instead of defaulting to SDLC.
- `executeAutoMergePhase` silently skips (no comment) when the `hitl` label is already present, preventing comment floods on repeated cron re-entries.
- The `hitl` label is applied and a comment is posted at most once per unapproved PR cycle; subsequent cron entries hit the silent-skip path.
- Merge failures do not propagate as thrown errors — the phase always returns successfully.
- `PRReviewWorkflowConfig.base` conforms to `WorkflowConfig`, allowing PR review phases to reuse the same phase helpers as standard workflows: PR-specific fields (`prNumber`, `prDetails`, `unaddressedComments`) live alongside `base`, and generic `WorkflowConfig`-typed phases (e.g. scenario/test phases) are invoked with `config.base`.

## Configuration

GitHub App authentication is activated at the start of `initializePRReviewWorkflow` via `activateGitHubAppAuth`. The `repoContext` is created from a `RepoIdentifier`; when it cannot be created, the phase falls back to direct `gh` CLI calls. `MAX_AUTO_MERGE_ATTEMPTS` is read from `core` constants.

## Gotchas

- `executePRPhase` uses `repoContext.codeHost.createPullRequest()` when a `repoContext` is available; without one it only logs the generated PR content and does not create a PR.
- `extractPrNumber` in `autoMergePhase` parses the PR number from `ctx.prUrl`; the phase exits as a no-op when the URL is absent or unparseable.
- `approvePR` (called upstream by the merge orchestrator, not by these phases) uses a PAT-swap to work around GitHub's rule that an actor cannot approve their own PR.
- `inferIssueTypeFromBranch` is called in the commit-push phase to classify the issue type from the branch name prefix because the PR review workflow does not carry the original `issueType`.
- `resolvePrReviewSpawn` must not be called from `adws/core/`: it does I/O (`fetchPRDetails`, `fetchIssueCommentsRest`, `writeTopLevelState`). It lives in `adws/triggers/webhookHandlers.ts`; the pure `resolvePrReviewTarget` lives in `adws/core/`.
- `completePRReviewWorkflow` writes to two distinct files: the execution/log state at `orchestratorStatePath`, and the terminal stage + `orchestratorScript` to the top-level state file (`agents/<adwId>/state.json`). Neither write substitutes for the other.
- Phase functions written for generic workflows (e.g. `executeScenarioTestPhase`) are typed for `WorkflowConfig`, not `PRReviewWorkflowConfig` — call sites must pass `config.base`.
- `executeSdlcReviewFailedHandoff` is extracted into its own module (`sdlcReviewHandoff.ts`) rather than inlined in `adwSdlc.tsx`'s `main()`, so BDD scenarios can drive the SDLC review-failed handoff without spawning a full orchestrator subprocess. Unlike `completePRReviewWorkflow`, it does not co-stamp `orchestratorScript` — SDLC doesn't need it there because SDLC's own init already persists `orchestratorScript: 'adws/adwSdlc.tsx'`.
- The `review_failed` terminal comment carries the branch name and a `## Retry` instruction (`formatReviewFailedComment` in `adws/github/workflowCommentsIssue.ts`) so operators know where to push a fix; a legacy `review_failed` state that predates `orchestratorScript` being persisted has no way to route a `## Retry` back to PR-review and falls back to SDLC.
