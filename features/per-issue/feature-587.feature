@adw-587 @adw-5jigj8-slack-notifications
Feature: Slack notifications for HITL-gated board transitions (→ Review / → Blocked)

  Issue #587 adds human-in-the-loop Slack pings for the two ADW-driven project-board
  transitions a person actually needs to act on, and *only* for issues carrying the
  `hitl` label:

    • → Review (`BoardStatus.Review`): a human must approve the PR to open the
      auto-merge gate. The ping links to the **PR** ("go approve this").
    • → Blocked (`BoardStatus.Blocked`), but only the two genuinely human-relevant
      sources — a `discarded` terminal (PR closed/terminal) and a PR-review **error**.
      The ping links to the **issue** ("go look at this").

  A new no-throw module `adws/github/hitlBoardNotifier.ts` owns issue/PR lookup,
  message-building, and Slack delivery (reusing the existing `SLACK_WEBHOOK_URL`, the
  same channel feature-504's auth-gate alerts use), so the board API and the terminal
  handlers stay thin. Every notification is gated on the `hitl` label via a single
  `gh issue view N --json title,labels` read (one call serves both the label check and
  the title), and the module no-ops entirely for non-GitHub repositories.

  The behavioural contract pinned below:

    1. REVIEW PING IS HITL-GATED AND LINKS TO THE PR. When the review-transition
       notifier runs for a `hitl` issue, exactly one Slack message is delivered:
       `:eyes: HITL issue #N "<title>" → In Review. Approve to merge: <prUrl>`. The
       link target is the PR, never the issue. A non-`hitl` issue delivers nothing.
    2. PR LOOKUP IS SELF-DISAMBIGUATING. The PR is found from the OPEN PR list by
       matching bodies against `Implements #N` with a digit boundary, then resolved
       with the existing `selectPreferredPR`. A promotion PR ("Moves scenario…") and
       an unrelated `Implements #M` PR never false-match, and issue #1 never captures
       a PR that says `Implements #12`.
    3. BLOCKED PINGS ARE HITL-GATED AND LINK TO THE ISSUE. A `discarded` source
       delivers `:no_entry: HITL issue #N "<title>" discarded (PR closed/terminal):
       <issueUrl>`; a `review_error` source delivers `:warning: HITL issue #N
       "<title>" — PR review failed: <snippet> — needs attention: <issueUrl>`. Both
       link to the issue, never to a PR. A non-`hitl` issue delivers nothing.
    4. ERROR-SNIPPET HYGIENE. The `review_error` snippet is collapsed to a single
       line and truncated (~200 chars) so a multi-line stack trace or trailing secret
       never reaches Slack.
    5. ONLY discarded AND review_error TERMINALS NOTIFY. The workflow-discarded
       handler and the PR-review-error handler each deliver their Blocked ping for a
       `hitl` issue; the transient-crash (`abandoned`) handler stays deliberately
       silent because that path self-heals via the cron retry.
    6. DEFENSIVE BOUNDARIES. A non-GitHub repository is a no-op (no lookup, no ping),
       and a failing Slack delivery is swallowed — the notifier never throws into its
       caller.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime, never
    the text of a source file of this repo:

      • The Slack delivery itself — the HTTP POST the notifier makes to
        `SLACK_WEBHOOK_URL`, captured by a stubbed `fetch` sink. This is the
        recorded-HTTP-request surface (registry Observability Surface #2) and the same
        "a Slack notification is delivered to SLACK_WEBHOOK_URL" idiom feature-504
        established. The delivered message body is the system's OUTPUT, an artefact —
        so asserting its emoji, the issue/PR link it carries, and the absence of
        newlines / a truncated tail are behaviour assertions, not source reads.
      • The TypeScript type-checker's verdict (registry T22) for the signature change
        that turns the two terminal handlers from `: never` into `: Promise<never>`.

    The notifier's `gh issue view` (title + `hitl` label) and `gh pr list` (open PRs)
    reads are served to the system under test through the established injected-reader
    seam (the same pattern feature-530 uses for an injected `findPRByBranch`), so the
    World seeds issue/PR fixtures and the notifier consumes them — no live network, and
    nothing asserts against a source file.

    Deliberately NOT asserted (would couple to source structure, and depends on the
    un-mockable Projects-V2 GraphQL board write — see Scope notes): that the Review
    ping is wired one fire-and-forget line *after* `updateProjectItemStatus`, that it
    is guarded to `matchedOption.name === Review`, that it covers both `prPhase` and
    `prReviewPhase` call sites, and that `moveIssueToStatus`'s already-in-status
    short-circuit gives "free dedup" so re-asserting Review never double-pings. Those
    hook-placement facts are the implementer's `moveIssueToStatus` unit tests; the
    review *notifier's* own observable behaviour (HITL gate, PR link, disambiguation)
    is fully pinned in §1. No step reads `hitlBoardNotifier.ts`, `projectBoardApi.ts`,
    `workflowCompletion.ts`, or `prReviewCompletion.ts` as text, substring-matches its
    contents, or parses it as JSON/AST.

  Scope notes:

    • The Review hook lives inside `moveIssueToStatus` (`projectBoardApi.ts`), whose
      board write is a `gh api graphql` call the regression mock cannot serve (no
      GraphQL route). Driving that entry point would therefore add no observable
      coverage beyond driving the notifier directly, so §1 exercises the notifier
      (`notifyReviewTransition`) — the exact function the production hook invokes.
    • The two Blocked terminals ARE driven as terminal handlers in §3, because their
      whole point is *which* terminal calls the notifier: `handleWorkflowDiscarded`
      (source `discarded`) and `handlePRReviewWorkflowError` (source `review_error`)
      notify, while `handleWorkflowError` (`abandoned`) must not. Their `process.exit`
      and board/state writes are stubbed so only the Slack delivery is observed.
    • OUT OF SCOPE: manual board drags (ADW owns every transition, confirmed);
      splitting the Slack channel from the auth-gate alerts (explicitly "later if
      noisy"); GitLab/Jira board managers (stubs — covered by the non-GitHub no-op).

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Reused from sibling per-issue file feature-504 (established there, not in the
    registry):
      `a Slack notification is delivered to SLACK_WEBHOOK_URL`,
      `no Slack notification is delivered`.

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    HITL-notification, Slack-message-content, or PR/issue-link phrase). The gap is
    surfaced to the maintainer in the agent Output:
      • `a Slack webhook URL is configured`
      • `the configured Slack webhook rejects every delivery attempt`
      • `a GitHub issue {int} titled {string} carrying the "hitl" label`
      • `a GitHub issue {int} titled {string} without the "hitl" label`
      • `an open pull request {int} whose body reads {string}`
      • `the active repository is hosted on a non-GitHub platform`
      • `a review error message that begins {string}, spans several lines, and runs well past 200 characters before ending with the marker {string}`
      • `the review-transition notifier runs for issue {int}`
      • `the blocked-transition notifier runs for issue {int} with source {string}`
      • `the blocked-transition notifier runs for issue {int} with source {string} and error message {string}`
      • `the blocked-transition notifier runs for issue {int} with source "review_error" and that error message`
      • `the workflow-discarded terminal handler completes for issue {int}`
      • `the PR-review-error terminal handler completes for issue {int} with error message {string}`
      • `the transient-crash terminal handler completes for issue {int}`
      • `the delivered Slack message contains {string}`
      • `the delivered Slack message does not contain {string}`
      • `the delivered Slack message contains the title {string}`
      • `the delivered Slack message contains the URL of pull request {int}`
      • `the delivered Slack message contains the URL of issue {int}`
      • `the delivered Slack message does not contain the URL of issue {int}`
      • `the delivered Slack message contains no newline characters`
      • `the review-transition notifier does not throw`

  Background:
    Given the ADW codebase is checked out
    And a Slack webhook URL is configured

  # ── §1 Review ping — HITL-gated, links to the PR ──────────────────────────────
  #
  # The headline "go approve this" ping. A `hitl` issue moved to In Review produces
  # exactly one `:eyes:` Slack message whose link target is the PR. The negative
  # (non-`hitl`) scenario proves the label gate — the same gate every notification
  # shares.

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A hitl issue transitioning to Review delivers an :eyes: ping linking to the PR
    Given a GitHub issue 123 titled "Add retry budget to the poller" carrying the "hitl" label
    And an open pull request 100 whose body reads "Implements #123"
    When the review-transition notifier runs for issue 123
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains ":eyes:"
    And the delivered Slack message contains "HITL issue #123"
    And the delivered Slack message contains the title "Add retry budget to the poller"
    And the delivered Slack message contains "In Review"
    And the delivered Slack message contains "Approve to merge"
    And the delivered Slack message contains the URL of pull request 100
    And the delivered Slack message does not contain the URL of issue 123

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A non-hitl issue transitioning to Review delivers nothing
    Given a GitHub issue 124 titled "Routine dependency bump" without the "hitl" label
    And an open pull request 101 whose body reads "Implements #124"
    When the review-transition notifier runs for issue 124
    Then no Slack notification is delivered

  # ── §2 Review PR lookup is self-disambiguating ────────────────────────────────
  #
  # The PR is found from the OPEN PR list by `Implements #N` with a digit boundary,
  # then resolved by selectPreferredPR. A promotion PR ("Moves scenario…") and an
  # unrelated impl PR must not be chosen; and the digit boundary keeps issue #1 from
  # capturing a PR that implements #12.

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: The review ping picks the PR implementing the exact issue and ignores promotion and unrelated PRs
    Given a GitHub issue 123 titled "Add retry budget to the poller" carrying the "hitl" label
    And an open pull request 100 whose body reads "Implements #123"
    And an open pull request 200 whose body reads "Moves scenario foo.feature into the regression suite"
    And an open pull request 300 whose body reads "Implements #456"
    When the review-transition notifier runs for issue 123
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains the URL of pull request 100
    And the delivered Slack message does not contain the URL of pull request 200
    And the delivered Slack message does not contain the URL of pull request 300

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: The digit-boundary guard stops issue #1 from matching a PR that implements #12
    Given a GitHub issue 1 titled "Bootstrap the project" carrying the "hitl" label
    And an open pull request 50 whose body reads "Implements #1"
    And an open pull request 60 whose body reads "Implements #12"
    When the review-transition notifier runs for issue 1
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains the URL of pull request 50
    And the delivered Slack message does not contain the URL of pull request 60

  # ── §3 Blocked pings — HITL-gated, link to the issue ──────────────────────────
  #
  # The "go look at this" pings. Both sources link to the ISSUE (never a PR). The
  # discarded template is `:no_entry:`; the review-error template is `:warning:` and
  # carries a snippet of the failure. The non-`hitl` negative proves the shared gate.

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A discarded hitl issue delivers a :no_entry: ping linking to the issue
    Given a GitHub issue 130 titled "Wire the export endpoint" carrying the "hitl" label
    When the blocked-transition notifier runs for issue 130 with source "discarded"
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains ":no_entry:"
    And the delivered Slack message contains "HITL issue #130"
    And the delivered Slack message contains the title "Wire the export endpoint"
    And the delivered Slack message contains "discarded"
    And the delivered Slack message contains the URL of issue 130

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A review-error hitl issue delivers a :warning: ping linking to the issue
    Given a GitHub issue 131 titled "Tighten the auth guard" carrying the "hitl" label
    When the blocked-transition notifier runs for issue 131 with source "review_error" and error message "Assertion failed: expected approval state APPROVED"
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains ":warning:"
    And the delivered Slack message contains "HITL issue #131"
    And the delivered Slack message contains the title "Tighten the auth guard"
    And the delivered Slack message contains "PR review failed"
    And the delivered Slack message contains "needs attention"
    And the delivered Slack message contains "Assertion failed"
    And the delivered Slack message contains the URL of issue 131

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: The review-error snippet is collapsed to a single line and truncated
    Given a GitHub issue 132 titled "Refactor the merge gate" carrying the "hitl" label
    And a review error message that begins "Error: review build failed", spans several lines, and runs well past 200 characters before ending with the marker "TAIL-MARKER"
    When the blocked-transition notifier runs for issue 132 with source "review_error" and that error message
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains "Error: review build failed"
    And the delivered Slack message contains no newline characters
    And the delivered Slack message does not contain "TAIL-MARKER"

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A non-hitl issue reaching a Blocked terminal delivers nothing
    Given a GitHub issue 133 titled "Bump the lockfile" without the "hitl" label
    When the blocked-transition notifier runs for issue 133 with source "discarded"
    Then no Slack notification is delivered

  # ── §4 Which terminals notify — discarded & review_error yes, abandoned no ─────
  #
  # The crux of the Blocked design is *which* terminal handler calls the notifier.
  # The discarded and PR-review-error handlers each deliver their issue-linked ping
  # for a `hitl` issue; the transient-crash (abandoned) handler stays silent because
  # that path auto-retries via cron and self-heals. The handlers are driven with
  # process.exit and board/state writes stubbed, so only the Slack delivery is
  # observed.

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: The workflow-discarded terminal handler delivers the Blocked ping for a hitl issue
    Given a GitHub issue 140 titled "Migrate the cache layer" carrying the "hitl" label
    When the workflow-discarded terminal handler completes for issue 140
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains ":no_entry:"
    And the delivered Slack message contains the URL of issue 140

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: The PR-review-error terminal handler delivers the Blocked ping for a hitl issue
    Given a GitHub issue 141 titled "Harden the webhook" carrying the "hitl" label
    When the PR-review-error terminal handler completes for issue 141 with error message "review agent exited non-zero"
    Then a Slack notification is delivered to SLACK_WEBHOOK_URL
    And the delivered Slack message contains ":warning:"
    And the delivered Slack message contains "PR review failed"
    And the delivered Slack message contains the URL of issue 141

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: The transient-crash terminal handler stays silent for a hitl issue
    Given a GitHub issue 142 titled "Index the audit table" carrying the "hitl" label
    When the transient-crash terminal handler completes for issue 142
    Then no Slack notification is delivered

  # ── §5 Defensive boundaries — non-GitHub no-op, no-throw delivery ─────────────
  #
  # The notifier no-ops for a non-GitHub repository (GitLab/Jira board managers are
  # stubs) and never throws into its caller when Slack delivery fails — the boundary
  # is no-throw on both notifier entry points.

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A non-GitHub repository is a no-op for the review notifier
    Given a GitHub issue 150 titled "Provider-agnostic board move" carrying the "hitl" label
    And the active repository is hosted on a non-GitHub platform
    When the review-transition notifier runs for issue 150
    Then no Slack notification is delivered

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A non-GitHub repository is a no-op for the blocked notifier
    Given a GitHub issue 151 titled "Provider-agnostic discard" carrying the "hitl" label
    And the active repository is hosted on a non-GitHub platform
    When the blocked-transition notifier runs for issue 151 with source "discarded"
    Then no Slack notification is delivered

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: A failing Slack delivery is swallowed and the notifier does not throw
    Given a GitHub issue 152 titled "Resilient delivery" carrying the "hitl" label
    And an open pull request 152 whose body reads "Implements #152"
    And the configured Slack webhook rejects every delivery attempt
    When the review-transition notifier runs for issue 152
    Then the review-transition notifier does not throw

  # ── §6 Type-check backstop ────────────────────────────────────────────────────
  #
  # The two terminal handlers change from `: never` to `: Promise<never>` and their
  # callers must await before `process.exit`. The type-check is the backstop that the
  # signature change and its call sites compile.

  @adw-587 @adw-5jigj8-slack-notifications
  Scenario: TypeScript type-check passes after adding the HITL board notifier and async terminal handlers
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
