@adw-780 @adw-e50ix7-appauth-error-paths
Feature: A failing GitHub App mint reports the endpoint, repo identity and HTTP status — and never the bearer credential it sent

  Issue #780 is a credential-disclosure defect on the GitHub App token-mint error
  paths. `resolveInstallationId` and `fetchInstallationToken`
  (`adws/gitContext/appAuth.ts`) shell out with the App JWT interpolated into the
  command string:

    execSync(`curl -sf -H "Authorization: Bearer ${jwt}" … https://api.github.com/…`)

  On a non-zero curl exit `execSync` embeds the ENTIRE command string in its
  `Error: Command failed: …` message, nothing catches or redacts it, and the error
  propagates uncaught into process logs. Observed 2026-07-30 11:36Z during an
  upgrade-gate crash: the complete App JWT was printed verbatim into the workflow
  log — and workflow logs get pasted into issues and chat for debugging, which is
  exactly how this one surfaced.

  The leak was reproduced verbatim while writing these scenarios:

    Error: Command failed: curl -sf -H "Authorization: Bearer eyJhbGciOi…" \
      https://api.github.com/repos/o/r/installation

  The required behaviour has two halves, and both are asserted below:
    • NEGATIVE — the credential appears in no raised error, no logged message, and
      no subprocess command line (the `ps` half of the issue's secondary concern).
    • POSITIVE — the failure is still diagnosable WITHOUT the raw command: it names
      the failing operation, the repository identity, and the HTTP status
      (`GitHub App installation lookup failed for acme/webapp: HTTP 404`). A fix
      that redacts by swallowing detail is as wrong as the leak.

  ── Why these scenarios REQUIRE an injected endpoint seam on the mint ───────────

    `getInstallationToken` currently hardcodes `https://api.github.com` and injects
    nothing. feature-701 recorded that as a harness blind spot in prose — "the mint
    (`getInstallationToken`) curls real `api.github.com` — un-mockable in the BDD
    harness" — and consequently shipped NO behavioural coverage of the mint at all.
    #780 cannot do the same: the issue's own acceptance criterion is a test
    ("Add a regression test asserting the thrown error message for a failing lookup
    does not contain the JWT"), and a test may not depend on network egress to a
    third party, nor transmit a bogus JWT to GitHub, to induce its failure.

    So the fix must make the mint's HTTP endpoint injectable — a base-URL override
    or an injected transport. This is NOT test-only scaffolding: it is the
    documented doctrine of the package the mint lives in. `tokenResolver.ts`, its
    neighbour, states "All I/O is injected for hermetic testing", and
    `resolveContextToken` already takes `mintInstallationToken` as a parameter.
    `appAuth.ts` is the one holdout in `adws/gitContext/` that performs un-injected
    I/O, and that is precisely why it has no tests and why this bug went unseen.
    Closing the seam closes the blind spot #701 could only document.

  ── Two harness constraints the step definitions MUST respect ──────────────────

    1. THE STUB RUNS OUT-OF-PROCESS. This was found empirically, not theorised. A
       synchronous `execSync` SUT blocks the Node event loop, so an in-process
       stub server can never accept the connection: curl waits, the loop is
       blocked, and the scenario DEADLOCKS (it hung for 120s on first attempt). A
       stub in a separate process serves the request and the RED reproduces
       immediately. Because the stub must also work post-fix, it is out-of-process
       in every scenario below — and the recorded-request query happens AFTER the
       mint call returns, when the loop is free.

    2. THE `When` IS SYNC/ASYNC-AGNOSTIC. See the async-ripple flag below: the
       issue's preferred fix changes the mint's return type. `an installation token
       is requested for owner X repo Y` must therefore tolerate a value OR a
       thenable, so the same scenario drives both candidate fixes unchanged.

  ── Why the assertions are exact rather than shape-guesses ─────────────────────

    The stub RECORDS the `Authorization` header it receives, and the assertions
    compare the raised failure against THAT recorded credential — the actual bytes
    the system under test transmitted. This beats regex-matching a JWT shape: it
    cannot drift, and it cannot be satisfied by a redaction that merely happens to
    miss the pattern.

    It also makes the negative assertions NON-VACUOUS, which matters more than it
    looks. "The error does not contain the JWT" passes trivially if the mint never
    sent one — a fix that fails before authenticating, or a stub that was never
    reached, would score a false GREEN. Every negative below is therefore paired
    with `the stub recorded a bearer credential on the installation lookup`, which
    fails the scenario if no credential was ever transmitted.

  ── Observability / rot-prevention note ────────────────────────────────────────

    No step opens `appAuth.ts` (or any other source file) as text, substring-matches
    its contents, or parses it as JSON/AST. Every assertion targets a runtime OUTPUT
    of the system under test:

      • the raised error's message                     — registry surface: raised error
      • the credential recorded by the stub server     — registry surface 2 (recorded
                                                          HTTP requests)
      • messages written to stdout/stderr during the
        attempt                                       — registry surface 5 (log streams)
      • the command lines of subprocesses the attempt
        spawns                                        — recorded-invocation surface,
                                                          the same category as #659's
                                                          recording runner
      • the token the mint returns on success          — returned value (artefact)
      • the type-checker's verdict                     — registry T22

    The throwaway RSA key, the App env vars and the stub's canned responses are
    INPUTS the step definitions construct in a temp directory; the error, the
    recorded request, the log stream and the returned token are the OUTPUTS.

  ── Vocabulary note ────────────────────────────────────────────────────────────

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`          (Background, §5)
      T22  `the ADW TypeScript type-check passes`     (§5)

    Every other phrase below is NEW. The registry has no App-mint vocabulary at all
    — a direct consequence of the blind spot described above — so there was nothing
    to reuse. The gap is surfaced in the agent Output for the maintainer; these
    phrases are per-issue and are NOT being registered by this agent (promotion to
    `features/regression/` is a human decision, and `.adw/scenarios.md` configures a
    `## Regression Scenario Directory`).

  ── Scope / honesty notes (surfaced to the maintainer in the agent Output) ──────

    • ASYNC RIPPLE — the issue's preference order glosses over a real architectural
      fork, and the planner must decide it explicitly:

        Option 1 (native `fetch`) is async, so `getInstallationToken` stops being
        able to return `string`. That breaks
        `ResolveContextTokenInput.mintInstallationToken: (owner, repo) => string`
        and cascades to `resolveContextToken` → `buildLaunchGitContext` →
        `gitContextFactory` → every context construction, all synchronous today
        (`adws/core/launchGitContext.ts:55`, `adws/github/gitContextFactory.ts:46`).

        Option 2 (keep curl, pass the header via `-H @-`/`--config`, wrap in
        try/catch and rethrow sanitized) stays synchronous and touches only
        `appAuth.ts`.

      The scenarios below are deliberately neutral on this choice — they pass under
      either fix. §5's type-check is the backstop that catches an option-1 rewrite
      that leaves a sync call site behind, which is why it is load-bearing here and
      not boilerplate.

    • MODULE-SCOPE CACHES — `tokenCache` and `installationIdCache` are module-level
      `Map`s that outlive a scenario. Each scenario below therefore uses a DISTINCT
      owner/repo, and the step definitions must clear both between scenarios;
      otherwise §4's successful mint poisons a later lookup and the scenario passes
      without exercising the endpoint.

    • §2b IS SCOPE-ADJACENT — the plan may narrow it. It covers the sibling echo at
      `appAuth.ts:119`/`:139`, where a 2xx response with an unexpected body is
      interpolated raw into the error (`token exchange failed: ${result}`). That is
      not the JWT path, so it is not strictly the reported bug — but it is the same
      construction leaking a longer-lived credential (installation tokens live an
      hour), and the issue explicitly motivates the fix by "the same pattern would
      leak longer-lived tokens if one is ever passed this way". Flagged rather than
      assumed.

    • NO EXISTING SCENARIO IS INVALIDATED. The current error strings
      (`App not installed on …`, `GitHub App token exchange failed: …`) are asserted
      nowhere in `features/`. The two matches outside `appAuth.ts` are a hand-written
      fake mint in `feature-700.steps.ts:78` and an independent stub in
      `tokenResolver.test.ts:65`, neither of which observes the real mint. Rewording
      the mint's failures breaks nothing, so no existing scenario is flagged
      `@adw-780`.

    • The @regression maintenance sweep is SKIPPED: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.

  # The App key and the stub server are set up per-scenario rather than in the
  # Background on purpose: §5 needs neither, and a stub that failed to start must not
  # be able to fail the type-check scenario for an unrelated reason.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  THE INSTALLATION LOOKUP FAILURE IS SANITIZED ═════════════
  #
  # The reported crash. `resolveInstallationId` gets a non-2xx from the installation
  # lookup; pre-fix, curl exits non-zero and execSync's message carries the whole
  # command line including `Authorization: Bearer <JWT>`.
  #
  # §1a is the primary RED. It asserts the negative (no credential in the error) and
  # the positive (the failure still names operation, repo identity and status) in one
  # scenario, because a fix satisfying only one half is not a fix. The JWT-shape
  # assertion is a second line of defence: it catches a redaction that scrubs the
  # exact bytes the stub saw while still emitting some other JWT.

  @adw-780 @adw-e50ix7-appauth-error-paths
  Scenario: A 404 from the installation lookup raises a failure naming the operation, repo and status without disclosing the bearer credential
    Given the GitHub App is configured with a throwaway signing key
    And the GitHub App API is served by an out-of-process recording stub
    And the stub answers the installation lookup for owner "acme" repo "webapp" with HTTP 404
    When an installation token is requested for owner "acme" repo "webapp"
    Then the installation token request fails
    And the stub recorded a bearer credential on the installation lookup
    And the raised failure does not contain the bearer credential the stub recorded
    And the raised failure does not contain a JWT-shaped token
    And the raised failure identifies the failing operation as the installation lookup
    And the raised failure names the repository identity "acme/webapp"
    And the raised failure names HTTP status 404

  # ── §1b  the log stream is as clean as the error ────────────────────────────────
  #
  # The issue requires the credential to appear in "no thrown error, log line, or the
  # process argv". §1a covers the error; this covers the log stream. A fix that
  # sanitizes the rethrow but logs the raw cause on the way out still leaks.

  @adw-780 @adw-e50ix7-appauth-error-paths
  Scenario: Nothing logged while the installation lookup fails discloses the bearer credential
    Given the GitHub App is configured with a throwaway signing key
    And the GitHub App API is served by an out-of-process recording stub
    And the stub answers the installation lookup for owner "initech" repo "payroll" with HTTP 401
    When an installation token is requested for owner "initech" repo "payroll"
    Then the installation token request fails
    And the stub recorded a bearer credential on the installation lookup
    And no message logged during the attempt contains the bearer credential the stub recorded
    And the raised failure names HTTP status 401

  # ═══════════════ §2  THE TOKEN EXCHANGE FAILURE IS SANITIZED TOO ══════════════
  #
  # `fetchInstallationToken` is the second function the issue names and carries the
  # identical construction. Here the lookup SUCCEEDS (the stub returns an
  # installation id) so the failure lands on the exchange leg — proving the fix
  # covered both call sites, not just the one in the traceback.

  @adw-780 @adw-e50ix7-appauth-error-paths
  Scenario: A 500 from the token exchange raises a failure naming the exchange and status without disclosing the bearer credential
    Given the GitHub App is configured with a throwaway signing key
    And the GitHub App API is served by an out-of-process recording stub
    And the stub answers the installation lookup for owner "octo" repo "infra" with installation id "4711"
    And the stub answers the token exchange for installation id "4711" with HTTP 500
    When an installation token is requested for owner "octo" repo "infra"
    Then the installation token request fails
    And the stub recorded a bearer credential on the token exchange
    And the raised failure does not contain the bearer credential the stub recorded
    And the raised failure identifies the failing operation as the token exchange
    And the raised failure names HTTP status 500

  # ── §2b  a 2xx with an unexpected body is not echoed raw (scope-adjacent) ───────
  #
  # The sibling leak at appAuth.ts:139: on a 2xx whose body has no `token` key, the
  # raw body is interpolated into the error. Here the body carries a credential under
  # an unexpected key — the "longer-lived token" case the issue warns about. The
  # failure must stay diagnosable (it names the exchange) without echoing the body.
  # See the scope note: the plan may narrow this.

  @adw-780 @adw-e50ix7-appauth-error-paths
  Scenario: A token exchange returning an unexpected body reports the endpoint without echoing the response body
    Given the GitHub App is configured with a throwaway signing key
    And the GitHub App API is served by an out-of-process recording stub
    And the stub answers the installation lookup for owner "hooli" repo "nucleus" with installation id "8080"
    And the stub answers the token exchange for installation id "8080" with HTTP 200 and a body carrying the credential "ghs_unexpected_shape_credential"
    When an installation token is requested for owner "hooli" repo "nucleus"
    Then the installation token request fails
    And the raised failure does not contain the credential "ghs_unexpected_shape_credential"
    And the raised failure identifies the failing operation as the token exchange

  # ═══════════════ §3  THE CREDENTIAL NEVER REACHES A COMMAND LINE ══════════════
  #
  # The issue's secondary concern: the JWT is visible in the process table for the
  # duration of the curl call. This asserts the argv half — no subprocess the attempt
  # spawns carries the credential in its command line.
  #
  # Fix-agnostic by construction: under option 1 (fetch) no subprocess is spawned at
  # all and the assertion holds vacuously-but-correctly; under option 2 (curl with
  # the header on stdin) a curl subprocess IS spawned but its argv is clean. Pre-fix
  # it fails, because the Bearer header is an argument.

  @adw-780 @adw-e50ix7-appauth-error-paths
  Scenario: No subprocess spawned by the mint carries the bearer credential in its command line
    Given the GitHub App is configured with a throwaway signing key
    And the GitHub App API is served by an out-of-process recording stub
    And the stub answers the installation lookup for owner "globex" repo "billing" with HTTP 404
    And the command lines of subprocesses spawned during the attempt are recorded
    When an installation token is requested for owner "globex" repo "billing"
    Then the installation token request fails
    And the stub recorded a bearer credential on the installation lookup
    And no recorded subprocess command line contains the bearer credential the stub recorded

  # ═══════════════ §4  THE HAPPY PATH SURVIVES THE TRANSPORT REWRITE ════════════
  #
  # The fix replaces the mint's transport, so the successful mint needs a guard — and
  # has never had one, because the endpoint was un-mockable (the #701 blind spot).
  # This is the first behavioural coverage of a successful mint in the suite: both
  # legs are driven end to end and the returned token is the one the exchange issued.

  @adw-780 @adw-e50ix7-appauth-error-paths
  Scenario: A successful mint still exchanges the installation id for the issued token
    Given the GitHub App is configured with a throwaway signing key
    And the GitHub App API is served by an out-of-process recording stub
    And the stub answers the installation lookup for owner "umbrella" repo "platform" with installation id "9001"
    And the stub answers the token exchange for installation id "9001" with the token "ghs_minted_ok"
    When an installation token is requested for owner "umbrella" repo "platform"
    Then the installation token request succeeds
    And the minted token is "ghs_minted_ok"
    And the stub recorded a token exchange for installation id "9001"

  # ═══════════════ §5  TYPE-CHECK BACKSTOP (registry T22) ═══════════════════════
  #
  # Load-bearing rather than boilerplate here — see the async-ripple scope note. If
  # the plan takes option 1, `getInstallationToken` returns a promise and every
  # synchronous call site through resolveContextToken → buildLaunchGitContext →
  # gitContextFactory must be migrated. This is what catches a half-migrated fix
  # that the behavioural scenarios above, which drive the mint directly, cannot see.

  @adw-780 @adw-e50ix7-appauth-error-paths
  Scenario: The ADW TypeScript type-check passes after the mint's transport and error handling are rewritten
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
