# GitContext Forge-Agnostic Refactor (Phase A)

## Problem Statement

GitContext was built as the repo-context authority: a single chokepoint that owns every git and `gh` interaction, constructed with mandatory identity, eliminating the wrong-repo and token-bleed bug class. It succeeded — but its public surface grew GitHub-shaped. The class exposes forge-semantic operations (issue, PR, label, board, secret commands) directly, so roughly twenty consumer modules call GitHub semantics on GitContext while a parallel provider abstraction (IssueTracker / CodeHost / BoardManager) exists precisely to own those semantics. The hexagon leaks from below: consumers can and do bypass the provider layer entirely.

This blocks the planned extraction of GitContext into a standalone library (`@paysdoc/gitcontext`) for the upcoming Pi_Dev_Workflow project. Extracting the package as-is would publish a GitHub-coupled API that is already scheduled for restructuring — guaranteeing breaking releases against a published contract immediately after extraction. The forge-specific material woven through the core includes: token resolution order, GitHub App authentication (with direct environment reads), GitHub-specific bot identities and remote-URL parsing, clone-URL rewriting, and the PAT-versus-token distinction in command environment assembly.

The refactor must not reintroduce the disease the current design cured: if migrated callers construct their own provider instances with hand-picked owner/repo arguments scattered across call sites, identity selection re-fragments and the wrong-repo bug class returns in new clothing.

## Solution

Reshape the boundary **inside the ADW repository first**, where atomic PRs and the full consumer base prove the design cheaply. Extraction to a separate repo (Phase B) happens only after the shape is stable.

The GitContext core becomes forge-agnostic: git operations, worktree lifecycle, workspace management, claim operations, and one generic **disciplined executor** — run this command with per-command credential environment and an identity-resolved working directory, with no knowledge of what the command means. The existing repo-API working-directory contract (repo-independent forge commands run from the framework root, never a target workspace) survives as a forge-neutral cwd-class concept.

All GitHub knowledge consolidates into a **GitHub forge adapter**: the command-string builders, GitHub App authentication, token resolution, GitHub identity derivation, and clone-URL construction. The adapter implements the existing provider interfaces on top of the executor. Credentials flow through a **TokenProvider port** resolved per command, so the core never caches a token (GitHub App installation tokens expire) and never reads the environment.

The ~20 modules calling forge semantics directly on GitContext migrate to the provider interfaces. Providers are minted **only at the launch boundary**, bound to the same identity as the process's GitContext — and this rule is CI-enforced by extending the existing git/gh guard with an ad-hoc-construction rule, the same way direct shell-outs are already structurally forbidden.

## User Stories

1. As a framework developer, I want the GitContext core to contain no GitHub-specific code, so that it can later be extracted and published as a forge-neutral library without breaking API changes.
2. As a framework developer, I want the hexagon-shaping refactor done inside the ADW repo before extraction, so that design mistakes are fixed in atomic single-repo PRs instead of coordinated breaking releases across two repos.
3. As a framework developer, I want one semantic hexagon for forge operations, so that there are not two competing abstractions (provider interfaces and GitContext methods) for the same operations.
4. As an ADW orchestrator, I want every issue, PR, label, board, and secret operation to go through a provider interface, so that swapping GitHub for GitLab or Jira on a target repo requires no orchestrator changes.
5. As an ADW orchestrator, I want providers bound to a repository identity at construction time, so that no operation can silently address the wrong repository.
6. As a framework developer, I want provider construction restricted to the launch boundary, so that identity selection stays in one audited place instead of re-scattering across call sites.
7. As a CI pipeline, I want to fail the build when a module constructs a provider or context outside the sanctioned boundary, so that the wrong-repo discipline is structural rather than conventional.
8. As a CI pipeline, I want to fail the build when any module outside the exempt set shells out to git or gh, so that the chokepoint cannot erode as the codebase grows.
9. As a framework developer, I want the guard's exempt set to name exactly which package may issue git commands and which may issue gh commands, so that the closed set of privileged code is explicit and reviewable.
10. As the GitContext core, I want a single disciplined executor for all child-process spawns, so that credential environment assembly, working-directory resolution, and missing-directory error rewrapping live in exactly one place.
11. As the GitHub forge adapter, I want to feed command strings into the core's executor rather than spawning processes myself, so that spawn discipline is inherited, not reimplemented.
12. As the GitContext core, I want to resolve credentials through a TokenProvider port on every command, so that expiring GitHub App installation tokens are never served stale from a construction-time cache.
13. As the GitHub forge adapter, I want to own token resolution order and the PAT-versus-installation-token distinction, so that forge-specific auth policy lives with the forge that requires it.
14. As the GitContext core, I want to receive a ready-made clone URL and a ready-made git identity at construction, so that I never derive either from forge-specific conventions.
15. As the GitHub forge adapter, I want to own GitHub bot-identity derivation and remote-URL parsing, so that GitHub naming conventions never appear in the core.
16. As the GitContext core, I want repo-independent forge API commands to keep running from the framework root, so that directive handling works on hosts that never cloned the target workspace.
17. As the GitContext core, I want logging to arrive through an injected logger, so that I carry no dependency on the host application's utilities.
18. As a framework developer, I want the ~20 direct semantic callers migrated to providers with no behavior change, so that the existing test suites act as the regression net for the migration.
19. As a framework developer, I want the migration to preserve the existing per-command environment injection, so that the token-bleed bug class stays dead throughout.
20. As a future library consumer (Pi_Dev_Workflow), I want the core's public API to consist only of git, worktree, workspace, and executor operations plus the ports it consumes, so that adopting it does not drag in GitHub machinery I don't use.
21. As a framework developer, I want the provider-selection factory (config-driven, per target repo) to remain application wiring in ADW, so that the future library never decides which forge a repo uses.
22. As a test author, I want the executor testable through an injected exec fake, so that I can assert which command ran, with which environment and working directory, without touching a real repository.
23. As a test author, I want the guard's new construction rule covered by tests that both catch violations and pass sanctioned sites, so that the rule neither rots nor blocks legitimate code.
24. As an operator, I want workflows to behave identically after the refactor (same commands, same repos, same comments), so that the refactor is invisible in production.

