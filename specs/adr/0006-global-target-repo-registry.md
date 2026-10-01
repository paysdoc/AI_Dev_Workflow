---
status: superseded
date: 2026-03-01
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: commit f5591087 (2026-03-01), including specs/issue-52-plan.md as committed there
  - kind: contemporaneous
    source: specs/issue-52-adw-issue-classifier-run-0hgk57-sdlc_planner-fix-classifier-wrong-repo.md
  - kind: contemporaneous
    source: specs/issue-0-adw-adw-unknown-sdlc_planner-fix-worktree-target-repo-registry.md
supersedes: []
superseded-by: ["0011"]
---

# A global registry holds the target repository for the process

## Context and Problem Statement

ADW runs from its own repository but works on issues in external target repositories (ADR-0003, [0003-external-target-repo-workspaces.md](0003-external-target-repo-workspaces.md)). The GitHub API functions in `adws/github/issueApi.ts` and `prApi.ts` took an optional `repoInfo` parameter and fell back to `getRepoInfo()`, which read `git remote get-url origin` in the current directory. That directory was the ADW repository.

Issue #52 (2026-03-01) was the result: a webhook event for an issue in `paysdoc/Millennium` made the classifier fetch the issue with the same number from `paysdoc/AI_Dev_Workflow`, classify the wrong issue and start the wrong workflow.

## Considered Options

* Thread an optional `repoInfo` parameter from the webhook payload through the classifier to the API functions (the first plan for #52).
* A central registry: one module-level value per process, set at the entry point and read by every GitHub API function.

## Decision Outcome

Chosen option: "A central registry", because the owner rejected the first fix in PR review. The review text, as recorded in `specs/issue-52-plan.md`:

> Instead of allowing individual ADW components to determine which repository they are working in, they need to get the target repository from a central registry (e.g. state) and only ever use that repository. IMPORTANT: the central registry is the only truth for determining which repository to use.

The registry was `adws/core/targetRepoRegistry.ts`, with `setTargetRepo`, `getTargetRepo`, `clearTargetRepo` and `hasTargetRepo`. Entry points set it: `initializeWorkflow()`, `initializePRReviewWorkflow()`, the cron trigger at startup, and the webhook before each event, clearing it after the orchestrator was spawned. The API functions changed from `repoInfo ?? getRepoInfo()` to `repoInfo ?? getTargetRepo()`.

On 2026-03-03 the worktree and git helpers were brought under the registry as well (`resolveTargetRepoCwd`, commits e1964594 and f3ba8790), because `isBranchCheckedOutElsewhere()` and `freeBranchFromMainRepo()` still ran `git worktree list` without a `cwd` and so acted on the ADW repository.

### Consequences

* Good, because callers no longer had to pass the repository through every function for the default case.
* Good, because the classifier, comment and PR functions in the trigger process used the repository from the webhook payload.
* Bad, because the registry was mutable module-level state. The webhook server, one long-lived process serving several repositories, had to set and clear it around each event.
* Bad, because `getTargetRepo()` fell back to the local git remote with a warning when nothing had been set, so the original wrong-repository path stayed reachable.
* Bad, because nothing checked that the working directory belonged to the registered repository. The first version did not cover the worktree layer at all.

### Confirmation

The decision is no longer in force. Checked on 2026-09-29: `grep -rn "getTargetRepo\b\|setTargetRepo\|registryRepoInfo\|targetRepoRegistry" adws` over `*.ts` and `*.tsx` returns nothing, and `git log --diff-filter=D -- adws/core/targetRepoRegistry.ts` shows the file deleted by commit aa6f68de on 2026-03-12 (#119).

## More Information

Replaced by ADR-0011 ([0011-provider-ports-and-immutable-repo-context.md](0011-provider-ports-and-immutable-repo-context.md)), which describes the registry as a "mutable global singleton" and removes it.

The registry lived for eleven days, 2026-03-01 to 2026-03-12.
