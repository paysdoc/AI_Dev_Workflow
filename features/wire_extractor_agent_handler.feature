@adw-tgs1li-cost-revamp-wire-ext
Feature: Wire Anthropic extractor into agent process handler with real-time streaming

  Extends the Anthropic extractor to parse per-turn assistant message usage for
  real-time token tracking, and replaces inline JSONL cost parsing in
  agentProcessHandler.ts with the TokenUsageExtractor.

  # --- Per-turn assistant message parsing with deduplication ---

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Extractor parses per-turn message.usage from assistant JSONL messages
    Given an assistant JSONL message with "message.usage" containing "input_tokens" = 500 and "output_tokens" = 100
    When the message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns accumulated input tokens of 500

  @adw-tgs1li-cost-revamp-wire-ext @regression
  Scenario: Extractor deduplicates usage by message.id across content blocks
    Given two assistant JSONL messages with the same "message.id" but different content blocks
    And both messages report "input_tokens" = 500 in "message.usage"
    When both messages are fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns accumulated input tokens of 500, not 1000

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Extractor accumulates usage across multiple turns with different message IDs
    Given an assistant JSONL message with "message.id" = "msg_1" and "input_tokens" = 500
    And a second assistant JSONL message with "message.id" = "msg_2" and "input_tokens" = 700
    When both messages are fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns accumulated input tokens of 1200

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Extractor accumulates cache tokens from per-turn assistant messages
    Given an assistant JSONL message with "message.usage" containing "cache_creation_input_tokens" = 200 and "cache_read_input_tokens" = 3000
    When the message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns accumulated "cache_write" = 200 and "cache_read" = 3000

  # --- Output token estimation from content block character length ---

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Extractor estimates output tokens from content block character length
    Given an assistant JSONL message with a text content block of 400 characters
    When the message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns estimated output tokens of approximately 100

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Extractor accumulates estimated output tokens across multiple turns
    Given an assistant JSONL message with a text content block of 200 characters
    And a second assistant JSONL message with a text content block of 600 characters
    When both messages are fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns estimated output tokens of approximately 200

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Output token estimation uses ~4 chars per token ratio
    Given an assistant JSONL message with a text content block of exactly 1000 characters
    When the message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns estimated output tokens of 250

  # --- Real-time getCurrentUsage accuracy ---

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: getCurrentUsage returns real-time token data before result message arrives
    Given a multi-turn stream with 3 assistant messages totaling "input_tokens" = 1500
    And the result message has not yet arrived
    When getCurrentUsage is polled
    Then the returned map contains accumulated input tokens of 1500
    And isFinalized returns false

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: getCurrentUsage includes both per-turn usage and estimated output tokens
    Given an assistant JSONL message with "input_tokens" = 500, "cache_read_input_tokens" = 1000, and a text block of 800 characters
    When getCurrentUsage is polled
    Then the returned map contains "input" from per-turn usage and "output" from estimation
    And the "output" value is approximately 200

  # --- Result message finalization ---

  @adw-tgs1li-cost-revamp-wire-ext @regression
  Scenario: Result message replaces all estimated values with authoritative numbers
    Given a stream with assistant messages accumulating estimated output tokens of 250
    And a result JSONL message with modelUsage containing "outputTokens" = 300
    When the result message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns "output" = 300, not the estimated 250
    And isFinalized returns true

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Result message replaces per-turn input tokens with authoritative values
    Given a stream with assistant messages accumulating input tokens of 1500
    And a result JSONL message with modelUsage containing "inputTokens" = 1520
    When the result message is fed to the Anthropic extractor via onChunk
    Then getCurrentUsage returns "input" = 1520

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Reported cost USD is available after result message
    Given a result JSONL message with "total_cost_usd" = 0.0234
    When the result message is fed to the Anthropic extractor via onChunk
    Then getReportedCostUsd returns 0.0234

  # --- Agent process handler wiring ---

  @adw-tgs1li-cost-revamp-wire-ext @regression
  Scenario: agentProcessHandler.ts uses TokenUsageExtractor instead of inline JSONL cost parsing
    Given the file "adws/agents/agentProcessHandler.ts" exists
    Then it imports from the cost module
    And it creates a TokenUsageExtractor instance
    And stdout chunks are fed to the extractor via onChunk

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: agentProcessHandler feeds stdout chunks to the extractor
    Given the file "adws/agents/agentProcessHandler.ts" exists
    Then the stdout data handler calls extractor.onChunk with each chunk

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: agentProcessHandler polls getCurrentUsage for progress comments
    Given the file "adws/agents/agentProcessHandler.ts" exists
    Then the progress callback receives token data from extractor.getCurrentUsage

  # --- Failed agent runs contribute cost ---

  @adw-tgs1li-cost-revamp-wire-ext @regression
  Scenario: Failed agent run with non-zero exit code returns accumulated cost
    Given an agent run that emits 3 assistant messages with token usage
    And the agent exits with a non-zero exit code
    When the agent process handler resolves
    Then the AgentResult includes accumulated token usage from the extractor
    And the cost is not zero

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Agent run with no result message returns accumulated cost from extractor
    Given an agent run that emits assistant messages but no result message
    And the agent exits with code 0
    When the agent process handler resolves
    Then the AgentResult includes accumulated token usage from the extractor

  @adw-tgs1li-cost-revamp-wire-ext @regression
  Scenario: Crashed agent run still contributes cost via extractor
    Given an agent run that emits an error event after some assistant messages
    When the agent process handler resolves with success = false
    Then the AgentResult includes accumulated token usage from the extractor

  # --- Progress comments with real-time token estimates ---

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Progress comments show real-time estimated token counts
    Given an agent run with progress callback enabled
    And the extractor has accumulated token usage during streaming
    When a progress update is emitted
    Then the progress info includes current token counts from the extractor

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Progress token display format uses estimated label
    Given accumulated tokens showing input = 1000, cache_read = 500, and estimated output = 200
    When the token summary is formatted for a progress comment
    Then the display includes "~1700 tokens (estimated)"

  # --- Estimate-vs-actual reporting ---

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Estimate-vs-actual difference is logged to console at phase completion
    Given a stream with estimated output tokens of 250 before the result message
    And a result message with actual output tokens of 300
    When the phase completes
    Then a console log shows the estimated vs actual numbers
    And the log includes the percentage difference

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Estimate-vs-actual log includes absolute numbers and percentage
    Given estimated total tokens of 1500 and actual total tokens of 1600
    When the estimate-vs-actual is logged
    Then the log contains the estimated count 1500
    And the log contains the actual count 1600
    And the log contains the percentage difference

  # --- Unit tests ---

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Unit tests cover multi-turn streaming with message.id deduplication
    Given the directory "adws/cost/__tests__/" exists
    Then there is at least one test covering multi-turn assistant message parsing with message.id deduplication

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Unit tests cover output token estimation accuracy
    Given the directory "adws/cost/__tests__/" exists
    Then there is at least one test verifying output token estimation from content block character length

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Unit tests cover incomplete stream handling without result message
    Given the directory "adws/cost/__tests__/" exists
    Then there is at least one test verifying getCurrentUsage returns accumulated data when no result message is received

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: Unit tests cover finalization replacing estimates with actuals
    Given the directory "adws/cost/__tests__/" exists
    Then there is at least one test verifying the result message replaces estimated values with authoritative numbers

  # --- Type checks ---

  @adw-tgs1li-cost-revamp-wire-ext
  Scenario: All existing type checks still pass
    Given the ADW codebase with the extractor wired into agentProcessHandler
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
