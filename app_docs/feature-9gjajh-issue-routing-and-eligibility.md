# Issue Routing and Eligibility

## Overview

This module determines whether an issue is eligible for ADW processing and routes it to the correct workflow. It covers dependency resolution, concurrency gating, the `issues.opened` label-routing path, the auto-merge retry loop, the `## Cancel` directive handler, and the 14-day per-issue scenario retention sweep.

## Responsibilities

- `parseDependencies`: extracts issue numbers from a `## Dependencies`, `## Depends on`, or `## Blocked by` section in an issue body. Matches `#N` references and full GitHub issue URLs.
- `parseKeywordProximityDependencies`: extends `parseDependencies` by also scanning the entire body for `#N` references preceded within 80 characters by a dependency keyword (`blocked by`, `depends on`, `requires`, etc.).
- `extractDependencies`: the full extraction pipeline — cache check first, then keyword proximity, then LLM fallback when the proximity parser finds fewer references than the total `#N` count in the body.
- `findOpenDependencies`: calls `extractDependencies` then checks each dependency's state via `getIssueState`; unknown states are treated as OPEN (fail-closed).
- `checkIssueEligibility`: combines `findOpenDependencies` and `isConcurrencyLimitReached` into a single `EligibilityResult`; dependencies are checked first.
- `decideIssueOpenedRoute`: pure function — maps an `AdwLabelReading` to one of `opt_out`, `conflict`, `classified`, or `infer`.
- `extractPayloadLabelNames`: defensively extracts label names from a raw webhook issue payload object.
- `routeIssueOpened`: the DI-orchestrated `issues.opened` handler — calls `decideIssueOpenedRoute`, then `checkEligibility`, then `classifyAndSpawn` with the appropriate label routing.
- `mergeWithConflictResolution` (`autoMergeHandler`): retries merge up to `MAX_AUTO_MERGE_ATTEMPTS`; for each attempt, dry-run checks for conflicts, invokes the `/resolve_conflict` agent when conflicts are detected, pushes the branch, and calls `mergePR`; stops early on non-conflict merge failures.
- `handleCancelDirective` (`cancelHandler`): scorched-earth cancel — extracts all adwIds from comments, SIGTERMs then SIGKILLs orchestrator processes, removes worktrees, deletes agent state directories, clears GitHub comments, and removes the issue from cron dedup sets.
- `runPerIssueScenarioSweep` (`perIssueScenarioSweep`): the 14-day per-issue scenario retention sweep. Lists tracked `features/per-issue/feature-{N}.feature` files, resolves each issue's linked-merged-PR date, and batches a file plus its `step_definitions/feature-{N}.*` siblings for removal once `isScenarioStale` (a pure age-only predicate: `now - mergedAt >= RETENTION_DAYS * 86_400_000`, `RETENTION_DAYS = 14`) returns true — unless the file is promotion-exempt. Listing, staleness reads, and the removal all run against a dedicated `SweepBase` (`adws/triggers/perIssueSweepPersist.ts`) — a worktree synced to fresh `origin/<default>` — never the cron host's own, possibly stale, base checkout; the base is lazily created at most once per call and only when a base-dependent default actually runs.
- Promotion-awareness gate: for each age-stale file only, reads its content (from the synced sweep worktree) and calls `parsePromotionTagState` / `isPromotionExempt` from `adws/core/promotionTagState.ts` — a file tagged `@promotion-suggested-<date>` is kept (skipped), while `@promotion-declined` or untagged files are swept normally. An unreadable stale file is also skipped rather than deleted with unknown promotion state.
- `prepareSweepBase` / `persistRemovalViaPr` / `cleanupSweepBase` (`perIssueSweepPersist`): the sweep's persistence orchestration. `prepareSweepBase` creates a dedicated worktree off fresh `origin/<default>` via `GitContext.createWorktreeForNewBranch(SWEEP_BRANCH, defaultBranch)` (`SWEEP_BRANCH = 'chore/scenario-sweep'`), returning `null` (logged) on any resolution failure so the sweep degrades to a no-op for that cycle. `persistRemovalViaPr` commits the removal batch on that dedicated branch, pushes it, opens a PR into the default branch (guarded by an existing-open-PR idempotency check via `defaultFindPRByBranch`), and immediately merges it (mirrors `adwUpgrade`'s non-SDLC dedicated-branch → PR → immediate-merge pattern) — never a direct commit/push onto the shared default branch. `cleanupSweepBase` best-effort deletes the remote sweep branch and local worktree after every run.

## Contracts & Invariants

