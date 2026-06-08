@adw-545 @adw-y35zbi-cron-recovery-layer
Feature: CRON recovery layer — label-eligibility rescan for unprocessed adw:* issues

  Issue #545 extends the cron backlog sweeper (`trigger_cron.ts`) with a recovery
  scan that picks up open `adw:*`-labelled issues which never started an ADW
  workflow, per the parent PRD
  (`specs/prd/adw-init-hash-and-label-classification.md`, section "CRON recovery
  layer"). The webhook subscribes to `issues.opened` only (issue #542); a label
  applied after creation — or a multi-label issue later cleaned up to one label —
  produces no webhook effect. This recovery scan is what eventually processes
  those issues, unifying late-label recovery with the existing dependency-closure
  rescan.

  Eligibility rule — the scan spawns only when every condition holds:

    1. the issue is open and carries exactly one `adw:<type>` label
       (`adw:chore` | `adw:bug` | `adw:feature` | `adw:pr_review`);
    2. it does NOT carry `adw:none` (opt-out wins outright);
    3. it has NO in-progress ADW workflow comment (no workflow already running);
    4. it has NO linked merged or closed pull request (the work is not already done);
    5. no existing orchestrator state — the same spawn-time orchestrator-existence
       check the webhook path uses (the `spawnGate` lock) — so a cron tick that
       races a webhook spawn does not double-spawn.

  A scanned issue that satisfies the rule routes to the orchestrator for its
  single label's type with no LLM classifier call — the label IS the
  classification, exactly as the issues.opened single-label branch in issue #542.
  Any one condition failing makes the scan skip the issue; the issue stays
  eligible for a later tick once the failing condition clears. That standing
  eligibility is the self-recovery property (User Story 15: a stuck multi-label
  issue recovers when cleaned up) and the late-applied-label property (User
  Story 28: a label added after `issues.opened` is recovered by cron, not by the
  unsubscribed `issues.labeled` event).

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    never the text of a source file. No step reads `trigger_cron.ts` (or any
    module) as text, substring-matches its contents, or parses it as JSON/AST.

      • Whether the recovery scan spawned an orchestrator, and the classification
        it spawned with, is asserted through the harness-recorded spawn — the same
        recorded-spawn channel issue #542 uses for the issues.opened router. A
        recorded spawn, and its absence, is an output of the scan, not a
        source-file property.
      • The disqualifiers — the labels a scanned issue carries, an in-progress ADW
        workflow comment, a linked merged/closed PR, and an existing spawn lock —
        are mock inputs and lock artefacts. The spawn lock is the on-disk
        orchestrator-existence artefact the registered G5/T6 vocabulary already
        drives.
      • The type-check scenario asserts the type-checker's verdict — the output of
        running `tsc`, not a file's contents.

  Scope notes:

    • The `{ optOut, classification, conflict }` label shape these conditions read
      is owned by `labelManager.readAdwLabels` (issue #540) and proven exhaustively
      there — including the `adw:` namespace matching (`adw-bug` / `adwesome` are
      NOT adw:* labels). This feature exercises only the cron recovery composition
      that acts on the shape, not a re-enumeration of the shape itself.
    • The webhook's deliberate non-handling of `issues.labeled` is proven in issue
      #542; this feature proves the complementary half — that the cron scan is what
      recovers a late-labelled or de-conflicted issue.
    • `adw:upgrade` is a tracking-issue marker, not a workflow-type classification;
      `#UPG` issues are created outside this path and are out of scope here.
    • The grace-period, awaiting_merge, and retriable-stage paths of the existing
      sweeper (`cronIssueFilter`) are unchanged by this issue and are not
      re-exercised below.

  Vocabulary note:

    Registered phrases in `features/regression/vocabulary.md` reused below: G4
    (seed an issue in the mock tracker) and G5 (no spawn lock exists for an issue —
    the "without orchestrator state" precondition). The merged-PR scenario's
    mock-PR state aligns with the semantics of registered G10 ("return PR as
    merged"). The registry has no phrase for: carrying a label set on a tracked
    issue, an in-progress ADW workflow comment, an issue→PR linkage (merged or
    closed), a held/live spawn lock, a multi-label cleanup, running the cron
    recovery scan, or asserting the scan's spawn / no-spawn outcome. Novel Gherkin
    phrasing is introduced for those and the gap is surfaced to the maintainer in
    the agent Output.

  Defaults: unless a scenario states otherwise, a seeded issue has no in-progress
  ADW workflow comment, no linked pull request, and no existing spawn lock — a
  clean recovery candidate — so each scenario adds only the one condition it
  exercises.

  Background:
    Given the ADW codebase is checked out

  # ── Eligible: exactly one adw:<type> label, no orchestrator state (AC1) ──────

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: A single adw:<type> label with no orchestrator state recovers and spawns its type
    Given an issue 9501 exists in the mock issue tracker
    And the issue 9501 carries the labels "adw:feature"
    And no spawn lock exists for issue 9501
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned an orchestrator for issue 9501 classified as "feature"

  # ── Skip: multiple adw:<type> labels are a conflict (AC2) ───────────────────

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: Two distinct adw:<type> labels are a conflict — the scan skips and spawns nothing
    Given an issue 9502 exists in the mock issue tracker
    And the issue 9502 carries the labels "adw:bug,adw:feature"
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9502

  # ── Skip: adw:none opt-out wins (AC3) ───────────────────────────────────────

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: A lone adw:none label opts the issue out — the scan spawns nothing
    Given an issue 9503 exists in the mock issue tracker
    And the issue 9503 carries the labels "adw:none"
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9503

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: adw:none alongside a single adw:<type> label still opts out — opt-out wins
    Given an issue 9504 exists in the mock issue tracker
    And the issue 9504 carries the labels "adw:none,adw:bug"
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9504

  # ── Skip: an ADW workflow is already in progress (AC4) ──────────────────────

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: A single-label issue already carrying an in-progress ADW workflow comment is skipped
    Given an issue 9505 exists in the mock issue tracker
    And the issue 9505 carries the labels "adw:feature"
    And the issue 9505 has an in-progress ADW workflow comment
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9505

  # ── Skip: a linked merged or closed PR means the work is already resolved (AC5) ─

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: A single-label issue with a linked merged pull request is skipped
    Given an issue 9506 exists in the mock issue tracker
    And the issue 9506 carries the labels "adw:bug"
    And the issue 9506 has a linked merged pull request
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9506

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: A single-label issue with a linked closed (unmerged) pull request is skipped
    Given an issue 9507 exists in the mock issue tracker
    And the issue 9507 carries the labels "adw:bug"
    And the issue 9507 has a linked closed pull request
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9507

  # ── Dedup: existing orchestrator state prevents a cron + webhook double-spawn (AC6) ─

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: An eligible issue already owned by a live orchestrator is not double-spawned
    Given an issue 9508 exists in the mock issue tracker
    And the issue 9508 carries the labels "adw:feature"
    And a live ADW orchestrator already holds the spawn lock for issue 9508
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9508

  # ── Self-recovery: a stuck multi-label issue recovers once cleaned to one label (AC7 / US15) ─

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: A multi-label issue cleaned up to a single label auto-recovers on the next tick
    Given an issue 9509 exists in the mock issue tracker
    And the issue 9509 carries the labels "adw:bug,adw:feature"
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9509
    When the conflicting labels on issue 9509 are cleaned up to "adw:feature"
    And the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned an orchestrator for issue 9509 classified as "feature"

  # ── Scoping: issues without an adw:* label are not recovery candidates ──────

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: An open issue carrying no adw:* labels is not a recovery candidate
    Given an issue 9510 exists in the mock issue tracker
    And the issue 9510 carries the labels "bug,enhancement"
    When the cron recovery scan runs over the target repo
    Then the cron recovery scan spawned no orchestrator for issue 9510

  # ── Type-check ───────────────────────────────────────────────────────────────

  @adw-545 @adw-y35zbi-cron-recovery-layer
  Scenario: TypeScript type-check passes after introducing the cron recovery layer
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
