@adw-743 @adw-2ubuuc-rot-reuse-advisory-p
Feature: The review phase posts an advisory rot/reuse PR comment on promotion PRs — a regression-promotion PR receives one comment carrying per-phrase reuse and rot verdicts for the promoted scenario's Given/When/Then steps, and that fallible verdict is advisory only: it never blocks, gates, or crashes the promotion

  Issue #743 builds the ADVISORY half of the automated scenario-promotion sweep
  (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`, user stories 12-13,
  Implementation Decision "Pipeline modifications"). It is the reviewer-facing companion
  to the sweep that #740 originates: once a promotion issue has routed through the normal
  plan → build → test → PR pipeline and a `regression-promotion` PR is open, the review
  phase runs the `promote-regression-vocabulary` analysis over the promoted scenario's
  phrases and posts the per-phrase reuse/rot verdicts as a single PR comment, so the
  maintainer reviews the vocabulary changes with verdicts in hand rather than eyeballing
  raw Gherkin.

  WHAT THE ADVISORY DOES (parent PRD "Pipeline modifications", US12-13): a rot-comment
  step wired into `adws/phases/reviewPhase.ts`. When the PR under review carries the
  `regression-promotion` label, the step extracts the promoted scenario's Given/When/Then
  phrases, asks the `promote-regression-vocabulary` analysis for a REUSE verdict (is this
  phrase already registered? / near-duplicate?) and a ROT verdict (does its backing step
  def assert an observable artefact, or a source-code property?) per phrase, and posts a
  single PR comment tabulating them. The step is a pure side-effect: its ONLY output is
  the posted comment. A fallible automated rot verdict must NEVER block a legitimate
  promotion — the promotion/merge decision stays the maintainer's (a `hitl` gate), and an
  analysis failure degrades to a logged warning rather than crashing the pipeline.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance criteria —
  the fallible per-phrase VERDICT judgment itself is injected/deterministic here and is
  the analysis's own concern, not this pipeline step's, see Scope notes):

    1. PROMOTION PR ⇒ ONE ADVISORY COMMENT WITH PER-PHRASE VERDICTS (AC1, US12). A PR
       labelled `regression-promotion` under review receives EXACTLY ONE comment (not one
       comment per phrase) carrying a reuse verdict and a rot verdict for EACH of the
       promoted scenario's Given/When/Then phrases.
    2. NON-PROMOTION PR ⇒ NO SUCH COMMENT (AC3). A PR without the `regression-promotion`
       label receives no advisory comment — the label is a hard gate that short-circuits
       BEFORE any analysis runs, so an ordinary PR incurs neither the comment nor the
       analysis cost.
    3. ADVISORY, NEVER BLOCKING (AC2, US13). When the analysis SUCCEEDS and flags a
       promoted phrase as vocabulary rot, the advisory still surfaces that verdict in the
       one posted comment and completes without raising and without gating the review — a
       damning rot verdict is posted as advice, never turned into a review blocker.
    4. ANALYSIS FAILURE DEGRADES TO A WARNING (AC4). When the analysis itself throws, the
       step swallows the error, completes without raising, and posts no comment — the
       failure degrades to a logged warning and never crashes the review pipeline.
    5. TYPE-CHECK BACKSTOP (T22). The ADW codebase still type-checks with the new
       rot-comment advisory wired into `reviewPhase.ts`.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the advisory PRODUCES — the body and count
    of the comment handed to the injected/capturing PR commenter, whether the injected
    analysis was invoked at all, and whether the in-process advisory raised — or the
    type-checker's verdict (T22). These are vocabulary registry surface #2 ("recorded
    calls captured by a mock/injected seam", here the capturing `commentOnPullRequest`
    commenter) and the "completes without raising" no-throw property feature-740 §7 pins.

    A subtlety carried over verbatim from #739 / #740, called out so it is not mistaken
    for a rot violation: the seeded promoted `.feature` file whose phrases the advisory
    analyses is INPUT TEST-FIXTURE DATA — a scenario artefact the step CONSUMES to extract
    the promoted Given/When/Then phrases, the exact category the Rot-Detection Rubric
    permits (as feature-740 seeds per-issue fixtures the sweep consumes and feature-648
    seeds commits into a real temp repo) — NOT a source file of this framework. The step
    reading the promoted scenario's phrases (its input) and the scenario asserting the
    step's OUTPUT (was one comment posted, does its body carry the verdicts) are two
    different things; only the latter is an assertion. NO step below reads
    `reviewPhase.ts`, `scenarioParser.ts`, `vocabularyParser.ts`, or any framework source
    file as text, substring-matches its contents, or parses it as JSON/AST. The comment
    Thens (§1/§3) match against the comment body the advisory PRODUCED and handed to the
    injected commenter — a recorded call argument, not a source file.

  Scope notes:

    • THE FALLIBLE PER-PHRASE VERDICT IS INJECTED, NOT ASSERTED. Whether a given phrase is
      genuinely a reuse of a registered entry or genuinely rot is the `promote-regression-
      vocabulary` analysis's own (fallible, LLM-shaped) judgment — the very reason US13
      makes it advisory. This feature therefore INJECTS the per-phrase verdict (clean /
      rot / throws) deterministically and pins only that the PIPELINE STEP routes the
      analysis's output into exactly one comment, gated on the label, non-blocking and
      non-fatal. It deliberately does NOT assert that the analysis correctly classifies
      any real phrase — exactly as feature-740 injected its reconciliation facts and did
      NOT assert `promotionSweepDecider`'s per-cell action, and feature-739 injected merge
      ages and did NOT assert `promotionTagState`'s parse table. The correctness of the
      verdict rubric belongs to the analysis / its own unit coverage, not to this
      pipeline-wiring slice.
    • THE REVIEW-AGENT GATE ITSELF IS UNCHANGED AND NOT RE-PINNED. #743 adds a comment
      side-effect to the review phase; it does not change how the review agent judges the
      implementation or how `executeReviewPhase` decides pass/fail. Those are existing
      behaviour. What is NEW and pinned here is the advisory's contract: label-gated, one
      comment, per-phrase verdicts, never raising, never posting when the analysis fails.
      The non-blocking property (§3) is pinned as "the advisory surfaces the rot verdict
      and completes without raising or gating" — its only output is the comment; it
      returns nothing the review gate consumes, so a rot verdict structurally cannot block
      the promotion. This is the observable, falsifiable core of US13 (it catches a
      mis-implementation that throws-to-block on a rot finding or suppresses the comment).
    • HOW THE ADVISORY IS SEAMED is a SOURCE-STRUCTURE CHOICE, left unpinned exactly as
      feature-740 left its marker-write seam and feature-739 left its content-read seam.
      Whether the promoted scenario's phrases are extracted via the reused `scenarioParser`
      or another reader; whether the analysis is an injected dependency or an in-module
      call wrapped for injection in test; whether the label gate reads `config.issue.labels`
      or the PR's own labels; and whether the comment is posted through
      `repoContext.codeHost.commentOnPullRequest` or an injected `postComment` dep — none
      is asserted. The scenarios pin the behaviour (promotion ⇒ one verdict-bearing
      comment; ordinary ⇒ none; rot ⇒ surfaced, not blocking; failure ⇒ swallowed), not
      the mechanism.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the executed
      regression suite is a deliberate human decision (the very PR this advisory comments
      on) and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry's comment phrases (T2/T3/T14) are keyed
    on the mock GitHub API server's `getRecordedRequests()` surface, whereas this slice
    drives the new advisory shell IN-PROCESS with an INJECTED capturing PR commenter (the
    feature-740 pattern: a captured call, not a mock-server request) and an INJECTED
    analysis, so those registered phrases do not fit this driver. As #740 and #739 did for
    the sibling sweeps, feature-743 introduces DISTINCT, self-contained phrasing so that
    feature-743.steps.ts owns its step defs with no `AmbiguousStepDefinition` clash under
    the globally-loaded per-issue + regression step defs (the bespoke-per-feature
    convention; zero phrase collisions across the suite). The gap is surfaced to the
    maintainer here:
      • `a regression-promotion PR {int} for issue {int} is under review, promoting a scenario carrying Given/When/Then phrases`
      • `an ordinary PR {int} for issue {int} without the "regression-promotion" label is under review`
      • `the phrase analysis returns a reuse verdict and a rot verdict for each promoted phrase`
      • `the phrase analysis flags a promoted phrase as vocabulary rot`
      • `the phrase analysis fails`
      • `the review phase runs its promotion rot/reuse advisory`
      • `exactly one advisory comment is posted on PR {int}`
      • `the advisory comment carries a reuse verdict and a rot verdict for each promoted Given/When/Then phrase`
      • `the advisory comment surfaces the flagged rot verdict`
      • `no advisory comment is posted on PR {int}`
      • `the phrase analysis is not run`
      • `the promotion rot/reuse advisory does not block or fail the review`
      • `the promotion rot/reuse advisory completes without raising an error`

    Step-definition note for the maintainer (feature-743.steps.ts — keep it SELF-CONTAINED
    with its own `@adw-743` Before/After and module-private `ctx`; do NOT reach into
    feature-740 / feature-739 sweep step defs or the regression givenSteps/thenSteps
    comment defs T2/T3/T14):
      • Drive the NEW rot-comment advisory step of `adws/phases/reviewPhase.ts` IN-PROCESS
        (the feature-740 / feature-739 discipline: exercise the new deep helper directly,
        NOT an orchestrator subprocess and NOT the LLM review agent). Build the promotion
        context as an object the step consumes: a PR number, the issue's label set
        (`[{ name: 'regression-promotion' }]` for the promotion rows; a label set WITHOUT
        it for the ordinary-PR row), and a promoted scenario whose phrases the step
        extracts — seed a small `.feature` (a temp file, or a `features/regression/`
        fixture in a temp worktree) carrying ONE scenario with three known phrases (one
        `Given`, one `When`, one `Then`) so the "for each Given/When/Then phrase" Then has
        concrete phrases to match. This seeded scenario is INPUT fixture data the step
        CONSUMES — not a framework source file.
      • Inject the analysis as a capturing/​controllable dependency (mirroring the old
        `PromotionCommenterDeps.postComment` / `readFile` injection precedent):
          – `the phrase analysis returns a reuse verdict and a rot verdict for each
             promoted phrase` wires a stub analysis that, for each extracted phrase,
             returns a `{ reuse, rot }` verdict pair (deterministic canned values).
          – `the phrase analysis flags a promoted phrase as vocabulary rot` wires a stub
             whose verdict set includes at least one `rot: ROT` entry.
          – `the phrase analysis fails` wires a stub that THROWS when invoked (the AC4
             failure-injection, mirroring feature-740 §7's `<failingAction> fails
             transiently`). Also record whether the analysis stub was invoked, for
             `the phrase analysis is not run`.
      • Inject a CAPTURING PR commenter that records every `(prNumber, body)` it is handed
        (the seam the step posts through — `repoContext.codeHost.commentOnPullRequest` or
        an injected `postComment` dep; wiring is the implementer's choice). Record HEAD of
        the capture list before the run is not needed — assert against the captured calls
        after.
      • `the review phase runs its promotion rot/reuse advisory` invokes the production
        advisory step over the seeded context, wrapping the call so `completes without
        raising an error` / `does not block or fail the review` can assert no exception
        propagated (and no blocking result was returned). Do NOT stand up the mock GitHub
        server or a full `WorkflowConfig` review run; the advisory is exercised as the
        discrete step the PRD's "Pipeline modifications" describes.
      • The comment Thens read the CAPTURED commenter calls: `exactly one advisory comment
        is posted on PR {int}` asserts exactly one captured call for that PR number;
        `carries a reuse verdict and a rot verdict for each promoted Given/When/Then
        phrase` asserts the single captured body contains each of the seeded scenario's
        three phrases together with a reuse token and a rot token per phrase; `surfaces the
        flagged rot verdict` asserts the injected ROT verdict appears in the body; `no
        advisory comment is posted on PR {int}` asserts zero captured calls for that PR.
        `the phrase analysis is not run` asserts the analysis stub's invocation count is
        zero (the label gate short-circuited first). None of these reads a framework source
        file — they read the produced comment body (a captured call argument) and the
        injected stub's call record.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Promotion PR ⇒ ONE advisory comment carrying per-phrase reuse + rot verdicts (AC1 / US12) ─
  #
  # The headline. A `regression-promotion` PR under review receives EXACTLY ONE comment
  # (a single tabulated advisory, never one comment per phrase) carrying a reuse verdict
  # and a rot verdict for each of the promoted scenario's Given/When/Then phrases — so the
  # maintainer reviews the vocabulary changes with per-phrase verdicts in hand. RED before
  # the step exists (no comment is ever posted); GREEN once the advisory posts it.

  @adw-743 @adw-2ubuuc-rot-reuse-advisory-p
  Scenario: A regression-promotion PR receives one advisory comment with a reuse and rot verdict per promoted phrase
    Given a regression-promotion PR 900 for issue 665 is under review, promoting a scenario carrying Given/When/Then phrases
    And the phrase analysis returns a reuse verdict and a rot verdict for each promoted phrase
    When the review phase runs its promotion rot/reuse advisory
    Then exactly one advisory comment is posted on PR 900
    And the advisory comment carries a reuse verdict and a rot verdict for each promoted Given/When/Then phrase

  # ── §2 Non-promotion PR ⇒ NO advisory comment; the label gate short-circuits (AC3) ─────
  #
  # The label is a hard gate. A PR that does NOT carry `regression-promotion` receives no
  # advisory comment at all — and the gate fires BEFORE any analysis, so an ordinary PR
  # incurs neither the comment nor the analysis cost. Guards against an implementation that
  # comments (or analyses) on every reviewed PR.

  @adw-743 @adw-2ubuuc-rot-reuse-advisory-p
  Scenario: An ordinary PR without the regression-promotion label receives no advisory comment
    Given an ordinary PR 900 for issue 665 without the "regression-promotion" label is under review
    When the review phase runs its promotion rot/reuse advisory
    Then no advisory comment is posted on PR 900
    And the phrase analysis is not run

  # ── §3 Advisory, never blocking — a rot verdict is surfaced, not turned into a gate (AC2 / US13) ─
  #
  # The core of US13: a fallible rot verdict must never block a legitimate promotion. When
  # the analysis SUCCEEDS and flags a promoted phrase as vocabulary rot, the advisory still
  # posts the one comment surfacing that verdict AND completes without raising or gating the
  # review — the maintainer sees the rot flag as advice and keeps the merge decision. Guards
  # against a mis-implementation that throws-to-block on a rot finding, or suppresses the
  # comment when rot is present.

  @adw-743 @adw-2ubuuc-rot-reuse-advisory-p
  Scenario: A rot verdict is surfaced in the advisory comment without blocking the review
    Given a regression-promotion PR 900 for issue 665 is under review, promoting a scenario carrying Given/When/Then phrases
    And the phrase analysis flags a promoted phrase as vocabulary rot
    When the review phase runs its promotion rot/reuse advisory
    Then exactly one advisory comment is posted on PR 900
    And the advisory comment surfaces the flagged rot verdict
    And the promotion rot/reuse advisory does not block or fail the review

  # ── §4 Analysis failure degrades to a warning — never crashes the pipeline (AC4) ───────
  #
  # The non-fatal guarantee, mirroring feature-740 §7 (`runPromotionSweep` swallows a
  # transient git/gh error). When the analysis itself THROWS, the advisory step swallows it,
  # completes without raising, and posts no comment — the failure degrades to a logged
  # warning and the review pipeline is never crashed. RED if the step lets the throw
  # propagate; GREEN once it is wrapped.

  @adw-743 @adw-2ubuuc-rot-reuse-advisory-p
  Scenario: A failing phrase analysis is swallowed and never crashes the review
    Given a regression-promotion PR 900 for issue 665 is under review, promoting a scenario carrying Given/When/Then phrases
    And the phrase analysis fails
    When the review phase runs its promotion rot/reuse advisory
    Then the promotion rot/reuse advisory completes without raising an error
    And no advisory comment is posted on PR 900

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The new rot-comment advisory keeps the ADW codebase type-clean. A backstop consistent
  # with feature-740 §T and feature-739 §T.

  @adw-743 @adw-2ubuuc-rot-reuse-advisory-p
  Scenario: The ADW TypeScript type-check passes with the promotion rot/reuse advisory wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
