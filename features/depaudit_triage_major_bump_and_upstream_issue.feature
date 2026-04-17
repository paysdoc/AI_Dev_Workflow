@adw-438
Feature: /depaudit-triage — major-bump issue filing, upstream-issue filing, idempotency

  Completes the `/depaudit-triage` action menu. For a major bump within the
  `upgrade parent` action, the skill files a tracked issue on the CURRENT repo
  (stable title format, body embedding `/adw_sdlc`), writes a short-lived
  accept entry pointing to the new issue (default 30-day expiry, user-adjustable
  up to the 90-day cap), and advances to the next finding. The separate
  `accept+file-upstream-issue` action files an issue on the dependency's OWN
  repo via `gh issue create --repo <dep-owner>/<dep-repo>`, captures the
  returned URL in `upstreamIssue`, and writes an accept entry — auto-filing
  unconditionally (no ADW-registration check). Re-invoking the skill on a
  finding that is already in flight is a no-op — no duplicate issue is filed.
  Every file the skill produces passes `depaudit lint`.

  Background:
    Given the ADW codebase is at the current working directory

  # --- Major-bump detection routes to the issue-filing path (not a direct upgrade) ---

  @adw-438 @regression
  Scenario: Major-bump detection triggers the issue-filing path (not a direct upgrade)
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "major"
    And the file contains "gh issue create"

  @adw-438 @regression
  Scenario: Major-bump path does not edit the manifest
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "major"
    And the file contains "does not edit"

  # --- Stable greppable title format ---

  @adw-438 @regression
  Scenario: Auto-filed major-bump issue uses the stable greppable title format
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)"

  # --- Issue body embeds /adw_sdlc for ADW pickup ---

  @adw-438 @regression
  Scenario: Auto-filed major-bump issue body embeds /adw_sdlc
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "/adw_sdlc"

  # --- Major-bump issue filed on the CURRENT repo (no --repo flag) ---

  @adw-438 @regression
  Scenario: Major-bump issue is filed on the current repo via gh issue create
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "gh issue create"
    And the file contains "current repo"

  # --- Short-lived accept entry for major-bump ---

  @adw-438 @regression
  Scenario: Major-bump action writes an accept entry pointing to the new issue
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "upstreamIssue"
    And the file contains "major"

  @adw-438 @regression
  Scenario: Major-bump accept entry reason is "pending major-bump issue #N"
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "pending major-bump issue #N"

  @adw-438 @regression
  Scenario: Major-bump default expiry is today + 30 days
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "30"
    And the file contains "expires"

  @adw-438 @regression
  Scenario: Major-bump expiry is user-adjustable up to the 90-day cap
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "90"
    And the file contains "user-adjustable"

  # --- Major-bump advances to next finding ---

  @adw-438 @regression
  Scenario: After filing the major-bump issue the skill advances to the next finding
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "major"
    And the file contains "next finding"

  # --- accept+file-upstream-issue action wired (no longer a stub) ---

  @adw-438 @regression
  Scenario: accept+file-upstream-issue action is wired (stub removed)
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "accept+file-upstream-issue"
    And the file does not contain "Not yet wired — coming in a future issue"

  @adw-438 @regression
  Scenario: Upstream-issue action files on the dependency's own repo via --repo flag
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "gh issue create --repo"
    And the file contains "<dep-owner>/<dep-repo>"

  @adw-438 @regression
  Scenario: Upstream-issue action drafts the title and body before filing
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "file-upstream-issue"
    And the file contains "draft"

  @adw-438 @regression
  Scenario: Upstream-issue action records the returned URL in upstreamIssue
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "returned URL"
    And the file contains "upstreamIssue"

  @adw-438 @regression
  Scenario: Upstream-issue action auto-files unconditionally (no ADW-registration check)
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "unconditional"
    And the file contains "ADW-registration"

  @adw-438 @regression
  Scenario: Upstream-issue action writes an accept entry after filing
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "file-upstream-issue"
    And the file contains "accept entry"

  # --- Idempotency: no duplicate issue on re-invocation ---

  @adw-438 @regression
  Scenario: Re-invoking on an already-in-flight finding is a no-op (no duplicate issue)
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "no duplicate issue"

  @adw-438 @regression
  Scenario: In-flight detection covers both major-bump and upstream-issue flows
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "in flight"
    And the file contains "upstreamIssue"

  @adw-438 @regression
  Scenario: Idempotency check inspects existing accept entries before filing
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "idempotency"
    And the file contains "upstreamIssue"

  # --- depaudit lint passes on every file produced ---

  @adw-438 @regression
  Scenario: Skill ensures every file it produces passes depaudit lint
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    Then the file contains "depaudit lint"

  # --- Menu continues to present the four top-level actions ---

  @adw-438
  Scenario: The menu still presents the four top-level actions
    Given the file ".claude/skills/depaudit-triage/SKILL.md" is read
    When the content is inspected
    Then it contains a menu with at least these actions:
      | action                    |
      | upgrade parent            |
      | accept+document           |
      | accept+file-upstream-issue|
      | skip                      |
