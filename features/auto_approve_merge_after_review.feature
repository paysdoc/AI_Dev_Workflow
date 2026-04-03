@adw-fvzdz7-auto-approve-and-mer
Feature: Auto-approve and merge PRs after review passes in review orchestrators

  All ADW orchestrators with review capabilities (adwPlanBuildReview,
  adwPlanBuildTestReview, adwSdlc) auto-approve and merge pull requests after
  the internal review phase passes, eliminating manual human approval.

  When a GitHub App is configured the PR was authored by the bot, so approval
  uses the personal `gh auth login` identity (by temporarily unsetting GH_TOKEN).
  When no GitHub App is configured, approval is skipped and the merge proceeds
  directly.  Merge failures are non-fatal — a PR comment is posted but the
  workflow completes successfully.

  Background:
    Given the ADW codebase is checked out

  # ── Shared merge function extraction ────────────────────────────────────────

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: mergeWithConflictResolution is exported from autoMergeHandler.ts
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file exports a function named "mergeWithConflictResolution"

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: handleApprovedReview delegates to mergeWithConflictResolution
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the function "handleApprovedReview" calls "mergeWithConflictResolution"

  # ── approvePR function ──────────────────────────────────────────────────────

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: approvePR function exists in prApi.ts
    Given "adws/github/prApi.ts" is read
    Then the file exports a function named "approvePR"

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: approvePR temporarily unsets GH_TOKEN for personal identity
    Given "adws/github/prApi.ts" is read
    Then the "approvePR" function deletes process.env.GH_TOKEN before calling gh pr review

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: approvePR restores GH_TOKEN in a finally block
    Given "adws/github/prApi.ts" is read
    Then the "approvePR" function restores GH_TOKEN in a finally block

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: approvePR uses gh pr review --approve
    Given "adws/github/prApi.ts" is read
    Then the file contains "gh pr review" and "--approve"

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: approvePR is exported from github/index.ts barrel
    Given "adws/github/index.ts" is read
    Then the file exports "approvePR"

  # ── autoMergePhase.ts ──────────────────────────────────────────────────────

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: autoMergePhase.ts exists as a dedicated phase file
    Then the file "adws/phases/autoMergePhase.ts" exists

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: executeAutoMergePhase is exported from phases/index.ts
    Given "adws/phases/index.ts" is read
    Then the file exports "executeAutoMergePhase"

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: executeAutoMergePhase is exported from workflowPhases.ts
    Given "adws/workflowPhases.ts" is read
    Then the file exports "executeAutoMergePhase"

  # ── Approval identity logic ────────────────────────────────────────────────

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: autoMergePhase approves PR when GitHub App is configured
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase calls "isGitHubAppConfigured" to decide whether to approve
    And the phase calls "approvePR" when the GitHub App is configured

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: autoMergePhase skips approval when no GitHub App is configured
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase skips approval and proceeds directly to merge when no GitHub App is configured

  # ── Merge delegation ───────────────────────────────────────────────────────

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: autoMergePhase delegates to mergeWithConflictResolution
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase calls "mergeWithConflictResolution" for the merge step

  # ── Non-fatal failure ──────────────────────────────────────────────────────

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: autoMergePhase posts a PR comment when merge fails
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase calls "commentOnPR" when the merge outcome is unsuccessful

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: autoMergePhase does not throw on merge failure
    Given "adws/phases/autoMergePhase.ts" is read
    Then the function "executeAutoMergePhase" returns a result object instead of throwing on failure

  # ── Orchestrator wiring ────────────────────────────────────────────────────
  # Orchestrator-specific executeAutoMergePhase wiring scenarios superseded by
  # orchestrator_awaiting_merge_handoff.feature (issue #380). Orchestrators now
  # approve the PR directly and write awaiting_merge instead of calling
  # executeAutoMergePhase.

  # ── TypeScript type-check ──────────────────────────────────────────────────

  @adw-fvzdz7-auto-approve-and-mer @regression
  Scenario: ADW TypeScript type-check passes after the auto-approve-merge implementation
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
