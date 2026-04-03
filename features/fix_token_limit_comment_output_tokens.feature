@adw-b0y6j4-fix-token-limit-reco
Feature: Fix token limit recovery comment showing total tokens instead of output tokens

  The token limit recovery comment on GitHub issues displays total tokens
  (input + output + cache creation) against the output token limit, making
  the numbers nonsensical. The comment should display output tokens against
  the output token limit so the ratio is meaningful.

  # --- Comment formatter fix ---

  @adw-b0y6j4-fix-token-limit-reco @regression
  Scenario: Token limit recovery comment displays output tokens against the output token limit
    Given a TokenUsageSnapshot with totalOutputTokens = 58984 and maxTokens = 63999 and thresholdPercent = 0.90
    When formatWorkflowComment is called with the "token_limit_recovery" stage
    Then the comment displays "58,984 / 63,999" as the tokens used
    And the comment does not display totalTokens (the sum of all token types)

  @adw-b0y6j4-fix-token-limit-reco
  Scenario: Token limit recovery comment uses totalOutputTokens not totalTokens
    Given a WorkflowContext with tokenUsage containing totalOutputTokens = 58984 and totalTokens = 211265
    When formatTokenLimitRecoveryComment is called
    Then the formatted comment includes 58984 as the tokens used numerator
    And the formatted comment does not include 211265

  # --- TokenUsageSnapshot type cleanup ---

  @adw-b0y6j4-fix-token-limit-reco @regression
  Scenario: TokenUsageSnapshot does not include totalTokens field
    Given the file "adws/types/agentTypes.ts" exists
    Then the TokenUsageSnapshot interface does not include a "totalTokens" field
    And the interface retains "totalInputTokens", "totalOutputTokens", "totalCacheCreationTokens", "maxTokens", and "thresholdPercent"

  # --- agentProcessHandler snapshot construction ---

  @adw-b0y6j4-fix-token-limit-reco @regression
  Scenario: agentProcessHandler does not populate totalTokens in the TokenUsageSnapshot
    Given the file "adws/agents/agentProcessHandler.ts" exists
    When a token limit termination occurs and a TokenUsageSnapshot is constructed
    Then the snapshot does not include a "totalTokens" property
    And the snapshot includes "totalInputTokens", "totalOutputTokens", "totalCacheCreationTokens", "maxTokens", and "thresholdPercent"

  # --- Type checks ---

  @adw-b0y6j4-fix-token-limit-reco @regression
  Scenario: All type checks pass after removing totalTokens
    Given the ADW codebase with the totalTokens field removed from TokenUsageSnapshot
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
