@adw-437
Feature: /depaudit-triage — autonomous minor/patch parent upgrade action

  Extends `/depaudit-triage` with the `upgrade parent` action for the
  MINOR/PATCH case only. When a finding can be resolved by a minor or patch
  bump of the direct parent, the skill computes the smallest resolving target
  version, edits the manifest, runs the package manager install command, and
  advances to the next finding — without re-scanning. Major bumps are out of
  scope for this slice: the skill refuses to apply them and points the user at
  the next slice's major-bump action. The user may cancel a pending upgrade
  before install runs; install failures surface clearly and leave the
  workspace unchanged (no partial bump).

  Background:
    Given the ADW codebase is at the current working directory

  # --- Semver-based classification (minor/patch vs major) ---

  @adw-437 @regression
  Scenario: Skill classifies the upgrade by parsing semver of from and to
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "semver"
    And the file contains "from"
    And the file contains "to"
    And the file contains "minor"
    And the file contains "patch"
    And the file contains "major"

  @adw-437 @regression
  Scenario: Skill documents autonomous minor/patch bump path
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "minor"
    And the file contains "patch"
    And the file contains "autonomous"

  @adw-437 @regression
  Scenario: Skill refuses to apply a major bump in this slice
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "major"
    And the file contains "refuse"

  @adw-437 @regression
  Scenario: Skill points the user at the upcoming major-bump action
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "major"
    And the file contains "future issue"

  # --- Smallest resolving target version ---

  @adw-437 @regression
  Scenario: Skill computes the smallest upgrade target that resolves the finding
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "smallest"
    And the file contains "resolves the finding"

  # --- Manifest edit ---

  @adw-437 @regression
  Scenario: Skill edits the manifest to bump the direct parent
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "manifest"
    And the file contains "package.json"
    And the file contains "go.mod"

  # --- Install command source of truth ---

  @adw-437 @regression
  Scenario: Skill prefers the install command from .adw/commands.md
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains ".adw/commands.md"
    And the file contains "Install Dependencies"

  @adw-437 @regression
  Scenario: Skill falls back to the ecosystem default install command when commands.md is absent
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "ecosystem default"

  # --- Cancellation before install ---

  @adw-437 @regression
  Scenario: User can cancel a pending upgrade before the install command runs
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "cancel"
    And the file contains "before the install command runs"

  @adw-437
  Scenario: Cancelling a pending upgrade reverts the manifest edit
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "revert"
    And the file contains "manifest"

  # --- Install failure handling ---

  @adw-437 @regression
  Scenario: Install failures surface clearly
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "install fail"

  @adw-437 @regression
  Scenario: Install failures leave workspace state unchanged (no partial bump)
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "no partial bump"
    And the file contains "workspace"

  # --- Advance without re-scan ---

  @adw-437 @regression
  Scenario: After a successful minor/patch upgrade the skill advances to the next finding
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "next finding"

  @adw-437 @regression
  Scenario: Skill does not re-scan after a minor/patch upgrade (static snapshot preserved)
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "static snapshot"
    And the file does not contain "re-scan after each"

  # --- Menu wiring ---

  @adw-437 @regression
  Scenario: The upgrade parent action is wired (no longer "not yet wired") for minor/patch
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "upgrade parent"
    And the file contains "minor"
    And the file contains "patch"

  @adw-437 @regression
  Scenario: Skill's menu still presents the four top-level actions
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains a menu with at least these actions:
      | action                    |
      | upgrade parent            |
      | accept+document           |
      | accept+file-upstream-issue|
      | skip                      |
