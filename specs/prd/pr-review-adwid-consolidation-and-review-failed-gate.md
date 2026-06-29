# PRD: PR-review adwId consolidation + `review_failed` blocking gate

## Problem Statement

When an ADW-managed PR accumulates work after its original SDLC run — most commonly because a human leaves a review comment that triggers a PR-review run — the issue can get permanently stuck: ADW neither merges it nor makes any further progress, and no human is alerted that it is stuck.

Concretely (the #712 / PR #715 incident): the SDLC orchestrator finished and left the issue at `awaiting_merge`. A human review comment then triggered one or more PR-review runs. Each PR-review run minted its **own** new adwId and ended at an inert terminal stage. Because the cron resolves "which adwId owns this issue" from the **newest** comment, it began reading the PR-review adwId's state — which was not `awaiting_merge` — so it stopped dispatching the merge orchestrator entirely. The original `awaiting_merge` survived only under the older, now-shadowed adwId. The PR sat approved-and-ready but unmerged until a human manually invoked the merge orchestrator against the right adwId.

Two distinct defects underlie this:

1. **No hand-off from PR-review back to the merge path.** PR-review was built before the auto-merge / `awaiting_merge` hand-off model existed. It never writes `awaiting_merge`, so even when it finishes cleanly, nothing tells cron the PR is ready to merge.
2. **Fragmented identity.** Every PR-review run creates a fresh adwId, so a single issue accumulates multiple adwIds with scattered state, logs, and comment threads — which is both what shadows the merge signal and what made the incident hard to diagnose.

Separately, the team discovered an unexpected behavior while investigating: when the SDLC review-retry loop is **exhausted with unresolved blockers**, the orchestrator does **not** block — it creates the PR and hands off to `awaiting_merge` anyway. The only thing preventing a bad merge is that the PR is left unapproved (approval is gated on review passing) plus branch protection / the `hitl` gate. There is no explicit "this failed review, stop and ask a human" state.

## Solution

Three changes, deliverable as independent slices:

1. **PR-review hands off to the merge path.** On a clean PR-review run, write `awaiting_merge` (gated on the review actually passing) so cron's existing merge dispatch picks it up — exactly as the SDLC orchestrator does. This alone fixes the stuck-state class.

2. **Introduce an explicit `review_failed` blocking stage.** When either orchestrator exhausts its review-retry budget with blockers still unresolved, it writes a new `review_failed` workflow stage instead of proceeding. `review_failed` is treated like the existing human-gated stages: cron never auto-spawns or auto-merges it; it is recoverable only by a human posting `## Retry`, which re-runs the review. On the SDLC path, review failure additionally skips document + PR creation (no PR exists until review passes). This matches the long-standing operator expectation that an exhausted review blocks the issue rather than silently shipping it.

3. **Consolidate to one adwId per issue.** PR-review discovers and reuses the issue's existing adwId rather than minting a new one, so all work for an issue lives under a single adwId with one state/log/comment home. This permanently removes the shadowing failure mode and is a prerequisite for routing a `review_failed` `## Retry` back to the *correct* orchestrator (PR-review vs SDLC), since the two do fundamentally different work.

## User Stories

1. As an ADW operator, I want a PR-review run that finishes cleanly to automatically hand the PR off to the merge path, so that an addressed PR actually merges instead of sitting stuck.
2. As an ADW operator, I want the merge to happen via the existing cron merge dispatch, so that no new merge mechanism is introduced.
3. As an ADW operator, I want PR-review to write `awaiting_merge` only when the review actually passed, so that a PR with unresolved blockers is never auto-merged.
4. As an ADW operator, I want an exhausted SDLC review to block the issue in a `review_failed` state, so that broken work is not silently shipped.
5. As an ADW operator, I want an exhausted PR-review review to block the PR in a `review_failed` state, so that a PR that still has blockers is not auto-merged.
6. As an ADW operator, I want a `review_failed` issue to never be auto-spawned or auto-merged by cron, so that it cannot enter an unattended, money-burning re-run loop.
7. As an ADW operator, I want to recover a `review_failed` issue by posting `## Retry`, so that after I push a fix the review re-runs without manual orchestrator invocation.
8. As an ADW operator, I want `## Retry` on a `review_failed` issue to re-run the **review** specifically (not silently merge), so that the fix is verified before merge.
9. As an ADW operator, I want a `review_failed` SDLC run to skip document + PR creation, so that no PR exists until the work actually passes review.
10. As an ADW operator, I want `## Retry` to resume the **same orchestrator** that produced the failure (PR-review for a PR-review failure, SDLC for an SDLC failure), so that the human's review-comment intent is not dropped by resuming the wrong workflow.
11. As an ADW operator, I want all work for one issue to live under a single adwId, so that state, logs, and comment threads are not fragmented across runs.
12. As an ADW operator, I want PR-review to reuse the issue's existing adwId rather than mint a new one, so that the merge signal can never be shadowed by a newer adwId.
13. As an ADW operator, I want PR-review to discover the issue's adwId using the same resolver cron uses (latest adwId in the **issue's** comments), so that PR-review and cron never disagree about which adwId owns the issue.
14. As an ADW operator, I want PR-review to fall back to generating a fresh adwId only when no existing one is found, so that genuinely new work still gets an identity.
15. As an ADW operator, I want PR-review to operate only on issue-linked PRs, so that the `(issueNumber, adwId)` identity contract always holds.
16. As an ADW operator, I want issue-less human PRs to be left alone (no ADW review/auto-merge), so that ADW does not act on PRs it cannot key to an issue.
17. As an ADW maintainer, I want the post-review outcome decision encapsulated in one tested function shared by both orchestrators, so that the gate behaves identically everywhere.
18. As an ADW maintainer, I want the resume-spawn routing (which orchestrator + which args for a given adwId's state) encapsulated in one tested function, so that the takeover/`phase_timeout`/auth-queue paths stop hardcoding the SDLC orchestrator.
19. As an ADW maintainer, I want `review_failed` classified into the cron-excluded human-gated class with an explicit test, so that a future refactor cannot accidentally make it auto-spawnable.
20. As an ADW operator, I want a `review_failed` SDLC issue (which has no PR yet) to carry a comment pointing at its branch, so that I can inspect and push a fix before posting `## Retry`.

## Implementation Decisions

**New / changed workflow stage**
- Add a `review_failed` stage to the workflow stage taxonomy. Classify it into the same cron-excluded, human-gated class as `merge_blocked` / `human_gated` (cron returns `eligible:false`; recoverable only via `## Retry`). This classification is safety-critical: if it ever lands in the `retriable` (auto-spawn) bucket, a failing review would auto-re-run a full, expensive orchestrator every cron tick with no human in the loop.

**Post-review outcome gate (deep module, shared)**
- A pure function maps "did the review pass?" to the post-review action: pass → `awaiting_merge` and proceed (document/PR as applicable); fail → `review_failed` and stop. SDLC additionally skips document + PR creation on fail (its review loop already runs before PR creation). Both `adwSdlc` and `adwPrReview` consume this single function. Today `adwSdlc` writes `awaiting_merge` unconditionally after the review loop and `adwPrReview` never writes it at all — both change to route through this gate.

**`## Retry` recovery**
- The retry directive handler gains a `review_failed → phase_timeout` transition (re-arming the resume counter), mirroring the existing `human_gated → phase_timeout` path. On resume the review re-runs (the review phase is not a skip-tracked phase, so it always re-executes; completed plan/build/step-def phases stay skipped).

**Resume-spawn routing (deep module)**
- A pure function maps an adwId's top-level state to the correct orchestrator script + normalized args. The takeover / `phase_timeout` spawn path stops hardcoding the SDLC orchestrator and uses this function (reading the persisted `orchestratorScript`), reusing the pattern already present in the auth-queue / webhook resume paths. Routing a PR-review `review_failed` to the SDLC orchestrator is incorrect, not merely wasteful: SDLC works from the issue spec and never reads PR review comments, so it would drop the human's review-comment intent.

**adwId consolidation (deep module + orchestrator wiring)**
- `adwPrReview`'s CLI is normalized to `(issueNumber, adwId)` (today it is PR-number-keyed and self-generates an adwId). It resolves its PR from the reused adwId's persisted branch name.
- A pure resolver takes PR details + an injected issue-comment fetcher + an adwId generator and returns either the reused identity (issue number + existing adwId, discovered via the existing "latest adwId in the issue's comments" resolver) or a freshly generated one — or a "skip" signal when the PR is not issue-linked.
- `adwPrReview` persists `orchestratorScript` to top-level state and **overwrites** it to its own script when taking over an SDLC adwId, so `review_failed` resume routes back to PR-review.
- Triggers that currently spawn PR-review by PR number (cron PR-comment poll, webhook) delegate to the resolver to produce `(issueNumber, adwId)` and skip issue-less PRs.

**Identity / GitHub facts relied upon**
- An issue's canonical adwId is the latest adwId mentioned in the issue's comments (the resolver cron already uses for stage resolution, retry, and takeover).
- A PR's linked issue is derived from the PR body ("Implements #N") or an `issue-(\d+)` branch name; when neither is present the PR is treated as not issue-linked and is skipped.

## Testing Decisions

Good tests here assert **external behavior** through a module's interface, not its internals: given inputs (a review verdict, an adwId's state, a set of issue comments, PR details), assert the decision/output. The safety-critical classification and routing decisions are pure functions specifically so they can be tested in isolation with injected dependencies.

