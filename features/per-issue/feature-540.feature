@adw-540 @adw-25daxp-labelmanager-deep-mo
Feature: labelManager deep module — adw:* label lifecycle and label-based classification

  Issue #540 introduces the `labelManager` deep module from the parent PRD
  (`specs/prd/adw-init-hash-and-label-classification.md`, sections "Label
  lifecycle management" and "Label-based classification"). The module owns the
  six `adw:*` labels on every target repo and exposes three behaviours:

    1. `ensureAdwLabelsExist(repoInfo)` — on first contact with a new target
       repo, idempotently pre-creates all six labels: `adw:chore`, `adw:bug`,
       `adw:feature`, `adw:pr_review`, `adw:upgrade`, `adw:none`. Running it
       again against a repo that already carries the labels neither errors nor
       duplicates them.
    2. `applyLabel(issueNumber, label, repoInfo)` — applies an `adw:*` label to
       an issue. When the apply fails because the label does not exist on the
       repo (a human deleted it), the module lazy-creates that one label and
       retries the application once, so ADW does not silently break on a
       label-not-found error.
    3. `readAdwLabels(issue)` — a pure read over the issue's `labels[]` that
       returns the classification shape `{ optOut, classification, conflict }`.
       The three fields are computed orthogonally:
         • `optOut`  — true exactly when `adw:none` is present.
         • `conflict` — true exactly when more than one distinct workflow-type
                        label (`adw:chore` | `adw:bug` | `adw:feature` |
                        `adw:pr_review`) is present.
         • `classification` — the sole workflow-type label when exactly one is
                        present, otherwise null.
       A consumer checks `optOut` first (an `adw:none` issue is ignored) and
       `conflict` next (a multi-type issue is refused); `classification` carries
       the routed type for the clean single-label case. Because the three fields
       are independent, the combined cases (`adw:none` alongside a type label)
       are fully defined rather than left to a short-circuit.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    never the text of a source file:

      • §1–§3 assert the label-create and label-apply calls the module issues,
        captured by the mock GitHub API (the same recorded-request channel the
        registered vocabulary entries G12/T12/T13 already drive for label
        applications), plus the post-condition label state of the mock target
        repo. A recorded request and the mock server's resulting state are
        outputs, not source files.
      • §4 asserts the value returned by `readAdwLabels` for a constructed
        issue input. The returned shape is the module's output, exercised the
        same way `feature-535` exercises `getSafeSubprocessEnv` — import the
        function, feed real input, assert the real return value.
      • §5 asserts the type-checker's verdict.

    No step reads `adws/core/labelManager.ts` (or wherever the module lands) as
    text, substring-matches its contents, or parses it as JSON/AST. The
    behaviour is proven by what the module creates, applies, and returns —
    exactly as the framework Rot-Prevention rule and the
    `features/regression/vocabulary.md` Rot-Detection Rubric require.

  Scope notes:

    • The transport (`gh label create` vs. a REST `POST /labels`) is an
      implementation detail; these scenarios assert that a creation/application
      was recorded against the target repo, not how the call was shaped.
    • `adw:upgrade` is a tracking-issue marker, not a workflow-type
      classification. The PRD applies it to ADW's own upgrade tracking issues
      (`#UPG`) and exempts those from classification and multi-label refusal,
      so `readAdwLabels` treats `adw:upgrade` as neither a classification nor a
      conflict input. It is one of the six labels `ensureAdwLabelsExist`
      provisions, but only the four workflow-type labels — `adw:chore`,
      `adw:bug`, `adw:feature`, `adw:pr_review` — participate in the
      `{ classification, conflict }` computation. Whether a human-applied
      `adw:upgrade` on an ordinary issue is acted on is a routing/eligibility
      decision owned by the webhook and cron layers (out of scope here).
    • §3's persistent-not-found scenario pins a bounded retry (lazy-create at
      most once, fail loudly rather than loop). The precise error surface is
      left to the implementer; the scenario only forbids an unbounded
      create/retry loop and a silently-swallowed failure.
    • The webhook routing, cron rescan, and LLM-fallback classification that
      *consume* this shape live in sibling issues and are not exercised here.

  Vocabulary note:

    The registered phrases in `features/regression/vocabulary.md` cover issue
    setup (G4), label *application* acceptance (G12), and recorded/zero label
    *applications* (T12/T13) — all reused below. The registry has no phrase for
    label *creation*, for lazy-create-on-not-found, or for the `readAdwLabels`
    shape, so novel Gherkin phrasing is introduced for those and the gap is
    surfaced to the maintainer in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 ensureAdwLabelsExist — idempotent pre-create of all six labels ───────

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: First contact with a fresh target repo creates all six adw:* labels
    Given a target repo with none of the adw:* labels present
    And the mock GitHub API is configured to accept label creation
    When ADW ensures the adw:* labels exist on the target repo
    Then the mock GitHub API recorded a creation of the "adw:chore" label
    And the mock GitHub API recorded a creation of the "adw:bug" label
    And the mock GitHub API recorded a creation of the "adw:feature" label
    And the mock GitHub API recorded a creation of the "adw:pr_review" label
    And the mock GitHub API recorded a creation of the "adw:upgrade" label
    And the mock GitHub API recorded a creation of the "adw:none" label
    And ADW ensuring the adw:* labels exist completed without error

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Ensuring the adw:* labels twice is idempotent — no error, no duplicates
    Given a target repo with none of the adw:* labels present
    And the mock GitHub API is configured to accept label creation
    When ADW ensures the adw:* labels exist on the target repo
    And ADW ensures the adw:* labels exist on the target repo again
    Then both adw:* label-ensure passes completed without error
    And the target repo carries all six adw:* labels

  # ── §2 applyLabel — applies an existing label without creating it ───────────

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Applying an existing adw:* label records the application and creates nothing
    Given an issue 7001 exists in the mock issue tracker
    And the target repo already has the "adw:feature" label
    And the mock GitHub API is configured to accept label applications
    When ADW applies the "adw:feature" label to issue 7001
    Then the mock GitHub API recorded an application of the "adw:feature" label on issue 7001
    And the mock GitHub API recorded no creation of the "adw:feature" label
    And ADW applying the "adw:feature" label completed without error

  # ── §3 applyLabel — lazy-create and retry when the label is missing ─────────

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Applying a missing label lazy-creates it and retries the application to success
    Given an issue 7002 exists in the mock issue tracker
    And the target repo is missing the "adw:bug" label
    And the mock GitHub API rejects applying the "adw:bug" label with a not-found error until the label is created
    And the mock GitHub API is configured to accept label creation
    And the mock GitHub API is configured to accept label applications
    When ADW applies the "adw:bug" label to issue 7002
    Then the mock GitHub API recorded exactly one creation of the "adw:bug" label
    And the "adw:bug" label was created before it was applied to issue 7002
    And the mock GitHub API recorded an application of the "adw:bug" label on issue 7002
    And ADW applying the "adw:bug" label completed without error

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: A label that stays not-found after lazy-create fails loudly without looping
    Given an issue 7003 exists in the mock issue tracker
    And the target repo is missing the "adw:chore" label
    And the mock GitHub API rejects every application of the "adw:chore" label with a not-found error
    And the mock GitHub API is configured to accept label creation
    When ADW applies the "adw:chore" label to issue 7003
    Then the mock GitHub API recorded exactly one creation of the "adw:chore" label
    And ADW applying the "adw:chore" label reported a failure

  # ── §4 readAdwLabels — classification shape across every branch ─────────────

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Zero adw:* labels and no adw:none yields no classification, no opt-out, no conflict
    Given an issue carrying no adw:* labels
    When ADW reads the adw labels on the issue
    Then the adw label reading reports no opt-out
    And the adw label reading reports no classification
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Exactly one adw:bug label classifies as bug with no opt-out and no conflict
    Given an issue carrying the labels "adw:bug"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports classification "bug"
    And the adw label reading reports no opt-out
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: A single adw:pr_review label classifies as pr_review (underscore type preserved)
    Given an issue carrying the labels "adw:pr_review"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports classification "pr_review"
    And the adw label reading reports no opt-out
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: A single adw:upgrade marker label is not a classification
    Given an issue carrying the labels "adw:upgrade"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports no classification
    And the adw label reading reports no opt-out
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Two distinct adw:* type labels report a conflict and no classification
    Given an issue carrying the labels "adw:bug,adw:feature"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports a conflict
    And the adw label reading reports no classification
    And the adw label reading reports no opt-out

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Three distinct adw:* type labels still report a conflict (not just exactly two)
    Given an issue carrying the labels "adw:bug,adw:feature,adw:chore"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports a conflict
    And the adw label reading reports no classification
    And the adw label reading reports no opt-out

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: A lone adw:none label is an opt-out with no classification and no conflict
    Given an issue carrying the labels "adw:none"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports an opt-out
    And the adw label reading reports no classification
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: adw:none alongside a single type is an opt-out and still names the type with no conflict
    Given an issue carrying the labels "adw:none,adw:bug"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports an opt-out
    And the adw label reading reports classification "bug"
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: adw:none alongside multiple types is an opt-out and a conflict with no classification
    Given an issue carrying the labels "adw:none,adw:bug,adw:feature"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports an opt-out
    And the adw label reading reports a conflict
    And the adw label reading reports no classification

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Non-adw labels are ignored entirely
    Given an issue carrying the labels "bug,enhancement"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports no opt-out
    And the adw label reading reports no classification
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: A single adw:* type plus unrelated labels classifies on the type and ignores the rest
    Given an issue carrying the labels "adw:bug,hitl"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports classification "bug"
    And the adw label reading reports no opt-out
    And the adw label reading reports no conflict

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: Labels that resemble but do not match the adw: namespace are ignored
    Given an issue carrying the labels "adw-bug,adwesome"
    When ADW reads the adw labels on the issue
    Then the adw label reading reports no opt-out
    And the adw label reading reports no classification
    And the adw label reading reports no conflict

  # ── §5 Type-check ───────────────────────────────────────────────────────────

  @adw-540 @adw-25daxp-labelmanager-deep-mo
  Scenario: TypeScript type-check passes after introducing the labelManager module
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
