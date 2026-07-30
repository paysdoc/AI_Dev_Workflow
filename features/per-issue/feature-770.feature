@adw-770 @adw-42nx32-unverified-comment-m
Feature: The adw:unverified comment states the condition that actually produced it — no JUnit report emitted, not "Zero Testcases Ran"

  Issue #770 is a wrong-diagnosis defect in the unit-test phase's unverified
  channel. The comment posted when a run is marked `adw:unverified` is titled
  "ADW Unverified — Zero Testcases Ran" and claims the phase "ran but discovered
  zero testcases, and no test framework was detected in the repository's
  dependencies" — but the ONLY branch that reaches this comment is the
  no-JUnit-report branch, and nothing on that path ever inspects dependencies.

  The verdict table (`adws/core/testVerdict.ts`, pinned by feature-601 §2–§6) is
  unambiguous about which run lands where:

    • report ABSENT              → `warn`      → the phase applies `adw:unverified`
                                                 and posts THIS comment
    • report PRESENT, 0 cases    → `hard-fail` → the phase posts the error comment
                                                 and exits; the run never reaches
                                                 the unverified channel at all
    • report PRESENT, failures   → `hard-fail`
    • report PRESENT, count > 0  → `pass`

  So every claim in the comment describes a condition that CANNOT be the one that
  produced it. The cost is real: on `vestmatic/vestmatic` every completed issue
  carried the label while the repo has a 45+-feature Cucumber suite and
  `@cucumber/cucumber` in devDependencies — both of the comment's claims were
  false, and the diagnosis went hunting for missing tests instead of a missing
  `--format junit:$ADW_UNIT_TEST_REPORT_PATH` flag. The "Next steps" hint is
  stale in the same direction: it points at `## Test Framework` in
  `.adw/commands.md` "to enable strict zero-testcase detection", but
  `commands.testFramework` is consumed ONLY by the stack-coherence check and by
  nothing in the zero-testcase path.

  This issue changes comment TEXT only. The verdict table, the label, the
  non-blocking behaviour, and every other channel are unchanged — so most of the
  contract below is a guard against a template rewrite over-reaching.

  The behavioural contract pinned below:

    1. REAL CAUSE STATED (the fix). The comment composed for a run whose JUnit
       report was ABSENT reports that no JUnit report was emitted and names
       `ADW_UNIT_TEST_REPORT_PATH` — the variable holding the path the reader has
       to make their runner write to. RED today: the current body mentions
       neither.
    2. FALSE CLAIMS GONE (the fix). That same comment makes no claim that zero
       testcases were discovered and no claim about test frameworks in the
       repository's dependencies. RED today: the current title and first sentence
       assert both.
    3. NEXT STEPS RE-AIMED (the fix). The comment directs the reader to emit a
       JUnit report from the `## Run Tests` command, and no longer directs them to
       configure `## Test Framework`. RED today: the current hint names
       `## Test Framework` and never mentions `## Run Tests`.
    4. STILL NON-BLOCKING, STILL LABELLED (guard). The reworded comment still
       names the `adw:unverified` label and still says the workflow was not
       blocked. GREEN today and must stay GREEN: the channel is advisory, and a
       rewrite that reads as a failure would change what the reader does.
    5. STILL MACHINE-READABLE (guard). The reworded comment is still recognised as
       an ADW workflow comment and still carries its ADW ID. GREEN today and
       load-bearing: `isAdwComment` decides cron label eligibility, the
       concurrency guard, and the plan agent's human-vs-bot comment filter, and
       `extractLatestAdwId` reads the ADW ID footer back out to route resumes and
       PR reviews. A rewrite that drops the `## :emoji: Title` heading, the
       signature, or the `**ADW ID:**` footer would silently reclassify this
       comment as a human one.
    6. THE PREMISE — THE ZERO-TESTCASE RUN NEVER GETS HERE (guard). A run whose
       report was PRESENT with zero testcases resolves to hard-fail and composes
       the error comment; no unverified comment is composed for it. This is the
       fact that makes the old wording wrong, so it is pinned rather than assumed.
    7. NO OVER-REACH INTO THE COHERENCE CHANNEL (guard). The stack-coherence
       comment still directs the reader to confirm `## Test Framework` — that is
       the ONE place `commands.testFramework` is actually consumed, so a blunt
       repo-wide removal of the stale hint must not take it out.
    8. TYPE-CHECK BACKSTOP.

  How the scenarios drive the system under test:

    In-process (the phase-import pattern), with no orchestrator subprocess and no
    mock server:

      • The verdict is resolved through the REAL `computeTestVerdict` over the run
        the step describes (report absent / report present with zero testcases) —
        the same resolver `unitTestPhase` calls.
      • The comment is composed and dispatched through the REAL
        `postIssueStageComment` → `formatWorkflowComment` path, with a capturing
        `RepoContext` whose `issueTracker.commentOnIssue` records the body instead
        of calling GitHub — the fake-commenter pattern already used by
        feature-720 §3 and feature-639 §3. The recorded body is the assertion
        target.
      • The verdict → stage mapping (`warn` → `unverified`, `hard-fail` →
        `error`) is re-composed in the step definition rather than driven through
        `executeUnitTestPhase` itself, because that phase runs the `/test` agent
        and calls `process.exit(1)` on the hard-fail branch — neither is
        hermetically drivable. The mapping is therefore asserted as the composed
        channel identity (§1 first Then, §6) rather than assumed, and the
        phase-level wiring stays covered by the live run, exactly as feature-601
        deferred the channel emission and feature-577 §8/§9 deferred the
        end-to-end drive.

    Assertion style, so these scenarios do not rot on wording the fix is free to
    choose: every positive check is a token/family match on the produced body (for
    example "no JUnit report was emitted" is satisfied by any phrasing carrying
    both the absent-report sense and `JUnit`; "was not blocked" is satisfied by
    "non-blocking", "not blocked", or "continued without a hard gate"), never an
    exact-string equality against the whole template. The negative checks are
    aimed at the FALSE CLAIMS specifically, not at vocabulary: §2's
    dependency-claim check targets the detection assertion (words in the
    "detected" / "dependencies" family), so the fix is still free to mention the
    reader's test framework while telling them how to emit a report.

  Observability / rot-prevention note:

    Every assertion targets a comment body the system PRODUCES at runtime, plus
    the verdict its resolver returns — never the text, shape, or existence of a
    source file:

      • §1–§5 assert the body captured from the real comment dispatch. A produced
        comment body is exactly the surface registry phrase T-PY5 ("the composed
        proof comment shows the pass tally and an inline screenshot") and T-PY6
        ("publishing the proof posts a PR comment carrying the pass tally") assert
        against; §5's ADW-comment recognition and ADW-ID read-back are the values
        `isAdwComment` / `extractAdwIdFromComment` RETURN over that produced body.
      • §6 asserts the verdict resolved over a described run (report counts are
        INPUT, as the registry rubric permits) and which channel that verdict
        composes — both produced values.
      • §7 asserts the produced stack-coherence comment body.
      • §8 asserts the type-checker's verdict (registry T22).

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule):
    that `formatUnverifiedComment` exists or was edited, that
    `workflowCommentsIssue.ts` line 340 changed, or any substring/AST match
    against `workflowCommentsIssue.ts`, `unitTestPhase.ts`, or `testVerdict.ts`.
    The template's own per-line mechanics belong in the implementer's unit tests.
    No step reads a source file of this repo as text, substring-matches its
    contents, or parses it as JSON/AST.

  Scope notes:

    • The exact replacement wording in the issue's "Suggested fix" (the
      "No JUnit Report Emitted" title, the vitest / cucumber-js flag examples) is
      a SUGGESTION, and pinning it verbatim would make this file rot the first
      time a word changes. §1–§3 pin the semantic content it has to carry — real
      cause, no false claims, re-aimed next steps — so any faithful rewording
      passes and the current text cannot.
    • The `adw:unverified` LABEL application is the phase's other effect on this
      branch (`applyLabel` in `unitTestPhase`), is unchanged by this issue, and is
      not re-pinned here; feature-577 §8 owns it (pending the ISSUE-3-CUTOVER W1
      orchestrator driver). §4 pins only that the reworded comment still NAMES the
      label, which is comment text and therefore in scope.
    • The stale hint's other half — that `commands.testFramework` feeds only
      `stackCoherenceCheck` — is an existing wiring fact, not a change. §7 pins
      the side of it this issue could break (the coherence comment keeping its
      guidance); proving testFramework has no other consumer is a source-structure
      fact and is left to the implementer's unit tests.
    • feature-601 remains the authoritative unit-verdict spec and is NOT edited by
      this issue: #770 changes no branch of the table. §6 restates the two rows
      that matter here as the premise of the wording fix, phrased distinctly so it
      does not cross-wire feature-601's per-feature step state.
    • feature-577 §8/§9 still encode the retired `frameworkDetected`-keyed model
      (already flagged superseded in that file's own docstring by #601). They are
      untouched here — the mis-wording this issue fixes is a descendant of that
      retired model, but reconciling those scenarios is #601's outstanding
      business, not #770's.
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    No registered phrase covers composing a workflow comment through the comment
    dispatch and asserting its produced text — the registry's comment phrases
    (T2/T3/T14/T20/T21) all query a MOCK SERVER's recorded requests, which these
    hermetic, server-free scenarios never start. Novel phrasing is therefore
    introduced and the gap is surfaced to the maintainer in the agent Output:
      • `the composed channel comments carry the ADW ID {string}`
      • `the unit-test channel comment is composed for a run whose JUnit report was absent`
      • `the unit-test channel comment is composed for a run whose JUnit report was present with zero testcases`
      • `the stack-coherence channel comment is composed for a run with an incoherent stack`
      • `the composed channel is the unverified comment`
      • `the composed channel is the hard-fail error comment`
      • `no unverified comment is composed for that run`
      • `the composed comment reports that no JUnit report was emitted`
      • `the composed comment names the report path variable {string}`
      • `the composed comment makes no claim that zero testcases were discovered`
      • `the composed comment makes no claim about test frameworks in the repository's dependencies`
      • `the composed comment directs the reader to emit a JUnit report from the {string} command`
      • `the composed comment does not direct the reader to configure {string}`
      • `the composed comment still directs the reader to confirm {string}`
      • `the composed comment names the {string} label`
      • `the composed comment states the workflow was not blocked`
      • `the composed comment is recognised as an ADW workflow comment`
      • `the composed comment carries the ADW ID {string}`

  Background:
    Given the ADW codebase is checked out
    And the composed channel comments carry the ADW ID "770unverif"

  # ── §1 The real cause — an absent JUnit report, named with its path variable ──
  #
  # The run that actually reaches this channel is the report-absent one, so the
  # comment it posts must say so. Naming ADW_UNIT_TEST_REPORT_PATH is the half
  # that makes the comment actionable: it is the path the reader's runner has to
  # write to. RED today — the current body mentions neither the report nor the
  # variable.

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: The unverified comment names the absent JUnit report as the cause
    When the unit-test channel comment is composed for a run whose JUnit report was absent
    Then the composed channel is the unverified comment
    And the composed comment reports that no JUnit report was emitted
    And the composed comment names the report path variable "ADW_UNIT_TEST_REPORT_PATH"

  # ── §2 The two false claims are gone ─────────────────────────────────────────
  #
  # "discovered zero testcases" describes the hard-fail branch (§6), and "no test
  # framework was detected in the repository's dependencies" describes an
  # inspection this path never performs. Both sent vestmatic's diagnosis in the
  # wrong direction. The dependency check targets the DETECTION claim, so the fix
  # may still mention the reader's test framework while telling them how to emit
  # a report.

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: The unverified comment drops the zero-testcase and dependency-detection claims
    When the unit-test channel comment is composed for a run whose JUnit report was absent
    Then the composed comment makes no claim that zero testcases were discovered
    And the composed comment makes no claim about test frameworks in the repository's dependencies

  # ── §3 Next steps re-aimed at the report, off the stale Test Framework hint ───
  #
  # `commands.testFramework` is consumed only by the stack-coherence check, so
  # configuring it can never "enable strict zero-testcase detection". The
  # actionable fix lives in `## Run Tests`: make the runner emit JUnit XML.

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: The unverified comment's next steps point at emitting a JUnit report from the run-tests command
    When the unit-test channel comment is composed for a run whose JUnit report was absent
    Then the composed comment directs the reader to emit a JUnit report from the "## Run Tests" command
    And the composed comment does not direct the reader to configure "## Test Framework"

  # ── §4 Guard — the channel stays advisory ────────────────────────────────────
  #
  # GREEN today and must stay GREEN. The verdict is `warn`: the workflow
  # continues and the PR is still created. A rewrite that reads as a hard failure
  # would change what the reader does about it.

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: The reworded unverified comment still names the adw:unverified label and reports the run as unblocked
    When the unit-test channel comment is composed for a run whose JUnit report was absent
    Then the composed comment names the "adw:unverified" label
    And the composed comment states the workflow was not blocked

  # ── §5 Guard — the comment stays machine-readable ────────────────────────────
  #
  # GREEN today and load-bearing. `isAdwComment` (cron label eligibility, the
  # concurrency guard, the plan agent's human-vs-bot filter) keys on the
  # `## :emoji: Title` heading or the bot signature; `extractLatestAdwId` (resume
  # routing, PR-review targeting) reads the `**ADW ID:**` footer back out. A
  # template rewrite that drops either would silently reclassify this comment as
  # a human one.

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: The reworded unverified comment is still recognised as an ADW comment and still carries its ADW ID
    When the unit-test channel comment is composed for a run whose JUnit report was absent
    Then the composed comment is recognised as an ADW workflow comment
    And the composed comment carries the ADW ID "770unverif"

  # ── §6 The premise — the zero-testcase run never reaches this channel ────────
  #
  # A report present with zero testcases is the discovery break: hard-fail, error
  # comment, no PR. It is precisely the condition the old title advertised, and it
  # can never be the one that produced the comment. Pinned rather than assumed,
  # because the whole wording fix rests on it.

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: A report-present run that discovered zero testcases hard-fails instead of reaching the unverified channel
    When the unit-test channel comment is composed for a run whose JUnit report was present with zero testcases
    Then the composed channel is the hard-fail error comment
    And no unverified comment is composed for that run

  # ── §7 Guard — the coherence channel keeps its Test Framework guidance ───────
  #
  # `## Test Framework` is stale advice in the unverified comment but correct
  # advice in the stack-coherence comment — the one consumer of
  # `commands.testFramework`. Dropping the stale hint must not become a
  # repo-wide removal.

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: The stack-coherence comment keeps directing the reader to confirm Test Framework
    When the stack-coherence channel comment is composed for a run with an incoherent stack
    Then the composed comment still directs the reader to confirm "## Test Framework"

  # ── §8 Type-check backstop ───────────────────────────────────────────────────

  @adw-770 @adw-42nx32-unverified-comment-m
  Scenario: TypeScript type-check passes after the unverified comment rewording
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
