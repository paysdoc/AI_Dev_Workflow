@adw-438
Feature: /depaudit-triage — issue-filing paths (major-bump + upstream-issue) with idempotency

  Completes the `/depaudit-triage` action menu. When `upgrade parent` classifies
  a bump as major, the skill files a tracked issue on the CURRENT repo via
  `gh issue create`, embeds `/adw_sdlc` in the body so ADW picks it up, and
  writes a short-lived accept entry (default 30 days, user-adjustable up to the
  90-day cap) that points to the new issue via `upstreamIssue`. A separate
  `accept+file-upstream-issue` action files on the dependency's OWN repo for
  transitive-fix cases and records the returned URL. Both paths are idempotent:
  re-invoking on a finding whose accept entry already has a non-empty
  `upstreamIssue` is a no-op (no duplicate issue filed). Every file produced
  must pass `depaudit lint`.

  Background:
    Given the ADW codebase is at the current working directory

  # --- Major-bump detection gates the issue-filing path (not a direct upgrade) ---

  @adw-438 @regression
  Scenario: Major-bump detection triggers issue filing instead of a direct upgrade
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "major"
    And the file contains "gh issue create"
    And the file contains "does not apply"

  @adw-438 @regression
  Scenario: Skill never applies a major bump directly to the manifest
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "does not apply"
    And the file contains "major"

  # --- Major-bump issue title format (stable, greppable) ---

  @adw-438 @regression
  Scenario: Major-bump issue uses the stable title prefix
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "depaudit: major upgrade"

  @adw-438 @regression
  Scenario: Major-bump issue title embeds package, from, to-range, and finding-id placeholders
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "<package>"
    And the file contains "<from>"
    And the file contains "<to-range>"
    And the file contains "resolves <finding-id>"

  # --- Major-bump issue body embeds /adw_sdlc ---

  @adw-438 @regression
  Scenario: Major-bump issue body embeds /adw_sdlc so ADW picks it up
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "/adw_sdlc"

  # --- Major-bump issue is filed on the CURRENT repo ---

  @adw-438 @regression
  Scenario: Major-bump issue is filed on the current repo via gh issue create
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "gh issue create"
    And the file contains "current repo"

  # --- Major-bump accept entry (written alongside the issue) ---

  @adw-438 @regression
  Scenario: Major-bump accept entry points upstreamIssue at the new issue
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "upstreamIssue"
    And the file contains "major"

  @adw-438 @regression
  Scenario: Major-bump accept entry uses the pending-issue reason format
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "pending major-bump issue #"

  @adw-438 @regression
  Scenario: Major-bump accept entry defaults to a 30-day expiry
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "30"
    And the file contains "expires"
    And the file contains "default"

  @adw-438 @regression
  Scenario: User may adjust the major-bump expiry up to the 90-day cap
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "90"
    And the file contains "cap"
    And the file contains "adjust"

  # --- Major-bump advances to next finding after filing ---

  @adw-438 @regression
  Scenario: Major-bump action advances to the next finding after filing
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "next finding"
    And the file contains "major"

  # --- accept+file-upstream-issue action (separate menu entry) ---

  @adw-438 @regression
  Scenario: accept+file-upstream-issue action is wired (no longer "not yet wired")
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "accept+file-upstream-issue"
    And the file does not contain "not yet wired"

  @adw-438 @regression
  Scenario: Upstream-issue action drafts a title and body
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "draft"
    And the file contains "title"
    And the file contains "body"

  @adw-438 @regression
  Scenario: Upstream-issue action files on the dep's own repo via gh issue create --repo
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "gh issue create --repo"
    And the file contains "<dep-owner>/<dep-repo>"

  @adw-438 @regression
  Scenario: Upstream-issue action captures the returned URL into upstreamIssue
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "returned URL"
    And the file contains "upstreamIssue"

  @adw-438 @regression
  Scenario: Upstream-issue action writes an accept entry
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "accept entry"
    And the file contains "upstream"

  @adw-438 @regression
  Scenario: Upstream-issue action auto-files unconditionally (no ADW-registration check)
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "unconditional"
    And the file contains "ADW-registered"

  # --- Idempotency: re-invocation is a no-op (no duplicate issue) ---

  @adw-438 @regression
  Scenario: Re-invoking on an in-flight finding files no duplicate issue
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "in flight"
    And the file contains "no duplicate"

  @adw-438 @regression
  Scenario: Idempotency check applies to the major-bump issue-filing path
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "major"
    And the file contains "upstreamIssue"
    And the file contains "in flight"

  @adw-438 @regression
  Scenario: Idempotency check applies to the upstream-issue filing path
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "upstream"
    And the file contains "upstreamIssue"
    And the file contains "in flight"

  # --- Lint validation on every produced file ---

  @adw-438 @regression
  Scenario: Files produced by issue-filing paths must pass depaudit lint
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "depaudit lint"

  # --- Menu still presents the four top-level actions, all now wired ---

  @adw-438 @regression
  Scenario: Skill's menu presents the four top-level actions with all now wired
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains a menu with at least these actions:
      | action                    |
      | upgrade parent            |
      | accept+document           |
      | accept+file-upstream-issue|
      | skip                      |
