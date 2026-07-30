@adw-700 @adw-wz7osl-gitcontext-absorb-bo
Feature: GitContext absorbs bootstrap construction and enforces token veracity — the launch boundary resolves a token bound to the context's own owner/repo (no ambient process-global fallback), the bootstrap files leave the git/gh guard ALLOWLIST, and the base-path + auth-isolation pillars survive the absorption

  Issue #700 (parent PRD `specs/prd/git-context-repo-authority.md` — the **Auth
  model** and **"Removal of the unsafe primitives"** sections — and user stories 2,
  7 and 23) is the CAPSTONE of the GitContext epic. It is **Blocked by #691, #692,
  #693, #694, #695, #696, #697, #698 and #699**: every one of those slices migrated a
  disjoint consumer family off raw `git`/`gh` and shrank the SAME `checkGitGhGuard.ts`
  ALLOWLIST, until the only entries left are the four BOOTSTRAP files — the ones that
  cannot route through a GitContext because they are the code that BUILDS one. This
  slice closes the epic by taking those four to zero.

  The four bootstrap files and why they are unmigratable-as-consumers:

    • `adws/github/githubAppAuth.ts`   — mints the GitHub App installation token (the
                                          curl JWT dance + a `git remote get-url origin`
                                          probe). The token does not exist yet.
    • `adws/github/gitContextFactory.ts` — derives identity and resolves the token, then
                                          calls `new GitContext(...)`. It runs BEFORE the
                                          context exists.
    • `adws/core/launchGitContext.ts`  — the launch-boundary adapter that builds exactly
                                          one GitContext per process. Same chicken-and-egg.
    • `adws/core/targetRepoManager.ts` — `git clone` / `git fetch origin` / `gh repo view
                                          --json defaultBranchRef`. These run against a
                                          workspace that is not yet a repo, so there is no
                                          base path for a context to spawn under.

  What this slice builds (two contracts, one capstone):

    (A) ABSORPTION / DE-ALLOWLISTING (stories 2 & 7). The bootstrap construction, the
        clone/fetch/default-branch resolution, and the token mint are moved INSIDE the
        gitContext package (`adws/gitContext/`), which the guard treats as STRUCTURALLY
        EXEMPT, OR are reworked to use verified per-command auth — implementer's choice,
        deliberately NOT pinned (consistent with every sibling slice's "pin the decision,
        not the shape" stance). Either way the four `ALLOWLIST` entries are removed, the
        ratchet reaches ZERO, and `lint:git-guard` still passes across the whole repo.

    (B) TOKEN VERACITY (stories 7 & 23). A context's token must be a mint BOUND to its
        own owner/repo. The `resolveToken` fall-through to the ambient process-global
        `GH_TOKEN` is REMOVED: when no bound mint is obtainable, resolution fails LOUDLY
        (naming the owner/repo) instead of silently adopting whatever repo last wrote the
        process-global token. This is the fix for the `fetchLatestRefs` crash class AT
        ITS ROOT.

  Why (B) is the root-cause fix — the exact defect foreclosed:

    Both `resolveToken` (in `gitContextFactory.ts`) and `resolveLaunchToken` (in
    `launchGitContext.ts`) end their resolution chain the same way: if the GitHub App
    installation mint for `owner/repo` is unavailable — because the App is not
    configured, OR because `getInstallationToken(owner, repo)` THROWS for a repo the App
    is not installed on (a FOREIGN repo) — they fall through to `process.env.GH_TOKEN`.
    That ambient global is whatever repo's token was last written into the process, so a
    context for repo A silently acquires repo B's token. Downstream, the first command
    that actually contacts the remote — `targetRepoManager.fetchLatestRefs` (`git fetch
    origin`) — authenticates as the wrong installation and detonates. The whole
    "wrong-base-repo / GH_TOKEN-bleed" incident class the PRD mined traces back to this
    one silent fall-through. Deleting it converts a silent mis-auth into a loud,
    immediate, owner/repo-named failure at construction time — before any clone, fetch,
    or default-branch read can run against the wrong identity.

  The guard subtlety this slice turns on (why it does NOT reuse the #696–#699 pattern):

    The migration slices proved "de-allowlisted" by scanning the consumer file directly
    (`scanFiles([path])` → scannedCount === 1, zero violations): the file was no longer
    exempt AND its raw calls were gone. That pattern is UNAVAILABLE here. The guard skips
    files TWO different ways, and only one is observable per-file:

      • ALLOWLIST entries are skipped INSIDE `scanFiles` (a `continue` that does not even
        count the file).
      • The gitContext PACKAGE is skipped one level up, in the whole-repo directory walk,
        which simply never adds package files to the scan list.

    A bootstrap file absorbed INTO the package is exempt only by the second mechanism. It
    still contains genuine raw `git`/`gh` (it mints, clones, fetches — that is its job),
    so scanning it DIRECTLY would report violations, and scanning its OLD path after a
    move throws (the file is gone). Therefore #700's guard proof is the WHOLE-REPO run
    (`lint:git-guard`, exit 0) PLUS the capstone the epic was always driving toward: the
    guard's own runtime report shows ZERO allowlisted files. There is no honest per-file
    `scannedCount === 1` assertion for an absorbed bootstrap file, and this slice does not
    fake one.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never the
    static text of a source file. No step opens `gitContextFactory.ts`,
    `launchGitContext.ts`, `targetRepoManager.ts`, `githubAppAuth.ts`, `gitContext.ts`,
    or `checkGitGhGuard.ts` as text, substring-matches its contents, or parses it as
    JSON/AST.

      • §1 drives the REAL absorbed launch-boundary token resolution against INJECTED
        token sources (a deterministic per-owner/repo installation mint; a controllable
        ambient global) and observes the OUTPUT: the token the resulting context hands to
        its per-command child environment (`commandEnv().GH_TOKEN`, a pure method — a
        runtime value, not a source read), or the error thrown when resolution fails
        loudly. The ambient global is seeded into the LIVE `process.env` (the canonical
        observable for "did it adopt the global"), which the Rot-Detection Rubric permits.
      • §2 and §3 assert the constructed context's runtime behaviour — its resolved base
        path (a computed value) and the cwd / child `env` it hands a RECORDING RUNNER at
        the command boundary (the same recorded-invocation channel the whole GitContext
        epic uses), plus the live `process.env` before/after a command. Runtime artefacts,
        not source text.
      • §4 asserts the guard tool's runtime OUTPUT: its process exit status (`lint:git-
        guard` pass/fail) and the `(M allowlisted)` count it PRINTS at run time. This is
        the same artefact category as registry T22 ("the ADW TypeScript type-check
        passes"), which runs an analyzer over the source tree and asserts its VERDICT, not
        the source. "Removed from the ALLOWLIST" is proven only through its observable
        consequence — the guard reports zero allowlisted files while still passing — never
        by grepping the ALLOWLIST array.
      • §5 asserts the type-check VERDICT (T22).

    The owner/repo, token values, mint-binding, and file inputs in the steps are INPUT
    test data; the resolved per-command token, the thrown error, the recorded `(cwd,
    env)`, the live `process.env`, the guard's exit status and printed allowlist count,
    and the type-check exit code are the system's OUTPUTS — exactly the artefact category
    the rubric permits. §1–§3 spawn no real `git`/`gh` and touch no network or filesystem
    (the mint and the command boundary are injected), so they are hermetic.

  Scope notes:

    • The implementer's choice between ABSORBING a bootstrap file into the package and
      reworking it onto verified per-command auth is NOT pinned. §1 pins the OBSERVABLE
      token-veracity contract (bound mint preferred; ambient global never adopted; loud
      failure) which holds under either; §4 pins the OBSERVABLE end state (guard passes;
      allowlist empty) which also holds under either.
    • §1 drives the REAL resolution logic (including the now-deleted fall-through), so the
      absorbed resolver must expose its token SOURCES as an injection seam (a mint
      function bound per owner/repo, plus a way to neutralise the PAT and `gh auth token`
      sources so a scenario can isolate the ambient-global path). This is the one piece of
      new machinery this slice requires; it is surfaced to the maintainer in the agent
      Output and detailed in the Step-definition note. The scenarios assert the context's
      OUTPUT token, not the resolver's internal precedence — a rename or re-home of the
      resolver during absorption leaves them valid.
    • #700 removes ONLY the AMBIENT-GLOBAL (`process.env.GH_TOKEN`) fall-through, per the
      acceptance criterion. It does NOT claim the PAT or `gh auth token` sources are
      removed; §1's loud-failure scenarios deliberately neutralise those so the test
      isolates the ambient-global path the issue names.
    • Construction-time base-path resolution (self-host → framework root; target →
      `join(targetReposDir, owner, repo)`) and the per-command auth-isolation matrix are
      already proven EXHAUSTIVELY by #658 and #659. §2 and §3 do NOT re-derive them — they
      pin a single representative of each as a REGRESSION guard, because #700 reworks the
      construction/auth path and the acceptance criterion explicitly requires the
      "GitContext base-path + auth-isolation tests green". They reuse #659's
      recording-runner phrases verbatim, so no new isolation machinery is introduced.
    • Auth ACQUISITION semantics OTHER than the deleted fall-through (App JWT minting,
      token caching/refresh, the installation-id resolution) are unchanged and already
      covered by `githubAppAuth`'s unit suite and feature-535's token-leak coverage; this
      slice does not re-drive the minting path, an orchestrator, or the cron poller as a
      subprocess.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`        (background + §4 + §5)
      T22 `the ADW TypeScript type-check passes`    (§5 backstop, via feature-504.steps.ts)

    Phrases reused VERBATIM from the GitContext per-issue corpus (established by
    feature-659, globally registered via `gitContextSharedWorld.ts` / feature-659.steps.ts;
    NOT yet in the registry) so §2/§3 share #659's recording-runner, perturbation, and
    parent-env machinery — generate_step_definitions must NOT redefine them, or Cucumber
    raises a duplicate step definition:
      • `a GitContext for owner {string} repo {string} with auth token {string} and git author {string}`
      • `the context's git and gh commands are captured by a recording runner`
      • `the process working directory is changed away from the context base path`
      • `the parent process environment has auth token {string}`
      • `a baseline snapshot of the parent process environment is captured`
      • `the {string} read operation runs through the context`
      • `the captured command ran with auth token {string} in its child environment`
      • `the captured command ran with cwd equal to the context base path`
      • `the parent process environment matches the baseline snapshot`

    Guard phrases reused VERBATIM from feature-691.steps.ts (globally registered there —
    generate_step_definitions must NOT redefine them):
      • `the git/gh guard is run across the repository`
      • `the git/gh guard reports no violations`

    Novel phrasing introduced here — the registry and the corpus have no phrase for
    driving the launch-boundary token RESOLUTION (every existing GitContext Given supplies
    the token directly; §1 must NOT, because the token IS what it tests), nor for the
    "zero allowlisted" capstone read. Surfaced to the maintainer in the agent Output:
      Token-source configuration + launch-boundary build (§1):
        • `the GitHub App is configured to mint installation tokens bound to each owner and repo`
        • `the GitHub App is not configured to mint installation tokens`
        • `the installation mint for owner {string} repo {string} is unavailable`
        • `a launch GitContext is built for owner {string} repo {string}`
        • `the built context carries the installation token bound to owner {string} repo {string} as its per-command GitHub token`
        • `the built context does not carry the foreign ambient token {string}`
        • `building the launch context fails loudly naming owner {string} repo {string}`
        • `the built context base path is the target workspace for owner {string} repo {string}`   (§2)
      Guard ratchet capstone (§4):
        • `the git/gh guard ratchet is measured across the repository`
        • `the git/gh guard reports zero allowlisted files`

    Step-definition note for the maintainer:
      • §1/§2a use a SMALL #700-local world (in feature-700.steps.ts), independent of the
        shared `W`. Hold the injectable token SOURCES there: an `appConfigured` flag and a
        deterministic mint `(owner, repo) => 'installation-token::' + owner + '/' + repo`
        (so "the installation token bound to owner X repo Y" is a value the assertion step
        recomputes — never hard-coded in the .feature), plus inert PAT / `gh auth token`
        sources. `the installation mint for owner X repo Y is unavailable` marks that one
        key so the mint THROWS for it (the foreign-repo path) while remaining available
        for others. The `a launch GitContext is built for owner X repo Y` When calls the
        REAL absorbed builder for a TARGET repo — `buildLaunchGitContext({ owner, repo,
        ... }, deps)` — injecting `targetReposDir` and `frameworkRepoRoot` SENTINELS
        (reuse `TARGET_REPOS_ROOT` / `FRAMEWORK_ROOT` from `gitContextSharedWorld.ts`), a
        fixed `resolveGitIdentity`, and — crucially — the REAL source-parameterised
        resolver bound to the #700 world's sources (do NOT inject a fake `resolveToken`;
        inject the real resolver with TEST sources, so the deleted fall-through is what is
        under test). Capture the returned context on the #700 world, or the thrown error.
      • The ambient global is seeded with #659's `the parent process environment has auth
        token {string}` (it saves and restores `process.env.GH_TOKEN`); rely on
        feature-659.steps.ts's existing `After` to restore `GH_TOKEN`. The #700 `After`
        must reset ONLY the #700-local world (sources, captured ctx/error) and must NOT
        touch `GH_TOKEN`, to avoid racing #659's restore.
      • `the built context carries the installation token bound to owner X repo Y …`
        asserts `ctx.commandEnv().GH_TOKEN === mint(X, Y)`. `the built context does not
        carry the foreign ambient token T` asserts `ctx.commandEnv(process.env).GH_TOKEN
        !== T` (command-time env with the ambient as base — the context must OVERRIDE it)
        and that no identity env value equals T. `building the launch context fails loudly
        naming owner X repo Y` asserts a thrown error whose message contains `X/Y` (the
        real builders throw `… for ${owner}/${repo}`) — proving it is the loud no-bound-
        mint failure, not an unrelated crash. `the built context base path is the target
        workspace for owner X repo Y` asserts `ctx.basePath === join(TARGET_REPOS_ROOT, X,
        Y)`.
      • §2b/§3 resolve entirely to feature-659.steps.ts (shared `W`): the construction
        Given, the recording-runner Given, the cwd perturbation, the ambient-token Given,
        the baseline snapshot, the read-op When, and the token/cwd/parent-env assertions.
        Add NO new definitions and NO new `After` for them.
      • §4a resolves to feature-691.steps.ts. `the git/gh guard ratchet is measured across
        the repository` (§4b) is a NEW When that spawns `bunx tsx adws/checkGitGhGuard.ts`,
        capturing BOTH exit status and stdout into the #700 world. `the git/gh guard
        reports zero allowlisted files` regex-matches the printed `(\d+) allowlisted` group
        and asserts it equals 0. (The `/` in the guard phrases is escaped in the step-def
        as `git\/gh`, exactly as feature-691.steps.ts does, so Cucumber treats it as a
        literal slash, not alternation.) §5 resolves to feature-504.steps.ts (T22).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  TOKEN VERACITY AT THE LAUNCH BOUNDARY (stories 7 & 23) ══════
  #
  # The star of this slice and the root fix for the fetchLatestRefs crash class. The
  # launch boundary must resolve a token that is an installation mint BOUND to the
  # context's own owner/repo, and must NEVER fall back to the ambient process-global
  # GH_TOKEN. Each scenario drives the REAL absorbed resolution logic against injected
  # sources and observes the token the resulting context hands its per-command child
  # environment — or the loud failure when no bound mint exists.

  # ── §1a  the bound mint is used, and the ambient global is ignored ────────────────
  #
  # The positive veracity case. With the App configured and a FOREIGN ambient GH_TOKEN
  # sitting in the environment (the exact bleed source), the context built for acme/webapp
  # carries the mint bound to acme/webapp — not the foreign global. The App branch resolves
  # the bound mint and the ambient global is never consulted.

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: A launch GitContext built while the App is configured carries the installation token bound to its own owner and repo, not the ambient process-global token
    Given the GitHub App is configured to mint installation tokens bound to each owner and repo
    And the parent process environment has auth token "ghp-ambient-foreign-other-repo"
    When a launch GitContext is built for owner "acme" repo "webapp"
    Then the built context carries the installation token bound to owner "acme" repo "webapp" as its per-command GitHub token
    And the built context does not carry the foreign ambient token "ghp-ambient-foreign-other-repo"

  # ── §1b  the mint is bound to the SPECIFIC owner/repo being constructed ────────────
  #
  # Veracity is per-identity, not a shared global: building for two different repos yields
  # two different bound mints. A token minted for acme/webapp is not the token minted for
  # octo/infra — which is precisely why an ambient global (one token for all repos) is the
  # wrong thing to fall back to.

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario Outline: The launch boundary mints a token bound to the specific owner and repo it is constructing for
    Given the GitHub App is configured to mint installation tokens bound to each owner and repo
    When a launch GitContext is built for owner "<owner>" repo "<repo>"
    Then the built context carries the installation token bound to owner "<owner>" repo "<repo>" as its per-command GitHub token

    Examples:
      | owner | repo   |
      | acme  | webapp |
      | octo  | infra  |

  # ── §1c  a FOREIGN / uninstalled mint fails loudly — never the ambient global ──────
  #
  # The headline RED test for the deleted fall-through. The App is configured, but the
  # installation mint for THIS owner/repo is unavailable — the App is not installed on
  # acme/webapp, so the mint throws. Pre-#700 the resolver swallowed that throw and
  # returned the ambient process-global GH_TOKEN (some OTHER repo's token), and the next
  # `git fetch origin` detonated. Post-#700 construction fails loudly, naming the owner and
  # repo, and the ambient global is never adopted.

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: When the installation mint for the context's own owner and repo is unavailable, the launch boundary fails loudly instead of falling back to the ambient process-global token
    Given the GitHub App is configured to mint installation tokens bound to each owner and repo
    And the installation mint for owner "acme" repo "webapp" is unavailable
    And the parent process environment has auth token "ghp-ambient-foreign-other-repo"
    When a launch GitContext is built for owner "acme" repo "webapp"
    Then building the launch context fails loudly naming owner "acme" repo "webapp"

  # ── §1d  no mint configured at all, only the ambient global → still a loud failure ──
  #
  # The second path into the same deleted fall-through: the App is not configured, so the
  # only legacy candidate left (after the PAT and `gh auth token` sources are neutralised)
  # is the ambient process-global token. #700 removes it as a candidate, so resolution
  # fails loudly rather than silently adopting an unbound global.

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: When no installation mint is configured and only the ambient process-global token is present, the launch boundary fails loudly instead of adopting it
    Given the GitHub App is not configured to mint installation tokens
    And the parent process environment has auth token "ghp-ambient-foreign-other-repo"
    When a launch GitContext is built for owner "acme" repo "webapp"
    Then building the launch context fails loudly naming owner "acme" repo "webapp"

  # ═══════════════ §2  BASE-PATH RESOLUTION SURVIVES THE ABSORPTION (story 2) ═══════
  #
  # Acceptance: "GitContext base-path … tests green". Moving the construction boundary
  # must not disturb where a context resolves its base path. §2a proves the ABSORBED
  # launch boundary still computes a target context's base path as the target workspace;
  # §2b re-pins the wrong-base-repo invariant #659 owns — a command spawns under the base
  # path, never the ambient process cwd — as a regression guard, reusing #659's machinery.

  # ── §2a  the launch-built target context resolves its base path to the workspace ───

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: A launch GitContext built for a target repo resolves its base path to that repo's target workspace
    Given the GitHub App is configured to mint installation tokens bound to each owner and repo
    When a launch GitContext is built for owner "acme" repo "webapp"
    Then the built context base path is the target workspace for owner "acme" repo "webapp"

  # ── §2b  a command spawns under the base path even when process.cwd() has moved ────
  #
  # Regression guard (the wrong-base-repo invariant). The command's cwd is the context's
  # base path, independent of the ambient working directory the process happens to sit in.

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: A context command spawns under the context base path even when the process working directory has moved away
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the process working directory is changed away from the context base path
    When the "default-branch" read operation runs through the context
    Then the captured command ran with cwd equal to the framework repository root

  # ═══════════════ §3  PER-COMMAND AUTH ISOLATION SURVIVES THE ABSORPTION (story 7) ══
  #
  # Acceptance: "… auth-isolation tests green". The whole epic exists to kill the shared
  # process-global GH_TOKEN; #700 hardens that at the RESOLUTION layer, and these guards
  # confirm the APPLICATION layer is undisturbed. §3a re-pins the property that makes the
  # bleed impossible: a command carries the context's OWN token even after the ambient
  # global is overwritten with a foreign value mid-process. §3b re-pins that an operation
  # never mutates the parent environment. Both reuse #659's recording-runner verbatim.

  # ── §3a  a command keeps its own token after the ambient global is overwritten ─────

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: A context command carries its own token even after the ambient process-global token is overwritten with a foreign value
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the parent process environment has auth token "token-foreign-clobber"
    When the "default-branch" read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment

  # ── §3b  an operation leaves the parent process environment byte-for-byte unchanged ─

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: A context operation leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "default-branch" read operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §4  THE GUARD RATCHET REACHES ZERO (stories 2 & 7) ═══════════════
  #
  # The capstone. With the four bootstrap files absorbed into the structurally-exempt
  # package (or reworked onto verified per-command auth), the ALLOWLIST has no entries
  # left. §4a is the safe-de-allowlisting backstop — `lint:git-guard` still passes across
  # the whole repo, so removing the entries surfaced no violation. §4b is the epic's
  # terminal state, read straight off the guard's own runtime report: ZERO allowlisted
  # files. (There is no per-file scan here: an absorbed bootstrap file still contains
  # genuine raw git/gh and is exempt only via the whole-repo package skip, so the only
  # honest proof is the whole-repo run plus the printed allowlist count.)

  # ── §4a  the whole-repo guard still passes (lint:git-guard) ────────────────────────

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: The git/gh guard passes across the whole repository after the bootstrap files are absorbed and de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ── §4b  the guard reports zero allowlisted files (the ratchet's terminal state) ───

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: The git/gh guard reports zero allowlisted files once the last bootstrap entries are removed
    Given the ADW codebase is checked out
    When the git/gh guard ratchet is measured across the repository
    Then the git/gh guard reports zero allowlisted files

  # ═══════════════ §5  TYPE-CHECK BACKSTOP (registry T22) ═══════════════════════════
  #
  # Consistent with every sibling per-issue slice: the absorbed construction, the moved
  # mint/clone/fetch code, and the token-veracity change all compile within the ADW
  # codebase's type-check. This is also the backstop that catches a botched move — an
  # absorbed file's imports must be re-homed, and a broken import surfaces here.

  @adw-700 @adw-wz7osl-gitcontext-absorb-bo
  Scenario: The ADW TypeScript type-check passes with the absorbed bootstrap and token-veracity surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
