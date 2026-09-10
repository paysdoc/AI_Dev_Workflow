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
  #821 covered their own structural criteria: by RUNTIME ARTEFACTS that cannot be green unless the
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

  # ── §1  ONE IDENTITY IN, EVERY MEMBER BOUND TO IT (AC1 — the critical suite) ──────────────
  #
  # The PRD calls this "the critical suite" and the four rows are its four claims. The first is the
  # positive direction at the only level where binding is observable without trusting the object: the
  # commands. A real `GitContext` over a recording executor is handed in; every command every minted
  # provider issues must arrive there and must name the one repository. An assembly function that
  # built its own context would reach a real `gh` and record nothing.
  #
  # This row reuses `the GitHub providers are minted over the recording gh seam`, whose body calls
  # `mintBoundProviders` today (FINDING 6). Repointing that body to `forgeProviders` is how #819's
  # own rows keep passing, and reusing the phrase here is what makes the repoint provable rather than
  # merely required.

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

  # FINDING 1. The row that makes "no construction path yields a mixed-identity set" a property of
  # the library rather than a property of ADW's one call site. The identity and the context disagree;
  # nothing in the current mint notices, and the resulting set would address `acme/webapp` over
  # `octo/infra`'s credential and base path. The error must name BOTH repositories — naming only one
  # leaves an operator unable to tell which half was wrong, which is the whole diagnostic value.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A git context bound to another repository is refused rather than assembled against
    Given a recording gh seam for the repository "octo/infra" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    When a provider set is assembled for the identity "acme/webapp" over that git context and any failure is captured
    Then assembling the provider set failed naming both repositories
    And no provider was returned from the assembly
    And the recording gh seam recorded no command

  # FINDING 2, first direction. The swallow must keep swallowing: a GitLab code host is a supported
  # selection with no board manager, and the set it yields must OMIT the member rather than carry a
  # stub whose every method throws. `if (boardManager)` is how consumers decide whether a board move
  # happens at all, so a stub turns a skipped move into a raised error at `adwMerge.tsx:251` and in
  # both completion phases — a behaviour change AC5 forbids.

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

  # FINDING 2, second direction, and the row that catches the single most likely wrong
  # implementation: validating the forge name by attempting to resolve, inside the board manager's
  # try/catch. Such an implementation returns a set for an unknown name, which is user story 6's
  # failure exactly — a misconfigured repository running silently against a substituted forge instead
  # of failing at launch.

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

  # ── §2  THE FORGE NAME IS CLOSED, PER PORT, AND REFUSED BY NAME (AC1; story 6) ────────────
  #
  # "`forge` is a closed union (`'github' | 'gitlab' | 'jira'` per port)" is a per-PORT claim, and the
  # code says why it has to be. `Platform` (`providers/types.ts:12-16`) is `github | gitlab |
  # bitbucket` — no Jira member at all, which is what `jiraAuthFromEnv`'s docblock records
  # (`repoContext.ts:148`) — while `bitbucket` is a `Platform` with no adapter on ANY port and
  # `gitlab` is a valid CodeHost but not a valid IssueTracker. So `forge` cannot simply BE `Platform`
  # in either direction, and the exact membership per port is the part of the signature the HITL
  # review freezes.
  #
  # The three runtime rows are #794 §8's refusals, re-run against the new construction path because
  # they are the regression net for AC5 and because the obvious rewrite loses them: a `switch` over a
  # union with a `default:` that falls back to GitHub type-checks, passes the whole unit suite, and
  # addresses the right repository through the wrong forge — the wrong-repo bug class in different
  # clothes. Each names the offending value, because a silent fall-through on a typo is the same
  # defect with a friendlier cause.

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

  # The per-port half. `gitlab` is a legal code host and an illegal issue tracker, and after this
  # slice the illegality has to survive a union that contains the name for the other port. An
  # implementation with one flat union and one resolver per port satisfies AC1's headline and fails
  # here.

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

  # The default must survive untouched: every target repository in production today carries no
  # `.adw/providers.md` at all and relies on the full GitHub set.

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

  # The compile-time half of "closed", and the row the 1.0.0 promise actually rests on. A runtime
  # throw makes a misconfigured repository fail at launch; a closed union makes a miswritten CONSUMER
  # fail at build. Only the second is what "closed union" means, and only the second is frozen by the
  # HITL review. The probe is a module the step authors into a throwaway directory and compiles
  # against the real project config — the artefact asserted is the compiler's verdict.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A forge name outside the union is rejected by the compiler, not only at runtime
    Given a type probe module that reads:
      """
      import { forgeProviders } from './providers/forgeProviders';

      export const probe = () => forgeProviders({ forge: { codeHost: 'bitbucket', issueTracker: 'github' } } as never);
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile rejecting the forge name "bitbucket"

  # ── §3  THE NON-GITHUB NAMES IN THE UNION REACH THEIR ADAPTERS (AC1; stories 4, 9) ────────
  #
  # A closed union whose non-GitHub members resolve to nothing is a type-level fiction. These two
  # rows drive the real adapters against a recording HTTP endpoint through the wiring path — which
  # is the path this issue moves. #818 built both drivers; they import `resolveCodeHost` and
  # `jiraAuthFromEnv` from `adws/providers/repoContext` by generated absolute path
  # (`feature-818.steps.ts:60,128`), and both move to `adws/core/`. Reusing the phrases is what
  # forces the repoint, and a driver whose generated import fails writes no output rather than a
  # clean error — so these rows are also the detector for that specific silent breakage.
  #
  # The GitLab row is a REGRESSION row: `resolveCodeHost(Platform.GitLab, …)` works today
  # (`repoContext.ts:170-172`) and must keep working with its configuration arriving from
  # `adws/core/`. The Jira row is NEW capability in one narrow sense — the adapter and its injected
  # config shape both exist and both are tested (#818), `.adw/providers.md`'s
  # `## Issue Tracker URL` and `## Issue Tracker Project Key` are already parsed
  # (`core/providerConfig.ts:78-86`) and read by nobody, and `jiraIssueTracker.ts:17` records the
  # wiring as this issue's. It is not a new forge OPERATION, so it is inside the PRD's "no new
  # GitLab/Jira operations" boundary; but it is the row to revisit first if the HITL review narrows
  # the union to the ports that have adapters today.

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

  # The refusal must stay operator-legible after the move. `gitLabConfigFromEnv`'s message names the
  # environment variable and tells the operator where to set it (`repoContext.ts:143`); the adapter
  # itself is forbidden from naming an environment variable at all (#818 AC2). Moving the wiring to
  # `adws/core/` is exactly the change that loses the message, by re-deriving the refusal inside the
  # library where it cannot mention the environment.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A missing forge credential is still refused by the environment variable's name after the wiring moves
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "" in its environment
    And the adapter runs with "GITLAB_INSTANCE_URL" pointing at the recording endpoint
    When ADW's provider wiring resolves a GitLab code host for "acme/widget" and performs the "default branch" operation
    Then the adapter refuses with an error naming "GITLAB_TOKEN"
    And the recording endpoint received no request

  # ── §4  THE BOUNDARY IS THE ONLY CALLER, AND IT BEHAVES AS IT DOES TODAY (AC2; story 5) ───
  #
  # AC2 is a claim about who calls what, which is a source-tree claim; what is observable is that the
  # boundary's guarantees survive being rebuilt on a new function. FINDING 7: the first row is the
  # one that goes vacuous if the injection seam disappears — three minting records against one
  # identity, or the four files that watch the boundary through that seam are watching nothing.

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

  # An explicit target must never be second-guessed by the local remote — the wrong-repo firewall's
  # oldest invariant, and the one a rewrite of the mint call is most likely to disturb by re-reading
  # identity on the provider path.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A target launch still binds every provider to the argument and never reads the local remote
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary's issue tracker was minted for the repository "octo/infra"
    And the boundary's code host was minted for the repository "octo/infra"
    And the launch boundary never read the local git remote

  # The lazy-mint contract (`freezeBoundary`, `launchGitContext.ts:144-153`). The boundary CALL must
  # stay free of the provider config's I/O, because a target repository is routinely not cloned yet
  # when its boundary is built. An assembly function that validates its forge names eagerly at the
  # boundary call — the natural way to implement "an unknown name throws at launch" — moves the
  # `.adw/providers.md` read forward into a directory that does not exist.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A target repository that has not been cloned yet still gets a boundary and its providers
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    And the workspace for the repository "octo/infra" has not been cloned
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary result carries a git context, an issue tracker, a code host and a board manager
    And the boundary's issue tracker was minted for the repository "octo/infra"

  # FINDING 3. The workspace bind is the consumer that has to stop constructing. The instances must be
  # the boundary's own — a passthrough that re-resolved would satisfy AC2 in the type system and
  # defeat it in fact, since reused instances are the only evidence the identity travelled.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: Binding a workspace reuses the very providers the boundary assembled
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And a cloned workspace whose origin remote names the repository "acme/webapp"
    When the launch boundary is asked for the repository "acme/webapp"
    And a repo context is built for that workspace from the boundary's providers
    Then the repo context carries the same issue tracker and code host instances the boundary minted

  # FINDING 3's observable half, and the one row in §4 that does NOT run in feature-794's world.
  # `LaunchGitContextDeps` has no executor seam, so nothing in that harness can see WHICH context ran
  # `git remote get-url` — the very question this row asks. #819's recording gh seam can: it is a real
  # `GitContext` over a spy executor that records every command, so a remote read performed on the
  # context that was handed in ARRIVES there, and one performed on a context the package built for
  # itself does not. That is the whole discrimination. A builder who keeps a private factory alive
  # inside the provider package to feed `validateGitRemote` passes every other row in this file and
  # fails this one.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The workspace remote is read through the context the caller already holds
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "remote get-url" with "https://github.com/acme/widget.git"
    When a workspace is bound to that git context for the identity "acme/widget"
    Then the remote read reached the recording gh seam
    And the bound workspace carries the identity "acme/widget"

  # And the check the bind exists for must survive: handing in providers is not a way to skip the
  # wrong-repo worktree refusal.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: A workspace whose origin contradicts the boundary is still refused when providers are handed in
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And a cloned workspace whose origin remote names the repository "acme/webapp"
    When the launch boundary is asked for the repository "octo/infra"
    And a repo context is built for that workspace from the boundary's providers and any failure is captured
    Then building the repo context failed naming the repository the remote actually points at

  # ── §5  THE RETIRED NAMES LEAVE THE PACKAGE'S SURFACE (AC2) ───────────────────────────────
  #
  # AC2's "are gone" in the only rot-safe form: a probe that imports the name and a compiler that
  # cannot resolve it. A name deleted from a module but re-exported from the barrel — the single
  # easiest way to "delete" `mintBoundProviders` while every caller keeps working — passes a
  # source-text grep and fails this row.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The retired mint is no longer part of the provider package's surface
    Given a type probe module that reads:
      """
      import { mintBoundProviders } from './providers';

      export const probe = mintBoundProviders;
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile naming the missing member "mintBoundProviders"

  # The deleted module, from the consumer's side. `gitContextFor`, `gitContextForSync` and
  # `gitContextForRepo` all lived in one file; an unresolvable module is the artefact that proves the
  # file is gone rather than emptied, and it is what `checkGitGhGuard.test.ts:601-603` currently
  # asserts by reading the file off disk (FINDING 6).

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The boundary-free context factory module cannot be imported at all
    Given a type probe module that reads:
      """
      import { gitContextForRepo } from './github/gitContextFactory';

      export const probe = gitContextForRepo;
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile reporting the unresolvable module "./github/gitContextFactory"

  # The positive direction, so the section cannot be satisfied by deleting things until nothing
  # compiles. The assembly function must be reachable from the package barrel — it is the library's
  # documented entry point, and #819 put `adws/providers/index.ts` in the extraction scope precisely
  # so the barrel stays resolvable inside the extractable set.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: The assembly function is reachable from the provider package's barrel
    Given a type probe module that reads:
      """
      import { forgeProviders } from './providers';

      export const probe = forgeProviders;
      """
    When the type probe is compiled against the ADW project
    Then the type probe compiles

  # ── §6  THE GUARD HOLDS THE WHOLE OF BOTH PACKAGES (AC3, AC4) ─────────────────────────────
  #
  # THE PIVOT. #819's file ends with a row titled "The transitional wiring file is still not checked"
  # asserting that `adws/providers/repoContext.ts` importing `../core/environment`,
  # `../core/projectConfig`, `../core/logger` and `../github/gitContextFactory` PASSES the guard —
  # it had to, or AC4 of that slice was unreachable without doing this one in the same PR. This
  # outline is that row inverted, and it is the single most important structural row in the file: the
  # same four specifiers must now FAIL. Until the scope entry widens they all pass, so an
  # implementation that removes the imports but forgets the entry leaves AC3 unenforced and this
  # outline red.
  #
  # The fourth specifier is worth naming: `../core/providerConfig` is where #819 already moved the
  # `.adw/providers.md` parser. It reaches the framework not through an import statement but through
  # `repoContext.ts:42-43`'s RE-EXPORT, and the extraction rule collects `export … from` exactly like
  # `import … from` (`extractionRule.ts:124`). Two lines that look like tidy backwards-compatibility
  # are a build failure.

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

  # The new module, and the reason the scope entry must be the DIRECTORY rather than a list of files.
  # `forgeProviders.ts` does not exist yet, so no file entry can name it; and a builder who widens by
  # appending `adws/providers/repoContext.ts` alone leaves every future top-level provider file
  # unguarded, which is how the first re-entanglement lands silently.

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

  # The other direction, and the exact shape the assembly function has to take. Everything it needs
  # resolves inside the extractable set: the executor and the `Logger` port from `adws/gitContext/`,
  # the ports and the `RepoIdentifier` from `../types`, the three adapter packages from its own
  # siblings. An implementation that satisfied the guard by inlining a private logger type instead of
  # taking the port would be passing a test it did not need to pass; a rule that flagged any
  # specifier leaving the file's own directory would fail the build on the very file this issue adds.

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

      export function forgeProviders(input: { identity: RepoIdentifier; gitContext: GitContext; tokenProvider: TokenProvider; logger?: Logger }): BoundProviders {
        void createGitHubIssueTracker; void createGitHubCodeHost;
        void createGitLabCodeHost; void createJiraIssueTracker;
        void input;
        return {} as BoundProviders;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # FINDING 5. The construction allowlist's permanent half, which the stale-entry ratchet is blind to
  # by design. These two rows are the only thing that makes "the allowlist shrinks to
  # `launchGitContext.ts` plus the assembly module" enforceable: the retired site must stop being
  # sanctioned, and the new one must start.

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

  # FINDING 6's last bullet, and PRD story 24. `getRepoInfo` has had no declaration since #821;
  # `gitContextForRepo` loses its declaration here. Both are NAME-based AST matches, and the whole
  # point of keeping them is that they outlive the files that declared them — otherwise the next
  # cwd-derived identity fallback to be written under a familiar name lands unopposed. A builder
  # tidying the guard sets after the deletion breaks this row and nothing else.

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

  # The widen-only ratchet. WIDEN ONLY, NEVER NARROW is a property of a list, and the only way a test
  # sees it is by re-running what every earlier slice pinned. This is the fifth and final widening,
  # so all four predecessors' entries must still fire — including the two #817 file entries and the
  # three #819 ones that a whole-directory widening subsumes, whether or not their list rows survive
  # the tidy-up that reaching `adws/providers/**` invites.

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

  # The anti-relabel row every slice since #816 has re-run. A widening applied to file COLLECTION
  # rather than to the extraction rule alone relabels or swallows an ordinary shell-out; and a
  # widening that stopped pruning the two exempt packages from the whole-repo walk would start
  # flagging the GitHub adapter's sanctioned `gh` command strings under the shell-out rule instead.

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

  # ── §7  THE EXTRACTION GATE: A FILE MOVE, PERFORMED (AC4) ─────────────────────────────────
  #
  # The row this whole issue exists for. #797 proved the git core could be lifted out on its own by
  # copying it into an empty directory and importing it; "extraction is a file move" for BOTH
  # packages is the same proof over both, and it is a strictly stronger statement than the guard's,
  # because the guard reasons about specifiers while this resolves them.
  #
  # The two directories are copied SIDE BY SIDE, preserving their relative layout, because
  # `adws/providers/**` reaching `../gitContext` is an intra-set hop the guard permits and extraction
  # preserves — the packages move together, which is the PRD's scope-collapse decision. The provider
  # barrel is the entry point, so this row transitively resolves `./types`, `./github`, `./gitlab`,
  # `./jira` and whatever `./repoContext` has become. It is the row that cannot be green while
  # `repoContext.ts` still re-exports from `adws/core/`, and it is the row that goes red if the barrel
  # keeps a line pointing at a file the copy did not include.

  @adw-823 @adw-0ja9uv-forgeproviders-assem
  Scenario: Both extractable packages import cleanly when copied out of the framework together
    Given the git context and provider packages are copied side by side into an empty directory
    When the copied provider package is imported as its own entry point
    Then the import of the copied packages succeeds
    And the copied packages resolved no module outside their own directories

  # ── §8  THE RATCHET (AC4, AC5) ────────────────────────────────────────────────────────────
  #
  # Three rows carrying every remaining criterion that is a statement about the tree, in the only
  # form the rot rule permits.
  #
  # The whole-repo guard run shells the real `checkGitGhGuard.ts` binary, so all four rules fire over
  # the real tree at once: extraction-readiness at its final scope, unsanctioned-construction against
  # the rewritten allowlist, cwd-derived-identity against the surviving name sets, and shell-out.
  #
  # The stale-entry row is `main()`'s `findStaleSanctionedEntries` in isolation, and it is the
  # executable form of "`gitContextFactory.ts` is gone": deleting the file removes it from
  # `seenFiles`, its `owner: '#823'` entry is reported stale, and the build stays red until the
  # allowlist edit lands. It fails for the right reason and cannot be satisfied by leaving the file
  # in place.
  #
  # The type-check is the executable form of the rest of AC2 and of every bullet in FINDING 6, and it
  # reaches further than `adws/` — the root `tsconfig.json` includes `**/*.ts`, so `healthCheck.tsx`,
  # `feature-572.steps.ts`, `feature-818.steps.ts`, `feature-819.steps.ts`, the two provider unit
  # suites and the launch-boundary suite are all inside what it asserts. It is the only row that
  # catches the generated-driver import paths before a driver silently writes no output.

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
