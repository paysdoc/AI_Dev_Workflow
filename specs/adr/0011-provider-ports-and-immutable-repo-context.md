---
status: accepted
date: 2026-03-09
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: "specs/issue-113-*.md to specs/issue-123-*.md (issues #113 to #123, filed 2026-03-09)"
  - kind: contemporaneous
    source: specs/issue-427-adw-qm6gwx-add-boardmanager-pro-sdlc_planner-add-board-manager-provider.md
supersedes: ["0006"]
superseded-by: []
---

# Platform access goes through provider ports bound to an immutable RepoContext

## Context and Problem Statement

Every workflow phase called GitHub directly through functions in `adws/github/` that wrapped the `gh` CLI. The spec for #113 states the effect: supporting "alternative platforms like Jira, Linear, GitLab, or Bitbucket" was impossible "without modifying every workflow phase".

The repository a process worked on came from the global registry of ADR-0006 ([0006-global-target-repo-registry.md](0006-global-target-repo-registry.md)). The spec for #116 names its faults: the value "can be set, cleared, and overwritten at any time", there is "no validation that the working directory actually belongs to the declared repository", and nothing stops a phase from changing the context.

## Decision Drivers

* Phases must not change when a target repository uses another issue tracker or code host.
* #119: "no global mutable state for repo targeting so that it is structurally impossible to operate on the wrong repository".
* A team may keep its work items in one product and its code in another (#123).

## Considered Options

None recorded.

## Decision Outcome

Platform operations are defined as ports with platform-neutral types, and a phase reaches them only through a `RepoContext` that is built once and cannot be changed.

* Two ports, `IssueTracker` and `CodeHost`, were defined in `adws/providers/types.ts` (#113), shaped to "map 1:1 to the existing GitHub functions" so that the GitHub implementations could wrap existing code (#114, #115). A third port, `BoardManager`, was added on 2026-04-09 (#427).
* `createRepoContext` validated the repository identifier, the working directory and that the directory's `origin` remote matched the identifier, then returned the context through `Object.freeze` (#116). One context per workflow run, created at the entry point and passed to every phase (#117, #118).
* Each target repository selects its platforms in `.adw/providers.md`; both default to `github` when the file is absent (#116, #121).
* The registry was deleted and the optional `repoInfo?` parameters removed (#119). Git operations moved from `adws/github/` to `adws/vcs/` (#120).
* A GitLab `CodeHost` (#122) and a Jira `IssueTracker` (#123) were written to prove the split. Jira keys map from ADW's numeric issue numbers as `{projectKey}-{number}`.

### Consequences

* Good, because phases call `repoContext.issueTracker` and `repoContext.codeHost` and carry no platform code.
* Good, because a provider is bound to one repository when it is created; a method has no repository argument to get wrong.
* Bad, because git operations stayed outside the ports. #117 says they "continue to use `repoContext.cwd` directly". Wrong-repository faults in that layer continued until ADR-0046.
* Bad, because the ports did not stop code from reaching platform operations another way. `specs/prd/gitcontext-forge-agnostic-refactor.md` later records about twenty modules calling GitHub operations on GitContext instead of the ports.
* Bad, because ADW's issue numbers are numeric, which fixes the Jira mapping to one project key per target repository.

### Confirmation

Checked on 2026-09-29 against the code:

* The ports, the domain types and the `RepoContext` type are no longer in this repository. They are imported from `@paysdoc/devplatform`; the published 1.2.0 package declares `IssueTracker`, `CodeHost`, `BoardManager`, `BoundProviders` and `RepoContext` in `dist/providers/types.d.ts`.
* `bindWorkspaceContext` in `adws/core/workspaceBinding.ts` performs the same three validations and returns `Object.freeze({ ...boundary.providers, cwd, repoId })`. Tested by `adws/core/__tests__/workspaceBinding.test.ts`.
* `loadProviderConfig` in `adws/core/providerConfig.ts` reads `.adw/providers.md` and defaults to GitHub. Tested by `adws/core/__tests__/providerConfig.test.ts`.
* `createRepoContext` no longer exists. Its name is kept in `CONTEXT_CONSTRUCTORS` in `adws/guard/constructionRule.ts`, so the CI job in `.github/workflows/git-cli-guard.yml` fails if a call to it is reintroduced outside the launch boundary.
* No reference to the registry remains (see ADR-0006).

## More Information

Later decisions that build on this one: ADR-0046 ([0046-gitcontext-as-sole-git-authority.md](0046-gitcontext-as-sole-git-authority.md)) brings git and `gh` execution under one authority; ADR-0051 ([0051-forge-agnostic-core-and-devplatform-dependency.md](0051-forge-agnostic-core-and-devplatform-dependency.md)) restricts provider construction to the launch boundary and moves the ports and adapters into a library.

`.adw/` configuration in general is ADR-0005 ([0005-adw-directory-config-per-target-repo.md](0005-adw-directory-config-per-target-repo.md)).
