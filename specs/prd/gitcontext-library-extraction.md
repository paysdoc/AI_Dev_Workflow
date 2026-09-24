# GitContext Library Extraction (Phase B)

## Problem Statement

The forge-agnostic refactor (Phase A, see `gitcontext-forge-agnostic-refactor.md`) reshapes GitContext into a forge-neutral core with a disciplined executor, ports for credentials and logging, and a provider layer owning all forge semantics. But the reshaped code still lives inside the ADW repository, so the upcoming Pi_Dev_Workflow project cannot consume it, and every future ADW-family framework would otherwise re-implement the same wrong-repo discipline from scratch.

The original plan staged the move: extract the git core first, relocate the provider layer later. That staging is now rejected — the provider interfaces and adapters exist precisely so consumers do not re-implement forge integrations, so they belong in the library from its first release. Collapsing the stages, however, exposes work the Phase A issues do not cover: the provider adapters are entangled with ADW internals. The GitHub adapter delegates to a legacy GitHub API layer inside ADW; the provider interfaces are typed with domain types owned by ADW's core type modules; and the GitLab and Jira adapters read credentials directly from ADW's environment configuration and log through ADW's application logger. Extracting them in that state would publish a library that does not compile, with its design finished after publication as breaking releases against a fresh 1.0.0 — exactly the failure mode the refactor-before-extract principle exists to prevent.

There are also two silent operational traps. First, the library repository will be ADW-registered, and ADW agents commit with an agent-name prefix (`build-agent: fix: …`); a stock conventional-commit release analyzer does not match that dialect, so merges would never publish a release. Second, the extracted code leaves the reach of ADW's git/gh guard while remaining under modification by agents — without a guard in its new home, nothing structural stops the spawn chokepoint from eroding.

## Solution

Finish the de-tangling **inside the ADW repository**, where the full consumer base and test suite prove every shape, so that extraction is a pure file move. Then create the library repository with real history, publish `@paysdoc/devplatform` at 1.0.0, and switch ADW over in one gated migration.

The de-tangling wave: the forge-neutral domain model (issue, pull-request, comment, and repository-identifier shapes) consolidates into the provider package; the GitHub adapter absorbs the legacy delegation layer until it reaches only the executor, the ports, and the domain model; the GitLab and Jira adapters receive injected configuration and the logger port; and a single assembly function — give it a forge name, a repository identity, and a token provider, receive a fully bound provider set — becomes the only way providers are constructed, wired in at the launch boundary. A new extraction-readiness guard in CI asserts that the extractable packages import nothing from the rest of the framework, converting "extraction is a file move" from an intention into a machine-checked invariant.

Extraction itself: a new ADW-registered repository seeded via history filtering (no rename map: every surviving file was created under, or moved within, the two extracted directories — verified 2026-09-10), a compiled ESM package with type declarations and three entry points (forge ports and domain model at the root, `forgeProviders` and the adapters under `./providers`, the git core under `./git`), release automation whose commit parser accepts the agent-prefixed dialect, the git/gh guard ported into the library's CI with the shell-out rule exempting the git core and the GitHub adapter and the construction rule sanctioning only the assembly module, and npm publishing from CI under the existing user scope. ADW then switches in one atomic human-gated migration — dependency added, imports rewritten, launch boundary repointed, extracted directories deleted, ADW's own guard left with an empty exempt set — after which version bumps arrive as Dependabot pull requests merged by hand.

## User Stories

