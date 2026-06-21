@adw-647 @adw-k3x7dc-bug-hitl-review-slac
Feature: Reliable HITL Review→Slack delivery — the review ping is awaited, its outcome is logged, and it works under the node webhook process

  Issue #647 is a follow-up bugfix to feature-587 (which added the HITL board-event
  Slack notifier). In production, two `hitl` issues (#612, #641) were moved to the
  board "Review" status by their `adwSdlc` runs, every notifier gate passed, yet no
  Slack message ever arrived. The notification was silently dropped.

  Root cause — a fire-and-forget delivery starved by process exit:

    • `moveIssueToStatus` (`adws/github/projectBoardApi.ts`) dispatched the review
      ping as `void notifyReviewTransition({ issueNumber, repoInfo })` — an orphaned
      promise nobody held. `notifyReviewTransition` does its two synchronous `gh`
      reads, then yields at `await postSlack(...)` (which has just initiated `fetch`).
      The very next phase (Proof-Publish) runs a blocking `gh` exec that starves the
      event loop, then `main()` returns and the orchestrator process tears down — all
      before the orphaned `fetch` can settle. Both #612 and #641 show the identical
      ~1s shape, so this is a structural timing bug, not two Slack-side misses.
    • `postSlack` (`adws/core/slackNotifier.ts`) logs NOTHING on success (only `warn`
      on failure), so "did the HITL ping actually go out?" is unanswerable from
      `logs/webhook.log` — there were zero "Slack" lines either way.
    • (Latent) Nothing loads `.env` in the webhook process. Orchestrators run under
      `bunx` (which auto-loads `.env`), so they happened to have `SLACK_WEBHOOK_URL`;
      the webhook entrypoint is `node` (`npm exec tsx`) and has no `.env` loaded, so a
      `postSlack` invoked directly from the webhook process silently no-ops on the
      "not set; skipping" branch.

  The fix pinned below (the three acceptance criteria of the issue):

    1. AWAIT THE DELIVERY. The review notification is delivered as part of the awaited
       call chain, so the dispatching operation cannot resolve — and the orchestrator
       cannot exit — until the Slack POST has settled.
    2. SIGNAL THE DELIVERY. `postSlack` emits a one-line success/failure log so the
       outcome of every Slack delivery is observable from the log stream.
    3. LOAD `.env` UNDER NODE. A `postSlack` invoked from the node webhook process
       finds `SLACK_WEBHOOK_URL` from `.env` and delivers, instead of no-opping.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime, never
    the text of a source file of this repo. No step reads `slackNotifier.ts`,
    `hitlBoardNotifier.ts`, `projectBoardApi.ts`, or `trigger_webhook.ts` as text,
    substring-matches its contents, or parses it as JSON/AST.

      • The Slack delivery itself — the HTTP POST the notifier makes to
        `SLACK_WEBHOOK_URL` — is captured as a recorded request (registry Observability
        Surface #2), the same stubbed-`fetch` sink idiom feature-587 established. The
        delivered message body is the system's OUTPUT, an artefact; asserting the text
        it carries and the PR link it targets are behaviour assertions.
      • The delivery SIGNAL is asserted against the log stream the system emits
        (registry Observability Surface #5) — the `console.log` line `postSlack` writes.
        §1–§3 capture it in-process; §4 reads it from the spawned process's stdout. A
        log line is a runtime output, an artefact — not a source read.
      • §4 additionally asserts a recorded request against a real local sink the
        spawned node process reaches (Surface #2), and the type-checker's verdict
        (registry T22) is the §5 backstop.

    Deliberately NOT asserted here (would require driving `moveIssueToStatus`, whose
    board write is a Projects-V2 `gh api graphql` call the regression mock cannot serve
    — the exact boundary feature-587's preamble recorded when it left the fire-and-forget
    wiring untested, which is precisely what regressed into this bug): that the `void`
    on line 288 of `projectBoardApi.ts` becomes `await`. Driving that entry point would
    add no hermetic coverage beyond driving the notifier directly. The caller-side
    `await` is the implementer's `moveIssueToStatus` unit test; the BDD layer pins the
    callee-side contract the caller's `await` depends on — that the notification, once
    sent, settles its delivery within the awaited call (§3) — plus the two genuinely
    observable, RED-able fixes (the delivery signal §1/§2 and the node `.env` load §4).

  Scope notes:

    • The pinned behaviour is the OBSERVABLE outcome — the delivery reaching the
      endpoint, the success/failure/skip log line, the delivery settling before the
      notification resolves, and a node process delivering from `.env`. The internal
      mechanism (whether `postSlack` logs before or after the status check, how the
      webhook entrypoint loads `.env`, the exact log wording) is the implementer's
      to choose, as long as these outcomes hold.
    • feature-587 already fully pins the notifier's MESSAGE CONTRACT (emoji, HITL gate,
      PR/issue link disambiguation, snippet hygiene, which terminals notify, non-GitHub
      no-op). This issue does NOT re-assert that contract; §2 asserts only enough of the
      review ping to confirm the delivered+logged message is the right one. feature-587
      is not modified by this issue and is not cross-tagged.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the regression
      suite is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    NOT reused from feature-587: feature-587's Slack steps (`a Slack notification is
    delivered to SLACK_WEBHOOK_URL`, `the review-transition notifier runs for issue
    {int}`, the issue/PR fixtures, etc.) are bound to feature-587's `@adw-587`-scoped
    `Before`/`After` hooks and its feature-local `world`. Those hooks do not fire for
    `@adw-647` scenarios, so reusing the phrases verbatim would read an uninitialised
    sink (and redefining them would collide in the global step pool). This feature
    therefore introduces its own `@adw-647`-scoped harness and distinct phrasing.

    Novel phrasing introduced here — the registry has no Slack-delivery, delivery-log,
    or `.env`-load phrase. Surfaced to the maintainer in the agent Output:
      • `a Slack webhook endpoint is configured that accepts deliveries`
      • `a Slack webhook endpoint is configured that rejects deliveries with HTTP {int}`
      • `a Slack webhook endpoint is configured that drops every connection`
      • `no Slack webhook endpoint is configured`
      • `the Slack webhook endpoint settles deliveries on a deferred turn`
      • `a hitl issue {int} titled {string} is entering Review`
      • `a non-hitl issue {int} titled {string} is entering Review`
      • `the issue has an open pull request {int} that implements it`
      • `a node webhook process whose SLACK_WEBHOOK_URL is set only in its .env file`
      • `a Slack notification with text {string} is posted`
      • `the HITL review notification is sent for issue {int}`
      • `the webhook process loads its environment and posts a HITL Slack notification`
      • `the Slack endpoint receives the notification`
      • `the Slack endpoint receives no notification`
      • `the delivered notification text contains {string}`
      • `the delivered notification links to pull request {int}`
      • `the delivered notification does not link to issue {int}`
      • `the Slack delivery is recorded as successful in the log`
      • `the Slack delivery is recorded as failed in the log`
      • `the Slack skip is recorded in the log`
      • `the HITL review notification resolves only after its Slack delivery has been recorded`
      • `sending the HITL review notification does not throw`
      • `the configured webhook endpoint records the delivery`
      • `the webhook process does not log a skipped Slack notification`

    Step-definition note for the maintainer:
      • §1–§3 run in-process. A `@adw-647` `Before` hook stubs `globalThis.fetch` to a
        sink that records each Slack POST body (and is configurable to return 200, a
        non-2xx, or to reject), points `SLACK_WEBHOOK_URL` at it, and captures
        `console.log` into a buffer (the logger writes there). §1 phase-imports
        `postSlack` from `adws/core/slackNotifier.ts`; §2–§3 phase-import
        `notifyReviewTransition` from `adws/github/hitlBoardNotifier.ts` with injected
        `NotifierDeps` seeded from the issue/PR fixtures (the feature-587 §1 seam).
      • §3's deferred-turn sink records the delivery only after a yielded turn (e.g.
        `await Promise.resolve()` before pushing), so `the notification resolves only
        after its Slack delivery has been recorded` is true ONLY if the notifier awaits
        the POST to completion — the callee contract the caller's `await` relies on.
      • §4 spawns a `node` (non-bun) subprocess with cwd at a temp dir whose `.env`
        sets `SLACK_WEBHOOK_URL` to a real local sink, with that var ABSENT from the
        spawn environment. The subprocess performs the webhook entrypoint's env load,
        then posts. The parent asserts the sink recorded the request and the
        subprocess stdout carries no "not set; skipping" line.

  Background:
    Given the ADW codebase is checked out

  # ── §1 The delivery signal — every postSlack outcome is observable (AC2) ──────
  #
  # The RED core of the fix: postSlack logs nothing on success today, so a delivered
  # HITL ping leaves no trace. After the fix, success, failure (non-2xx), connection
  # failure, and the unconfigured skip are each answerable from the log stream — the
  # whole point of "delivery success/failure is observable in the log."

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: A successful Slack delivery is recorded as successful in the log
    Given a Slack webhook endpoint is configured that accepts deliveries
    When a Slack notification with text ":eyes: HITL ping" is posted
    Then the Slack endpoint receives the notification
    And the Slack delivery is recorded as successful in the log

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: A Slack delivery rejected with a non-2xx status is recorded as failed in the log
    Given a Slack webhook endpoint is configured that rejects deliveries with HTTP 400
    When a Slack notification with text ":eyes: HITL ping" is posted
    Then the Slack delivery is recorded as failed in the log

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: A Slack delivery whose connection drops is recorded as failed in the log
    Given a Slack webhook endpoint is configured that drops every connection
    When a Slack notification with text ":eyes: HITL ping" is posted
    Then the Slack delivery is recorded as failed in the log

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: With no webhook configured the skip is recorded in the log and nothing is delivered
    Given no Slack webhook endpoint is configured
    When a Slack notification with text ":eyes: HITL ping" is posted
    Then the Slack endpoint receives no notification
    And the Slack skip is recorded in the log

  # ── §2 A hitl Review transition produces a delivered, logged ping (AC1 + AC2) ──
  #
  # The end-to-end outcome the production runs failed to produce: a hitl issue moved
  # to Review delivers exactly the :eyes: PR-linked ping AND records that delivery in
  # the log, so an operator can confirm it went out. A non-hitl issue stays silent —
  # the shared label gate — and likewise records no delivery.

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: A hitl issue entering Review delivers an :eyes: PR-linked ping that is logged as delivered
    Given a hitl issue 6471 titled "Bounded resume cap" is entering Review
    And the issue has an open pull request 6481 that implements it
    And a Slack webhook endpoint is configured that accepts deliveries
    When the HITL review notification is sent for issue 6471
    Then the Slack endpoint receives the notification
    And the delivered notification text contains ":eyes:"
    And the delivered notification text contains "HITL issue #6471"
    And the delivered notification text contains "In Review"
    And the delivered notification links to pull request 6481
    And the delivered notification does not link to issue 6471
    And the Slack delivery is recorded as successful in the log

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: A non-hitl issue entering Review delivers nothing and records no delivery
    Given a non-hitl issue 6472 titled "Routine dependency bump" is entering Review
    And the issue has an open pull request 6482 that implements it
    And a Slack webhook endpoint is configured that accepts deliveries
    When the HITL review notification is sent for issue 6472
    Then the Slack endpoint receives no notification

  # ── §3 Await-safety — the ping settles before the call resolves (AC1) ──────────
  #
  # The callee contract the caller's `await` depends on: the notification does not
  # resolve until its Slack delivery has settled, so once `moveIssueToStatus` awaits
  # it the orchestrator cannot exit mid-flight. The deferred-turn sink makes this
  # meaningful — it would fail if the notifier were ever made fire-and-forget again
  # (the exact shape of this bug, one level up). The no-throw guarantee is what keeps
  # the new upstream `await` safe: a failed delivery must not propagate into the move.

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: The HITL review notification settles its Slack delivery before it resolves
    Given a hitl issue 6473 titled "Resume-in-place gate" is entering Review
    And the issue has an open pull request 6483 that implements it
    And a Slack webhook endpoint is configured that accepts deliveries
    And the Slack webhook endpoint settles deliveries on a deferred turn
    When the HITL review notification is sent for issue 6473
    Then the HITL review notification resolves only after its Slack delivery has been recorded

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: A failing Slack delivery is swallowed so the awaited notification never breaks the move
    Given a hitl issue 6474 titled "Webhook auth gate" is entering Review
    And the issue has an open pull request 6484 that implements it
    And a Slack webhook endpoint is configured that drops every connection
    When the HITL review notification is sent for issue 6474
    Then sending the HITL review notification does not throw
    And the Slack delivery is recorded as failed in the log

  # ── §4 The node webhook process delivers from .env (AC3) ──────────────────────
  #
  # The latent half: the webhook runs under node, which does not auto-load `.env`, so
  # a postSlack from the webhook process no-ops on "not set; skipping". After the fix
  # the entrypoint loads `.env`, so a Slack notification posted from a node process
  # whose SLACK_WEBHOOK_URL lives only in `.env` reaches the endpoint — and leaves no
  # skip line behind.

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: A node webhook process posts Slack using SLACK_WEBHOOK_URL loaded from .env
    Given a node webhook process whose SLACK_WEBHOOK_URL is set only in its .env file
    When the webhook process loads its environment and posts a HITL Slack notification
    Then the configured webhook endpoint records the delivery
    And the webhook process does not log a skipped Slack notification

  # ── §5 Type-check backstop ────────────────────────────────────────────────────
  #
  # The awaited notification (callers now await up the chain), the new delivery-signal
  # log, and the webhook `.env` load keep the ADW codebase type-clean. A backstop,
  # consistent with feature-587 §6 and feature-639 §6.

  @adw-647 @adw-k3x7dc-bug-hitl-review-slac
  Scenario: The ADW TypeScript type-check passes with the awaited, logged HITL notification and .env-loading webhook
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
