@adw-450
Feature: Fix board column ordering and preserve option IDs in ensureColumns

  Two bugs in mergeStatusOptions / updateStatusFieldOptions
  (adws/providers/github/githubBoardManager.ts):

  1. Column order ignored — missing ADW columns are appended to the right of
     the board regardless of BOARD_COLUMNS.order.
  2. Option IDs stripped on update — updateProjectV2Field is called with
     singleSelectOptions that omit each option's id. GitHub treats each entry
     as a new option and deletes the old one, orphaning any project items
     that reference the old IDs.

  Fix:
  - Add optional id to StatusOption; thread existing ids through merge.
  - Insert missing ADW columns at positions derived from BOARD_COLUMNS.order.
  - Preserve existing non-ADW options' relative positions.
  - Include id in updateProjectV2Field mutation payload when present.

  Background:
    Given the ADW codebase is checked out

  # ── A: StatusOption type carries an optional id ────────────────────────────

  @adw-450 @regression
  Scenario: StatusOption type in githubBoardManager includes an optional id
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the StatusOption type declares an optional "id" field

  @adw-450 @regression
  Scenario: mergeStatusOptions accepts existing options with an optional id
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the mergeStatusOptions existing parameter type declares an optional "id" field

  # ── B: Option IDs are preserved through merge ──────────────────────────────

  @adw-450 @regression
  Scenario: getStatusFieldOptions id is threaded into mergeStatusOptions input
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the ensureColumns method passes statusField.options to mergeStatusOptions without stripping id

  @adw-450 @regression
  Scenario: Preserved non-ADW options retain their id in the merged list
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the mergeStatusOptions function preserves the existing option id when mapping non-ADW options

  @adw-450 @regression
  Scenario: Overwritten ADW options retain the existing option id
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the mergeStatusOptions function preserves the existing option id when overwriting ADW-matching options

  # ── C: Column ordering uses BOARD_COLUMNS.order for insertion ──────────────

  @adw-450 @regression
  Scenario: mergeStatusOptions uses BOARD_COLUMNS.order when inserting missing columns
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the mergeStatusOptions function reads "order" from the adw column definitions
    And the mergeStatusOptions function does not unconditionally push missing columns to the end

  # ── D: updateStatusFieldOptions includes id in mutation payload ────────────

  @adw-450 @regression
  Scenario: updateStatusFieldOptions mutation payload includes option id when present
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the updateStatusFieldOptions mutation payload includes "id" for each existing option

  # ── E: Unit tests for column ordering exist ────────────────────────────────

  @adw-450 @regression
  Scenario: Unit test exercises inserting Blocked at index 0
    Given "adws/providers/__tests__/boardManager.test.ts" is read
    Then the boardManager unit tests cover inserting Blocked at index 0

  @adw-450
  Scenario: Unit test exercises inserting Review between InProgress and Done
    Given "adws/providers/__tests__/boardManager.test.ts" is read
    Then the boardManager unit tests cover inserting Review between InProgress and Done

  @adw-450
  Scenario: Unit test exercises inserting all five ADW columns in BOARD_COLUMNS order
    Given "adws/providers/__tests__/boardManager.test.ts" is read
    Then the boardManager unit tests cover inserting all five ADW columns in BOARD_COLUMNS order

  @adw-450
  Scenario: Unit test exercises non-ADW options keeping their relative position
    Given "adws/providers/__tests__/boardManager.test.ts" is read
    Then the boardManager unit tests cover non-ADW options keeping their relative position

  # ── F: Unit tests for id preservation exist ────────────────────────────────

  @adw-450 @regression
  Scenario: Unit test asserts every existing option id survives into merged
    Given "adws/providers/__tests__/boardManager.test.ts" is read
    Then the boardManager unit tests assert every existing option id survives into merged

  @adw-450
  Scenario: Unit test asserts newly added ADW options have undefined id
    Given "adws/providers/__tests__/boardManager.test.ts" is read
    Then the boardManager unit tests assert newly added ADW options have undefined id

  # ── G: Unit test suite passes ──────────────────────────────────────────────

  @adw-450 @regression
  Scenario: boardManager unit tests pass
    Given the ADW codebase is checked out
    Then the boardManager unit tests pass

  # ── H: Type-check passes ───────────────────────────────────────────────────

  @adw-450 @regression
  Scenario: TypeScript type-check passes after column-order and id-preservation fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
