---
status: accepted
date: 2026-06-21
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-638-adw-hxbf7l-feat-resume-in-place-sdlc_planner-worktree-reuse-gate-resume-in-place.md
  - kind: contemporaneous
    source: specs/issue-639-adw-11ormi-feat-bounded-resume-sdlc_planner-bounded-resume-cap-human-gated.md
  - kind: contemporaneous
    source: specs/issue-640-adw-rk9n3v-feat-tell-resumed-bu-sdlc_planner-resume-build-continue-not-restart.md
  - kind: contemporaneous
    source: specs/issue-641-adw-gvsub5-feat-deterministic-b-sdlc_planner-deterministic-branch-identity-fallback.md
  - kind: contemporaneous
    source: specs/issue-648-adw-1n12vq-fix-adw-push-path-de-sdlc_planner-fix-push-force-with-lease.md
  - kind: contemporaneous
    source: specs/issue-636-*.md and specs/issue-637-*.md (the slices this builds on)
supersedes: []
superseded-by: []
---

# A recovered workflow continues in its existing worktree when git can still work there

## Context and Problem Statement

[ADR-0034](0034-coordination-kernel.md) made takeover deterministic by resetting the worktree to `origin/<branch>` and accepting the loss of unpushed work. After #637 made `phase_timeout` recoverable, that reset ran on every recovery. The plan for #638: a watchdog kill during a long build "leaves a perfectly valid working tree full of uncommitted progress", and the reset discards it. Automatic recovery also had no bound, so a phase that wedged every time would be recovered and re-run without end.

The decision covers `adws/triggers/takeoverHandler.ts`, `adws/vcs/worktreeReuseGate.ts`, `adws/vcs/worktreeProbe.ts`, `adws/core/resumePolicy.ts`, the first build prompt of a resumed run, branch-name resolution, and the push of a feature branch.

## Decision Drivers

* Keep in-progress work that was never the problem.
* Every resume should do less work than the one before, so that recovery converges.
* Automatic recovery must not spend money without limit and without a human knowing.
* One issue has one branch, one PR and one state history.

## Considered Options

* Reset to the remote on every takeover (the rule of ADR-0034).
* Reuse the worktree when a gate over git-operability signals passes, and reset otherwise.
* For the resume cap: reuse the stage `merge_blocked`, or add a stage `human_gated`.
* For the push: a plain push, a bare `--force-with-lease` after a fetch, or `--force-with-lease` together with `--force-if-includes`.

## Decision Outcome

Chosen option: "reuse when the gate passes", because a reset is only needed when the worktree is unusable, and "for every other case it is pure loss" (#638).

* Reuse gate (#638). `decideWorktreeReuse` is a pure function over a probe. It refuses reuse for a live owner, an `index.lock` held by a live process, an interrupted rebase, merge or cherry-pick, a `HEAD` on the wrong branch, or a worktree that is locked, prunable or missing. An orphaned `index.lock` is removed and does not block reuse. The gate applies to `abandoned` and `phase_timeout`. A workflow in an active stage is still reset.
* The gate judges whether git can continue ("Class A"). It does not judge the content ("Class B"). Scenario tests, review and the human gate on destructive diffs run after a resume as before.
* Resume cap (#639). `resumeAttempts` is kept in top-level state. After `MAX_RESUME_ATTEMPTS` (3) automatic resumes of a `phase_timeout` workflow, the stage becomes `human_gated`, a comment is posted, and only `## Retry` re-arms it. A stage of its own was chosen because with a shared `merge_blocked` the retry handler "could not then tell which reset to apply".
* Continue, do not restart (#640). The first build agent of a resumed run gets the same instruction as a continuation after a context reset ([ADR-0023](0023-context-exhaustion-is-a-reset.md)): git state is the record of what is done. A fresh build gets the unchanged prompt.
* Branch identity (#641). When the adwId cannot be recovered from issue comments, the existing branch for the issue is matched by prefix and issue number, ignoring the slug, and the adwId is found by looking up the branch name in persisted state. A reclassification that changes the prefix gives a new branch, which is accepted.
* Push (#648). Feature branches are pushed with `git fetch` followed by `git push --force-with-lease --force-if-includes`. A plain push deadlocked on a rebased branch (issue #638 itself). A bare lease after a fetch "would lease against the just-fetched ref and always succeed", so it could overwrite a remote that had moved.

### Consequences

* Good, because uncommitted work survives a watchdog kill or a liveness reclaim.
* Good, because a looping timeout stops after three resumes and a human is told.
* Good, because a rewritten branch can be pushed, and a remote that moved gives one distinct error.
* Bad, because a reused worktree may hold poor work; catching that is left to the later gates.
* Bad, because `resumeAttempts` is cumulative and is not cleared by progress. A workflow that advances but times out in three different phases is escalated too.
* Bad, because the cap covers `phase_timeout` only. An `abandoned` workflow has no resume cap.
* Bad, because a force push is now the normal push. The lease and the includes check are what prevent overwriting foreign commits.
* Bad, because a rewrite made in another clone is refused and needs a manual push.

### Confirmation

Checked on 2026-09-29.

* `recoverViaResumeInPlaceOrReset` in `adws/triggers/takeoverHandler.ts` serves the `retriable` class and `phase_timeout`; the `active` branch calls `recoverViaResetFromRemote`.
* `MAX_RESUME_ATTEMPTS = 3` in `adws/core/resumePolicy.ts`; `adws/triggers/retryHandler.ts` resets `resumeAttempts` to 0 for `human_gated`.
* `adws/phases/buildPhase.ts` calls `buildResumeInPlacePrompt`; `adws/vcs/branchIdentity.ts` exports `deterministicBranchName` and `branchMatchesIssue`.
* The push is no longer in ADW. `adws/vcs/commitOperations.ts` is an empty file, and callers use `pushBranch` of the git context from `@paysdoc/devplatform`. In the devplatform repository at tag `v1.2.0`, the version ADW pins, `src/git/commitOps.ts` runs the fetch and the push with both flags. The package was not installed in the checkout used for this record, so the installed artefact was not inspected.
* Vitest run of `worktreeReuseGate.test.ts` and `resumePolicy.test.ts` passed. `takeoverHandler.test.ts` could not be loaded for the same reason; its result is unverified. `adws/vcs/__tests__/pushBranch.integration.test.ts` exists and was not run.

## More Information

* This ADR amends one rule of [ADR-0034](0034-coordination-kernel.md): the hard reset on takeover is now the fallback for `abandoned` and `phase_timeout`, and the rule only for active stages. The rest of ADR-0034 stands.
* The stage classes used here are recorded in [ADR-0036](0036-stage-taxonomy-and-exhaustive-classifier.md). `## Retry` is recorded in [ADR-0032](0032-explicit-cancel-and-retry-directives.md). The move of git operations into the library is recorded in [ADR-0046](0046-gitcontext-as-sole-git-authority.md) and [ADR-0051](0051-forge-agnostic-core-and-devplatform-dependency.md).
* The plans for #638 to #641 name a parent PRD, `specs/prd/stage-recovery-resume-in-place.md`. The plan for #638 notes that it "does **not** exist in the repo on any branch". The rationale here comes from the issue bodies and plans only.
* Dates: #639 merged 2026-06-19, #641 on 2026-06-20, #638, #640 and #648 on 2026-06-21.
* #648 had a companion, #649, on serialising slices that edit the same region. It is not part of this record.
