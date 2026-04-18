@adw-446
Feature: Fix GitHubBoardManager PAT auth covers all project board operations

  GitHubBoardManager.ensureColumns / createBoard / findBoard must all run under
  GITHUB_PAT when the GitHub App installation token cannot access Projects V2
  (user-owned boards). A private withProjectBoardAuth<T> wrapper sets the PAT
  upfront in an outer try and restores the original GH_TOKEN in an outer
  finally, mirroring the reference pattern in
  adws/github/projectBoardApi.ts::moveIssueToStatus (commit b449834).

  The previous lazy-retry in findBoard restored the app token in its own finally
  before ensureColumns ran, causing ensureColumns to hit GitHub under the app
  token and fail with "Resource not accessible by integration".

  Background:
    Given the ADW codebase is checked out

  # ── A: withProjectBoardAuth wrapper exists ────────────────────────────────────

  @adw-446 @regression
  Scenario: GitHubBoardManager defines a withProjectBoardAuth wrapper
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the file contains "withProjectBoardAuth"

  @adw-446 @regression
  Scenario: withProjectBoardAuth is generic over the wrapped return type
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the file contains "withProjectBoardAuth<T>"
    And the file contains "() => Promise<T>"
    And the file contains "Promise<T>"

  # ── B: withProjectBoardAuth applies the PAT upfront pattern ───────────────────

  @adw-446 @regression
  Scenario: withProjectBoardAuth calls refreshTokenIfNeeded before swapping GH_TOKEN
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then withProjectBoardAuth calls refreshTokenIfNeeded before swapping GH_TOKEN

  @adw-446 @regression
  Scenario: withProjectBoardAuth guards the PAT swap with isGitHubAppConfigured and GITHUB_PAT presence
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then withProjectBoardAuth guards the PAT swap with isGitHubAppConfigured and GITHUB_PAT presence

  @adw-446 @regression
  Scenario: withProjectBoardAuth assigns GITHUB_PAT to process.env.GH_TOKEN
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then withProjectBoardAuth assigns GITHUB_PAT to process.env.GH_TOKEN

  @adw-446 @regression
  Scenario: withProjectBoardAuth saves the original GH_TOKEN before swapping
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then withProjectBoardAuth saves the original GH_TOKEN before swapping

  @adw-446 @regression
  Scenario: withProjectBoardAuth restores the original GH_TOKEN in a finally block
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then withProjectBoardAuth restores the original GH_TOKEN in a finally block

  # ── C: All three public methods route through withProjectBoardAuth ────────────

  @adw-446 @regression
  Scenario: findBoard routes through withProjectBoardAuth
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the findBoard method delegates to withProjectBoardAuth

  @adw-446 @regression
  Scenario: createBoard routes through withProjectBoardAuth
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the createBoard method delegates to withProjectBoardAuth

  @adw-446 @regression
  Scenario: ensureColumns routes through withProjectBoardAuth
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the ensureColumns method delegates to withProjectBoardAuth

  # ── D: Stale lazy-retry removed from findBoard ────────────────────────────────

  @adw-446 @regression
  Scenario: findBoard no longer contains the stale lazy PAT retry log message
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the findBoard method does not contain "App token cannot access Projects V2, retrying with GITHUB_PAT"

  @adw-446 @regression
  Scenario: findBoard no longer performs an in-method GH_TOKEN swap
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the findBoard method does not assign to process.env.GH_TOKEN

  # ── E: Scope — projectBoardApi.ts remains correctly patched (unchanged) ───────

  @adw-446
  Scenario: projectBoardApi.ts retains its upfront PAT fallback for moveIssueToStatus
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "Using GITHUB_PAT for project board operations"
    And the file contains "isGitHubAppConfigured"

  # ── F: Type-check passes ──────────────────────────────────────────────────────

  @adw-446 @regression
  Scenario: TypeScript type-check passes after githubBoardManager PAT auth fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
