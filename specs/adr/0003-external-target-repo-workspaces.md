---
status: accepted
date: 2026-02-25
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-1-adw-enable-adw-to-run-on-uwva44-sdlc_planner-external-repo-workspace.md (issue #1, filed 2026-02-24, merged as PR #4 on 2026-02-25)
  - kind: contemporaneous
    source: specs/issue-812-adw-53s866-cron-trigger-crash-l-sdlc_planner-fix-cron-janitor-crash-loop.md (issue #812)
  - kind: transcript
    source: Claude Code session 7924b627, 2026-09-04
supersedes: []
superseded-by: []
---

# ADW runs from its own repository against target repositories cloned into external workspaces

## Context and Problem Statement

At the start every ADW workflow ran in the repository ADW itself lived in, so using ADW on a project meant placing the whole suite in that project. Issue #1 names three problems: the target repository "gets polluted with ADW related information, including logs and agent information"; "unrelated - and possibly proprietary - reporting is done in the target repository"; and costing is hard because token reporting is spread over repositories. The decision covers where a target repository's files live on the host and how ADW recognises a directory as one of its targets.

## Considered Options

* Keep the ADW suite inside each repository it works on (the situation before issue #1)
* Run ADW from its own repository and work on each target in a dedicated workspace outside it

## Decision Outcome

Chosen option: "Run ADW from its own repository and work on each target in a dedicated workspace outside it", because it removes the three problems above.

* The triggers take the repository from the event and pass it to the orchestrator as `--target-repo owner/repo --clone-url <url>`.
* The workspace is `TARGET_REPOS_DIR/{owner}/{repo}`, default `~/.adw/repos/`. An existing workspace is reused; a missing one is cloned.
* Worktrees are created inside the target workspace and agents run with their working directory there.
* ADW's logs and agent state stay in the ADW repository, resolved from the ADW process's working directory.

Issue #812 (2026-09-04) added the rule for recognising a target. `TARGET_REPOS_DIR` may be a general projects folder, and the dev-server janitor had treated every directory with `.git` as a target, which crashed the cron trigger on a repository the GitHub App was not installed on. A directory is now an ADW target only when it carries both `.git` and the `.adw` directory written by `/adw_init`. The owner's words: "I want it to run over everything that contains a .adw . Agree on Robustness: certainly don't crash if remote does not exist." A failure while inspecting one repository is logged and that repository is skipped.

### Consequences

* Good, because a target repository needs no ADW code.
* Good, because one ADW installation serves many repositories.
* Bad, because every operation must carry the target's identity. Getting this wrong produced a class of wrong-repository bugs, addressed in [ADR-0011](0011-provider-ports-and-immutable-repo-context.md) and [ADR-0046](0046-gitcontext-as-sole-git-authority.md).
* Bad, because ADW commands and configuration must be placed in the target worktree before an agent can use them.

### Confirmation

Checked against the code on 2026-09-29:

* `adws/core/environment.ts` defines `TARGET_REPOS_DIR`, and `LOGS_DIR` and `AGENTS_STATE_DIR` from `process.cwd()`.
* `adws/core/orchestratorCli.ts` (`parseTargetRepoArgs`) parses `--target-repo` and `--clone-url`.
* `adws/core/targetRepoManager.ts` (`ensureTargetRepoWorkspace`) clones or refreshes the workspace; `adws/core/launchGitContext.ts` builds a target context whose base path is `join(targetReposDir, owner, repo)`.
* `adws/triggers/devServerJanitor.ts` requires `hasAdwMarker` as well as `isGitRepo`, and catches per-repository listing failures. Unit tests: `adws/triggers/__tests__/devServerJanitor.test.ts`.
* The janitor is the only code that walks `TARGET_REPOS_DIR` (grep for the constant), so it is the only place the marker rule applies today.

## More Information

* Unresolved: the spec for issue #1 says ADW state "(`logs/`, `agents/`, `specs/`) remain in the ADW repository". Logs and agent state do. Plan files do not: `adws/agents/planAgent.ts` looks for them in `specs/` inside the worktree, and target repositories such as `paysdoc/depaudit` contain `specs/issue-*-sdlc_planner-*.md`. No source was found that records when or why plans moved into the target repository.
* What the `.adw` directory contains: [ADR-0005](0005-adw-directory-config-per-target-repo.md).
* The clone URL is converted from HTTPS to SSH before cloning, and the workspace is marked trusted for Claude Code ([ADR-0050](0050-target-repo-guardrails.md)).
* The spec notes that cost reporting was out of scope; see [ADR-0004](0004-cost-records-as-csv-in-git.md) and [ADR-0026](0026-cost-computed-locally-persisted-in-d1.md).
