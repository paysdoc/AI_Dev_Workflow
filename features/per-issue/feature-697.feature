@adw-697 @adw-ebd8l3-gitcontext-migrate-p
Feature: GitContext promotion-sweep PR ops migration — adwPromotionSweep's PR view/create and its promotion-stats git reads route through the per-command-auth chokepoint, and the git/gh guard no longer exempts it

  Issue #697 (parent PRD `specs/prd/git-context-repo-authority.md`, user stories 5
  and 18) migrates the last three raw shell-outs in `adws/adwPromotionSweep.tsx` off
  `execWithRetry` and onto `GitContext`:

    • `gh pr view <n> --json files` (fetchChangedFilesFromPR) — the changed-file
      lookup that both the promotion commenter and the promotion mover depend on,
      now routing through a new PR-changed-files view method on the context.
    • `gh pr create …` (the regression-promotion mover) — now routing through the
      existing `createPR` context method instead of a hand-built `gh pr create`.
    • `git log …` ×2 (promotionStatsLoader's auto-ramp numerator/denominator) — the
      `runGit` dep that shelled out with a bare `process.cwd()`, now routing through
      the context with an explicit base-path cwd (the wrong-base-repo class of bug
      this whole epic exists to kill).

  Every migrated op runs through the private `#run()` per-command-auth chokepoint,
  inheriting token injection, git-identity injection, and an explicit cwd — never a
  `process.cwd()` fallback. With the last raw call gone, `adws/adwPromotionSweep.tsx`
  drops off the git/gh guard ALLOWLIST.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  THE MIGRATED PR/STATS OPS ROUTE THROUGH #run (story 18) ════

  # ── §1a  the new PR changed-files view carries token + git identity + base-path cwd ─

  @adw-697 @adw-ebd8l3-gitcontext-migrate-p
  Scenario: The new PR changed-files view supplies the context token, git identity, and base-path cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "pr-changed-files" promotion PR operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the framework repository root

  # ── §1b  the regression-promotion PR create routes through the context ───────────

  @adw-697 @adw-ebd8l3-gitcontext-migrate-p
  Scenario: The regression-promotion PR create routes through the context carrying the context token and git identity
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "pr-create" promotion PR operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment

  # ── §1c  the promotion-stats git-log read uses an explicit base-path cwd ─────────

  @adw-697 @adw-ebd8l3-gitcontext-migrate-p
  Scenario: The promotion-stats git-log read routes through the context with an explicit base-path cwd rather than a process.cwd() fallback
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "stats-log" promotion PR operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §1d  a promotion PR op never mutates the parent process environment ──────────

  @adw-697 @adw-ebd8l3-gitcontext-migrate-p
  Scenario: A promotion PR operation leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "pr-changed-files" promotion PR operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  CONSUMER DE-ALLOWLISTED AND GUARD-CLEAN (story 5) ═══════════

  # scannedCount === 1 is the de-allowlist proof: an allowlisted file is skipped (count 0).

  @adw-697 @adw-ebd8l3-gitcontext-migrate-p
  Scenario: The git/gh guard scans the de-allowlisted promotion sweep (no longer exempt) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "adws/adwPromotionSweep.tsx"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (story 5) ═════════════════════

  @adw-697 @adw-ebd8l3-gitcontext-migrate-p
  Scenario: The git/gh guard passes across the whole repository after the promotion sweep is de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════

  @adw-697 @adw-ebd8l3-gitcontext-migrate-p
  Scenario: The ADW TypeScript type-check passes with the migrated promotion-sweep PR surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
