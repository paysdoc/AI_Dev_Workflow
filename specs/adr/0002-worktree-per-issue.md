---
status: accepted
date: 2026-02-24
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: commit 5c4067c6 (adws/github/worktreeOperations.ts, adws/phases/workflowLifecycle.ts)
  - kind: contemporaneous
    source: specs/issue-163-adw-t5a58t-refactor-initialize-sdlc_planner-worktree-init-fetch-reset.md
  - kind: contemporaneous
    source: README.md, "Key design decisions" (retrospective text, added 2026-05-12)
supersedes: []
superseded-by: []
---

# One git worktree per issue

## Context and Problem Statement

Several workflows can run against the same repository at the same time, and the operator may be working in the main checkout while they do. A workflow that switches branches in a shared checkout changes the files under every other process using it. The decision covers where a workflow's files live and how that directory is created and synchronised.

## Decision Drivers

* Concurrent workflows on one repository.
* The main checkout must not be modified by a workflow.
* A stuck workflow must be recoverable without affecting the others.

## Considered Options

* One git worktree per issue
* Switching branches in a single checkout

## Decision Outcome

Chosen option: "One git worktree per issue", because it gives, in the README's words, "zero branch-state contamination, trivially safe parallel runs, and a stuck workflow that can be reclaimed by resetting *its* worktree without touching others." The founding commit states the same intent: worktrees let workflows "run in isolated directories without changing the branch of the main repository."

Each workflow runs in `.worktrees/<sanitised branch name>/` under the repository it works on. Agents are spawned with that directory as their working directory.

Issue #163 (2026-03-13) fixed the order of operations for a new worktree: create it from the root's current HEAD, copy the extra files in, then `git fetch` and `git reset --hard origin/<default branch>` inside the worktree. Before that, ADW ran checkout and pull on the main checkout first, which "can disrupt in-progress work on the main repo and relies on a network call succeeding before the worktree is created." The reset throws on failure because the worktree must match the remote tip.

### Consequences

* Good, because concurrent issues do not share a working tree.
* Good, because the main checkout is left alone.
* Bad, because of "disk usage and the complexity of `worktreeReset`" (README).
* Bad, because a fresh worktree has no installed dependencies and no untracked files. ADW copies `.env` and the `.claude` assets in, and the pipeline orchestrators (11 of the 16 scripts) start with an install phase, which is why install speed matters ([ADR-0009](0009-bun-as-package-manager-node-as-runtime.md)).

### Confirmation

Checked against the code on 2026-09-29:

* `adws/phases/workflowInit.ts` creates a new worktree with `gitCtx.ensureWorktree(branchName, defaultBranch)`, then `copyClaudeAssetsToWorktree`, then `gitCtx.fetchAndResetToRemote(defaultBranch, worktreePath)`. An existing worktree for the issue is reused and merged with the default branch instead of reset.
* `.gitignore` contains `/.worktrees`.
* `adws/vcs/worktreeCreation.ts` and `adws/vcs/worktreeReset.ts` are stubs; the operations live in `GitContext` from `@paysdoc/devplatform`. The library source was read from a sibling checkout (one commit after v1.1.0), where `gitContext.ts` builds the path as `<basePath>/.worktrees/<sanitised branch>`. The pinned 1.2.0 package is not installed in this checkout, so this was not verified against the pinned version.

No CI gate enforces this decision.

## More Information

* Branch names are `${prefix}-issue-${issueNumber}-${slug}` (`generateBranchName` in `adws/vcs/branchOperations.ts`). At commit 090a846d, `adws/README.md` and `UBIQUITOUS_LANGUAGE.md` gave `{type}-{issueNumber}-{adwId}-{slug}` instead; the code is authoritative.
* For a target repository the worktree lives inside that repository's workspace: [ADR-0003](0003-external-target-repo-workspaces.md).
* Git operations moved behind `GitContext`: [ADR-0046](0046-gitcontext-as-sole-git-authority.md), [ADR-0051](0051-forge-agnostic-core-and-devplatform-dependency.md).
* When a worktree is reset and when it is resumed in place: [ADR-0034](0034-coordination-kernel.md), [ADR-0047](0047-resume-in-place.md).
