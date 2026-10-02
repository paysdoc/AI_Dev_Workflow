@adw-961 @adw-lgska4-bug-promote-the-orph
Feature: The webhook launches exactly one cron for the repository every accepted event names, leaves a running cron alone, and launches none for a delivery it rejects or an event that names no repository — promoted from an orphan feature that never ran, without losing the Background step its step file defined

  Issue #961 resolves item 6 of the `## Divergence` section of ADR-0037
  (`specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`). That item is the
  specification. The issue was split from #935.

  Today. `features/webhook_ensure_cron_on_every_event.feature` (17 scenarios, `@adw-501`) lies
  outside the `cucumber.js` paths, so it never runs. It was written on 2026-04-28 for the fix that
  moved the `ensureCronProcess` call to the top of the webhook's handling. Before that fix only the
  `issue_comment` and `issues.opened` branches made the call, so an approved review could leave its
  repository with no cron, and the pull request then sat in `awaiting_merge`: the webhook does not
  merge an approved pull request, the cron's sweep does (the orphan names the incident: issue #492
  / PR #498). Every scenario but the type-check reads `adws/triggers/trigger_webhook.ts` as text,
  and three of them would fail today, because `ensureAppAuthForRepo(` and
  `if (webhookRepoInfo) ensureCronProcess(` are gone. The behaviour holds:
  `dispatchWebhookEvent` calls `ensureCronProcess` for every accepted event that names a
  repository, before it looks at the event. Nothing asserts it. The dispatcher's unit test stubs
  `ensureCronProcess`, and feature-908 and feature-932 register a running cron precisely so that
  none is launched.

  Ruling (owner, 2026-10-01): a bug. The feature is promoted into `features/regression/`,
  rewritten to the rubric.

  What #961 changes:
    • `the ADW codebase is checked out` (G18), a no-op, moves into
      `features/regression/step_definitions/givenSteps.ts`. Its only definition is in the
      orphan's step file, `features/step_definitions/ensureCronOnEveryEventSteps.ts`, and the
      Backgrounds of feature-537, feature-729, feature-910, feature-911 and of nineteen per-issue
      features use it.
    • `features/regression/webhook/cron_on_every_event.feature`, tagged `@regression @webhook`
      with no `@adw-` tag, drives the real exported `dispatchWebhookEvent` in-process. Its rows
      are §1–§4 below.
    • The orphan feature and its step file are deleted. The new phrases are registered in
      `features/regression/vocabulary.md`, which also records G18's new home. `README.md`'s
      Project Structure follows, and item 6 leaves ADR-0037 in the same pull request.

  Where §1–§4 live. The scenario writer never writes into `features/regression/` (ADR-0037:
  promotion is a human decision), and here the owner's ruling is that decision. So §1–§4 are the
  rows of the promoted feature, written here in its phrasing for the build to carry over, under
  `@regression @webhook` and without this file's tags. Each row here states its own
  preconditions, and no row of this file has a Background, because the G18 row below must not
  depend on one. The promoted file may state the shared precondition once, in a Background. If
  that Background also keeps G18, as 537, 729, 910 and 911 do, a lost G18 would quietly skip its
  rows, and the G18 row is what fails instead. This file is the issue's own proof, and the
  per-issue sweep deletes it 14 days after the merge. §5 stays here.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  EVERY ACCEPTED EVENT THAT NAMES A REPOSITORY LAUNCHES ONE CRON FOR IT. An approved review,
        signed with the webhook's secret as in production, launches exactly one cron for its
        repository and nothing else. Each event of the outline launches exactly one cron too: the
        review, review-comment, pull-request, comment and issue branches, and an event the
        webhook does not handle. Every row picks an action the webhook answers `ignored` without
        reaching a provider.

    §2  A RUNNING CRON IS LEFT ALONE. With a cron already running for the repository, an approved
        review launches no second one, and the running cron stays the registered one.

    §3  A REJECTED DELIVERY LAUNCHES NOTHING. A delivery signed with a secret other than the
        webhook's is answered 401, and one whose body is not valid JSON is answered 400. Neither
        launches a cron.

    §4  AN EVENT THAT NAMES NO REPOSITORY LAUNCHES NOTHING. An approved review without a
        `repository` is answered 200 and launches no cron, not even one for the repository ADW
        itself is checked out from.

    §5  THE ISSUE'S OWN CHECKS (this file only). G18 still resolves, to exactly one definition,
        wherever a feature uses it. The promoted feature passes when Cucumber runs it in a process
        of its own, and leaves ADW's auth gate, the cron registry and the cron logs as it found
        them. The type-check.

  Each row is written to fail for a specific wrong implementation:
    • the approved-review row is the incident above. It fails when the launch is made only in the
      branches that start work (`issue_comment`, `issues.opened`), as before the 2026-04-28 fix;
      when the webhook starts anything itself on an approval, such as a merge or a pull-request
      review; when it launches the cron twice, once before the branches and again in one; and
      when a correctly signed delivery is refused;
    • each outline row fails when the launch sits inside or after the per-event branches and that
      event's branch does not make it. The `check_run` row fails for a launch made only for the
      events the webhook handles: an event it does not handle falls through to `ignored`;
    • the already-running row fails for a launch that does not first ask the cron registry
      whether the repository's cron is alive, and for one that replaces the running cron;
    • the 401 row fails when the launch moves above the signature check. The approved-review row,
      signed with the right secret, shows that the steps sign in a form the webhook accepts, so
      the 401 comes from the wrong secret and not from a malformed header;
    • the 400 row fails when the launch moves above the parse, or falls back to the repository
      ADW is checked out from when the body cannot be read;
    • the no-repository row fails for a launch that falls back to that repository when the
      payload names none;
    • every "no cron is launched" row that names a repository first makes sure none is running
      for it. A cron registered as alive suppresses the launch whatever the webhook does, which
      would let those rows pass for the wrong reason;
    • the G18 row fails when G18 is lost, which leaves every Background that uses it undefined, and
      when it is defined twice, which makes every use ambiguous. A lost G18 has to fail loudly:
      `classifyTestCase` (`adws/core/testReportParser.ts`) scores an undefined scenario as
      skipped, and `deriveTagOutcome` (`adws/phases/scenarioProof.ts`) passes a run whose only
      problems are skipped scenarios (ADR-0037, item 3);
    • the promoted-run row fails when the promoted feature is missing; when any of its steps is
      undefined or pending, which the `@regression` run in the test phase would also score as
      skipped; when any of its rows fails; and when its hooks leave ADW's auth gate, the cron
      registry or the cron logs different from how they found them.

  ── WHY SOME CLAIMS GET NO ROW ──────────────────────────────────────────────────────────────
  Of the orphan's claims:
    • its order against `ensureAppAuthForRepo`: the webhook no longer calls it;
    • `GET /health`, the 404 for another path and the 405 for another method: the HTTP listener
      answers them before `dispatchWebhookEvent` runs, and `/health` runs a real `claude -p`
      probe;
    • `issues` `opened` and `closed`, and `pull_request` `closed`: they hand work to a provider,
      and an error there ends in `reportWebhookEventFailure`, which posts to Slack;
    • "called exactly once in the file" and "not called inside the `issue_comment` or
      `issues.opened` handler" are claims about source text. Their behaviour is "exactly one
      cron", which the approved-review row and the `issue_comment` outline row assert.
  Of the issue's acceptance criteria:
    • "no `.feature` file exists outside the `cucumber.js` paths" and "no step in it reads a
      source file" are facts about files, which a scenario could check only by reading them. The
      review and the plan's validation commands check them. `test/fixtures/python-app/features/`
      holds the Python end-to-end fixture's own `.feature`, an input rather than part of the suite;
    • restoring `PATH` and `GITHUB_WEBHOOK_SECRET` is a property of the hooks inside one Cucumber
      process, which no other process can see. The promoted-run row checks the files the
      criterion names, and the notes below hold the hooks to the rest. Incidentally, §5 runs
      after §1–§4 in file order, and a `bunx` shadow left on `PATH` would answer §5's child runs,
      which those rows would reject;
    • "item 6 leaves ADR-0037" is a documentation change. No scenario asserts on the text of a
      decision record.

  Not pinned here, and left to the plan:
    • the names of the step-definition and support files, beyond the placement the issue gives;
    • whether the promoted feature's Background keeps G18;
    • the regression run's Docker leg, which mounts the checkout read-only. A dispatch writes its
      cron log under `logs/` and the steps write under `agents/`, as feature-910's and
      feature-911's rows already do.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the status code and JSON body the webhook writes, recorded by a stand-in response;
    • the launches the webhook makes, recorded by a stand-in `bunx` on `PATH` that writes down its
      arguments and exits at once;
    • the cron registry record (`agents/cron/<owner>_<repo>.json`), a state file;
    • for §5: the message stream of a Cucumber dry run; the results and exit status of a Cucumber
      run in a child process; ADW's auth gate file, the cron registry and the cron logs around
      that run; and the type-check's exit code.
  No scenario reads, greps or parses a source file. The payloads, signatures and registry records
  the steps write are inputs.

  Notes for the step definitions:
    • NEVER LET A REAL CRON, ORCHESTRATOR OR PROVIDER RUN. NEVER POST TO SLACK.
    • §1–§4 drive the real exported `dispatchWebhookEvent(req, res, rawBody, mintEventBoundary)`
      with a stand-in request (`x-github-event`, and `x-hub-signature-256: sha256=<hex>`, the
      HMAC-SHA256 of the raw body, when the step signs), a stand-in response that records
      `writeHead` and `end`, and a fake boundary whose providers throw if anything touches them.
      The issue gives the rest: payloads that name the repository with `repository.full_name` and
      `repository.clone_url`, a plain comment that is no directive for the comment events, the
      secret read when the dispatch runs, and the launch recorder in
      `features/regression/support/`. The recorder's `bunx` shadow sits first on `PATH` for the
      dispatch call only. `ensureCronProcess` and `spawnDetached` resolve `bunx` when they spawn,
      so nothing is lost, and a wider window would also answer T22's `bunx tsc`, which would then
      pass without type-checking anything.
    • "the webhook answers {int} with the status {string}" and "… with the error {string}"
      require the recorded body to be exactly `{ status }` or `{ error }`, so that a reason such
      as `auth_gate_set` fails the row.
    • "the cron that was already running is still the one registered for the repository {string}"
      reads that repository's registry record and requires the pid "a cron is already running for
      the repository {string}" wrote (`writeCronPid(repo, process.pid)`).
    • HOOKS. Scope the webhook hooks to `@webhook or @adw-961`, as feature-910's are scoped to its
      descriptive tag and its `@adw-` tag; a `@webhook`-only scope leaves this file's rows without
      them. Before each scenario they save and clear `agents/.auth_gate` (while it holds a record,
      the review, review-comment and comment branches answer `auth_gate_set` before they look at
      the event); save and blank the GitHub App variables (an event that names no repository
      makes the webhook build its memoised self-host boundary, which then contacts nothing);
      save and unset `GITHUB_WEBHOOK_SECRET`; and save and unset `SLACK_WEBHOOK_URL`. After each
      scenario they restore all of them and `PATH`, put back each registry record a step
      replaced or remove the one it wrote, and remove each cron log a launch created
      (`logs/agents/cron/<owner>_<repo>.log`, under the checkout). The `@regression` hook in
      `features/regression/support/hooks.ts` also prepends to `PATH`, so restore in reverse
      order. `ensureCronProcess` keeps a module-level set of the repositories it launched for,
      but it reads the registry on every call, so a scenario that leaves no record behind does
      not change what the next one sees.
    • G18 moves as it is into `features/regression/step_definitions/givenSteps.ts`. Define it
      once: a second definition makes every use ambiguous, which the G18 row rejects.
    • §5's step definitions are per-issue (`features/per-issue/step_definitions/`) and go with
      this file. The child Cucumber runs:
        – spawn `bunx cucumber-js` with `NODE_OPTIONS=--import tsx` and `--format message`, and
          drop `ADW_JUNIT_REPORT_PATH` from the child's environment. ADW's test phase sets it for
          the parent run, and a child that inherits it writes its own JUnit report to the
          parent's report path;
        – a path argument does not narrow a run here: `cucumber.js` adds its configured `paths`,
          so a run given one feature file still loads all 504 scenarios (2026-10-02);
        – "Cucumber dry-runs every feature its configuration loads" adds `--dry-run` and nothing
          else. Do not require it to exit 0: another feature's undefined step is not this row's
          concern. A test step's matching definitions are its `stepDefinitionIds` in the
          `testCase` messages. On 2026-10-02 G18 matched one definition at each of its 402 uses;
        – "Cucumber runs the scenarios tagged {string} in a child process" selects by the tag
          expression, never by path, or the child would also run this file, recursively. Give the
          step a timeout of several minutes. Just before it spawns, it snapshots
          `agents/.auth_gate` and the names and contents of the files in `agents/cron/` and
          `logs/agents/cron/`, an absent directory counting as empty;
        – "that run held at least one scenario, and every one of them passed" requires exit 0, at
          least one test case, and every step of every test case `PASSED`;
        – "ADW's auth gate holds a record of an earlier authentication failure" writes a record in
          the shape `writeAuthGate` writes. "as they were before that run" compares with the
          snapshot.
    • REUSED, NOT REDEFINED. T22 is in the regression suite's `thenSteps.ts`.

  Vocabulary note. This registered phrase from `features/regression/vocabulary.md` is reused:
    • T22 `the ADW TypeScript type-check passes`
  G18 `the ADW codebase is checked out` is not used, on purpose: see the G18 row.
  These registered phrases are deliberately NOT reused:
    • W11 `the webhook handler receives a {string} event for issue {int}`. It is pending in
      `whenSteps.ts` (ADR-0037, item 3), and it posts to a listener behind the mock GitHub API
      with no repository and no signature;
    • W-PQ5, which launches a real cron; its world and its cleanup belong to the pause-queue
      harness.
  No unregistered phrase from another feature is reused. The webhook phrases of feature-908 and
  feature-932 read their own launch records, which never see a launch made here, and feature-934's
  dry-run phrases go with that file when the per-issue sweep deletes it.
  The registry has no phrase for the following, so novel phrasing is introduced:
    • for §1–§4, to be registered by the build together with the promoted feature: whether a cron
      is running for a repository; the webhook's secret; the webhook receiving an approved review,
      signed or not, an event with an action, a delivery whose body is not valid JSON, and an
      approved review that names no repository; what the webhook answers; the crons and other
      launches it makes; the cron that stays registered;
    • for §5, per-issue only: ADW's auth gate holding a record; the dry run and how a step
      resolves in it; the child run of the promoted feature and what it leaves behind.

  # ── §1 EVERY ACCEPTED EVENT THAT NAMES A REPOSITORY LAUNCHES ONE CRON FOR IT ─────────────────

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: An approved review signed with the webhook's secret launches exactly one cron, for its repository, and nothing else, because the cron, not the webhook, merges an approved pull request
    Given no cron is running for the repository "acme/widgets"
    And the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives an approved review from the repository "acme/widgets", signed with the secret "adw-regression-webhook-secret"
    Then the webhook answers 200 with the status "ignored"
    And exactly one cron is launched, for the repository "acme/widgets"
    And nothing other than that cron is launched

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario Outline: The webhook event "<event>" with the action "<action>", <which>, launches exactly one cron for its repository
    Given no cron is running for the repository "acme/widgets"
    When the webhook receives a "<event>" event with the action "<action>" from the repository "acme/widgets"
    Then the webhook answers 200 with the status "ignored"
    And exactly one cron is launched, for the repository "acme/widgets"

    Examples:
      | event                       | action    | which                                                   |
      | pull_request_review         | dismissed | a review that is not a submission                       |
      | pull_request_review_comment | edited    | a review comment that is not a new one                  |
      | pull_request                | opened    | a pull request event that is not a closing              |
      | issue_comment               | created   | a plain comment that carries no directive               |
      | issues                      | edited    | an issue event that is neither an opening nor a closing |
      | check_run                   | completed | an event the webhook does not handle                    |

  # ── §2 A RUNNING CRON IS LEFT ALONE ──────────────────────────────────────────────────────────

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: A cron already running for the repository is left alone: an approved review launches no second cron, and the running one stays registered
    Given a cron is already running for the repository "acme/widgets"
    When the webhook receives an approved review from the repository "acme/widgets"
    Then the webhook answers 200 with the status "ignored"
    And no cron is launched
    And the cron that was already running is still the one registered for the repository "acme/widgets"

  # ── §3 A REJECTED DELIVERY LAUNCHES NOTHING ──────────────────────────────────────────────────

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: A delivery signed with a secret other than the webhook's is answered 401 and launches no cron
    Given no cron is running for the repository "acme/widgets"
    And the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives an approved review from the repository "acme/widgets", signed with the secret "not-the-webhook-secret"
    Then the webhook answers 401 with the error "invalid signature"
    And no cron is launched

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: A delivery whose body is not valid JSON is answered 400 and launches no cron
    When the webhook receives a "pull_request_review" delivery whose body is not valid JSON
    Then the webhook answers 400 with the error "invalid json"
    And no cron is launched

  # ── §4 AN EVENT THAT NAMES NO REPOSITORY LAUNCHES NOTHING ────────────────────────────────────

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: An approved review that names no repository is answered 200 and launches no cron, not even one for the repository ADW itself is checked out from
    When the webhook receives an approved review that names no repository
    Then the webhook answers 200 with the status "ignored"
    And no cron is launched

  # ── §5 THE ISSUE'S OWN CHECKS (this file only) ───────────────────────────────────────────────

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: Every "the ADW codebase is checked out" step still resolves, to exactly one step definition, in every feature Cucumber's configuration loads
    When Cucumber dry-runs every feature its configuration loads
    Then every "the ADW codebase is checked out" step in the dry run matches exactly one step definition
    And the dry run holds a "the ADW codebase is checked out" step in each of these features:
      | feature                                             |
      | features/regression/hashing/feature-537.feature     |
      | features/regression/upgrade/feature-729.feature     |
      | features/regression/pause-queue/feature-910.feature |
      | features/regression/pause-queue/feature-911.feature |

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: The promoted feature passes when Cucumber runs it in a process of its own, and leaves ADW's auth gate, the cron registry and the cron logs as it found them
    Given ADW's auth gate holds a record of an earlier authentication failure
    And a cron is already running for the repository "acme/elsewhere"
    When Cucumber runs the scenarios tagged "@regression and @webhook" in a child process
    Then that run held at least one scenario, and every one of them passed
    And ADW's auth gate, the cron registry and the cron logs are as they were before that run

  @adw-961 @adw-lgska4-bug-promote-the-orph
  Scenario: The ADW TypeScript type-check passes once G18 has moved and the orphan's step definitions are gone
    Then the ADW TypeScript type-check passes
