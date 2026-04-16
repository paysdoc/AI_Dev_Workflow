@adw-432
Feature: Fix board setup: updateProjectV2Field mutation rejects projectId and wipes existing options

  The addStatusOption method passes projectId inside the updateProjectV2Field
  mutation input, but GitHub's UpdateProjectV2FieldInput does not accept that
  argument. Additionally, the per-column approach calls updateProjectV2Field
  once per missing column with a single option, which is a replacement
  operation that wipes all existing options each time.

  Fix:
  1. Remove projectId from the mutation input
  2. Extend getStatusFieldOptions to fetch color and description
  3. Replace per-column addStatusOption with a single bulk update in ensureColumns

  Background:
    Given the ADW codebase is checked out

  # ── A: Remove projectId from updateProjectV2Field mutation ─────────────────

  @adw-432 @regression
  Scenario: updateProjectV2Field mutation does not include projectId in its input
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the updateProjectV2Field mutation input does not contain "projectId"

  @adw-432
  Scenario: updateProjectV2Field mutation only requires fieldId in its input
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the updateProjectV2Field mutation input contains "fieldId"
    And the updateProjectV2Field mutation does not declare a $projectId variable

  # ── B: getStatusFieldOptions fetches color and description ─────────────────

  @adw-432 @regression
  Scenario: getStatusFieldOptions query fetches color for each option
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the getStatusFieldOptions query requests "color" for each option

  @adw-432 @regression
  Scenario: getStatusFieldOptions query fetches description for each option
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the getStatusFieldOptions query requests "description" for each option

  @adw-432
  Scenario: getStatusFieldOptions return type includes color and description
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the getStatusFieldOptions return type includes "color" and "description" fields

  # ── C: Single bulk update replaces per-column addStatusOption ──────────────

  @adw-432 @regression
  Scenario: ensureColumns performs a single updateProjectV2Field call with the full merged option list
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then ensureColumns builds a merged list of all options before calling updateProjectV2Field
    And ensureColumns does not call addStatusOption in a loop

  @adw-432
  Scenario: ensureColumns preserves existing non-ADW options in the merged list
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then ensureColumns merges existing options that do not match any BOARD_COLUMNS entry

  @adw-432
  Scenario: ensureColumns overwrites existing ADW-matching options with BOARD_COLUMNS defaults
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then ensureColumns replaces options whose name matches a BOARD_COLUMNS entry

  @adw-432
  Scenario: ensureColumns appends missing ADW columns to the merged list
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then ensureColumns adds BOARD_COLUMNS entries not present in existing options

  # ── D: Non-blocking board setup behavior unchanged ─────────────────────────

  @adw-432
  Scenario: Board setup in workflowInit remains fire-and-forget
    Given "adws/phases/workflowInit.ts" is read
    Then the board setup call is wrapped in a try-catch or .catch handler

  # ── E: Type-check passes ───────────────────────────────────────────────────

  @adw-432
  Scenario: TypeScript type-check passes after board mutation fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