1. As a Pi_Dev_Workflow developer, I want to install one published package containing the git core, the provider ports, and the forge adapters, so that I inherit the wrong-repo discipline and forge integrations without re-implementing either.
2. As a framework developer, I want the provider layer extracted together with the core in a single motion, so that there is never a published library whose ports live in one place and adapters in another.
3. As a framework developer, I want all de-tangling done in-repo before extraction, so that every design decision is proven against ADW's full consumer base and test suite before it is frozen into a published API.
4. As a library consumer, I want a single assembly function that takes a forge name, a repository identity, and a token provider and returns a bound provider set, so that provider construction and identity binding are written once instead of per consumer.
5. As an ADW orchestrator, I want the launch boundary to obtain its providers exclusively through the assembly function, so that the identity-binding guarantee is the library's, not a per-consumer convention.
6. As a library consumer, I want the assembly function to reject unknown forge names explicitly, so that a misconfigured repository fails loudly at launch instead of silently defaulting.
7. As a framework developer, I want the forge-neutral domain model owned by the provider package, so that the library's interfaces are not typed against ADW-internal type modules.
8. As a framework developer, I want the GitHub adapter to reach only the executor, the ports, and the domain model, so that it carries no dependency on ADW's legacy GitHub API layer at extraction time.
9. As a framework developer, I want the GitLab and Jira adapters to receive their credentials and endpoints as injected configuration, so that no adapter reads the host application's environment.
10. As a framework developer, I want every adapter to log through the injected logger port, so that no adapter imports the host application's utilities.
11. As a CI pipeline, I want an extraction-readiness rule that fails the build when an extractable package imports from the rest of the framework, so that de-tangling regressions are caught the moment they are introduced rather than at extraction time.
12. As a framework developer, I want the extraction-readiness rule active while the de-tangling issues land one by one, so that completed de-tangling work cannot be quietly undone by later changes.
13. As a library maintainer, I want the new repository seeded by history filtering with a rename map built against the post-refactor tree, so that per-file history survives the moves and splits that preceded extraction.
14. As a library consumer, I want one package with the forge ports and domain model at the root import, the assembly function and adapters under `./providers`, and the git core under `./git`, so that a consumer needing only git operations never touches forge machinery.
15. As a library consumer, I want the package published as compiled ESM with type declarations, so that it works in any Node or Bun consumer rather than only under TypeScript-executing runtimes.
16. As a library maintainer, I want the first release to be 1.0.0, so that semver discipline applies from the start — justified because the entire API shipped only after being proven against a full consumer base.
17. As a library maintainer, I want releases published automatically from CI on merge, so that publishing requires no human on the path.
18. As a library maintainer, I want the release analyzer's commit parser to accept an optional agent-name prefix before the conventional type, so that ADW-authored commits drive version resolution instead of being invisible to it.
19. As a library maintainer, I want the custom parser pattern covered by unit tests and a CI dry run, so that a release pipeline that would silently never publish is caught before the first merge.
20. As a library maintainer, I want CI to authenticate to npm via trusted publishing, or failing that a granular automation token, so that no broad long-lived credential exists to steal.
21. As a framework operator, I want the library repository registered as an ADW target and bootstrapped with the standard init flow, so that issues on it are worked by the same pipeline as every other registered repo.
22. As a library maintainer, I want the git/gh guard ported into the library's CI — shell-out rule exempting only the git core and the GitHub adapter, construction rule sanctioning only the assembly module — so that agents modifying the library cannot erode the spawn chokepoint.
23. As a CI pipeline in ADW, I want the guard's exempt set to become empty after extraction, so that no in-repo code may shell out to git or gh at all.
24. As a framework developer, I want ADW's identity and construction guard rules to keep working when the guarded names are imported from the library, so that the wrong-repo firewall survives the move.
25. As a framework operator, I want the ADW switchover performed as one atomic, human-gated migration with the work queue drained first, so that a change touching nearly a hundred files neither merges unreviewed nor collides with concurrent pipeline work.
26. As a framework operator, I want the switchover verified by the full test suite and a live smoke workflow before merge, so that a broken switch — recoverable only by hand-revert, since ADW then runs on the library — is caught before it lands.
27. As a framework developer, I want the switchover to update the one regression feature citing extracted paths and retire the living docs of extracted modules, so that no documentation points at directories that no longer exist.
28. As a framework operator, I want library version bumps to arrive in ADW as Dependabot pull requests merged by hand, so that the library carries no knowledge of its consumers and bot PRs — which have no backing issue — stay outside the issue-keyed pipeline.
29. As an operator, I want ADW workflows to behave identically before and after the switchover, so that the extraction is invisible in production.

## Implementation Decisions

- **Gate:** the extraction work starts only after every Phase A issue and every de-tangling issue of this PRD has merged. Extraction is a file move of a settled shape, never a design activity.
- **Scope collapse:** the previously staged "providers move later" plan is superseded. Core, provider ports, domain model, and all three adapters (GitHub, GitLab, Jira) extract together.
- **De-tangling wave (in-repo, ADW issues):**
  - The forge-neutral domain model moves into the provider package; the framework imports those types from there.
  - The GitHub adapter absorbs the legacy GitHub API delegation layer; its acceptable imports become exactly: executor, ports, domain model.
  - The GitLab and Jira adapters take configuration (tokens, endpoints, credentials) as injected constructor input and log via the logger port; direct environment reads are removed.
  - The assembly function is built inside the provider package and the launch boundary is rewired to it; the launch-boundary construction guard rule follows.
