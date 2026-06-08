@adw-542 @adw-gmfhco-issues-opened-label
Feature: issues.opened label-routed handler — classification driven by adw:* labels

  Issue #542 modifies the `issues.opened` path of `trigger_webhook.ts` so that an
  inbound new-issue event is routed by the `adw:*` labels carried in its payload,
  per the parent PRD (`specs/prd/adw-init-hash-and-label-classification.md`,
  sections "Label-based classification" and "Trigger plumbing"). The handler reads
  the issue's `labels[]` straight from the webhook payload and selects exactly one
  of four branches:

    1. `adw:none` present            → ignore. No orchestrator is spawned and no
                                        comment is posted. Opt-out is evaluated
                                        first, so it wins even when a workflow-type
                                        label is also present.
    2. Exactly one `adw:<type>`      → use the label as the classification, skip
                                        the LLM classifier entirely, and spawn the
                                        orchestrator for that type.
    3. Multiple `adw:<type>` labels  → refuse. Post a non-workflow comment (no ADW
                                        marker, so the concurrency guard does not
                                        count it) asking the team to remove all but
                                        one label; spawn nothing. The issue stays
                                        eligible for the CRON rescan once the
                                        labels drop to one.
    4. Zero `adw:<type>` labels      → run the existing `classifyGitHubIssue` LLM
                                        classifier, persist the inferred label on
                                        the issue, and spawn the orchestrator for
                                        the inferred type.

  Only `issues.opened` is subscribed. `issues.labeled` is deliberately NOT
  subscribed: a label added after creation has no immediate effect; the existing
  CRON recovery layer rescans and picks the issue up later. The final scenario
  pins this by delivering, as a `labeled` event, the very same single-`adw:feature`
  payload that WOULD spawn under `opened`, and asserting that nothing happens.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    never the text of a source file. No step reads `trigger_webhook.ts` (or any
    module) as text, substring-matches its contents, or parses it as JSON/AST.

      • Comment posts and label applications are asserted through the recorded
        GitHub API requests captured by the mock server — the same channel the
        registered vocabulary entries T2/T3/T12/T13/T14 already drive.
      • Whether the LLM classifier ran is asserted through the claude-cli-stub's
        recorded invocations (the stub appends each prompt to `MOCK_INVOCATION_LOG`
        precisely to "enable ordering assertions"). The recorded invocation log is
        an artefact, not a source file.
      • Whether an orchestrator was spawned, and the classification it was spawned
        with, is asserted through the harness-recorded `spawnDetached` invocation
        (the orchestrator command carries `--issue-type <classification>`). A
        recorded spawn is an output of the handler, not a source-file property.
      • The type-check scenario asserts the type-checker's verdict — the output of
        running `tsc`, not a file's contents.

  Scope notes:

    • The `{ optOut, classification, conflict }` shape these branches consume is
      owned by the `labelManager.readAdwLabels` deep module (issue #540) and proven
      there; this feature exercises only the webhook routing that acts on the shape.
    • `adw:upgrade` is a tracking-issue marker, not a workflow-type classification,
      and `#UPG` issues are created with exactly one such label outside this path;
      they are out of scope here.
    • The exact wording of the multi-label refusal comment is the implementer's
      choice. The scenario forbids only that it carry an ADW workflow marker and
      requires that it reference the `adw:` namespace it is asking the team to
      clean up — it does not pin a verbatim sentence.
    • The CRON rescan that eventually recovers a multi-label or late-labelled issue
      lives in `trigger_cron.ts` (a sibling concern) and is not exercised here.

  Vocabulary note:

    The registered phrases in `features/regression/vocabulary.md` cover issue setup
    (G4), comment/label acceptance (G1/G12), classifier-fixture loading (G9), and
    the recorded comment/label assertions (T2/T3/T12/T13/T14) — all reused below.
    The registry has no phrase for delivering a webhook event that carries a label
    set in its payload (W11 carries no labels), for asserting a spawn/no-spawn and
    its classification, for asserting the LLM classifier was/was not invoked, or for
    asserting a posted comment carries no ADW workflow marker. Novel Gherkin phrasing
    is introduced for those and the gap is surfaced to the maintainer in the Output.

  Background:
    Given the ADW codebase is checked out

  # ── Branch 1: adw:none opts the issue out ───────────────────────────────────

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: A lone adw:none label opts the issue out — no spawn, no comment, no LLM
    Given an issue 8201 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the webhook handler receives a "opened" event for issue 8201 carrying labels "adw:none"
    Then the webhook spawned no orchestrator for issue 8201
    And the mock harness recorded zero comment posts on issue 8201
    And the claude classifier was not invoked for issue 8201

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: adw:none alongside a single type label still opts out — opt-out wins
    Given an issue 8206 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the webhook handler receives a "opened" event for issue 8206 carrying labels "adw:none,adw:bug"
    Then the webhook spawned no orchestrator for issue 8206
    And the mock harness recorded zero comment posts on issue 8206
    And the claude classifier was not invoked for issue 8206

  # ── Branch 2: exactly one adw:<type> routes without an LLM call ──────────────

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: A single adw:bug label routes to the bug orchestrator without an LLM call
    Given an issue 8202 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the webhook handler receives a "opened" event for issue 8202 carrying labels "adw:bug"
    Then the webhook spawned an orchestrator for issue 8202 classified as "bug"
    And the claude classifier was not invoked for issue 8202
    And the mock harness recorded zero applications of the "adw:bug" label on issue 8202
    And the mock harness recorded zero comment posts on issue 8202

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: A single adw:pr_review label routes to the pr_review orchestrator without an LLM call
    Given an issue 8207 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the webhook handler receives a "opened" event for issue 8207 carrying labels "adw:pr_review"
    Then the webhook spawned an orchestrator for issue 8207 classified as "pr_review"
    And the claude classifier was not invoked for issue 8207
    And the mock harness recorded zero comment posts on issue 8207

  # ── Branch 3: multiple adw:<type> labels are refused ────────────────────────

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: Multiple adw:<type> labels are refused with a non-workflow cleanup comment and no spawn
    Given an issue 8203 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the webhook handler receives a "opened" event for issue 8203 carrying labels "adw:bug,adw:feature"
    Then the mock GitHub API recorded a comment on issue 8203
    And the recorded comment on issue 8203 carries no ADW workflow marker
    And the mock GitHub API recorded a comment containing the text "adw:"
    And the webhook spawned no orchestrator for issue 8203
    And the claude classifier was not invoked for issue 8203

  # ── Branch 4: zero adw:<type> labels fall back to the LLM classifier ─────────

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: No adw:<type> label runs the LLM classifier, persists the inferred label, and spawns
    Given an issue 8204 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And the claude-cli-stub is loaded with fixture "classify-as-feature.json"
    When the webhook handler receives a "opened" event for issue 8204 carrying labels "bug,enhancement"
    Then the claude classifier was invoked for issue 8204
    And the mock GitHub API recorded an application of the "adw:feature" label on issue 8204
    And the webhook spawned an orchestrator for issue 8204 classified as "feature"

  # ── issues.labeled is NOT subscribed — late labels have no immediate effect ──

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: A labeled event carrying a valid single adw:feature label has no immediate effect
    Given an issue 8205 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the webhook handler receives a "labeled" event for issue 8205 carrying labels "adw:feature"
    Then the webhook spawned no orchestrator for issue 8205
    And the mock harness recorded zero comment posts on issue 8205
    And the claude classifier was not invoked for issue 8205

  # ── Type-check ───────────────────────────────────────────────────────────────

  @adw-542 @adw-gmfhco-issues-opened-label
  Scenario: TypeScript type-check passes after the issues.opened label-routing change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