- `parseDependencies` only returns issue numbers from the heading section; `parseKeywordProximityDependencies` is a superset.
- The in-memory dependency cache is keyed by `issueNumber:sha1(body)[:12]`; a body change invalidates the cache entry.
- `findOpenDependencies` is fail-closed: any error fetching a dependency's state causes that dependency to be treated as OPEN and block the issue.
- `checkIssueEligibility` returns `open_dependencies` before `concurrency_limit` — dependency checks gate concurrency checks, not the other way around.
- `decideIssueOpenedRoute` precedence: `opt_out` > `conflict` > `classified` > `infer`. Opt-out is unconditional.
- When `route.kind === 'conflict'`, `routeIssueOpened` posts a `MULTI_LABEL_REFUSAL_COMMENT` and returns `refused_multi_label` — no spawn occurs.
- When `route.kind === 'infer'`, `classifyAndSpawn` is called with `persistInferredLabel: true` so the LLM-inferred classification label is written back to the issue for cron label-recovery.
- `mergeWithConflictResolution` stops the retry loop immediately on a non-conflict merge error (e.g. permissions, already merged); it only retries on conflict-related errors.
- `handleCancelDirective` is synchronous (uses a spin-wait for SIGKILL timing) and returns `true` even when individual steps fail — all errors are logged and execution continues to subsequent steps.
- `isScenarioStale` stays pure and age-only; promotion-state exemption is a separate, orthogonal gate checked only after a file is already found age-stale, so fresh (non-stale) files never trigger the extra content read.
- Promotion-tag parsing considers only Gherkin *tag lines* (every whitespace-separated token starts with `@`) — a Feature description or step that merely mentions `@promotion-suggested-…` or `@promotion-declined` as prose is not matched, so it can't produce a false exemption.
- `@promotion-declined` is terminal and wins over a lingering `@promotion-suggested-<date>` if both markers are present on the same file (a malformed/partially-written file resumes the normal TTL rather than being exempt forever).
- A stale file whose content can't be read is skipped (not deleted) — this mirrors `getMergedAt` returning `null` (also "don't delete") and self-heals on the sweep's next cycle.
- The sweep never commits a removal to the cron host's own base checkout (`frameworkRepoRoot` is never `reset --hard`) and never pushes the default branch directly — both the lease-rejected-push and stranded-local-commit failure modes are structurally ruled out.
- Because the removal is committed only on the dedicated `chore/scenario-sweep` branch — never to the local base — a push/PR/merge failure never removes the files from the index `defaultListFeatures` re-lists from; the still-open PR (found by `findOpenSweepPr`) is the retry/idempotency signal across sweep cycles, not a re-committed local state.
- `persistRemovalViaPr` never throws: a push/PR/merge failure is logged at `error` (not swallowed at `warn`) and the function returns, leaving the PR open (if one was opened) for the next cycle or a human/CI to merge.
- The sweep worktree/branch is best-effort pre-cleaned at the start of `prepareSweepBase` (via `ctx.removeWorktree`) and torn down via `cleanupSweepBase` in a `finally` on every exit path of `runPerIssueScenarioSweep`, so a stale worktree from an interrupted prior cycle never blocks the next one.

## Configuration

`MAX_AUTO_MERGE_ATTEMPTS` is a core constant. The LLM fallback in `extractDependencies` calls `runDependencyExtractionAgent` which uses the standard agent infrastructure (logs dir, state path). `DEPENDENCY_KEYWORDS` is a module-level constant array. The `routeIssueOpened` DI deps default to production implementations via `buildDefaultIssueOpenedRouterDeps`. `RETENTION_DAYS = 14` gates the per-issue scenario sweep. `SWEEP_BRANCH = 'chore/scenario-sweep'` (`perIssueSweepPersist.ts`) is the stable dedicated branch the sweep removal is pushed to and PR'd from; `SWEEP_COMMIT_MESSAGE = 'chore: sweep stale per-issue scenarios (>14d post-merge)'` is unchanged from the pre-#758 direct-commit message.

## Gotchas

- The LLM fallback in `extractDependencies` is triggered only when `totalRefs > 0 && proximityDeps.length < totalRefs` — it is not called when the body has no `#N` references at all, or when the proximity parser found as many as there are total references.
- `syncWorktreeToOriginHead` in `mergeWithConflictResolution` pulls `origin/<headBranch>` into the worktree before the conflict check so the local and remote views are in sync; failures are logged as warnings and the loop proceeds.
- `checkMergeConflicts` does a real `git merge --no-commit --no-ff` and then calls `git merge --abort`; if the abort itself fails (already clean), the exception is swallowed.
- `handleCancelDirective` uses a synchronous spin-wait (busy loop for 500 ms) between SIGTERM and SIGKILL — this is intentional because cancel is a rare manual operation and the context does not support async waits.
- `resolveConflictsViaAgent` starts the actual merge (with conflict markers) before invoking the agent; if the merge happens to succeed cleanly (no conflict), the function returns true immediately without calling the agent.
- The `MULTI_LABEL_REFUSAL_COMMENT` references the CRON recovery layer as the mechanism that picks up the issue after label cleanup — this relies on `evaluateLabelRecovery` in the cron filter.
- The promotion-tag parser/serializer (`parsePromotionTagState`, `serializePromotionTagState`, `isPromotionExempt`) lives in `adws/core/promotionTagState.ts` as a dependency-free pure module (no fs/git/gh imports) so it is unit-testable in isolation from the sweep's I/O; only `parsePromotionTagState`/`isPromotionExempt` are wired into the sweep today — `serializePromotionTagState` is built and unit-tested for a later automated promotion-sweep slice that will write the marker, and is not yet called from any production writer.
