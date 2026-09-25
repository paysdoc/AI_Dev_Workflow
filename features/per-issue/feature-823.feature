@adw-823 @adw-0ja9uv-forgeproviders-assem
Feature: forgeProviders() is the library's one way to build a bound provider set — one identity in, every member bound to it, an unknown forge name refused by name, and the launch boundary its only caller, after which extraction is a file move

  Issue #823 is the extraction gate of the GitContext library extraction
  (`specs/prd/gitcontext-library-extraction.md`, Implementation Decisions → Assembly function
  contract and the De-tangling wave's fourth bullet; Testing Decisions → "Assembly function — the
  critical suite"; user stories 4, 5, 6, 24). #816 landed the extraction-readiness guard, #817 moved
  the domain model into the provider package, #818 gave the GitLab and Jira adapters injected
  configuration, #819 cut the GitHub adapter off the legacy layer and widened the guard to everything
  under `adws/providers/**` EXCEPT `repoContext.ts`, #820 and #821 walked every caller onto the
  boundary and deleted the legacy free-function layer. `repoContext.ts` is the last file in either
  extractable directory the guard still cannot see, and this issue is what closes it.

  When this merges, `EXTRACTION_SCOPE == EXTRACTABLE_SET` and the two directories can be moved
  verbatim into the library repository. That is why the last section of this file is not ceremony: it
  copies both packages into an empty directory and imports them, which is the extraction, performed.

  This is a HITL issue because `forgeProviders`'s signature is the library's public entry point at
  1.0.0 and freezes there. The rows below are written to pin the BEHAVIOUR the signature has to
  deliver, so the human review is about shape rather than about semantics.

  ── WHY AC2, AC3 AND AC4's SCOPE CLAUSE GET NO DIRECT ROW ─────────────────────────────────────
  "`mintBoundProviders`, `createRepoContext`-as-constructor and `gitContextFactory.ts` are gone",
  "no file under `adws/providers/` … imports from `adws/core`" and "guard scope = both packages
  entirely" are statements about the source tree. A row asserting them directly would read the tree —
  a file-existence or file-content check, the exact shape the framework's rot rule prohibits, and one
  that would go red on any later rename that changed nothing. They are covered the way #819, #820 and
  change happened correctly — the guard binary's exit code and stdout (§6), `tsc`'s exit code and
  stdout over a throwaway probe module (§5) and over the whole repository (§8), and the import
  behaviour of a copied-out package (§7).

  ── SEVEN FINDINGS THE ISSUE BODY DOES NOT CARRY ──────────────────────────────────────────────

  FINDING 1 — MIXED IDENTITY IS AN INPUT TO `forgeProviders`, NOT AN IMPOSSIBILITY.
  `mintBoundProviders({ repoId, gitContext, … })` (`repoContext.ts:221`) never compares the two. It
  does not have to today: its ONLY caller is `buildLaunchBoundary`, which resolves `{owner, repo}`
  once and feeds it to both the `GitContext` and the mint in the same expression
  (`launchGitContext.ts:200-215`), so agreement holds by construction. `forgeProviders` is a 1.0.0
  public entry point with arbitrary consumers, and its `gitContext` parameter is exactly the seam
  that breaks the guarantee: hand it a context bound to `octo/infra` and an `identity` of
  `acme/webapp` and every GitHub provider issues `gh --repo acme/webapp` commands over a context
  whose credential, base path and self-host resolution belong to `octo/infra`. AC1's "no construction
  path yields a mixed-identity set" is therefore only true if the function REFUSES the mismatch.
  `GitContext` exposes `get owner()` / `get repo()` (`gitContext.ts:161-162`), so the check is
  available, and the refusal has prior art one file up — `bindWorkspaceContext`
  (`launchGitContext.ts:245-249`) already raises exactly this error for exactly this reason. §1's
  second row.

  FINDING 2 — THE BOARD-MANAGER SWALLOW CAN EAT THE UNKNOWN-FORGE REJECTION, AND MUST NOT ALSO STOP
  SWALLOWING. `mintBoundProviders:229-234` wraps `resolveBoardManager` in a bare `catch {}` because
  `BoundProviders.boardManager` is optional (`types.ts:295`) and only GitHub has a real one. Two
  opposite mistakes follow, and a plausible implementation makes one of them.
    • Validate the forge name by attempting to resolve, inside that try, or route all three
      resolutions through one try: an unknown forge name stops throwing and returns a set with no
      board manager. Silently defaulting is precisely what user story 6 exists to prevent, and it is
      invisible — the caller gets providers and carries on.
    • "Fix" the swallow by wiring the stubs: `createGitLabBoardManager()` and
      `createJiraBoardManager()` exist (`gitlab/gitlabBoardManager.ts:30`, `jira/jiraBoardManager.ts:30`)
      and every method throws "BoardManager not implemented for …". They have no production caller,
      by design. Returning one makes `if (boardManager)` truthy at every consumer, so a board move
      that is skipped today throws instead — a live behaviour change against AC5's "behaves
      identically". The omission is the contract. §1's third and fourth rows split the two.

  FINDING 3 — `validateGitRemote` IS THE LAST CONSTRUCTION SITE IN THE PROVIDER PACKAGE, AND IT
  BUILDS A SECOND CONTEXT NOBODY ASKED FOR. `repoContext.ts:72` reads the workspace remote via
  `gitContextForRepo(repoId).remoteUrl(cwd)`. Deleting `gitContextFactory.ts` leaves it with no
  factory, so it must read through the context the caller already holds — and that is not merely a
  plumbing change. `gitContextForRepo` builds a DIFFERENT token provider
  (`buildTokenProvider(GITHUB_PAT)`, `gitContextFactory.ts:126`) and runs `getSelfHostIdentity()` →
  `readLocalRepoInfo(REPO_ROOT)` (`:61-73`), so a check that only wants to run `git remote get-url`
  in a directory today probes the FRAMEWORK repository's identity and resolves a fresh credential for
  the target. `feature-794.steps.ts:113-124` deletes `GITHUB_APP_ID` for the duration of every
  `@adw-794` scenario for exactly that reason: the App mint 404s against fixture identities. After
  the rewire that workaround is unnecessary, which is the observable signature of the fix. What must
  NOT change: handing in providers is still not a way to skip the wrong-repo worktree check (#794
  AC3). §4's last three rows.

  FINDING 4 — AC3's `process.env` CLAUSE IS ALREADY FALSE, IN TWO PLACES THAT HAVE TO STAY.
  `resolveBootstrapGitIdentity` (`providers/github/githubIdentity.ts:116`) defaults to
  `deps.env ?? process.env` and reads `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and the `GIT_AUTHOR_*` pair;
  `GitContext`'s executor spreads the inherited environment into every child process
  (`gitContext.ts:229`). Both sit inside the extractable set, both are inside EXTRACTION_SCOPE today,
  and both pass — because the extraction rule inspects IMPORTS ONLY and never `process.env`. So a
  builder who reads AC3 literally either adds an AST rule for `process.env` and fails the build on
  two deliberate seams, or strips the executor's env spread and every spawned `git`/`gh` command
  loses `PATH`. Neither is the ask. The clause that is enforceable — and enforced — is the import
  clause, which §6 is written against; the configuration half is proven where it is actually
  observable, in §3, by watching what an adapter puts on the wire. NO ROW HERE ASSERTS "no
  `process.env` read", and adding one would be a bug.

  FINDING 5 — THE ONE ALLOWLIST HALF THE RATCHET CANNOT SEE IS THE HALF THIS ISSUE EDITS.
  `findStaleSanctionedEntries` (`constructionRule.ts:179-183`) reports only entries carrying `owner`.
  `adws/github/gitContextFactory.ts` carries `owner: '#823'` (`:100`), so deleting the file fires the
  ratchet and the build stays red until the entry goes — that half is self-cleaning, and §8's stale-
  entry row is its executable form. `adws/providers/repoContext.ts` is PERMANENT (`:97`): if it stops
  constructing, or ceases to exist, the guard stays GREEN with a dangling entry, and the issue's
  "the permanent allowlist shrinks to `adws/core/launchGitContext.ts` plus the assembly module" is
  unenforced by anything. §6's two construction rows are the enforcement — the fixture-tree guard
  must FAIL on a `repoContext.ts` that constructs and PASS on a `forgeProviders.ts` that does.

  FINDING 6 — FIVE SUITES OUTSIDE THE ISSUE'S FILE LIST BREAK AT IMPORT TIME. Every one is caught by
  §8's type-check row, because the root `tsconfig.json` includes `**/*.ts` — `features/` step
  definitions are type-checked, not just `adws/`. That is what makes that row load-bearing.
    • `adws/healthCheck.tsx:17` imports `readLocalRepoInfo` from `./github/gitContextFactory` (a
      re-export of `providers/github/githubIdentity`) and uses it at `:112`.
    • `features/per-issue/step_definitions/feature-572.steps.ts:55` imports `gitContextForRepo` and
      `readLocalRepoInfo` from the same file; `:220` composes them.
    • `features/per-issue/step_definitions/feature-819.steps.ts:30` imports `mintBoundProviders` and
      calls it in the REGISTERED step `the GitHub providers are minted over the recording gh seam`
      (`:251`). Its body must repoint to `forgeProviders`; its PHRASE TEXT must not change, or #819's
      scenarios go undefined. §1's first row reuses that phrase, so the repoint is forced and proved
      in the same motion.
    • `features/per-issue/step_definitions/feature-818.steps.ts:60,128` GENERATE driver sources that
      import `resolveCodeHost` and `jiraAuthFromEnv` from `adws/providers/repoContext` by absolute
      path. Both move to `adws/core/`. A generated import failing surfaces as a driver subprocess
      writing no output file — not as a clean error — so §3 reuses those wiring phrases to force the
      repoint rather than leaving it to be discovered.
    • `adws/__tests__/checkGitGhGuard.test.ts:601-603` READS the real `gitContextFactory.ts` off disk
      with `declPattern` regexes for `gitContextFor`, `gitContextForSync` and `gitContextForRepo`;
      deletion turns each into an ENOENT. Removing those three cases is correct — the functions
      genuinely cease to exist. What must NOT follow is "cleaning up" `gitContextForRepo` out of
      `CONTEXT_CONSTRUCTOR_NAME` (`identityRule.ts:33`) or `getRepoInfo`/`readLocalRepoInfo` out of
      `CWD_DERIVED_IDENTITY_FNS` (`:30`). Those guard NAMES, not files — that is stated in the
      module's own docblock (`:22-28`) and is what stops a cwd-derived identity fallback returning
      under a familiar name. PRD story 24. §6's identity row is the backstop.
    • Also `adws/providers/__tests__/repoContext.test.ts:8` and `__tests__/forgeEnvWiring.test.ts:9-10,62`
      import `mintBoundProviders`, `ForgeEnv`, `gitLabConfigFromEnv` and `jiraAuthFromEnv` from
      `../repoContext`; `adws/core/__tests__/launchGitContext.test.ts:12-32` mocks that module path.

  FINDING 7 — `deps.mintProviders` IS THE SEAM FOUR BDD FILES DRIVE THE BOUNDARY THROUGH.
  `LaunchGitContextDeps.mintProviders` (`launchGitContext.ts:67`) is what `feature-794.steps.ts:187`
  injects to record which identity each provider was minted from, and #794/#796/#820/#821 all observe
  the boundary through it. Renaming it to match `forgeProviders` is defensible and may well be right;
  doing it without updating that harness is a `tsc` error rather than a silent pass (root tsconfig
  again), which is the good outcome. Whatever it ends up called, §4's first row must still see three
  minting records against one identity — a passthrough that stopped being injectable would satisfy
  the type system and blind every boundary row in four files.

  ── WHAT IS ALREADY DEFUSED (DO NOT WRITE ROWS FOR THESE) ─────────────────────────────────────
    • `adws/core/providerConfig.ts` ALREADY EXISTS. The `.adw/providers.md` parser
      (`loadProviderConfig`, `parsePlatform`) moved to `adws/core/` in #819 to keep `repoContext.ts`
      under the line cap; the issue's "moved out of the provider package into `adws/core/`" is
      already done. What is NOT done is the two re-export shims that keep it reachable from the
      provider package — `repoContext.ts:42-43` — and a re-export is an import as far as the
      extraction rule is concerned (`extractionRule.ts:124`, `specifierOfExportDeclaration`
      collects `export … from`). Same for `:100`'s `resolveAdwLabelDefinition` shim. §6's pivot row
      is what makes those three lines fail the build.
    • `adws/github/githubAppAuth.ts` is inert to delete. It is a five-line re-export shim
      (`:5`) whose own docblock schedules it for this issue, and it has NO production importer left:
      `core/index.ts:161` re-exports the `adws/core/` copy, and `gitContextFactory.ts:13` imports
      from `../core/githubAppAuth` directly. Nothing observable changes when it goes.
    • `adws/core/launchGitContext.ts` KEEPS its permanent allowlist entry and keeps constructing
      `new GitContext(…)` (`:202`). The issue deletes the FACTORY module, not the boundary's own
      construction — "the boundary constructs the `GitContext` directly from the library's
      constructor" is what it already does. No row.

  ── HOW THESE ROWS RUN ────────────────────────────────────────────────────────────────────────
    • FIVE EXISTING HARNESSES, REUSED, NEVER REDEFINED. Redefining a registered phrase is an
      AmbiguousStepDefinition, so every phrase below that already exists is used verbatim:
        – the launch-boundary world and its provider-config fixtures from `feature-794.steps.ts`
          (§1's identity rows, all of §2's runtime rows, §4);
        – the recording gh seam — a REAL `GitContext` over a pattern-scripted `exec` — from
          `feature-819.steps.ts` (§1);
        – the recording forge endpoint and the `ADW's provider wiring resolves …` drivers from
          `feature-818.steps.ts` (§3);
        – the type-probe harness from `feature-817.steps.ts` (§2's compile row, §5);
        – the guard fixture tree from `feature-816.steps.ts` plus #817's rule-naming Then (§6);
        – `the git/gh guard scans a fixture source at {string} containing:` / `… reports a violation
          in that fixture source` and `the git/gh guard runs across the whole ADW repository` /
          `the guard run reports no violations` from `feature-769.steps.ts` (§6, §8);
        – `the guard reports no stale transitional entry in the sanctioned-construction allowlist`
          from `feature-797.steps.ts` (§8);
        – `the ADW codebase is checked out` from `features/step_definitions/ensureCronOnEveryEventSteps.ts`
          and `the ADW TypeScript type-check passes` from `feature-504.steps.ts`.
    • THESE ROWS CARRY `@adw-823`, SO NO OTHER FILE'S HOOKS RUN FOR THEM. `feature-794.steps.ts`,
      `feature-816.steps.ts`, `feature-818.steps.ts` and `feature-819.steps.ts` all tag their
      `Before`/`After` to their own issue. `feature-823.steps.ts` must force isolation from its own
      hooks — fixture-tree reset, probe cleanup, recording-endpoint teardown, and a reset of
      `feature-794.steps.ts`'s module-private world. #816 exported `resetGuardFixtureTree` and #794
      exported `setDeclaredPlatform`/`getBuiltBoundary` for precisely this kind of reuse; #794 needs
      one more export in the same spirit (a world reset), and #817/#818/#819's step files are the
      pattern to copy. Do not solve this by adding `@adw-794` to these rows.
    • THE 794-HARNESS ROWS USE ITS OWN FIXTURE IDENTITIES, `acme/webapp` and `octo/infra`, because
      its steps write throwaway workspaces and `.adw/providers.md` files under those names. #817 did
      the same when it reused that world. The gh-seam rows use #819's `acme/widget` for the same
      reason. Inventing `-823`-suffixed names for a reused world would write fixtures the reused
      steps never read.
    • NO ROW ASSERTS THAT A MODULE, AN EXPORT OR A PARAMETER EXISTS. §5's probe rows assert on
      `tsc`'s exit code and diagnostics over a module the step itself authors into a throwaway
      directory — the probe is an INPUT to the system under test, and the compiler's verdict is the
      artefact. That is #817's established surface, and it is the only rot-safe way to observe that a
      name has left a package's public surface.

  Background:
    Given the ADW codebase is checked out

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: Every provider the assembly function returns issues its commands over the one context, against the one repository
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue view" with:
      """
      {"number":42,"title":"x","body":"","state":"OPEN","author":{"login":"octocat"},"assignees":[],"labels":[],"milestone":null,"comments":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"url":"https://github.com/acme/widget/issues/42"}
      """
    And the recording gh seam answers commands matching "gh repo view" with "main"
    And the recording gh seam answers commands matching "projectsV2" with:
      """
      {"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_board1"}]}}}}
      """
    And the GitHub providers are minted over the recording gh seam
    When the minted issue tracker, code host and board manager are each driven once
    Then every command the minted providers issued reached the recording gh seam
    And the minted providers issued no command outside the repository "acme/widget"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A git context bound to another repository is refused rather than assembled against
    Given a recording gh seam for the repository "octo/infra" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    When a provider set is assembled for the identity "acme/webapp" over that git context and any failure is captured
    Then assembling the provider set failed naming both repositories
    And no provider was returned from the assembly
    And the recording gh seam recorded no command

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A code host with no board support yields a set with no board manager, not a refusing stub
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    And the workspace for the repository "acme/webapp" carries the provider configuration:
      """
      ## Code Host
      gitlab
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the assembled set carries no board manager
    And the assembled set carries an issue tracker and a code host

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: An unknown forge name is not absorbed by the optional-board-manager swallow
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries the provider configuration:
      """
      ## Code Host
      bitbucket
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the provider request failed naming the platform "bitbucket"
    And the boundary handed back no providers

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A code host name outside the closed union is refused naming the value
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries the provider configuration:
      """
      ## Code Host
      bananas
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the provider request failed naming the platform "bananas"
    And the boundary handed back no providers

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A forge name legal for one port and illegal for another is refused on the port that cannot serve it
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries the provider configuration:
      """
      ## Issue Tracker
      gitlab
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the provider request failed naming the platform "gitlab"
    And the boundary handed back no providers

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A repository naming no forge still gets the full GitHub set
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    And the workspace for the repository "acme/webapp" carries no provider configuration
    When the launch boundary is asked for the repository "acme/webapp"
    Then the boundary result carries a git context, an issue tracker, a code host and a board manager
    And the boundary's issue tracker was minted for the repository "acme/webapp"
    And the boundary's code host was minted for the repository "acme/webapp"
    And the boundary's board manager was minted for the repository "acme/webapp"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A forge name outside the union is rejected by the compiler, not only at runtime
    Given a type probe module that reads:
      """
      import { forgeProviders } from '../providers/forgeProviders';
      import type { ForgeProvidersOptions } from '../providers/forgeProviders';

      declare const options: ForgeProvidersOptions;

      export const probe = () => forgeProviders({ ...options, forge: { codeHost: 'bitbucket', issueTracker: 'github' } });
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile rejecting the forge name "bitbucket"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The gitlab code-host name reaches the GitLab adapter with its configuration injected
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "glpat-from-environment" in its environment
    And the adapter runs with "GITLAB_INSTANCE_URL" pointing at the recording endpoint
    When ADW's provider wiring resolves a GitLab code host for "acme/widget" and performs the "default branch" operation
    Then the recording endpoint received a "GET" request to "/api/v4/projects/acme%2Fwidget"
    And the recorded request carried the header "PRIVATE-TOKEN" with value "glpat-from-environment"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The jira issue-tracker name reaches the Jira adapter with its credentials injected
    Given a recording forge endpoint is listening
    And the adapter runs with "JIRA_EMAIL" set to "bot@example.com" in its environment
    And the adapter runs with "JIRA_API_TOKEN" set to "env-api-token" in its environment
    And the adapter runs with "JIRA_PAT" set to "" in its environment
    When ADW's provider wiring resolves Jira credentials and the issue tracker comments on issue 42 at the recording endpoint with project key "ADW"
    Then the recorded request carried the header "authorization" beginning with "Basic"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A missing forge credential is still refused by the environment variable's name after the wiring moves
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "" in its environment
    And the adapter runs with "GITLAB_INSTANCE_URL" pointing at the recording endpoint
    When ADW's provider wiring resolves a GitLab code host for "acme/widget" and performs the "default branch" operation
    Then the adapter refuses with an error naming "GITLAB_TOKEN"
    And the recording endpoint received no request

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: One boundary call still binds all three providers to the identity its context names
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    And the local git remote at the launch boundary answers "acme/webapp"
    When the launch boundary is asked with no target repository
    Then the boundary's issue tracker was minted for the repository "acme/webapp"
    And the boundary's code host was minted for the repository "acme/webapp"
    And the boundary's board manager was minted for the repository "acme/webapp"
    And the boundary's git context names the repository "acme/webapp"
    And the launch boundary read the local git remote at most once

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A target launch still binds every provider to the argument and never reads the local remote
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary's issue tracker was minted for the repository "octo/infra"
    And the boundary's code host was minted for the repository "octo/infra"
    And the launch boundary never read the local git remote

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A target repository that has not been cloned yet still gets a boundary and its providers
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    And the workspace for the repository "octo/infra" has not been cloned
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary result carries a git context, an issue tracker, a code host and a board manager
    And the boundary's issue tracker was minted for the repository "octo/infra"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: Binding a workspace reuses the very providers the boundary assembled
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And a cloned workspace whose origin remote names the repository "acme/webapp"
    When the launch boundary is asked for the repository "acme/webapp"
    And a repo context is built for that workspace from the boundary's providers
    Then the repo context carries the same issue tracker and code host instances the boundary minted

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The workspace remote is read through the context the caller already holds
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "remote get-url" with "https://github.com/acme/widget.git"
    When a workspace is bound to that git context for the identity "acme/widget"
    Then the remote read reached the recording gh seam
    And the bound workspace carries the identity "acme/widget"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A workspace whose origin contradicts the boundary is still refused when providers are handed in
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And a cloned workspace whose origin remote names the repository "acme/webapp"
    When the launch boundary is asked for the repository "octo/infra"
    And a repo context is built for that workspace from the boundary's providers and any failure is captured
    Then building the repo context failed naming the repository the remote actually points at

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The retired mint is no longer part of the provider package's surface
    Given a type probe module that reads:
      """
      import { mintBoundProviders } from '../providers';

      export const probe = mintBoundProviders;
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile naming the missing member "mintBoundProviders"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The boundary-free context factory module cannot be imported at all
    Given a type probe module that reads:
      """
      import { gitContextForRepo } from '../github/gitContextFactory';

      export const probe = gitContextForRepo;
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile reporting the unresolvable module "../github/gitContextFactory"

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The assembly function is reachable from the provider package's barrel
    Given a type probe module that reads:
      """
      import { forgeProviders } from '../providers';

      export const probe = forgeProviders;
      """
    When the type probe is compiled against the ADW project
    Then the type probe compiles

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario Outline: The last unchecked provider file is now in scope and fails on a framework import
    Given a guard fixture tree holding the file "adws/providers/repoContext.ts":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/providers/repoContext.ts"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule
    And the guard failure over the guard fixture tree names the import specifier "<specifier>"

    Examples:
      | specifier                   |
      | ../github/gitContextFactory |
      | ../core/environment         |
      | ../core/projectConfig       |
      | ../core/logger              |
      | ../core/providerConfig      |
      | ../core/adwLabels           |
      | ../forge/hitlBoardNotifier  |
      | ../types/issueTypes         |

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario Outline: A framework import from any top-level provider module fails the guard
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                | specifier            |
      | adws/providers/forgeProviders.ts    | ../core/logger       |
      | adws/providers/forgeProviders.ts    | ../core/environment  |
      | adws/providers/forgeProviders.ts    | ../github/githubAppAuth |
      | adws/providers/someLaterFile.ts     | ../core              |

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The assembly function reaching the executor, the ports, the logger port and its own adapters passes the guard
    Given a guard fixture tree holding the file "adws/providers/forgeProviders.ts":
      """
      import type { GitContext } from '../gitContext';
      import type { Logger, TokenProvider } from '../gitContext/types';
      import type { BoundProviders, RepoIdentifier } from './types';
      import { createGitHubIssueTracker } from './github/githubIssueTracker';
      import { createGitHubCodeHost } from './github/githubCodeHost';
      import { createGitLabCodeHost } from './gitlab/gitlabCodeHost';
      import { createJiraIssueTracker } from './jira/jiraIssueTracker';

      export function forgeProviders(input: { forge: { codeHost: 'github' | 'gitlab'; issueTracker: 'github' | 'jira' }; identity: RepoIdentifier; tokenProvider: TokenProvider; gitContext: GitContext; deps?: { logger?: Logger } }): BoundProviders {
        void createGitHubIssueTracker; void createGitHubCodeHost;
        void createGitLabCodeHost; void createJiraIssueTracker;
        void input;
        return {} as BoundProviders;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The retired wiring file is no longer sanctioned to construct a provider
    Given a guard fixture tree holding the file "adws/providers/repoContext.ts":
      """
      import { createGitHubCodeHost } from './github/githubCodeHost';

      export const host = createGitHubCodeHost({} as never, {} as never);
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/providers/repoContext.ts"
    And the guard failure over the guard fixture tree cites the "unsanctioned-construction" rule

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The assembly module is sanctioned to construct every adapter it assembles
    Given a guard fixture tree holding the file "adws/providers/forgeProviders.ts":
      """
      import { createGitHubIssueTracker } from './github/githubIssueTracker';
      import { createGitHubCodeHost } from './github/githubCodeHost';
      import { createGitHubBoardManager } from './github/githubBoardManager';
      import { createGitLabCodeHost } from './gitlab/gitlabCodeHost';
      import { createJiraIssueTracker } from './jira/jiraIssueTracker';

      export const set = {
        tracker: createGitHubIssueTracker({} as never, {} as never),
        host: createGitHubCodeHost({} as never, {} as never),
        board: createGitHubBoardManager({} as never, {} as never),
        lab: createGitLabCodeHost({} as never, {} as never, {}),
        jira: createJiraIssueTracker({} as never, {}),
      };
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A cwd-derived identity feeding a context constructor is still caught after the factory is deleted
    When the git/gh guard scans a fixture source at "adws/triggers/reintroduced.ts" containing:
      """
      import { gitContextForRepo, readLocalRepoInfo } from '../providers/github/githubIdentity';

      export function ctx() {
        const info = readLocalRepoInfo();
        return gitContextForRepo(info);
      }
      """
    Then the git/gh guard reports a violation in that fixture source

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario Outline: Every scope entry the earlier slices seeded still fails on a framework import
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                        | specifier                 |
      | adws/gitContext/branchOps.ts                | ../core                   |
      | adws/providers/types.ts                     | ../core                   |
      | adws/providers/github/mappers.ts            | ../../types/issueTypes    |
      | adws/providers/github/domain/issueShapes.ts | ../../../types/issueTypes |
      | adws/providers/gitlab/gitlabApiClient.ts    | ../../core                |
      | adws/providers/jira/jiraApiClient.ts        | ../../core                |
      | adws/providers/workspaceValidation.ts       | ../core                   |
      | adws/providers/index.ts                     | ../core/logger            |

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A framework shell-out still fails under the shell-out rule, not the extraction rule
    Given a guard fixture tree holding the file "adws/core/branchHelper.ts":
      """
      import { execSync } from 'child_process';

      export function currentBranch(): string {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' });
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/core/branchHelper.ts"
    And the guard failure over the guard fixture tree cites no extraction-readiness rule

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A gh command string in the forge adapter still passes with both packages fully in scope
    Given a guard fixture tree holding the file "adws/providers/github/commands/prCommands.ts":
      """
      export function approvePRCmd(owner: string, repo: string, prNumber: number): string {
        return `gh pr review ${prNumber} --approve --repo ${owner}/${repo}`;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: Both extractable packages import cleanly when copied out of the framework together
    Given the git context and provider packages are copied side by side into an empty directory
    When the copied provider package is imported as its own entry point
    Then the import of the copied packages succeeds
    And the copied packages resolved no module outside their own directories

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: All four guard rules pass across the whole repository with both packages fully in scope
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The construction allowlist carries no stale entry once the factory module is deleted
    When the git/gh guard runs across the whole ADW repository
    Then the guard reports no stale transitional entry in the sanctioned-construction allowlist

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The ADW TypeScript type-check passes with the boundary on the assembly function
    Then the ADW TypeScript type-check passes
