@adw-9zcqhw-detect-context-compa
Feature: Detect context compaction and restart build agent with fresh context

  When the build agent runs long enough for Claude Code to hit its context
  window limit, it automatically compacts the conversation. This is lossy.
  ADW should detect compaction in the JSONL stream and restart the build
  agent with fresh context, reusing the existing token-limit continuation
  mechanism.

  # --- JSONL stream compaction detection in agentProcessHandler ---

  @adw-9zcqhw-detect-context-compa @regression
  Scenario: agentProcessHandler detects compact_boundary in the JSONL stream
    Given the file "adws/agents/agentProcessHandler.ts" exists
    And the stdout data handler processes incoming JSONL chunks
    When a chunk contains a JSON object with "subtype":"compact_boundary"
    Then a compactionDetected flag is set to true
    And the agent process is killed with SIGTERM

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction detection does not trigger on unrelated system messages
    Given the file "adws/agents/agentProcessHandler.ts" exists
    And the stdout data handler processes incoming JSONL chunks
    When a chunk contains a JSON object with "subtype":"status" and "status":"compacting"
    Then the compactionDetected flag remains false
    And the agent process is not killed

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction detection only fires once per agent run
    Given the file "adws/agents/agentProcessHandler.ts" exists
    And the stdout data handler processes incoming JSONL chunks
    When two chunks each contain a JSON object with "subtype":"compact_boundary"
    Then SIGTERM is sent only once

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction detection coexists with auth error detection
    Given the file "adws/agents/agentProcessHandler.ts" exists
    And the stdout data handler processes incoming JSONL chunks
    When a chunk contains "subtype":"compact_boundary"
    And a subsequent chunk contains "subtype":"api_retry" with "authentication_error"
    Then compactionDetected is true
    And authErrorDetected is also true

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction detection coexists with token limit detection
    Given the file "adws/agents/agentProcessHandler.ts" exists
    And the stdout data handler processes incoming JSONL chunks
    When a chunk contains "subtype":"compact_boundary"
    And the output token count also exceeds the token limit threshold
    Then compactionDetected is true
    And tokenLimitReached is also true

  # --- AgentResult type extension ---

  @adw-9zcqhw-detect-context-compa @regression
  Scenario: AgentResult includes compactionDetected boolean field
    Given the file "adws/types/agentTypes.ts" exists
    Then the AgentResult interface includes a "compactionDetected" field of type boolean
    And the field is optional

  @adw-9zcqhw-detect-context-compa
  Scenario: agentProcessHandler sets compactionDetected on the returned AgentResult
    Given the file "adws/agents/agentProcessHandler.ts" exists
    When the agent process completes after compaction was detected
    Then the returned AgentResult has compactionDetected set to true

  @adw-9zcqhw-detect-context-compa
  Scenario: AgentResult compactionDetected is falsy when no compaction occurs
    Given the file "adws/agents/agentProcessHandler.ts" exists
    When the agent process completes normally without compaction
    Then the returned AgentResult does not have compactionDetected set to true

  # --- buildPhase continuation loop handles compaction ---

  @adw-9zcqhw-detect-context-compa @regression
  Scenario: buildPhase restarts the build agent when compactionDetected is true
    Given the build phase is running with a plan and a build agent
    When the build agent returns with compactionDetected = true
    Then the continuation counter is incremented
    And buildContinuationPrompt is called with the original plan and the partial output
    And a new build agent is spawned with the continuation prompt

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction continuation shares the same counter as token limit continuations
    Given the build phase is running with a plan and a build agent
    When the first build agent returns with tokenLimitExceeded = true
    And the second build agent returns with compactionDetected = true
    Then the shared continuation counter is 2
    And the total number of continuations does not exceed MAX_TOKEN_CONTINUATIONS

  @adw-9zcqhw-detect-context-compa @regression
  Scenario: Compaction continuation respects MAX_TOKEN_CONTINUATIONS limit
    Given the build phase is running with MAX_TOKEN_CONTINUATIONS = 3
    And 3 continuations have already occurred (any mix of token limit and compaction)
    When the next build agent returns with compactionDetected = true
    Then the build phase throws an error indicating maximum continuations exceeded

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction continuation passes original plan content not accumulated continuation prompts
    Given the build phase is running with a plan
    When the first build agent returns with compactionDetected = true
    Then buildContinuationPrompt receives the original plan content
    And buildContinuationPrompt receives the first agent's output
    When the second build agent also returns with compactionDetected = true
    Then buildContinuationPrompt again receives the original plan content
    And buildContinuationPrompt receives the second agent's output

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction continuation accumulates cost across restarts
    Given the build phase is running with a plan and a build agent
    When the first build agent returns with compactionDetected = true and totalCostUsd = 0.05
    And the continuation build agent completes successfully with totalCostUsd = 0.03
    Then the total accumulated cost for the build phase is 0.08

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction continuation accumulates model usage across restarts
    Given the build phase is running with a plan and a build agent
    When the first build agent returns with compactionDetected = true and modelUsage data
    And the continuation build agent completes successfully with its own modelUsage data
    Then the total model usage is the merged sum of both runs

  # --- Issue comment for compaction recovery ---

  @adw-9zcqhw-detect-context-compa @regression
  Scenario: Compaction recovery posts a distinct issue comment
    Given the build phase is running with a GitHub repo context
    When the build agent returns with compactionDetected = true
    Then an issue comment is posted with the "compaction_recovery" stage
    And the comment is distinct from "token_limit_recovery"

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction recovery comment includes continuation number
    Given the build phase is running with a GitHub repo context
    When the build agent returns with compactionDetected = true for the 2nd time
    Then the compaction_recovery comment includes continuation number 2

  @adw-9zcqhw-detect-context-compa
  Scenario: WorkflowStage type includes compaction_recovery
    Given the file "adws/types/workflowTypes.ts" exists
    Then the WorkflowStage union type includes "compaction_recovery"

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction recovery comment formatter exists in workflowCommentsIssue
    Given the file "adws/github/workflowCommentsIssue.ts" exists
    Then there is a formatCompactionRecoveryComment function or case
    And the formatted comment indicates context compaction was detected
    And the formatted comment includes the ADW ID

  # --- Partial state saving on compaction ---

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction saves partial agent state before continuation
    Given the build phase is running with agent state tracking
    When the build agent returns with compactionDetected = true
    Then AgentStateManager.writeState is called with partial output
    And AgentStateManager.appendLog records that compaction was detected

  # --- Build agent scope only ---

  @adw-9zcqhw-detect-context-compa
  Scenario: Compaction detection is limited to the build agent
    Given the build phase uses agentProcessHandler for the build agent
    When a non-build agent (e.g. plan, review) runs via agentProcessHandler
    Then compaction detection is still present in the handler
    But only buildPhase.ts acts on the compactionDetected flag to trigger continuation

  # --- Type checks ---

  @adw-9zcqhw-detect-context-compa @regression
  Scenario: All type checks pass with compaction detection changes
    Given the ADW codebase with compaction detection implemented
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
