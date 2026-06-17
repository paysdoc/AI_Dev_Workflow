@adw-618 @adw-la04ed-fix-adw-label-overri
Feature: adw:* label override enforced at the classification chokepoint — every label-unaware trigger path honors it

  Issue #618 makes the documented contract — *"`adw:*` GitHub labels provide a
  deterministic override that bypasses AI classification entirely"* (README) — a
  real invariant rather than a per-caller convention. Today the override is
  honored on only **2 of 4** spawn paths, so a single `adw:<type>` label can
  still reach the LLM classifier and be misclassified.

    | Spawn path                                          | Honors adw:* override (before #618)? |
    |-----------------------------------------------------|--------------------------------------|
    | Cron backlog sweep (`trigger_cron.ts`)              | yes — pre-reads labels, passes labelRouting |
    | `issues.opened` webhook (`issueOpenedRouter.ts`)    | yes — pre-reads labels               |
    | `issue_comment` webhook (`trigger_webhook.ts`)      | NO — calls classifyAndSpawnWorkflow with no labelRouting |
    | Dependency-closure spawn (`webhookGatekeeper.ts`)   | NO — calls classifyAndSpawnWorkflow with no labelRouting |

  Root cause: the two failing callers invoke `classifyAndSpawnWorkflow(...)`
  without a `labelRouting` argument, so classification falls through to the
  shared chokepoint `classifyIssueForTrigger` (`adws/core/issueClassifier.ts`),
  which — before this fix — always ran the `/classify_issue` LLM heuristic with
  no label check. Issue #614 is the observed instance: it carried exactly
  `hitl` + `adw:bug`, an actionable comment routed it through the
  `issue_comment` path, and Sonnet misclassified the `fix:` issue as `/feature`
  ($0.59 for a result a free, deterministic label read should have produced).

  The fix relocates the override into the chokepoint. `classifyIssueForTrigger`
  already fetches the issue (whose result carries `labels`); a deterministic
  guard reads those labels via `labelManager.readAdwLabels` and, when exactly
  one `adw:<type>` classification label is present (`classification` set,
  `conflict` false), returns that type as a successful classification *before*
  the LLM call. Because every label-unaware caller funnels through this single
  function, pushing the guard here makes the override hold on all four paths at
  once and saves an LLM call on every labelled issue. The cron and
  `issues.opened` paths keep their existing label pre-read as a harmless earlier
  short-circuit (they never reach the chokepoint for a single-label issue, and
  are proven in features #545 and #542 respectively); the chokepoint guard is
  their universal second line of defence.

  Conflict and absence are unchanged: when more than one `adw:<type>`
  classification label is present (`conflict` true), or when none is present,
  the chokepoint falls through to the LLM exactly as before — it never picks one
  label arbitrarily.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    never the text of a source file. No step reads `issueClassifier.ts` (or any
    module) as text, substring-matches its contents, or parses it as JSON/AST.

      • The classification a trigger resolves is asserted through the value
        `classifyIssueForTrigger` returns — the chokepoint's output, exercised
        the same way feature-540 exercises `readAdwLabels`: drive the function
        with a real input, assert its real return (`issueType`, `success`).
      • Whether the LLM heuristic ran is asserted through a recording classifier
        seam — the same observable channel feature-542 uses to prove the
        label-routed branches skip the classifier while the infer branch runs
        it. A recorded (or absent) classifier invocation is an output of the
        chokepoint, not a source-file property. The inferred type on the
        fall-through branches is read from the loaded claude-cli-stub fixture
        (G9), parsed with the same last-match regex the real classifier uses.
      • The type-check scenario asserts the type-checker's verdict — the output
        of running `tsc`, not a file's contents.

  Scope notes:

    • The `{ optOut, classification, conflict }` shape the guard consumes is
      owned by `labelManager.readAdwLabels` (issue #540) and proven exhaustively
      there — including `adw:` namespace matching (`adw-bug` / `adwesome` are
      NOT adw:* labels) and the `adw:upgrade` marker not being a classification.
      This feature exercises only the chokepoint's use of that shape, not a
      re-enumeration of the shape itself.
    • `adw:none` opt-out is evaluated by the eligibility layer before
      classification is ever requested (proven in features #542 and #545); an
      opted-out issue does not reach the chokepoint, so opt-out is out of scope
      here.
    • Driving the full `classifyAndSpawnWorkflow` spawn is not viable in this
      harness — it calls `spawnDetached`, which forks a real detached
      orchestrator (the regression W-steps return pending for exactly this
      reason). Section 3 therefore drives the shared chokepoint that the
      `issue_comment` and dependency-closure paths delegate to (no
      `labelRouting`), which is the classification step those paths perform.

  Vocabulary note:

    The registered phrase reused below is G9 ("the claude-cli-stub is loaded
    with fixture {string}"), which supplies the deterministic LLM verdict on the
    fall-through branches. The classifier-invocation assertions are deliberately
    phrased as "the AI classification heuristic was / was not invoked for issue
    {int}" — distinct from feature-542's "the claude classifier was … invoked"
    so this feature's step binds to its own recording seam rather than 542's
    module-scoped state, the same context-isolation tactic feature-545 uses by
    path-qualifying its spawn phrasing apart from feature-542. The registry has
    no phrase for seeding an issue with a label set as a classification input,
    for asserting the type a trigger's classification resolves to, for asserting
    the classification reports success, for naming the trigger path that
    performs the classification, or for the AI-heuristic-invocation assertion.
    Novel Gherkin phrasing is introduced for those and the gap is surfaced to
    the maintainer in the Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Single adw:<type> label overrides at the chokepoint — no LLM call ─────
  #
  # The fix's locus. A lone classification label deterministically selects the
  # matching type and the LLM heuristic is never invoked. All four workflow
  # types are covered; pr_review pins that the underscore type survives intact.

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: A single adw:bug label resolves the trigger classification to bug with no LLM call
    Given an issue 61810 carrying the labels "adw:bug"
    When the trigger classifier runs for issue 61810
    Then the trigger classification for issue 61810 resolves to "bug"
    And the trigger classification for issue 61810 reports success
    And the AI classification heuristic was not invoked for issue 61810

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: A single adw:feature label resolves the trigger classification to feature with no LLM call
    Given an issue 61811 carrying the labels "adw:feature"
    When the trigger classifier runs for issue 61811
    Then the trigger classification for issue 61811 resolves to "feature"
    And the trigger classification for issue 61811 reports success
    And the AI classification heuristic was not invoked for issue 61811

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: A single adw:chore label resolves the trigger classification to chore with no LLM call
    Given an issue 61812 carrying the labels "adw:chore"
    When the trigger classifier runs for issue 61812
    Then the trigger classification for issue 61812 resolves to "chore"
    And the trigger classification for issue 61812 reports success
    And the AI classification heuristic was not invoked for issue 61812

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: A single adw:pr_review label resolves the trigger classification to pr_review with no LLM call
    Given an issue 61813 carrying the labels "adw:pr_review"
    When the trigger classifier runs for issue 61813
    Then the trigger classification for issue 61813 resolves to "pr_review"
    And the trigger classification for issue 61813 reports success
    And the AI classification heuristic was not invoked for issue 61813

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: A single adw:<type> label alongside unrelated labels still overrides with no LLM call
    Given an issue 61814 carrying the labels "adw:bug,hitl"
    When the trigger classifier runs for issue 61814
    Then the trigger classification for issue 61814 resolves to "bug"
    And the trigger classification for issue 61814 reports success
    And the AI classification heuristic was not invoked for issue 61814

  # ── §2 Conflict and absence fall through to the LLM — unchanged behaviour ────
  #
  # The guard short-circuits only when readAdwLabels yields a single, unconflicted
  # classification. More than one adw:<type> label is a conflict; zero adw:<type>
  # labels is an absence; both reach the LLM heuristic, which here returns the
  # type fixed by the loaded claude-cli-stub fixture (feature → classify-as-feature).

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: Two distinct adw:<type> labels are a conflict — the chokepoint falls through to the LLM
    Given an issue 61820 carrying the labels "adw:bug,adw:feature"
    And the claude-cli-stub is loaded with fixture "classify-as-feature.json"
    When the trigger classifier runs for issue 61820
    Then the AI classification heuristic was invoked for issue 61820
    And the trigger classification for issue 61820 resolves to "feature"

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: Three distinct adw:<type> labels still conflict — the chokepoint falls through to the LLM
    Given an issue 61821 carrying the labels "adw:bug,adw:feature,adw:chore"
    And the claude-cli-stub is loaded with fixture "classify-as-feature.json"
    When the trigger classifier runs for issue 61821
    Then the AI classification heuristic was invoked for issue 61821
    And the trigger classification for issue 61821 resolves to "feature"

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: An issue carrying only non-adw labels has no override — the LLM classifier runs
    Given an issue 61822 carrying the labels "bug,enhancement"
    And the claude-cli-stub is loaded with fixture "classify-as-feature.json"
    When the trigger classifier runs for issue 61822
    Then the AI classification heuristic was invoked for issue 61822
    And the trigger classification for issue 61822 resolves to "feature"

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: An issue carrying no labels at all has no override — the LLM classifier runs
    Given an issue 61823 carrying no labels
    And the claude-cli-stub is loaded with fixture "classify-as-feature.json"
    When the trigger classifier runs for issue 61823
    Then the AI classification heuristic was invoked for issue 61823
    And the trigger classification for issue 61823 resolves to "feature"

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: A lone adw:upgrade marker is not a classification — the LLM classifier runs
    Given an issue 61824 carrying the labels "adw:upgrade"
    And the claude-cli-stub is loaded with fixture "classify-as-feature.json"
    When the trigger classifier runs for issue 61824
    Then the AI classification heuristic was invoked for issue 61824
    And the trigger classification for issue 61824 resolves to "feature"

  # ── §3 The two previously-bypassing paths inherit the override (AC1: every path) ─
  #
  # The heart of #618. The issue_comment and dependency-closure paths reach
  # classification only through the shared chokepoint, with no labelRouting
  # pre-read. Driving that chokepoint as those paths invoke it proves a single
  # adw:<type> label now overrides on each — the exact regression behind #614
  # (a single adw:bug that the issue_comment path sent to the LLM and got
  # misclassified as /feature). The path name documents which caller's
  # classification step is exercised; the override is now caller-independent.

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario Outline: A label-unaware trigger path honors a single adw:<type> override with no LLM call
    Given an issue <issue> carrying the labels "<label>"
    When the "<path>" trigger path classifies issue <issue>
    Then the trigger classification for issue <issue> resolves to "<type>"
    And the trigger classification for issue <issue> reports success
    And the AI classification heuristic was not invoked for issue <issue>

    Examples:
      | path               | label         | type      | issue |
      | issue_comment      | adw:bug       | bug       | 61830 |
      | dependency-closure | adw:bug       | bug       | 61831 |
      | issue_comment      | adw:feature   | feature   | 61832 |
      | dependency-closure | adw:chore     | chore     | 61833 |
      | issue_comment      | adw:pr_review | pr_review | 61834 |
      | dependency-closure | adw:feature   | feature   | 61835 |

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario Outline: A label-unaware trigger path with conflicting labels still falls through to the LLM
    Given an issue <issue> carrying the labels "adw:bug,adw:feature"
    And the claude-cli-stub is loaded with fixture "classify-as-feature.json"
    When the "<path>" trigger path classifies issue <issue>
    Then the AI classification heuristic was invoked for issue <issue>
    And the trigger classification for issue <issue> resolves to "feature"

    Examples:
      | path               | issue |
      | issue_comment      | 61840 |
      | dependency-closure | 61841 |

  # ── §4 Type-check ─────────────────────────────────────────────────────────────

  @adw-618 @adw-la04ed-fix-adw-label-overri
  Scenario: TypeScript type-check passes after relocating the adw:* override into the chokepoint
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
