@adw-776 @adw-zbw0v7-webhook-server-dies
Feature: The webhook server survives a failing event handler — one bad delivery must not take the trigger down

  On 2026-07-30 between 11:00Z and 11:22Z every `issue_comment` delivery to the ADW
  webhook returned 502. A single `## Cancel` directive on `paysdoc/paysdoc.nl#28`
  threw inside the event handler, the exception was uncaught, and the node process
  exited. GitHub's delivery log records the blast radius: a last 200 at 10:59:36Z,
  then six consecutive 502s (11:00, 11:01, 11:06, 11:14, 11:16, 11:22) — each retry
  either hit the dead server or killed a freshly restarted instance the same way.
  The trigger was down for the whole window and the directive was never processed.

  Root cause — a missing resilience boundary:

    The entire event dispatch in `trigger_webhook.ts` runs synchronously inside the
    `req.on('end', ...)` callback with no try/catch. A synchronous throw there is an
    uncaught exception at the top of the event loop, and nothing in the codebase
    installs an `uncaughtException` handler, so the process terminates. In the
    incident the thrower was `fetchIssueCommentsRest` (`adws/github/issueApi.ts`),
    which wraps every failure and rethrows as `Failed to fetch comments for issue
    #N: …`; it is called synchronously and unguarded from the `## Cancel` branch.
    It is far from the only unguarded synchronous call on that path —
    `ensureCronProcess`, `handleCancelDirective`, `handleRetryDirective`,
    `resolvePrReviewSpawn` and `spawnDetached` are all equally exposed.

    The specific spawn failure that triggered it is issue #775's. THIS issue is the
    resilience boundary: any future per-event bug reproduces the same outage, so the
    behaviour pinned below is "a throwing handler is contained", not "this particular
    call stops throwing".

  The fix pinned below (the issue's acceptance criteria):

    1. CONTAIN. A throwing event handler never terminates the webhook server process.
    2. ANSWER. The failing delivery is answered 500, so GitHub's delivery log shows a
       real failure rather than a dropped connection, and the retry is honest.
    3. REPORT. The failure is logged and Slack-alerted via the existing
       `slackNotifier`, carrying event type + repo + issue number.
    4. KEEP SERVING. Subsequent deliveries are served normally.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime. No step
    reads `trigger_webhook.ts`, `slackNotifier.ts` or `issueApi.ts` as text,
    substring-matches their contents, or parses them as JSON/AST. This feature
    deliberately does NOT extend the source-substring idiom of the legacy
    `features/webhook_ensure_cron_on_every_event.feature`, which predates the
    rot-prevention rule.

      • The HTTP status and body the server returns to a delivery are the server's
        own output — an artefact.
      • Process liveness and exit status are registry Observability Surface #4; the
        webhook server runs as a real spawned subprocess, so "the process died" is
        directly observable rather than inferred.
      • The Slack alert is captured as a recorded request against a real local HTTP
        sink the subprocess POSTs to (Surface #2), the sink idiom feature-647 §4
        established for a spawned process.
      • The error log is asserted against the subprocess's captured output stream
        (Surface #5).

  How the handler is made to throw (hermetically, no network):

    `fetchIssueCommentsRest` calls `gitContextForRepo(repoInfo)`, whose token
    resolution (`resolveContextToken`, `adws/gitContext/tokenResolver.ts`) throws
    `no veracious token for <owner>/<repo>` when the GitHub App is not configured,
    `GITHUB_PAT` is empty, and `gh auth token` yields nothing. The harness reproduces
    exactly that state, so the `## Cancel` branch throws the same wrapped
    `Failed to fetch comments for issue #28: …` error the incident produced — the real
    production code path, with no fault-injection hook added to production code.

  Scope notes:

    • The pinned behaviour is the OBSERVABLE outcome — the 500, the surviving process,
      the alert, the served next delivery. Where the try/catch sits, how the alert is
      worded, and whether the boundary is one wrapper or several are the implementer's
      to choose, as long as these outcomes hold.
    • §3 covers the asynchronous half. The three async continuations on this path
      (`isAdwRunningForIssue(...).then(...)`, `handlePullRequestEvent(...)`,
      `handleIssueClosedEvent(...)`) ALREADY carry a `.catch`, so the process does not
      die there today and that half of §3 is expected to be GREEN from the start — it
      is a guard against the fix removing or bypassing those catches. What is RED in §3
      is the REPORTING: those catches only `log`, they raise no Slack alert. §3 also
      asserts no 500 for this path, because the 200 was already flushed before the
      continuation ran — the response cannot be retracted, and pretending otherwise
      would be a false requirement.
    • §4 exists because a resilience boundary is easy to over-apply. Deliveries that
      already have a correct non-200 answer (unparseable JSON → 400, bad signature →
      401) must keep it and must not be reclassified as 500.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the regression
      suite is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    NOT reused: W11 `the webhook handler receives a {string} event for issue {int}` is
    registered but has no implementation anywhere in `features/`, and its registry
    semantics (assertion target "recorded requests + state") describe a workflow-spawn
    assertion, not a response/liveness assertion. It also carries no repo or
    comment-body parameter, both of which every scenario here needs. Adopting it would
    either misrepresent the registry row or force a signature change to a row other
    features may later claim. This feature introduces distinct phrasing instead.

    Novel phrasing introduced here — the registry has no webhook-server-process,
    HTTP-response or crash-containment phrase. Surfaced to the maintainer in the agent
    Output:
      • `a webhook server is running with no usable GitHub credentials`
      • `a webhook server is running with working GitHub credentials`
      • `a Slack alert endpoint is configured that accepts deliveries`
      • `a Slack alert endpoint is configured that drops every connection`
      • `no Slack alert endpoint is configured`
      • `a webhook signing secret is shared with GitHub`
      • `an {string} delivery for issue {int} on {string} carrying the comment {string} is sent`
      • `the same failing delivery is sent {int} more times`
      • `an {string} delivery for issue {int} on {string} with action {string} is sent`
      • `a delivery carrying an unparseable body is sent`
      • `a delivery carrying an invalid signature is sent`
      • `a delivery that requires no work is sent`
      • `the delivery is answered with HTTP {int}`
      • `every failing delivery is answered with HTTP {int}`
      • `the webhook server process is still running`
      • `the webhook server process has not exited`
      • `the following delivery is answered with HTTP {int}`
      • `the error log names the event type {string}`
      • `the error log names the repository {string}`
      • `the error log names issue {int}`
      • `a Slack alert is delivered`
      • `no Slack alert is delivered`
      • `the Slack alert names the event type {string}`
      • `the Slack alert names the repository {string}`
      • `the Slack alert names issue {int}`

    Step-definition notes for the maintainer:
      • STEP ORDER IS LOAD-BEARING. The server under test is a spawned subprocess, and
        it reads `SLACK_WEBHOOK_URL` and `GITHUB_WEBHOOK_SECRET` from its own
        environment — neither can be changed after spawn. Every environment-shaping
        Given (Slack endpoint, signing secret) therefore appears BEFORE the
        `a webhook server is running …` Given in every scenario above, and those steps
        must accumulate into a pending spawn-env map that the server step consumes.
        Keep that order if scenarios are edited.
      • Cucumber's 5s default step timeout is too short — nothing in `features/`
        currently calls `setDefaultTimeout`. The `@adw-776` step-def file must raise it
        (spawning the server and waiting for its listening line takes seconds).
      • `a webhook server is running …` spawns the REAL entrypoint,
        `bunx tsx adws/triggers/trigger_webhook.ts`, with `cwd` at the repo root
        (`assertCwdIsRepoRoot` calls `process.exit(1)` otherwise), `PORT` set to a free
        port, and stdout+stderr piped into a buffer. Wait for the
        `Webhook server listening on 0.0.0.0:<port>` line before returning.
      • "No usable GitHub credentials" must survive `dotenv`. The entrypoint imports
        `adws/core/environment`, which runs `dotenv.config()` against the repo root
        `.env`; dotenv does not overwrite keys already present in `process.env`, so the
        spawn env must set `GITHUB_PAT`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and
        `GITHUB_APP_PRIVATE_KEY_PATH` to the empty string (present-but-empty), not
        merely delete them. `PATH` must also be prefixed with a temp dir holding a
        `gh` stub that exits non-zero, so `ghAuthToken()` returns `''`.
      • `readAuthGate()` reads the cwd-relative `agents/.auth_gate`. A gate file left
        behind by a real run would short-circuit every `issue_comment` to
        `{"status":"ignored","reason":"auth_gate_set"}` and silently vacate these
        scenarios. The hook must assert that file is absent before spawning and fail
        loudly if it is not — do not delete it, it may belong to a live run.
      • `ensureCronProcess` runs before every per-event branch and detach-spawns a real
        `trigger_cron.ts` for any payload carrying `repository`. The repo here is
        `paysdoc/paysdoc.nl` — the real incident repo, asserted on by name in §2 and §3 —
        so it CANNOT be swapped for a throwaway. Suppress the spawn instead: before
        starting the server, pre-seed a live-PID record at
        `agents/cron/paysdoc_paysdoc.nl.json` so `isCronAliveForRepo` short-circuits
        `ensureCronProcess`. That path is `process.cwd()/agents/...` and the server is
        spawned with `cwd` at the worktree root, so the record is worktree-local. The
        pre-seed is MANDATORY, above all for the four §4 scenarios that run with working
        GitHub credentials: an unsuppressed cron there inherits real credentials and
        starts a real ADW loop against a real repo. The
        `a delivery that requires no work is sent` and `the following delivery …` probes
        deliberately omit `repository` entirely, so they spawn nothing.
      • The Slack sink is a local `http.createServer` recording POST bodies, with
        `SLACK_WEBHOOK_URL` in the spawn env pointing at it (again present-but-empty
        for the "no endpoint configured" case, to beat `.env`).
      • RED shape: before the fix the failing delivery closes the socket with no
        response and the process exits, so `the delivery is answered with HTTP 500`
        fails on a connection error and `the webhook server process is still running`
        fails on a non-null exit code. Assert the socket error explicitly rather than
        letting the step time out, so the RED is fast and legible.
      • Always kill the spawned server in an `After` hook, including on failure.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Containment — the incident itself ─────────────────────────────────────
  #
  # The core RED. A `## Cancel` directive whose comment fetch throws must be answered
  # 500 and must leave the server alive and serving. Before the fix the connection is
  # dropped and the process is gone, which is precisely how six deliveries in a row
  # became 502s.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A delivery whose handler throws is answered 500 instead of dropping the connection
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    Then the delivery is answered with HTTP 500

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A delivery whose handler throws leaves the webhook server process running
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    Then the webhook server process is still running

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: The delivery after a failing one is still served
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    Then the following delivery is answered with HTTP 200

  # The retry storm: GitHub redelivered six times across 22 minutes and every one was
  # a 502. Each failing delivery must be answered and survived independently, so the
  # window closes at the first delivery rather than lasting until a human notices.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A run of failing deliveries is answered every time and never terminates the server
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    And the same failing delivery is sent 5 more times
    Then every failing delivery is answered with HTTP 500
    And the webhook server process has not exited
    And the following delivery is answered with HTTP 200

  # The containment must not be specific to the `## Cancel` branch — `## Retry` reaches
  # the same unguarded synchronous `fetchIssueCommentsRest` call, and the boundary is
  # meant to cover the whole per-event dispatch rather than one directive.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A throwing Retry directive is contained on the same terms as Cancel
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Retry" is sent
    Then the delivery is answered with HTTP 500
    And the webhook server process is still running

  # ── §2 Reporting — the failure is legible without reading the delivery log ────
  #
  # A contained failure that nobody hears about is a silent outage. The log line and
  # the Slack alert must each carry the three identifiers the issue names, so an
  # operator can tell which event, which repo and which issue was dropped.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: The contained failure is logged with event type, repository and issue number
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    Then the error log names the event type "issue_comment"
    And the error log names the repository "paysdoc/paysdoc.nl"
    And the error log names issue 28

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: The contained failure raises a Slack alert naming event type, repository and issue number
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    Then a Slack alert is delivered
    And the Slack alert names the event type "issue_comment"
    And the Slack alert names the repository "paysdoc/paysdoc.nl"
    And the Slack alert names issue 28

  # ── §3 The asynchronous half ─────────────────────────────────────────────────
  #
  # A `## Continue` comment is answered 200 "processing" immediately, then the
  # `isAdwRunningForIssue` chain runs and rejects on the same missing token. The
  # survival assertions here are expected GREEN from the start (that chain already has
  # a `.catch`) and stand as guards against the fix disturbing them. The alert
  # assertion is the RED: today that catch only logs, so an async failure is invisible
  # in Slack. No 500 is asserted — the 200 was already flushed and cannot be retracted.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A failing async continuation raises a Slack alert naming the event, repository and issue
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Continue" is sent
    Then a Slack alert is delivered
    And the Slack alert names the event type "issue_comment"
    And the Slack alert names the repository "paysdoc/paysdoc.nl"
    And the Slack alert names issue 28

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A failing async continuation leaves the server running and serving
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Continue" is sent
    Then the webhook server process is still running
    And the following delivery is answered with HTTP 200

  # ── §4 The boundary must not distort correct answers ─────────────────────────
  #
  # A catch-all that turns every non-200 into a 500 would be its own outage: GitHub
  # retries 500s, so a permanently malformed delivery would retry forever. Answers
  # that are already correct must survive the new boundary unchanged, and a healthy
  # delivery must not be alerted on.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: An unparseable delivery body is still answered 400, not 500
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with working GitHub credentials
    When a delivery carrying an unparseable body is sent
    Then the delivery is answered with HTTP 400
    And no Slack alert is delivered
    And the webhook server process is still running

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A delivery with an invalid signature is still answered 401, not 500
    Given a webhook signing secret is shared with GitHub
    And a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with working GitHub credentials
    When a delivery carrying an invalid signature is sent
    Then the delivery is answered with HTTP 401
    And no Slack alert is delivered
    And the webhook server process is still running

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: A delivery that needs no work is answered 200 and raises no alert
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with working GitHub credentials
    When a delivery that requires no work is sent
    Then the delivery is answered with HTTP 200
    And no Slack alert is delivered

  # An `issues` event with an action the dispatcher ignores exercises the far end of
  # the branch chain, past every early return, and must still land on its plain 200.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: An ignored issues action keeps its plain 200 answer under the new boundary
    Given a Slack alert endpoint is configured that accepts deliveries
    And a webhook server is running with working GitHub credentials
    When an "issues" delivery for issue 28 on "paysdoc/paysdoc.nl" with action "labeled" is sent
    Then the delivery is answered with HTTP 200
    And no Slack alert is delivered

  # ── §5 The alert path is best-effort ─────────────────────────────────────────
  #
  # The alert is a reporting nicety; containment is the requirement. If the alert
  # itself fails — no endpoint configured, or Slack unreachable — the boundary must
  # still answer 500 and keep the server up. A crash inside the crash handler would
  # reproduce the exact outage this issue exists to end.

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: With no Slack endpoint configured the failure is still answered 500 and survived
    Given no Slack alert endpoint is configured
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    Then the delivery is answered with HTTP 500
    And the webhook server process is still running
    And the following delivery is answered with HTTP 200

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: With Slack unreachable the failure is still answered 500 and survived
    Given a Slack alert endpoint is configured that drops every connection
    And a webhook server is running with no usable GitHub credentials
    When an "issue_comment" delivery for issue 28 on "paysdoc/paysdoc.nl" carrying the comment "## Cancel" is sent
    Then the delivery is answered with HTTP 500
    And the webhook server process is still running
    And the following delivery is answered with HTTP 200

  # ── §6 Type-check backstop ───────────────────────────────────────────────────

  @adw-776 @adw-zbw0v7-webhook-server-dies
  Scenario: The ADW TypeScript type-check passes with the per-event resilience boundary in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