Modules to test:
- **Post-review outcome gate** — pass → `awaiting_merge`+proceed; fail → `review_failed`+stop (and SDLC skip-doc/PR flag). Prior art: `resumePolicy` (`nextResumeAction`) unit tests.
- **Stage classification of `review_failed`** — asserts it lands in the human-gated/excluded class, and that the cron issue filter returns `eligible:false` for it (the money-fire pin). Prior art: `stageClassifier` tests, cron issue-filter tests.
- **Retry handler** — `review_failed → phase_timeout` re-arm; no-op for unrelated stages. Prior art: existing retry-handler / retry-directive coverage.
- **Resume-spawn routing** — given a state with each `orchestratorScript`, returns the right script + normalized args; defaults to SDLC when absent. Prior art: auth-queue resume tests, `orchestratorNamesForScript`.
- **PR-review target resolver** — reused-adwId path (issue-linked, existing adwId in issue comments), fresh-generate path (issue-linked, none found), and skip path (issue-less PR). Inject the comment fetcher + generator. Prior art: `cronStageResolver` (`extractLatestAdwId`) tests, the upgrade-gate injected-deps test style.

Thin wiring (CLI normalization, `orchestratorScript` persistence, trigger delegation) is covered by the extracted modules plus the existing BDD/regression harness rather than dedicated unit tests.

