@adw-722 @adw-3qnnp1-consolidate-to-one-a
Feature: PR-review reuses the issue's existing adwId via the same resolver cron uses — one adwId per issue across SDLC and PR-review — and skips issue-less PRs, so the merge signal can never be shadowed (#712 consolidation)

  Issue #722 consolidates to ONE adwId per issue, end to end. Today every
  `adwPrReview` run mints its OWN fresh adwId, so a single issue accumulates
  multiple adwIds with scattered state, logs, and comment threads. That
  fragmentation is the #712 / PR #715 root cause: cron resolves "which adwId owns
  this issue" from the NEWEST adwId in the issue's comments, so a PR-review run's
  freshly-minted adwId SHADOWS the original SDLC run's `awaiting_merge` adwId —
  cron starts reading the PR-review adwId's (non-`awaiting_merge`) state and stops
  dispatching the merge entirely. #722 makes PR-review DISCOVER and REUSE the
  issue's existing adwId instead of minting a new one, so all work for an issue
  lives under a single identity and the merge signal can never be shadowed.
  Parent PRD: `specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md`
  (§Solution item 3; §Implementation Decisions "adwId consolidation"; User
  Stories 11–16).

  This slice builds directly on three shipped pieces and changes them minimally:

    • The cron stage resolver already derives an issue's canonical adwId as
      `extractLatestAdwId(comments)` — the LATEST adwId mentioned in the issue's
      comments, scanned newest-to-oldest. Cron uses it for stage resolution,
      retry, and takeover. #722 makes PR-review discover the issue's adwId through
      the SAME "latest adwId in the issue's comments" resolver, so PR-review and
      cron can never disagree about which adwId owns the issue.
    • The PR→issue link is already derived for every PR (`getPRDetails`): the PR
      body's `Implements #N` falling back to an `issue-(\d+)` branch name; when
      neither is present the PR carries no linked issue. #722 RELIES ON that
      derived link unchanged — a PR with a linked issue is issue-linked; a PR with
      none is issue-less and is skipped.
    • #721 already normalised `adwPrReview`'s RESUME form to `(issueNumber, adwId)`
      and resolves the PR from the reused adwId's persisted `branchName`. #722
      makes `(issueNumber, adwId)` the orchestrator's PRIMARY identity contract and
      points the PR-number-keyed triggers (cron PR-comment poll, webhook) at the
      new resolver so they spawn `(issueNumber, adwId)` instead of a raw PR number.

  The fix, precisely: a pure `resolvePrReviewTarget(prDetails, deps)` — with an
  injected issue-comment fetcher and an injected adwId generator — maps a polled PR
  to the PR-review identity to run under. It returns one of three dispositions:
  REUSE (the PR is issue-linked and the issue already carries an adwId → reuse that
  existing adwId, discovered via the same latest-adwId-in-the-issue's-comments
  resolver cron uses), FRESH-GENERATE (the PR is issue-linked but the issue carries
  NO adwId yet → generate a fresh one so genuinely new work still gets an identity),
  or SKIP (the PR is not issue-linked → leave it alone, no ADW review or
  auto-merge). The triggers that currently spawn PR-review by PR number delegate to
  the resolver and skip the issue-less PRs.

  The behavioural contract pinned below:

    1. RESOLVER ROUTES BY ISSUE-LINK + EXISTING adwId (AC2, AC4, the deep-module
       core). `resolvePrReviewTarget` maps PR details to a target: an issue-linked
       PR whose issue already carries an adwId REUSES that adwId for the issue (and
       mints nothing); an issue-linked PR whose issue carries no adwId yet
       FRESH-GENERATES one via the injected generator; a PR with no linked issue is
       SKIPPED. The exact three-path matrix AC7's unit tests call out, asserted
       behaviourally on the resolver's returned disposition.
    2. DISCOVERY MATCHES CRON; ONE adwId PER ISSUE (AC3, AC6). The reused adwId is
       the LATEST adwId in the issue's comments — the SAME value cron's resolver
       (`extractLatestAdwId`) returns for those comments — so PR-review and cron
       never disagree. On the reuse path the injected generator is NEVER invoked,
       so an issue that already carries its SDLC run's adwId keeps exactly that one
       adwId across SDLC + PR-review and its `awaiting_merge` signal can never be
       shadowed by a newer PR-review-minted id.
    3. TYPE-CHECK BACKSTOP (AC1, AC5, AC7-regression). The ADW TypeScript
       type-check still passes after `resolvePrReviewTarget` is added, the
       `adwPrReview` CLI is normalised to `(issueNumber, adwId)` resolving its PR
       from the reused adwId's persisted branch name, and the cron
       `checkPRsForReviewComments` poll + webhook are rewired through the resolver
       to spawn `(issueNumber, adwId)` and skip issue-less PRs.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    a source file:

      • §1 and §2 phase-import the pure `resolvePrReviewTarget(prDetails, deps)` and
        assert the DISPOSITION it RETURNS — reuse-with-this-adwId / fresh-generate /
        skip — a function-of-the-system return value, exactly the observable
        category feature-721 §1 asserts for `resolveResumeSpawn`, feature-719 §1 /
        feature-720 §1 assert for `decidePostReviewOutcome`, and feature-712 §4–§6
        assert for the pure remote-version read. The "reuse vs generate" distinction
        is observed BEHAVIOURALLY through the injected adwId generator: on a reuse
        the generator spy is NOT invoked; on a fresh-generate it IS invoked once and
        its returned id flows through. No step calls `existsSync`/`readFileSync` on
        any module, substring-matches a source file, or parses one as JSON/AST.
      • §2's "matches cron" assertion compares the resolver's reused adwId to the
        value cron's own `extractLatestAdwId(comments)` returns for the SAME injected
        comment set — both are return values of pure functions, asserted equal. The
        comment objects are the `{ body }[]` shape `extractLatestAdwId` already
        consumes; they are test INPUT data fed to an injected fetcher, not a file
        read.
      • §3 asserts the ADW TypeScript type-check exit status (registered vocabulary
        T22) — the compiler's verdict that `resolvePrReviewTarget` compiles, the
        normalised CLI's `(issueNumber, adwId)` type matches what the triggers pass,
        and the rewired poll/webhook still type-check — never a runtime file probe.

    No step reads `adws/core/resolvePrReviewTarget.ts`, `adws/adwPrReview.tsx`,
    `adws/phases/prReviewPhase.ts`, `adws/triggers/trigger_cron.ts`, or
    `adws/triggers/webhookHandlers.ts` as text, substring-matches their contents, or
    parses them as JSON/AST. The routing is proven by the disposition the resolver
    returns and by whether the injected generator fired.

  Scope notes:

    • THE PINNED BEHAVIOUR IS THE OBSERVABLE OUTCOME — the resolver's returned
      reuse/fresh/skip disposition, the reused adwId's equality with cron's
      latest-adwId resolution, and the generator-invoked-or-not signal — NOT the
      resolver's internal branch structure, the name or shape of its return object
      (a discriminated union, a nullable, a tagged result — the implementer's
      choice), or the precise field through which the issue number is carried. An
      implementer may structure `resolvePrReviewTarget` and its result freely as
      long as these outcomes hold (the #636/#639/#720/#721 "pin the decision, not
      the taxonomy" stance).
    • THE PR→ISSUE LINK DERIVATION IS NOT RE-TESTED HERE. That a PR body's
      `Implements #N` or an `issue-(\d+)` branch name yields the linked issue (and
      that neither yields none) is owned by `getPRDetails` / `extractIssueNumberFromBranch`
      and their existing unit coverage. §1 frames its Givens at the level of the
      DERIVED fact — "links issue N in its body", "links issue N via its branch
      name", "links no issue" — and feeds the resolver PR details already carrying
      that derived link, so the resolver's own contract (what it DOES with a
      linked-or-not PR) is what is pinned, not the regex upstream of it.
    • THE TRIGGER DELEGATION IS THIN WIRING, OUT OF SCOPE as a driven subprocess —
      exactly as feature-721 scoped the takeover/`phase_timeout` detached spawn.
      That cron `checkPRsForReviewComments` and the webhook call `resolvePrReviewTarget`,
      skip the SKIP-signalled PRs, and spawn `adwPrReview.tsx <issueNumber> <adwId>`
      for the rest is thin wiring over the resolver §1 pins; it is covered by §3's
      type-check and the existing cron regression harness (`cron_trigger_spawn.feature`),
      and is deliberately NOT re-driven as a real detached subprocess (the PR-comment
      poll uses a real `spawn`, which the mock harness cannot observe — see the
      "BDD harness observability limits" constraint).
    • THE CLI NORMALISATION IS THIN WIRING. That `adwPrReview`'s `main()` consumes
      `(issueNumber, adwId)` and resolves its PR from the reused adwId's persisted
      `branchName` rides the resume seam #721 already shipped (`adwPrReview.tsx`
      already resolves a PR from a reused adwId's `branchName`); #722 makes it the
      primary form. It is proven by §3's type-check, not by driving a full
      `adwPrReview` subprocess — the resolver §1 pins the identity decision upstream
      of the orchestrator, exactly as feature-721 pinned `resolveResumeSpawn` rather
      than driving a full resumed orchestrator.
    • feature-719 / feature-720 / feature-721 ARE NOT MODIFIED AND ARE NOT
      RE-TAGGED. #719 (PR-review hands off to `awaiting_merge`), #720 (the
      `review_failed` blocking stage), and #721 (per-adwId resume routing +
      `orchestratorScript`) each pin their own contract under their own adwId. #722
      changes WHICH adwId a PR-review run adopts (the issue's existing one rather
      than a fresh mint); it does not change what those slices pinned — a clean run
      still hands off at `awaiting_merge`, a failed run still blocks at
      `review_failed` tagged with its `orchestratorScript`, and a `## Retry` still
      re-arms to `phase_timeout`. Those features stay green and untouched.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the
      regression suite is a deliberate human decision and the agent never
      auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    The resolver is a brand-new pure module with injected dependencies, so — like
    feature-721's `resolveResumeSpawn` scenarios — its Given/When/Then surfaces have
    no registered phrase. The registry has no phrase for a polled PR's identity, for
    the issue's comment-resolved adwId, for priming the injected adwId generator, or
    for the resolver's reuse/fresh/skip disposition. Novel phrasing is introduced and
    surfaced to the maintainer in the agent Output:
      • `a pull request {int} that links issue {int} in its body`
      • `a pull request {int} that links issue {int} via its branch name`
      • `a pull request {int} that links no issue`
      • `the issue's comments record adwId {string} as its latest ADW run`
      • `the issue's comments record an earlier adwId {string} then a later adwId {string}`
      • `the issue's comments record no ADW run`
      • `the adwId generator is primed to produce {string}`
      • `the PR-review target is resolved for that pull request`
      • `the PR-review target reuses adwId {string} for issue {int}`
      • `the PR-review target reuses the same adwId cron resolves from the issue's comments`
      • `the PR-review target generates the fresh adwId {string} for issue {int}`
      • `the PR-review target skips the pull request as not issue-linked`
      • `the adwId generator was invoked once`
      • `the adwId generator was not invoked`

    Step-definition note for the maintainer:
      • §1 / §2 phase-import `resolvePrReviewTarget` from
        `adws/core/resolvePrReviewTarget.ts`. The Given builds an in-memory PR-details
        object on the World carrying the DERIVED linked issue (`{ number, linkedIssueNumber }`
        — `linkedIssueNumber` undefined for the issue-less PR), an injected
        `fetchIssueComments(issueNumber)` returning the seeded `{ body }[]` comment
        objects (the same shape `extractLatestAdwId` consumes; each body carries an
        adw-id the same way `extractAdwIdFromComment` reads), and an injected
        `generateAdwId` SPY that returns the primed value and counts its calls. The
        When calls `resolvePrReviewTarget(pr, { fetchIssueComments, generateAdwId })`
        and stores the returned target plus the spy's call count. The Thens assert
        the disposition only — reuse: the returned target is not a skip, carries
        issue N, and its adwId equals the existing id AND the generator spy fired
        zero times; fresh-generate: not a skip, carries issue N, its adwId equals the
        primed generated id AND the spy fired exactly once; skip: the returned target
        IS the skip signal AND the spy fired zero times. These pin the documented
        disposition + identity, not field names, so they survive a change to the
        result object's shape (mirroring feature-721's `resolveResumeSpawn` Thens).
      • §2's `reuses the same adwId cron resolves from the issue's comments` Then
        imports `extractLatestAdwId` from `adws/triggers/cronStageResolver.ts`, calls
        it on the SAME seeded comment array the Given fed the injected fetcher, and
        asserts the resolver's reused adwId `===` that value — a return-value equality
        between two pure functions, the literal "PR-review and cron never disagree"
        guard. The `record an earlier adwId X then a later adwId Y` Given seeds two
        comments in chronological order so the newest-to-oldest scan returns Y.
      • §3 reuses the registered T22 type-check Then (feature-504.steps.ts) — already
        registered, do NOT redefine.
      • feature-722.steps.ts must declare its OWN `@adw-722` Before/After hooks. All
        scenarios here are PURE: the resolver runs over in-memory PR details with
        INJECTED comment-fetcher and generator, so NO mock GitHub server and NO
        `agents/<adwId>` disk writes are needed (the whole point of the deep module +
        injected deps — PRD §Testing Decisions). The Before resets the module-scope
        scratch vars (PR details, seeded comments, primed/spied generator, last
        result); the After clears them. Nothing is written to disk, so there is no
        state-dir cleanup to perform.

  Background:
    Given the ADW codebase is checked out

  # ── §1 resolvePrReviewTarget: reuse / fresh-generate / skip (AC2, AC4, AC7) ────
  #
  # The deep-module core. `resolvePrReviewTarget(prDetails, deps)` maps a polled PR
  # to the PR-review identity to run under, one of three dispositions. One scenario
  # per path — the exact unit matrix AC7 names — asserted on the resolver's returned
  # disposition and on whether the injected adwId generator fired. The reuse and
  # fresh scenarios also demonstrate both issue-link sources (body, branch); the
  # skip scenario the issue-less PR. (Contract §1; User Stories 12, 14, 15, 16.)

  @adw-722 @adw-3qnnp1-consolidate-to-one-a
  Scenario: An issue-linked PR whose issue already carries an adwId reuses that adwId and mints nothing
    Given a pull request 8221 that links issue 7221 in its body
    And the issue's comments record adwId "rprt-722-reuse" as its latest ADW run
    And the adwId generator is primed to produce "rprt-722-unused"
    When the PR-review target is resolved for that pull request
    Then the PR-review target reuses adwId "rprt-722-reuse" for issue 7221
    And the adwId generator was not invoked

  @adw-722 @adw-3qnnp1-consolidate-to-one-a
  Scenario: An issue-linked PR whose issue carries no adwId yet falls back to a freshly generated one
    Given a pull request 8222 that links issue 7222 via its branch name
    And the issue's comments record no ADW run
    And the adwId generator is primed to produce "rprt-722-fresh"
    When the PR-review target is resolved for that pull request
    Then the PR-review target generates the fresh adwId "rprt-722-fresh" for issue 7222
    And the adwId generator was invoked once

  @adw-722 @adw-3qnnp1-consolidate-to-one-a
  Scenario: A PR with no linked issue is skipped with no identity minted
    Given a pull request 8223 that links no issue
    And the adwId generator is primed to produce "rprt-722-unused"
    When the PR-review target is resolved for that pull request
    Then the PR-review target skips the pull request as not issue-linked
    And the adwId generator was not invoked

  # ── §2 Discovery matches cron; one adwId per issue (AC3, AC6) ──────────────────
  #
  # The consolidation crux and the #712 anti-shadow guard. The reused adwId is the
  # LATEST adwId in the issue's comments — the SAME value cron's `extractLatestAdwId`
  # returns for those comments — so PR-review and cron can never disagree about which
  # adwId owns the issue. Seeded with an OLDER then a NEWER adwId, the resolver
  # reuses the newer (here the SDLC run's `awaiting_merge`-holding id) and the
  # injected generator never fires: the issue keeps exactly one adwId across SDLC +
  # PR-review, and no fresh PR-review id can shadow the merge signal. (Contract §2;
  # User Stories 11, 12, 13; the literal #712 / PR #715 root-cause fix.)

  @adw-722 @adw-3qnnp1-consolidate-to-one-a
  Scenario: PR-review reuses the issue's latest adwId — the same one cron resolves — so a single issue keeps one adwId and the merge signal is never shadowed
    Given a pull request 8224 that links issue 7224 in its body
    And the issue's comments record an earlier adwId "rprt-722-stale" then a later adwId "sdlc-722-awaiting-merge"
    And the adwId generator is primed to produce "rprt-722-shadow"
    When the PR-review target is resolved for that pull request
    Then the PR-review target reuses adwId "sdlc-722-awaiting-merge" for issue 7224
    And the PR-review target reuses the same adwId cron resolves from the issue's comments
    And the adwId generator was not invoked

  # ── §3 Type-check backstop (AC1, AC5, AC7-regression) ──────────────────────────
  #
  # `resolvePrReviewTarget` is a new module; the `adwPrReview` CLI is normalised to
  # `(issueNumber, adwId)` resolving its PR from the reused adwId's persisted branch
  # name; and the cron `checkPRsForReviewComments` poll + webhook are rewired through
  # the resolver to spawn `(issueNumber, adwId)` and skip issue-less PRs. The
  # type-check confirms the new module compiles, its injected-deps signature matches
  # the call sites, and the rewired triggers still type-check — proven by the
  # compiler (registry T22), never by a runtime file probe. Consistent with
  # feature-721 §4 / feature-720 §5 / feature-719 §5.

  @adw-722 @adw-3qnnp1-consolidate-to-one-a
  Scenario: The ADW TypeScript type-check passes after adding resolvePrReviewTarget and rewiring the CLI and triggers through it
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
