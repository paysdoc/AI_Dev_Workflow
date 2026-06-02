@adw-535 @adw-pof86n-chore-remove-github
Feature: GITHUB_PAT is the single canonical GitHub token env var — the GITHUB_PERSONAL_ACCESS_TOKEN alias is removed

  Issue #535 retires the vestigial `GITHUB_PERSONAL_ACCESS_TOKEN` env-var alias
  inherited from the original course and consolidates on `GITHUB_PAT` as the one
  canonical name. The env-var name is orthogonal to the token *format* — a
  fine-grained `github_pat_...` token and a classic `ghp_...` token both work
  equally well inside an env var called `GITHUB_PAT` — so a second name buys
  nothing and invites the failure mode where an operator sets one name while the
  code reads the other.

  The change touches three runtime surfaces, each exercised below:

    1. Token resolution (`adws/core/environment.ts`). The exported `GITHUB_PAT`
       drops its `|| process.env.GITHUB_PERSONAL_ACCESS_TOKEN` fallback, so the
       resolved token comes from `process.env.GITHUB_PAT` alone.
    2. Subprocess forwarding (`getSafeSubprocessEnv()` in the same module).
       `GITHUB_PERSONAL_ACCESS_TOKEN` leaves the `SAFE_ENV_VARS` allowlist, so it
       is no longer forwarded to Claude CLI subprocesses.
    3. The environment-variable health check (`checkEnvironmentVariables()` in
       `adws/healthCheckChecks.ts`). `GITHUB_PERSONAL_ACCESS_TOKEN` leaves the
       optional-vars list, so the health report no longer recognises it.

  Operator-visible breaking change:

    Anyone whose `.env` sets only `GITHUB_PERSONAL_ACCESS_TOKEN` (and not
    `GITHUB_PAT`) silently loses the GitHub token after this change: it stops
    feeding the resolved PAT (§1), stops reaching subprocesses (§2), and stops
    being surfaced by the health check (§3). The "only the alias is set" scenario
    in each section pins that consequence so the regression is intentional and
    documented, not an accident. The remedy — rename the env var to `GITHUB_PAT`
    — belongs in the PR body and the changelog/app_docs entry.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system *produces at runtime*,
    never the text of a source file:

      • §1 asserts the resolved value of the `GITHUB_PAT` export — the literal
        runtime value the rest of ADW consumes — captured from a fresh ADW
        process launched with a controlled environment (a fresh process is
        required only because the export is evaluated once at module load and
        cached by the module system).
      • §2 asserts the object returned by the safe-subprocess-environment
        builder — an output, like a recorded call, not a source file.
      • §3 asserts the `CheckResult` returned by the health check — again a
        produced output.
      • §4 asserts the type-checker's verdict.

    No step reads `adws/core/environment.ts`, `adws/healthCheckChecks.ts`, or any
    other source file as text, parses it as JSON/AST, or substring-matches its
    contents. The fix is proven behaviourally — by what the system resolves,
    forwards, and reports — exactly as the framework Rot-Prevention rule and
    `features/regression/vocabulary.md` Rot-Detection Rubric require.

  Scope notes:

    • The PAT-swap behaviour in `adws/github/projectBoardApi.ts`,
      `githubBoardManager.ts`, and `prApi.ts` is a non-goal and unchanged; this
      file only pins *which env var* feeds the resolved PAT, not how the PAT is
      subsequently used.
    • Both token formats (fine-grained `github_pat_...` and classic `ghp_...`)
      remain supported; §1 deliberately feeds a `github_pat_...`-shaped value
      through the canonical `GITHUB_PAT` name to make the format/name
      orthogonality explicit. (The operational recommendation — a classic PAT
      with `project` scope for Projects V2 GraphQL — is documentation added to
      `.env.sample` and the README, not a runtime behaviour, so it is not
      asserted here.)
    • Renaming `GITHUB_PAT` to anything else is a non-goal; these scenarios
      intentionally fail if the canonical accessor is renamed, because that would
      be a public-contract change.
    • The documentation edits in the issue scope — `app_docs/`, `specs/`,
      `.env.sample`, and the `README` — are not covered by scenarios. Asserting
      the text of those files would be the substring-against-source-content
      pattern the Rot-Prevention rule prohibits; they are verified by human PR
      review instead.

  Vocabulary note:

    None of the phrases registered in `features/regression/vocabulary.md` cover
    environment-variable resolution, the safe-subprocess-env builder, or the
    environment-variable health check — the registry is scoped to
    orchestrator/phase/mock-query behaviours. Per the vocabulary-preference rule,
    novel Gherkin phrasing is introduced here and the gap is surfaced to the
    maintainer in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Token resolution — GITHUB_PAT only, alias dropped ───────────────────

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: The resolved GitHub PAT comes from the canonical GITHUB_PAT variable
    Given the environment variable GITHUB_PAT is set to "github_pat_test_canonical_535" and GITHUB_PERSONAL_ACCESS_TOKEN is unset
    When a fresh ADW process resolves the GitHub PAT
    Then the resolved GitHub PAT equals "github_pat_test_canonical_535"

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: The resolved GitHub PAT no longer falls back to the GITHUB_PERSONAL_ACCESS_TOKEN alias
    Given the environment variable GITHUB_PERSONAL_ACCESS_TOKEN is set to "ghp_test_legacy_alias_535" and GITHUB_PAT is unset
    When a fresh ADW process resolves the GitHub PAT
    Then the resolved GitHub PAT is empty

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: GITHUB_PAT wins when both the canonical variable and the legacy alias are set
    Given the environment variable GITHUB_PAT is set to "github_pat_test_canonical_535" and GITHUB_PERSONAL_ACCESS_TOKEN is set to "ghp_test_legacy_alias_535"
    When a fresh ADW process resolves the GitHub PAT
    Then the resolved GitHub PAT equals "github_pat_test_canonical_535"

  # ── §2 Subprocess forwarding — alias leaves the SAFE_ENV_VARS allowlist ─────

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: The canonical GITHUB_PAT is forwarded to Claude CLI subprocesses
    Given the environment variable GITHUB_PAT is set to "github_pat_test_canonical_535"
    When ADW builds the safe subprocess environment
    Then the safe subprocess environment includes GITHUB_PAT with value "github_pat_test_canonical_535"

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: The legacy GITHUB_PERSONAL_ACCESS_TOKEN alias is not forwarded to Claude CLI subprocesses
    Given the environment variable GITHUB_PERSONAL_ACCESS_TOKEN is set to "ghp_test_legacy_alias_535"
    When ADW builds the safe subprocess environment
    Then the safe subprocess environment omits GITHUB_PERSONAL_ACCESS_TOKEN

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: With only the legacy alias set, no GitHub token reaches the subprocess
    Given the environment variable GITHUB_PERSONAL_ACCESS_TOKEN is set to "ghp_test_legacy_alias_535" and GITHUB_PAT is unset
    When ADW builds the safe subprocess environment
    Then the safe subprocess environment omits GITHUB_PERSONAL_ACCESS_TOKEN
    And the safe subprocess environment omits GITHUB_PAT

  # ── §3 Health check — alias leaves the optional-vars list ──────────────────

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: The health check lists a present GITHUB_PAT among recognised optional variables
    Given the environment variable GITHUB_PAT is set to "github_pat_test_canonical_535"
    When the ADW environment-variable health check runs
    Then the health check lists GITHUB_PAT as a present optional variable

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: The health check no longer recognises GITHUB_PERSONAL_ACCESS_TOKEN as an optional variable
    Given the environment variable GITHUB_PERSONAL_ACCESS_TOKEN is set to "ghp_test_legacy_alias_535"
    When the ADW environment-variable health check runs
    Then the health check does not list GITHUB_PERSONAL_ACCESS_TOKEN as a present optional variable

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: With only the legacy alias set, the health check surfaces no recognised GitHub token
    Given the environment variable GITHUB_PERSONAL_ACCESS_TOKEN is set to "ghp_test_legacy_alias_535" and GITHUB_PAT is unset
    When the ADW environment-variable health check runs
    Then the health check does not list GITHUB_PERSONAL_ACCESS_TOKEN as a present optional variable
    And the health check does not list GITHUB_PAT as a present optional variable

  # ── §4 Type-check ──────────────────────────────────────────────────────────

  @adw-535 @adw-pof86n-chore-remove-github
  Scenario: TypeScript type-check passes after removing the GITHUB_PERSONAL_ACCESS_TOKEN alias
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
