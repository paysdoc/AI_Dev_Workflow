---
status: accepted
date: 2026-08-14
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/gitcontext-forge-agnostic-refactor.md
  - kind: contemporaneous
    source: specs/prd/gitcontext-library-extraction.md
  - kind: contemporaneous
    source: specs/runbooks/gitcontext-extraction.md
  - kind: contemporaneous
    source: "specs/issue-790-*.md to issue-797-*.md, issue-816-*.md to issue-823-*.md, issue-840-*.md, issue-844-*.md; issue #840 body as closed 2026-09-24"
  - kind: transcript
    source: "Claude Code session f6749bbe, 2026-08-14 and 2026-08-28"
  - kind: transcript
    source: "Claude Code session 24f270ed, 2026-09-10"
supersedes: []
superseded-by: []
---

# ADW depends on `@paysdoc/devplatform` and contains no forge-specific code

## Context and Problem Statement

`GitContext` (ADR-0046, [0046-gitcontext-as-sole-git-authority.md](0046-gitcontext-as-sole-git-authority.md)) had grown a GitHub-shaped surface: issue, pull request, label, board and secret operations were methods on it, and about twenty modules called them there instead of through the ports of ADR-0011 ([0011-provider-ports-and-immutable-repo-context.md](0011-provider-ports-and-immutable-repo-context.md)).

A second project, Pi_Dev_Workflow, was to use the same git and forge code. The owner named it as the driver: "hardening is a secondary requirement". This ADR records ADW's side: what ADW keeps, what it depends on, and how the change was made.

## Decision Drivers

* A second consumer must get the wrong-repository discipline without rewriting it.
* A published API must not need breaking releases straight after publication.
* Identity selection must stay in one place while callers migrate.

## Considered Options

* Extract `GitContext` as it was.
* Refactor inside ADW first, extract second.
* Extract the git core first and move the providers later.
* Keep a delegating facade on `GitContext` while callers migrate.
* Let the library file an issue on ADW for each version bump.
* Leave version bumps to Dependabot.

## Decision Outcome

Chosen: "Refactor inside ADW first, extract second", with all adapters in the library, a clean cut, and Dependabot. The owner's instruction was to "do a selective extraction and apply a hexagonal architecture approach", and then to "place the adapters into the library as well, so that the ADW's can simply choose the one they want depending on which platform the target repo runs on".

* Extracting as-is was rejected because it "would publish a GitHub-coupled API that is already scheduled for restructuring". The staged move was dropped on 2026-08-28.
* No facade. The owner: "this could lead to errors with wrong repo again as I don't think that the adapters sufficiently take care of that".
* ADW depends on `@paysdoc/devplatform` at an exact version. The name replaced `gitcontext` on 2026-09-10. The owner did not want "forge" in the package name ("I don't find "forge" very descriptive"); identifiers in code keep `forge`.
* Version bumps arrive as Dependabot pull requests and are merged by hand. The owner first accepted library-filed issues, then reversed: "This seems problematic once more projects use this library."
* The switchover was one human-gated issue (#840, label `hitl`). Rollback is a revert by hand, because ADW then runs on the library.
* ADW production code names no forge. The owner: "I want all the interaction with the devplatform to be generic, createGhRepoApi violates that." #840 states the rule: production code sees only `forgeProviders`, `createForgeCredentials`, `GitContext`, the ports and the domain model.
* Provider selection stays in ADW: it reads `.adw/providers.md`; the library reads no consumer files and no environment.
* Providers and the context are built only at the launch boundary, from one identity.

### Consequences

* Good, because every design step was proven against ADW's callers and tests before it was published.
* Good, because ADW's guard now has an empty exempt set: no code in this repository may run `git` or `gh`.
* Bad, because ADW cannot repair a broken library switch through its own pipeline.
* Bad, because Dependabot pull requests have no issue and sit outside the pipeline.
* Bad, because the first switchover run stopped: the published 1.0.0 entry points did not export names ADW still imported. #844 and a library release had to land first.

### Confirmation

Checked on 2026-09-29:

* `package.json` and `bun.lock` pin `@paysdoc/devplatform` at `1.2.0` with no range. `adws/providers/` and `adws/gitContext/` do not exist.
* #840 is closed; PR #843 was merged to `dev` by the owner on 2026-09-24.
* `.github/dependabot.yml` watches only this package, weekly.
* `bun run lint:git-guard` passes; `EXEMPT_PACKAGES` is empty and `SANCTIONED_CONSTRUCTION_SITES` lists only `adws/core/launchGitContext.ts`. CI: `.github/workflows/git-cli-guard.yml`.
* The grep from #840's acceptance criteria matches one file, `adws/guard/constructionRule.ts`, which holds the names as the guard's match list, not as imports.

Not checked: a type check against the installed package; it is absent from this checkout's `node_modules`. The published 1.2.0 tarball was inspected instead.

## More Information

Unresolved: ADW production code imports GitHub-named symbols from the library. `adws/core/githubAppAuth.ts` imports `isGitHubAppConfigured`, `getInstallationToken` and `GitHubAppConfig`; `adws/core/forgeWiring.ts` imports `GitHubForgeDeps`. The 1.2.0 `./providers` entry point re-exports the GitHub, GitLab and Jira adapter modules, although the runbook's library issue says such helpers "stay adapter-internal". #840's rule lists other names, so its grep does not catch these. `launchGitContext.ts` also fixes the credential forge to `github`.

Recorded in the devplatform repository, not here: the three entry points, compiled ESM output, release automation and its commit parser, OIDC publishing, the ported guard, history seeding.

`specs/prd/gitcontext-library-extraction.md` says ADW's branches are "unprotected"; see ADR-0019 ([0019-dev-and-main-branches-with-runner-clone.md](0019-dev-and-main-branches-with-runner-clone.md)). GitHub App credentials: ADR-0016 ([0016-github-app-identity.md](0016-github-app-identity.md)).
