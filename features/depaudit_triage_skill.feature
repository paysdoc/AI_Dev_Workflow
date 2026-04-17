@adw-436
Feature: /depaudit-triage skill — sequential walk + accept/document + skip

  The `/depaudit-triage` Claude Code skill lives in ADW (not copied to target
  repos). When invoked it reads `.depaudit/findings.json`, walks each "new"
  finding sequentially, and offers actions. This slice wires `accept+document`
  and `skip` only; upgrade and upstream-issue land in later issues.

  Background:
    Given the ADW codebase is at the current working directory

  # --- Skill directory and frontmatter ---

  @adw-436 @regression
  Scenario: depaudit-triage skill directory exists with SKILL.md
    Given the skill directory ".claude/skills/depaudit-triage" exists
    When the SKILL.md file is read
    Then the file is not empty

  @adw-436 @regression
  Scenario: depaudit-triage SKILL.md has target: false in frontmatter
    Given the skill directory ".claude/skills/depaudit-triage" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: false"

  # --- Findings file discovery ---

  @adw-436 @regression
  Scenario: Skill locates .depaudit/findings.json deterministically
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to locate ".depaudit/findings.json" in the current working directory

  @adw-436 @regression
  Scenario: Skill errors clearly when findings.json is missing
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to error clearly if ".depaudit/findings.json" is missing or unreadable

  # --- Sequential walk ---

  @adw-436 @regression
  Scenario: Skill walks findings sequentially
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to walk each "new" finding one at a time in sequence

  @adw-436 @adw-438 @regression
  Scenario: Skill presents a 4-option menu per finding
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains a menu with at least these actions:
      | action                    |
      | upgrade parent            |
      | accept+document           |
      | accept+file-upstream-issue|
      | skip                      |

  # --- accept+document action ---

  @adw-436 @regression
  Scenario: accept+document prompts for reason with minimum 20 characters
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to prompt for a "reason" of at least 20 characters when accepting a finding

  @adw-436 @regression
  Scenario: accept+document enforces expires at most 90 days from today
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to enforce an "expires" date no more than 90 days from today

  @adw-436 @regression
  Scenario: accept+document writes supply-chain findings to .depaudit.yml
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to write supply-chain accept entries into ".depaudit.yml"

  @adw-436 @regression
  Scenario: accept+document writes CVE findings to osv-scanner.toml
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to write CVE accept entries into "osv-scanner.toml"

  @adw-436
  Scenario: accept+document respects identity as package, version, finding-id
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to key accept entries by the triple of package, version, and finding-id

  # --- skip action ---

  @adw-436 @regression
  Scenario: skip leaves state untouched
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions that the "skip" action leaves all state files untouched
    And it moves to the next finding without writing anything

  # --- Idempotency ---

  @adw-436 @regression
  Scenario: Idempotency check for previously in-flight findings
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to detect findings that already have an accept entry with a non-empty "upstreamIssue"
    And it marks those findings as "in flight" and skips them automatically

  # --- Static snapshot behavior ---

  @adw-436 @regression
  Scenario: No auto re-scan mid-triage
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains instructions that the findings file is treated as a static snapshot
    And it does not trigger a re-scan after each action
