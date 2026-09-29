---
status: accepted
date: 2026-03-19
recorded: 2026-09-29
provenance:
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
  - kind: contemporaneous
    source: specs/prd/test-review-refactor.md (runner clone)
  - kind: contemporaneous
    source: specs/issue-62-adw-pr-for-vestmatic-is-8lmju4-sdlc_planner-fix-pr-default-branch.md
  - kind: contemporaneous
    source: 'GitHub ruleset "Basic" (id 14100115) on paysdoc/AI_Dev_Workflow, created 2026-03-19'
  - kind: transcript
    source: "Claude Code session 44ada946, 2026-09-24"
supersedes: []
superseded-by: []
---

# Pipeline work lands on `dev`; the runner executes a separate clone of `main`

## Context and Problem Statement

ADW works on its own repository. The triggers and orchestrators that process issues are the same code that the pipeline changes and merges. With one branch and one checkout, a merged pull request changed the code of the running system, without human review.

The decision covers ADW's own repository: its branches, the branch rules on GitHub, and the checkout the triggers run from. It also covers how all ADW code finds the base branch of any repository.

## Decision Drivers

* ADW was merging its own unreviewed changes into the branch it ran from (recalled).
* A release gate was wanted: pipeline output collects in one place and reaches the running system by a deliberate step (recalled).
* #62: a pull request for a target repository whose default branch is `stage-3` was opened against `main`.

## Considered Options

None recorded. The PRD calls the runner clone "`Option A` from the grill"; the other options of that grill are not recorded.

## Decision Outcome

* `dev` is the default branch. Pipeline pull requests target it.
* `main` is the stable copy. It receives changes only by a pull request from `dev`, opened by the owner.
* The triggers run from a second clone that has `main` checked out, the runner clone. The owner develops on `dev` in another clone. Target repository workspaces under `~/.adw/repos/` are shared between the clones; ADW's `agents/` and `projects/` directories are not. The runner clone was the mechanism from the first day (recalled).
* Ruleset "Basic" applies to the default branch and to `main`: a pull request is required, with zero approvals; deletion and force push are forbidden; there are no bypass actors.
* There are no required status checks, because the merge path is a bare `gh pr merge --merge` that does not wait for checks (recalled).
* Code never names the base branch. It is resolved at run time from the code host. #62 moved the lookup out of the `/pull_request` prompt, where the model fell back to `main`, into code.

### Consequences

* Good, because a merge to `dev` cannot change the code of a running workflow.
* Good, because the running system changes only when the owner promotes `dev` to `main` and restarts the runner.
* Bad, because a fix merged to `dev` does not reach the runner until it is promoted.
* Bad, because without required checks a red CI run does not block a merge. ADR-0037 ([0037-tiered-regression-suite-with-fixed-vocabulary.md](0037-tiered-regression-suite-with-fixed-vocabulary.md)) records the effect on the regression suite.
* Bad, because documents referenced by an issue must be on the default branch before the issue is filed; agents check out the default branch.

### Confirmation

Checked on 2026-09-29:

* `gh api repos/paysdoc/AI_Dev_Workflow` gives `default_branch: dev`.
* `gh api repos/paysdoc/AI_Dev_Workflow/rulesets/14100115`: enforcement `active`; conditions `~DEFAULT_BRANCH` and `refs/heads/main`; rules `deletion`, `non_fast_forward` and `pull_request` with `required_approving_review_count: 0`; `bypass_actors` empty; no status-check rule. A second ruleset, "No commit on main" (id 17662132), is disabled.
* `git log --merges origin/main` shows `main` advancing by "Merge pull request #N from paysdoc/dev"; the first is #257 on 2026-03-21. Recent pipeline pull requests (#914 to #920) have base `dev`.
* Base-branch lookups in `adws/` call `codeHost.getDefaultBranch()` (`workflowInit.ts`, `prPhase.ts`, `adwMerge.tsx`, `adwUpgrade.tsx` and the sweeps).
* The merge command in `@paysdoc/devplatform` 1.2.0 is `gh pr merge <n> --merge --repo <owner>/<repo>`.

Not confirmed: the runner clone. It is an arrangement on the host, not code. No trigger process was running at the time of the check and no second clone was found beside the development clone.

No CI gate enforces the rule against naming a branch.

## More Information

Unresolved: branch names written into the repository, found by grep. No source says whether any of them is deliberate.

* `adws/triggers/docsIndexSweep.ts` returns `'main'` when the default-branch lookup throws.
* `PROTECTED_BRANCHES` in `adws/vcs/branchOperations.ts` is `['main', 'master', 'develop']`; `dev` is not in it.
* `.claude/commands/document.md` and `.claude/commands/resolve_failed_test.md` diff against `origin/main`.
* `.github/dependabot.yml` sets `target-branch: "dev"`.

Unresolved: `specs/prd/test-review-refactor.md` (2026-04-08) says each pull request "merges to `main` independently". The history and the recalled rationale say work collects on `dev` first.

`specs/prd/gitcontext-library-extraction.md` says ADW's branches are "unprotected". The ruleset above shows otherwise.