## Implementation Decisions

- **Order:** refactor in-repo first; extraction to a separate repository is a later phase. Extraction becomes a file move once the shape is proven against all existing consumers.
- **Disciplined executor:** the existing private spawn chokepoint is promoted to the core's public forge-neutral primitive. Inputs: command, working-directory class (target workspace vs framework root — preserving the existing repo-API cwd contract), per-command credential environment, optional stdin. The GitHub-specific `usePat` flag and token selection leave the executor; the missing-working-directory error rewrap stays.
- **TokenProvider port:** an interface the core consumes, resolved per command, implemented by the GitHub adapter. Covers resolution order, PAT-versus-installation-token selection, and App-token expiry. The core never reads environment variables for credentials and never caches a token.
- **GitHub forge adapter:** consolidates the gh command-string builders, GitHub App authentication (environment reads become injected configuration), token resolution, GitHub bot-identity derivation, SCP-style remote parsing, and clone-URL construction. Implements the existing IssueTracker / CodeHost / BoardManager interfaces on top of the executor. Builders remain pure string factories (command pattern); only the adapter feeds them to the executor.
- **Core cleanup:** the workspace manager receives a ready clone URL; bootstrap identity splits into generic git-config reads (stay in core) and GitHub derivation (moves to adapter); the two worktree operations that import the application logger switch to an injected logger port with a console default.
- **Caller migration:** the ~20 modules invoking forge-semantic methods on GitContext move to provider interfaces. Clean cut — no delegating façade is kept, since a façade defers identical edits while muddying the API.
- **Launch boundary:** the existing launch-boundary constructor is extended to mint bound providers alongside the GitContext, from the same identity. It is the only sanctioned construction site for both.
- **CI guard extension:** (a) the shell-out rule's exempt set grows to two named packages — the git core (git commands) and the GitHub adapter (gh command call sites); (b) the cwd-derived-identity rule follows any factory renames; (c) a new rule forbids provider/context construction outside the launch-boundary allowlist. Pure string builders never trip the shell-out rule; the exemption follows executor call sites, not builders.
- **Provider selection** stays in ADW as config-driven application wiring (per-target-repo provider configuration file, defaulting to GitHub). Unchanged by this refactor.
- **Wrong-repo invariants preserved throughout:** mandatory identity at construction, per-command environment injection (never process-global mutation), no cwd fallback, framework-root execution for repo-independent forge commands.

## Testing Decisions

- A good test asserts external behavior only: which command string was executed, with which environment and working directory, and what the caller observed — never private state or call sequences. The package's existing suites already follow this via an injected exec function; new tests continue the pattern.
- **Executor** (extend existing core suite): credential-environment parameterization, working-directory-class resolution including the framework-root contract, missing-directory error rewrap still firing, no environment mutation.
- **TokenProvider port** (adapter suite, largely relocated from the existing token-resolver tests): per-call resolution with no caching, resolution order, PAT-versus-token selection.
- **Launch-boundary extension** (extend existing suite): providers minted bound to the same identity as the GitContext; no path exists to divergent identities from one boundary call.
- **Guard extension** (extend existing guard suite — strongest prior art): new construction rule catches ad-hoc provider/context construction, passes sanctioned boundary sites; updated exempt set verified in both directions (adapter call sites pass, any third package fails).
- **GitHub forge adapter:** mostly relocated existing tests (token resolution, command builders, App auth); new tests only for clone-URL construction moving in.
- **Caller migration:** no new tests. The existing consumer suites are the regression net proving behavior is unchanged.
- Prior art: the core package's exec-fake unit tests, the guard's AST-rule tests, and the launch-boundary tests.

## Out of Scope

- **Phase B — extraction itself:** repository creation, history extraction (git filter-repo with path renames for files absorbed in the pre-refactor consolidation), npm publishing (`@paysdoc/gitcontext`, MIT — renamed `@paysdoc/devplatform` on 2026-09-10, see the Phase B PRD), release automation, and registering the library repo as an ADW target.
- **Phase 2 — providers moving into the library:** the provider interfaces and adapters stay in ADW for this refactor; their relocation is a separate later effort (not gated on Pi_Dev_Workflow).
- **Dependency-bump automation:** Dependabot/Renovate configuration and the hand-merge policy for bump PRs belong to Phase B.
- **Pi_Dev_Workflow** itself.
- **New forge capabilities:** no new GitLab/Jira operations; existing provider implementations are touched only where the migration requires.
- **Behavior changes of any workflow:** this refactor is intended to be operationally invisible.

## Further Notes

- The refactor deliberately fixes a current architectural defect independent of extraction: consumers bypassing the provider layer by calling forge semantics on GitContext. Even if extraction never happened, the single-hexagon result stands on its own.
- The guard's meaning shifts from "only GitContext may touch git/gh" to "only the git core may run git; only the GitHub adapter may issue gh" — still a closed, named, CI-enforced set.
- Sequencing within the phase should land the executor + TokenProvider reshaping before the caller migration, so migrated callers land directly on the final shape.
- Decisions in this PRD were settled in a full design grill on 2026-08-14 (recorded in project memory), including the later-phase decisions listed as out of scope.