## Out of Scope

- Changing the merge orchestrator itself, the `hitl`-gate behavior, or branch-protection requirements.
- Supporting PR-review on issue-less / purely human PRs (explicitly excluded; humans use the `hitl` label to hold a PR for manual handling).
- A cost/attempt ceiling on `review_failed` independent of the human (the human-gated classification already bounds auto-runs; `## Retry` is human-paced).
- Retroactively consolidating adwIds on issues that already carry multiple (pre-change) adwIds; discovery picks the latest and self-heals after one cycle.
- Any change to how the review agent itself decides pass/fail or what counts as a blocker.

## Further Notes

- **Incident of record:** #712 / PR #715 (merged manually 2026-06-29 by invoking the merge orchestrator against the `awaiting_merge`-holding adwId). Same shadowing failure class as the `adwMerge strands in abandoned` note.
- **Slice ordering / region collisions:** the stage taxonomy + classification + cron-filter exclusion are touched by the `review_failed` slice and depended on by the consolidation slice. The post-review gate touches both orchestrators. The minimal "PR-review hands off to `awaiting_merge`" slice can ship first and independently (it fixes the incident class without consolidation), but it edits the PR-review completion path that the consolidation slice also edits — order them.
- **Money-fire backstop:** review failure writes `review_failed` directly (human-gated), so it never consumes the auto-resume counter; the existing resume cap (`MAX_RESUME_ATTEMPTS`) still bounds the *hang* path after a `## Retry`.
