@adw-241-cost-revamp-core
Feature: Cost module core computation, Anthropic extractor, and Vitest infrastructure

  The foundational slice of the cost module revamp introduces a new `adws/cost/`
  module with core types, a generic cost computation function, divergence checking,
  Anthropic provider pricing tables and streaming extractor, and Vitest unit tests.

  # --- Core types ---

  @adw-241-cost-revamp-core
  Scenario: TokenUsageExtractor interface is defined in types.ts
    Given the file "adws/cost/types.ts" exists
    Then it exports a "TokenUsageExtractor" interface
    And the interface defines methods "onChunk", "getCurrentUsage", "isFinalized", and "getReportedCostUsd"

  @adw-241-cost-revamp-core
  Scenario: PhaseCostRecord type is defined in types.ts
    Given the file "adws/cost/types.ts" exists
    Then it exports a "PhaseCostRecord" type
    And the type includes fields for "workflowId", "issueNumber", "phase", "model", "provider", "tokenUsage", "computedCostUsd", "reportedCostUsd", and "status"

  @adw-241-cost-revamp-core
  Scenario: Extensible token usage maps use Record<string, number>
    Given the file "adws/cost/types.ts" exists
    Then token usage is typed as "Record<string, number>"
    And pricing is typed as "Record<string, number>"

  # --- Generic computeCost ---

  @adw-241-cost-revamp-core
  Scenario: computeCost multiplies matching keys in usage and pricing maps
    Given a token usage map with "input" = 1000 and "output" = 500
    And a pricing map with "input" = 0.000003 and "output" = 0.000015
    When computeCost is called with the usage and pricing maps
    Then the computed cost is 0.0105

  @adw-241-cost-revamp-core
  Scenario: computeCost ignores usage keys with no matching pricing entry
    Given a token usage map with "input" = 1000 and "unknown_type" = 2000
    And a pricing map with "input" = 0.000003
    When computeCost is called with the usage and pricing maps
    Then the computed cost is 0.003

  @adw-241-cost-revamp-core
  Scenario: computeCost returns zero for empty usage map
    Given an empty token usage map
    And a pricing map with "input" = 0.000003
    When computeCost is called with the usage and pricing maps
    Then the computed cost is 0

  @adw-241-cost-revamp-core
  Scenario: computeCost returns zero for empty pricing map
    Given a token usage map with "input" = 1000
    And an empty pricing map
    When computeCost is called with the usage and pricing maps
    Then the computed cost is 0

  @adw-241-cost-revamp-core
  Scenario: computeCost handles large token counts without overflow
    Given a token usage map with "input" = 5000000 and "output" = 2000000
    And a pricing map with "input" = 0.000003 and "output" = 0.000015
    When computeCost is called with the usage and pricing maps
    Then the computed cost is 45.0

  @adw-241-cost-revamp-core
  Scenario: computeCost ignores pricing keys with no matching usage entry
    Given a token usage map with "input" = 1000
    And a pricing map with "input" = 0.000003 and "output" = 0.000015
    When computeCost is called with the usage and pricing maps
    Then the computed cost is 0.003

  @adw-241-cost-revamp-core
  Scenario: computeCost handles Anthropic-specific token types
    Given a token usage map with "input" = 1000, "output" = 500, "cache_read" = 2000, and "cache_write" = 100
    And a pricing map with "input" = 0.000003, "output" = 0.000015, "cache_read" = 0.0000003, and "cache_write" = 0.00000375
    When computeCost is called with the usage and pricing maps
    Then the computed cost equals the sum of each key's usage multiplied by its price

  # --- Divergence check ---

  @adw-241-cost-revamp-core
  Scenario: Divergence check flags when computed cost exceeds reported cost by more than 5%
    Given a computed cost of 1.06
    And a reported cost of 1.00
    When the divergence check is performed
    Then the result indicates divergence

  @adw-241-cost-revamp-core
  Scenario: Divergence check does not flag at exactly 5% divergence
    Given a computed cost of 1.05
    And a reported cost of 1.00
    When the divergence check is performed
    Then the result does not indicate divergence

  @adw-241-cost-revamp-core
  Scenario: Divergence check returns zero percent diff for exact match
    Given a computed cost of 1.00
    And a reported cost of 1.00
    When the divergence check is performed
    Then the result does not indicate divergence
    And the percent difference is 0

  @adw-241-cost-revamp-core
  Scenario: Divergence check does not flag at 4.9% divergence
    Given a computed cost of 1.049
    And a reported cost of 1.00
    When the divergence check is performed
    Then the result does not indicate divergence

  @adw-241-cost-revamp-core
  Scenario: Divergence check flags when reported cost exceeds computed cost by more than 5%
    Given a computed cost of 0.94
    And a reported cost of 1.00
    When the divergence check is performed
    Then the result indicates divergence

  @adw-241-cost-revamp-core
  Scenario: Divergence check handles undefined reported cost gracefully
    Given a computed cost of 1.00
    And no reported cost is available
    When the divergence check is performed
    Then the result does not indicate divergence

  @adw-241-cost-revamp-core
  Scenario: Divergence check flags when reported cost is zero and computed cost is positive
    Given a computed cost of 0.50
    And a reported cost of 0.00
    When the divergence check is performed
    Then the result indicates divergence

  @adw-241-cost-revamp-core
  Scenario: Divergence check does not flag when both costs are zero
    Given a computed cost of 0.00
    And a reported cost of 0.00
    When the divergence check is performed
    Then the result does not indicate divergence

  @adw-241-cost-revamp-core
  Scenario: Divergence check supports a custom threshold parameter
    Given a computed cost of 1.07
    And a reported cost of 1.00
    And a custom divergence threshold of 10%
    When the divergence check is performed with the custom threshold
    Then the result does not indicate divergence

  # --- Anthropic pricing tables ---

  @adw-241-cost-revamp-core
  Scenario: Anthropic pricing tables include current Claude models
    Given the file "adws/cost/providers/anthropic/pricing.ts" exists
    Then it contains pricing entries for "claude-opus-4-6"
    And it contains pricing entries for "claude-sonnet-4-5"
    And it contains pricing entries for "claude-haiku-4-5"

  @adw-241-cost-revamp-core
  Scenario: Anthropic pricing tables use provider-specific token type keys
    Given the Anthropic pricing table for any model
    Then the pricing map contains keys "input", "output", "cache_read", and "cache_write"

  @adw-241-cost-revamp-core
  Scenario: Anthropic pricing lookup falls back to default for unknown model
    Given an unknown model identifier "claude-unknown-99"
    When getAnthropicPricing is called with the unknown model
    Then the returned pricing map equals the default Anthropic pricing

  # --- Anthropic extractor ---

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor parses a result JSONL message with snake_case fields
    Given an Anthropic result JSONL message containing "total_cost_usd" and modelUsage with camelCase token fields
    When the message is fed to the Anthropic extractor via onChunk
    Then isFinalized returns true
    And getReportedCostUsd returns the value from "total_cost_usd"

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor accumulates token usage from result message
    Given an Anthropic result JSONL message with modelUsage containing "inputTokens" = 5000 and "outputTokens" = 1200
    When the message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns a map containing "input" = 5000 and "output" = 1200

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor implements TokenUsageExtractor interface
    Given the file "adws/cost/providers/anthropic/extractor.ts" exists
    Then the default export implements the "TokenUsageExtractor" interface

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor handles cache token fields from result message
    Given an Anthropic result JSONL message with modelUsage containing "cacheReadInputTokens" = 3000 and "cacheCreationInputTokens" = 200
    When the message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns a map containing "cache_read" = 3000 and "cache_write" = 200

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor is not finalized before receiving a result message
    Given a new Anthropic extractor instance
    When no messages have been fed to the extractor
    Then isFinalized returns false
    And getReportedCostUsd returns undefined

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor handles partial line buffering across chunk boundaries
    Given an Anthropic result JSONL message split across two chunks
    When both chunks are fed to the Anthropic extractor via onChunk
    Then isFinalized returns true
    And getReportedCostUsd returns the correct value

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor silently skips invalid JSON lines
    Given chunks containing invalid JSON lines mixed with a valid result JSONL message
    When the chunks are fed to the Anthropic extractor via onChunk
    Then no errors are thrown
    And isFinalized returns true

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor ignores non-result message types
    Given JSONL messages of type "assistant" and "system"
    When the messages are fed to the Anthropic extractor via onChunk
    Then isFinalized returns false
    And getReportedCostUsd returns undefined

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor handles result message with missing modelUsage field
    Given an Anthropic result JSONL message without a modelUsage field
    When the message is fed to the Anthropic extractor via onChunk
    Then isFinalized returns true
    And getCurrentUsage returns an empty map

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor handles result message with missing total_cost_usd
    Given an Anthropic result JSONL message without a total_cost_usd field
    When the message is fed to the Anthropic extractor via onChunk
    Then isFinalized returns true
    And getReportedCostUsd returns undefined

  @adw-241-cost-revamp-core
  Scenario: Anthropic extractor handles multi-model result message
    Given an Anthropic result JSONL message with usage for both "claude-opus-4-6" and "claude-haiku-4-5-20251001"
    When the message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns token maps for both models

  # --- Vitest infrastructure ---

  @adw-241-cost-revamp-core
  Scenario: Vitest is added as a dev dependency
    Given the file "package.json" exists
    Then "vitest" appears in the "devDependencies" section

  @adw-241-cost-revamp-core
  Scenario: Vitest test script is configured and runnable
    Given the project has a test script that runs Vitest
    When the test script is executed
    Then Vitest runs without configuration errors

  @adw-241-cost-revamp-core
  Scenario: Unit tests exist for computeCost function
    Given the directory "adws/cost/__tests__/" exists
    Then there is at least one test file covering "computeCost"

  @adw-241-cost-revamp-core
  Scenario: Unit tests exist for divergence check
    Given the directory "adws/cost/__tests__/" exists
    Then there is at least one test file covering the divergence check at the 5% boundary

  @adw-241-cost-revamp-core
  Scenario: Unit tests exist for Anthropic extractor
    Given the directory "adws/cost/__tests__/" exists
    Then there is at least one test file covering the Anthropic extractor parsing of a result message

  # --- Backward compatibility ---

  @adw-241-cost-revamp-core
  Scenario: Existing type checks still pass
    Given the ADW codebase with the new cost module added
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
