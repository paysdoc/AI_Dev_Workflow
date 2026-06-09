@adw-560 @adw-23ipne-distinct-operator-fa
Feature: Distinct operator-facing abort messages for the build progress gate

  Issue #560 is the follow-up slice to the build progress gate (#559). The gate
  aborts a build for two structurally different reasons, and #559 deliberately
  left the abort *messages* generic — it pinned only the discriminated abort
  *reason* (`no_progress` vs `backstop`) at the pure-function level, as the seam
  this slice edits. Parent PRD:
  `specs/prd/build-context-reset-progress-gate.md`
  (Implementation Decisions → Operator-facing failure signal).

  The two reasons demand two different corrective actions, so an operator must be
  able to tell them apart from the failure message alone:

    • No-progress abort — the build stopped advancing (it froze, or it oscillated
      back to a tree state already seen this build). Re-running it unchanged will
      only stall again; the operator should inspect the plan or the task.
    • Backstop abort — the build kept reaching genuinely novel states but
      exhausted the progress-checkpoint ceiling. The work is likely too large for
      one issue and should be split, not re-run unchanged.

  This slice turns those two reasons into two distinct operator-facing failure
  messages and surfaces them through the existing workflow-completion error path
  — the same "ADW Workflow Error" issue comment and failed-state record the
  orchestrator already produces when a build phase throws. No new comment-posting
  machinery is introduced; only the message *content* changes, and the two
  reasons are never collapsed into one generic message.

  Observability / rot-prevention note:

    Every assertion below targets a runtime *output*, never the text of a source
    file. No step reads `buildPhase.ts`, `progressGate.ts`, or any module as
    text, substring-matches its contents, or parses it as JSON/AST.

      • §1 calls the message-producing function and asserts its returned string —
        an output, exactly as #559's scenarios assert `evaluateProgressGate`'s
        returned decision.
      • §2 asserts the rendered "ADW Workflow Error" comment the existing
        workflow-completion error path produces from that message — the comment
        body is an artefact the system would post, not a source file.

  Vocabulary note:

    Reused registered phrases: `the ADW codebase is checked out` (background) and
    `the ADW TypeScript type-check passes` (type-check backstop). The vocabulary
    registry (`features/regression/vocabulary.md`) is keyed to the regression
    suite's subprocess / phase-import / mock-query patterns and has no phrase for
    an operator-facing abort message's content or for the rendered workflow-error
    comment, so novel phrasing is introduced for those and the gap is surfaced to
    the maintainer in the agent Output (consistent with #559).

  Background:
    Given the ADW codebase is checked out

  # ── §1 Two distinct operator-facing abort messages (AC1, AC2, AC4) ─────────
  #
  # The message is produced from the gate's discriminated abort reason — the seam
  # #559 established. Each reason yields its own guidance; the two never reduce to
  # a single generic message.

  @adw-560 @adw-23ipne-distinct-operator-fa
  Scenario: A no-progress abort message reports the build stalled and points at the plan or task
    Given the build progress gate aborts the build with reason no-progress
    When the operator-facing failure message is produced for that abort
    Then the message reports that the build stopped making progress
    And the message directs the operator to inspect the plan or task

  @adw-560 @adw-23ipne-distinct-operator-fa
  Scenario: A backstop abort message reports the issue is likely too large and should be split
    Given the build progress gate aborts the build with reason backstop
    When the operator-facing failure message is produced for that abort
    Then the message reports that the issue is likely too large
    And the message advises splitting the issue rather than re-running it unchanged

  @adw-560 @adw-23ipne-distinct-operator-fa
  Scenario: The no-progress and backstop abort messages are distinct, not one generic message
    Given the build progress gate can abort with reason no-progress or with reason backstop
    When the operator-facing failure message is produced for each abort reason
    Then the two messages are not identical
    And each message carries the corrective action specific to its reason

  # ── §2 Surfaced through the existing workflow-completion error path (AC3, AC4) ─
  #
  # The orchestrator already routes a thrown build-phase abort to the
  # workflow-completion error path, which renders the standard "ADW Workflow
  # Error" issue comment from the error message. This slice changes only the
  # message; the channel is unchanged.

  @adw-560 @adw-23ipne-distinct-operator-fa
  Scenario: A no-progress abort surfaces the stalled-progress guidance via the standard workflow-error comment
    Given the build progress gate aborts the build with reason no-progress
    When the failure is surfaced through the workflow-completion error path
    Then the workflow-error comment reports that the build stopped making progress
    And the workflow-error comment directs the operator to inspect the plan or task

  @adw-560 @adw-23ipne-distinct-operator-fa
  Scenario: A backstop abort surfaces the too-large and split guidance via the standard workflow-error comment
    Given the build progress gate aborts the build with reason backstop
    When the failure is surfaced through the workflow-completion error path
    Then the workflow-error comment reports that the issue is likely too large
    And the workflow-error comment advises splitting the issue

  @adw-560 @adw-23ipne-distinct-operator-fa
  Scenario: The error path surfaces the two reasons as distinct messages through the same existing comment
    Given the build progress gate aborts one build with reason no-progress and another with reason backstop
    When each failure is surfaced through the workflow-completion error path
    Then the two workflow-error comments are not identical
    And each failure is surfaced as the standard ADW workflow-error comment

  # ── §3 Type-check backstop ─────────────────────────────────────────────────

  @adw-560 @adw-23ipne-distinct-operator-fa
  Scenario: TypeScript type-check passes after introducing the distinct abort messages
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
