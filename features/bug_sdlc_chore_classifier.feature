@adw-u8okxe-bug-issues-should-us
Feature: Bug issues use full SDLC orchestrator and chore classification is tightened

  Bug issues must route through adwSdlc (the full SDLC pipeline) so that regression
  scenario proof is generated and posted to the PR. The /chore classification must
  only be assigned when the issue explicitly requests it or the changes are
  config/documentation-only, preventing misclassification from silently skipping
  the test, review, and documentation phases.

  Background:
    Given the ADW codebase is checked out

  @adw-u8okxe-bug-issues-should-us @regression
  Scenario: issueTypeToOrchestratorMap maps /bug to adwSdlc.tsx
    Given "adws/types/issueRouting.ts" is read
    Then the issueTypeToOrchestratorMap maps "/bug" to "adws/adwSdlc.tsx"

  @adw-u8okxe-bug-issues-should-us @regression
  Scenario: issueTypeToOrchestratorMap does not map /bug to adwPlanBuildTest.tsx
    Given "adws/types/issueRouting.ts" is read
    Then the issueTypeToOrchestratorMap does not map "/bug" to "adws/adwPlanBuildTest.tsx"

  @adw-u8okxe-bug-issues-should-us @regression
  Scenario: issueTypeToOrchestratorMap /chore mapping remains adwChore.tsx
    Given "adws/types/issueRouting.ts" is read
    Then the issueTypeToOrchestratorMap maps "/chore" to "adws/adwChore.tsx"

  @adw-u8okxe-bug-issues-should-us @regression
  Scenario: issueTypeToOrchestratorMap /feature mapping remains adwSdlc.tsx
    Given "adws/types/issueRouting.ts" is read
    Then the issueTypeToOrchestratorMap maps "/feature" to "adws/adwSdlc.tsx"

  @adw-u8okxe-bug-issues-should-us @regression
  Scenario: classify_issue.md restricts /chore to explicit requests or config/docs-only changes
    Given ".claude/commands/classify_issue.md" is read
    Then the classifier restricts chore to explicit requests or config/docs-only changes

  @adw-u8okxe-bug-issues-should-us @regression
  Scenario: classify_issue.md instructs to default ambiguous issues to /bug or /feature
    Given ".claude/commands/classify_issue.md" is read
    Then the classifier defaults ambiguous issues to bug or feature not chore

  @adw-u8okxe-bug-issues-should-us @regression
  Scenario: TypeScript type-check passes after the orchestrator mapping change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
