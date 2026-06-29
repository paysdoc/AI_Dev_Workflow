@adw-701 @adw-kojzv6-gitcontext-delete-pr
Feature: GitContext capstone — the process-global GH_TOKEN write is gone and the git/gh guard's only exemption is the package directory

  Issue #701 (parent PRD `specs/prd/git-context-repo-authority.md` — the
  **Enforcement** invariant and the **"Removal of the unsafe primitives"** section;
  user stories 2, 5, 7 and 8) is the terminal slice of the GitContext epic. With
  every consumer already routed through a per-command-auth context by the upstream
  slices, the last unsafe primitives are deleted:

    • the process-global `process.env.GH_TOKEN =` MUTATION in `activateGitHubAppAuth`
      and `refreshTokenIfNeeded` (`adws/github/githubAppAuth.ts`) — the *write* side of
      the bleed, the twin of #700's deleted *read*-side fall-through;
    • the webhook startup `activateGitHubAppAuth()` (`adws/triggers/trigger_webhook.ts`);
    • the surgical `adwUpgrade` (and nominally `adwMerge`) activate-auth stopgaps,
      superseded by the per-event `buildLaunchGitContext`;
    • the `ALLOWLIST` array in `adws/checkGitGhGuard.ts`, leaving `EXEMPT_PACKAGE_DIR`
      (`adws/gitContext`) as the guard's only file exemption.

  Why the DELETIONS in this slice have no harness-drivable RED — though the slice is NOT a
  pure no-op (read this before expecting RED tests):

    Most behavioural guarantees #701 protects were already MADE TRUE by the slices it is
    blocked on. Per-command auth isolation — a command carries the context's own token in
    its CHILD environment and never the process-global — is #658/#659's contract. The
    two-repo interleave with no cross-repo bleed is #659's. The guard ratchet reaching
    ZERO allowlisted files is #700's. The ONE consumer still reading the process-global is
    the Claude CLI SUBPROCESS: `getSafeSubprocessEnv()` copies `process.env.GH_TOKEN` +
    `GIT_*` into the child env spawned at `claudeAgent.ts`, so the `process.env.GH_TOKEN`
    write is NOT dormant — it still feeds that subprocess. #701 therefore FIRST re-sources
    the subprocess auth from the launch-boundary GitContext (the `commandEnv()` overlay —
    plan Phase 1, a real behavioural change verified by the Step 11 unit tests) so the
    subprocess never depends on the global, THEN deletes the now-superseded `process.env`
    write and the already-EMPTY `ALLOWLIST` array.

    Consequently there is no honest, harness-drivable RED scenario for the deletions
    themselves:

      • The write only fires on a SUCCESSFUL installation-token mint, and the mint
        (`getInstallationToken`) curls real `api.github.com` — un-mockable in the BDD
        harness, with no injection seam on `activateGitHubAppAuth`. A harness invocation
        takes the App-not-configured early return and never reaches the write, on BOTH
        sides of the change. So "the write is gone" has no isolated observable.
      • The `ALLOWLIST` array is already empty, so removing it changes no guard VERDICT —
        only the guard's source and its printed allowlist count (neither an honest
        behavioural target).

    This slice therefore does NOT fabricate a RED. Its scenarios are REGRESSION GUARDS:
    they pin that the deletions preserved the established invariants and that a BOTCHED
    deletion is caught. The whole-repo guard run goes red if the `ALLOWLIST` removal
    leaves a dangling `ALLOWLIST.length` reference (the guard crashes instead of
    reporting "no violations"); the type-check goes red if any of the five edited files
    fails to compile (a stopgap removed but its import left behind). The HITL label means
    a human verifies the source-level deletions a behaviour test cannot.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never the
    static text of a source file. No step opens `githubAppAuth.ts`, `checkGitGhGuard.ts`,
    `trigger_webhook.ts`, `adwUpgrade.tsx`, or `adwMerge.tsx` as text, substring-matches
    its contents, or parses it as JSON/AST.

      • §1 asserts the git/gh guard tool's runtime OUTPUT — its process verdict across the
        whole repository, and, per file, whether the guard SCANNED that file (it is not
        exempt) and found no violation in it. The guard run, not the guard's source, is
        the artefact (the same category as registry T22, which runs an analyzer over the
        tree and asserts its verdict). The repository the guard scans is INPUT; the verdict
        is the OUTPUT.
      • §2 drives the per-event GitContext construction the webhook performs (the real
        `buildLaunchGitContext` seam, reused here as the #659 recording-runner) for two
        interleaved multi-repo events and observes the OUTPUTS: the auth token each
        event's command carries in its CHILD environment (a recorded-invocation value),
        and the live `process.env.GH_TOKEN` before/after (the canonical observable for
        "did the hot path mutate the global", which the Rot-Detection Rubric permits).
        The tokens and owner/repo are INPUT test data; the recorded child env and the
        live process env are the system's OUTPUTS.
      • §3 asserts the type-checker's VERDICT (registry T22).

  Vocabulary note:

    This slice introduces ZERO new step phrasing — it is composed entirely of phrases
    already registered or established by the GitContext corpus. generate_step_definitions
    MUST NOT redefine any of them, or Cucumber raises a duplicate step definition.

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`              (background, §1, §3)
      T22 `the ADW TypeScript type-check passes`         (§3, via feature-504.steps.ts)

    Guard phrases reused VERBATIM from feature-691.steps.ts (globally registered there):
      • `the git/gh guard is run across the repository`
      • `the git/gh guard reports no violations`
      • `the git/gh guard scans the file {string}`
      • `the git/gh guard scanned that file`
      • `the git/gh guard reports no violation in that file`

    Recording-runner / interleave phrases reused VERBATIM from feature-659.steps.ts
    (globally registered via `gitContextSharedWorld.ts`; its untagged After restores
    `GH_TOKEN` and resets the shared world for every scenario, including @adw-701):
      • `a GitContext for owner {string} repo {string} with auth token {string}`
      • `each context's git and gh commands are captured by a recording runner`
      • `the parent process environment has auth token {string}`
      • `an operation on the {string} context and an operation on the {string} context are interleaved in one process`
      • `the {string} command ran with auth token {string} in its child environment`
      • `the {string} command's child environment does not carry auth token {string}`
      • `the parent process environment still has auth token {string}`

  Scope / honesty notes (surfaced to the maintainer in the agent Output):

    • The literal deletions (the `process.env.GH_TOKEN` write, the `ALLOWLIST` array, the
      `adwUpgrade`/`adwMerge` stopgaps) are SOURCE changes with no isolated observable.
      Rot-prevention forbids asserting them directly; they are gated INDIRECTLY by §1
      (a broken `ALLOWLIST` removal fails the whole-repo guard), §3 (a broken edit fails
      the type-check), the existing webhook/orchestrator suites (their behaviour is
      unchanged), and HITL human review.
    • `adws/adwMerge.tsx` carries NO activate-auth stopgap today (it already builds a
      per-event context via `buildLaunchGitContext`); the issue's adwMerge edit is a
      no-op. §1's per-file scan still pins it stays guard-clean and non-exempt.
    • §2 deliberately REUSES #659's two-context interleave machinery — it IS the webhook's
      real per-event seam — combining it with a foreign process-global token and a
      parent-env-unchanged assertion to express, in one scenario, the post-#701 contract:
      with the global write deleted, two interleaved per-event contexts each carry their
      own token, neither carries the other's, and the hot path leaves the process-global
      token untouched. This is a regression guard for the write-deleted world, not a
      re-derivation of #659's isolation proof.
    • DOWNSTREAM IMPACT — removing the `ALLOWLIST` array also removes the guard's printed
      `(${ALLOWLIST.length} allowlisted)` count. feature-700 §4b's step
      `the git/gh guard reports zero allowlisted files` (feature-700.steps.ts) regex-matches
      that printed count; it must be updated to treat an ABSENT count as zero allowlisted
      (vacuously true once no allowlist exists), or #700 §4b breaks. Flagged in the Output.
    • The @regression maintenance sweep is SKIPPED: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion is a deliberate human decision and
      the agent never auto-promotes.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  THE GUARD'S ONLY EXEMPTION IS THE PACKAGE DIR (stories 2 & 5) ══
  #
  # With the ALLOWLIST array removed, the guard's sole file exemption is the gitContext
  # package (EXEMPT_PACKAGE_DIR, applied in the whole-repo directory walk). §1a is the
  # whole-repo verdict: it still PASSES — proving both that no non-package file harbours a
  # raw git/gh shell-out AND that the package-dir exemption alone suffices (the package
  # legitimately CONTAINS raw git/gh — it mints, clones, fetches — yet the guard passes).
  # It is also the backstop for a botched removal: a dangling ALLOWLIST reference makes the
  # guard crash rather than report "no violations". §1b pins that the #701-touched,
  # non-package consumers are SCANNED (not exempt — there is no allowlist to hide behind)
  # and carry no direct git/gh shell-out.

  # ── §1a  the whole-repo guard still passes with the package dir the sole exemption ──

  @adw-701 @adw-kojzv6-gitcontext-delete-pr
  Scenario: The git/gh guard passes across the whole repository once the ALLOWLIST array is removed and only the package directory is exempt
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ── §1b  each #701-touched non-package consumer is scanned (not exempt) and clean ───

  @adw-701 @adw-kojzv6-gitcontext-delete-pr
  Scenario Outline: The git/gh guard scans each #701-touched non-package file and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                              |
      | adws/triggers/trigger_webhook.ts  |
      | adws/adwUpgrade.tsx               |
      | adws/adwMerge.tsx                 |

  # ═══════════════ §2  INTERLEAVED MULTI-REPO WEBHOOK EVENTS STAY TOKEN-ISOLATED ═══════
  #                     (stories 7 & 8 — the bleed root deleted)
  #
  # Acceptance: "webhook handles interleaved multi-repo events without bleed." The webhook
  # constructs exactly one immutable per-event GitContext per event (the buildLaunchGitContext
  # seam), so auth rides the per-event context, never a mutable process-global. With the
  # process-global write deleted, NOTHING pins or clobbers a shared global between events.
  #
  # This scenario drives that exact seam (the #659 recording-runner) for two interleaved
  # events — acme/webapp and octo/infra — while a FOREIGN token sits in the process-global
  # GH_TOKEN (modelling the bleed source the deleted write created). Each event's command
  # carries its OWN repo's token in its child environment, neither carries the other's, and
  # the hot path leaves the process-global token exactly as it found it — performing no
  # process-global mutation.

  @adw-701 @adw-kojzv6-gitcontext-delete-pr
  Scenario: Two interleaved multi-repo webhook events each authenticate with their own per-event token, with no cross-repo bleed and no process-global mutation
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme"
    And a GitContext for owner "octo" repo "infra" with auth token "token-octo"
    And each context's git and gh commands are captured by a recording runner
    And the parent process environment has auth token "ghp-foreign-bleed-source"
    When an operation on the "acme/webapp" context and an operation on the "octo/infra" context are interleaved in one process
    Then the "acme/webapp" command ran with auth token "token-acme" in its child environment
    And the "octo/infra" command ran with auth token "token-octo" in its child environment
    And the "acme/webapp" command's child environment does not carry auth token "token-octo"
    And the "octo/infra" command's child environment does not carry auth token "token-acme"
    And the parent process environment still has auth token "ghp-foreign-bleed-source"

  # ═══════════════ §3  TYPE-CHECK BACKSTOP (registry T22) ═══════════════════════════
  #
  # The capstone backstop: the deleted write, the removed ALLOWLIST array, and the removed
  # upgrade/merge stopgaps must all compile within the ADW codebase. This is what catches a
  # botched deletion — a stopgap removed but its import left behind, or `ALLOWLIST.length`
  # referenced after the array is gone — that a behaviour test cannot see.

  @adw-701 @adw-kojzv6-gitcontext-delete-pr
  Scenario: The ADW TypeScript type-check passes after the global-token write, the ALLOWLIST array, and the upgrade/merge auth stopgaps are removed
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