- **Assembly function contract:** input is a forge name, a repository identity, and a token provider (plus executor access); output is the full bound provider set. One identity parameter binds everything; unknown forge names are rejected. Consumers parse their own configuration format into the forge name — the library never reads consumer config files.
- **Extraction-readiness guard:** a new AST-based CI rule in the existing guard runner asserting the extractable packages have no imports from the rest of the framework. It lands with the first de-tangling issue (initially scoped to what is already clean, widening as issues land) and stays until extraction, after which it is deleted along with the directories it guarded.
- **History:** the library repository is seeded with git filter-repo over the two extractable directories, using a rename map hand-built at extraction time by following each surviving file's history through its pre-refactor paths. History older than a file's oldest recorded path stays in ADW.
- **Package:** `@paysdoc/devplatform` (renamed from `gitcontext` on 2026-09-10: the package ships the forge ports and all three adapters, not just the GitContext class; *forge* stays in the API and gains a glossary entry). Single npm package under the existing user scope, MIT licensed, compiled ESM plus type declarations, exports map with the forge ports and domain model at the root, `./providers` for the assembly function and adapters, `./git` for the core. First version 1.0.0.
- **Release automation:** semantic-release-style publishing on merge to the default branch. The commit analyzer uses a custom header pattern treating a leading agent-name segment as optional noise before the conventional type. Publishing authenticates via npm trusted publishing (OIDC) where possible, otherwise a granular automation token scoped to the single package; the first publish may be manual to create the package.
- **Library repository:** created under the existing GitHub account, bootstrapped with the standard ADW init flow (project config, starter guardrail settings), registered as an ADW target. CI runs typecheck, unit tests, the ported git/gh guard (shell-out exempt set: git core and GitHub adapter; construction allowlist: `forgeProviders.ts` only; identity and extraction-readiness rules not ported), and the release job. No branch protection: ADW's merge path (`gh pr merge --merge`, no `--auto`, no check polling) cannot merge under required status checks, and ADW's own branches are unprotected for the same reason. Bootstrap (package skeleton, tsconfig, vitest, CI) is a hand commit before the first issue is filed; `.adw/` and `.adw-version` come from the upgrade path triggered by that first issue, since `/adw_init` alone does not write `.adw-version`.
- **ADW switchover:** one issue, HITL-labelled, executed through ADW's own pipeline. It adds the dependency, rewrites all imports, repoints the launch boundary, deletes the extracted directories, empties the ADW guard's exempt set, updates the regression feature that cites extracted paths, and retires the living docs of extracted modules. The queue is drained before it builds. Rollback is a hand revert.
- **Post-switchover:** a Dependabot configuration in ADW watches the package; bump PRs are merged by hand.
- **Out-of-band setup (runbook, not issues):** npm account 2FA, trusted-publisher linkage, repository creation, history filtering, and the first publish are performed by the operator, not the pipeline.

## Testing Decisions

- A good test asserts external behavior only: which command or request was produced, with which configuration, and what the caller observed — never private state. Prior art: the core package's exec-fake unit tests, the guard's AST-rule tests, and the launch-boundary tests.
- **Domain model:** no tests — pure type declarations; the compiler and downstream suites cover it.
- **GitHub adapter absorption:** existing tests relocate with the absorbed functions; new exec-fake tests only where absorption changes a seam.
- **GitLab/Jira injection:** unit tests proving configuration arrives injected — fake config in, outgoing request or command shape asserted, and no environment read remaining.
- **Assembly function** (the critical suite): one identity in, every returned provider bound to it; unknown forge name rejected; no construction path yields a mixed-identity set.
- **Extraction-readiness guard:** both directions, per the guard suite's prior art — a violating import is caught, a clean package passes.
- **Release parser:** unit tests mapping agent-prefixed and plain conventional commits to the correct release type (patch, minor, none), plus a CI dry run of the release pipeline. The ported git/gh guard's tests move with it.
- **Switchover:** no new tests — the full existing suite plus a live smoke workflow is the regression net.

## Out of Scope

- **Phase A** (the forge-agnostic refactor) — prerequisite, tracked by its own PRD and issues.
- **Pi_Dev_Workflow** itself; it is the motivating consumer, not a deliverable.
- **New forge capabilities:** no new GitLab/Jira operations; those adapters change only in how configuration and logging arrive.
- **Multi-maintainer npm organization setup:** the user scope suffices until role separation is actually needed.
- **Automated merge of dependency bumps:** bump PRs are deliberately human-merged; pipeline integration for bot PRs is a separate future concern.
- **Behavior changes of any workflow:** the extraction is intended to be operationally invisible.

## Further Notes

- The de-tangling issues depend on Phase A's final shape; they should be issue-ified only after the Phase A slices merge, even though this PRD fixes their design now.
- Two traps this PRD exists to defuse, both found during design review: a stock release analyzer would never publish (agent-prefixed commit dialect), and the extracted code would have left the guard's reach while still being modified by agents (guard ported into the library CI).
- The 1.0.0 decision is load-bearing: it is defensible only because the gate guarantees nothing unproven ships. If extraction pressure ever tempts a shortcut past the de-tangling wave, the version promise is the argument against it.
- Decisions in this PRD were settled in a design grill on 2026-08-28 (recorded in project memory), superseding the staged provider relocation agreed in the original 2026-08-14 grill.
