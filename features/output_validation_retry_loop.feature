@adw-362
Feature: Output validation retry loop in commandAgent

  The LLM frequently returns malformed JSON, wrong keys, or prose instead of
  structured output. When extractOutput fails today the entire phase fails with
  no recovery. This feature adds a generic retry loop inside
  commandAgent.runCommandAgent() that validates output against a JSON Schema,
  and retries with a corrective Haiku prompt until the output conforms.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Prerequisites — migrate direct agents to commandAgent
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: reviewAgent uses commandAgent with extractOutput
    Given the file "adws/agents/reviewAgent.ts" is read
    When searching for the agent invocation
    Then reviewAgent delegates to commandAgent via a CommandAgentConfig
    And the config includes an extractOutput function that returns ReviewResult

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: validationAgent uses commandAgent with extractOutput
    Given the file "adws/agents/validationAgent.ts" is read
    When searching for the agent invocation
    Then validationAgent delegates to commandAgent via a CommandAgentConfig
    And the config includes an extractOutput function that returns ValidationResult

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: alignmentAgent uses commandAgent with extractOutput
    Given the file "adws/agents/alignmentAgent.ts" is read
    When searching for the agent invocation
    Then alignmentAgent delegates to commandAgent via a CommandAgentConfig
    And the config includes an extractOutput function that returns AlignmentResult

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: resolutionAgent uses commandAgent with extractOutput
    Given the file "adws/agents/resolutionAgent.ts" is read
    When searching for the agent invocation
    Then resolutionAgent delegates to commandAgent via a CommandAgentConfig
    And the config includes an extractOutput function that returns ResolutionResult

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: testAgent uses commandAgent with extractOutput
    Given the file "adws/agents/testAgent.ts" is read
    When searching for the agent invocation
    Then testAgent delegates to commandAgent via a CommandAgentConfig
    And the config includes an extractOutput function that returns TestResult[]

  # ===================================================================
  # 2. JSON Schema definitions co-located with extractOutput
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: Each agent with structured output defines a JSON Schema
    Given the following agent files are read:
      | file                                        |
      | adws/agents/diffEvaluatorAgent.ts            |
      | adws/agents/documentAgent.ts                 |
      | adws/agents/dependencyExtractionAgent.ts     |
      | adws/agents/prAgent.ts                       |
      | adws/agents/stepDefAgent.ts                  |
      | adws/agents/reviewAgent.ts                   |
      | adws/agents/validationAgent.ts               |
      | adws/agents/alignmentAgent.ts                |
      | adws/agents/resolutionAgent.ts               |
      | adws/agents/testAgent.ts                     |
    Then each agent exports a JSON Schema object co-located with its extractOutput function
    And each schema is a valid JSON Schema definition

  @adw-u8xr9v-add-output-validatio
  Scenario: JSON Schema serves double duty for runtime validation and retry prompt
    Given any agent's CommandAgentConfig includes a JSON Schema
    When the schema is referenced in the retry loop
    Then the same schema object is used for both validation and inclusion in the retry prompt

  # ===================================================================
  # 3. CommandAgentConfig includes outputSchema field
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: CommandAgentConfig interface includes an outputSchema field
    Given the file "adws/agents/commandAgent.ts" is read
    When the CommandAgentConfig interface is inspected
    Then it includes an optional "outputSchema" field of type object
    And the outputSchema is used for validation when extractOutput is defined

  # ===================================================================
  # 4. extractOutput contract — structured error, not bare throw
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: extractOutput returns a structured error on validation failure
    Given an agent's extractOutput function receives malformed output
    When extractOutput attempts to parse and validate the output
    Then it returns a structured error object containing the specific validation message
    And it does not throw an exception

  @adw-u8xr9v-add-output-validatio
  Scenario: extractOutput structured error includes the validation details
    Given an agent's extractOutput receives output with wrong JSON keys
    When extractOutput validates against the JSON Schema
    Then the error object includes the schema path that failed
    And the error object includes a human-readable validation message

  @adw-u8xr9v-add-output-validatio
  Scenario: extractOutput returns the parsed value on successful validation
    Given an agent's extractOutput receives valid JSON matching the schema
    When extractOutput validates against the JSON Schema
    Then it returns the parsed and typed result
    And no error is present in the return value

  # ===================================================================
  # 5. Retry loop in commandAgent.runCommandAgent()
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: commandAgent retries when extractOutput validation fails
    Given the commandAgent is configured with an extractOutput and outputSchema
    And the initial agent output fails schema validation
    When runCommandAgent processes the output
    Then it spawns a new claude --print session for the retry
    And calls extractOutput on the retry output

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: Retry uses Haiku model regardless of original agent model
    Given the original agent was invoked with model "opus"
    And the output fails schema validation
    When the retry loop spawns a corrective session
    Then the retry session uses the Haiku model
    And the retry goes through the same agent spawn infrastructure

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: Retry loop allows up to 10 retries total
    Given the commandAgent output fails validation on every attempt
    When the retry loop executes
    Then extractOutput is called at most 11 times total (1 original + 10 retries)
    And the loop throws with the last validation error after all retries are exhausted

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: Early exit after 3 consecutive identical validation errors
    Given the commandAgent output fails validation
    And the same validation error occurs on 3 consecutive retry attempts
    When the retry loop detects the repeated error
    Then the loop exits early before reaching 10 retries
    And the error thrown indicates the validation error repeated consecutively

  @adw-u8xr9v-add-output-validatio
  Scenario: Different validation errors reset the consecutive error counter
    Given the commandAgent output fails validation with error "missing field: summary"
    And the first retry fails with error "missing field: summary"
    And the second retry fails with error "wrong type for field: aligned"
    When the consecutive error counter is checked
    Then the counter resets to 1 for the new error
    And the loop continues retrying

  @adw-u8xr9v-add-output-validatio
  Scenario: Successful retry on second attempt stops the loop
    Given the commandAgent output fails schema validation on the first attempt
    And the first retry returns valid JSON matching the schema
    When extractOutput succeeds on the retry output
    Then the retry loop stops immediately
    And the valid parsed result is returned

  @adw-u8xr9v-add-output-validatio
  Scenario: commandAgent without extractOutput skips the retry loop
    Given a CommandAgentConfig with no extractOutput function defined
    When runCommandAgent processes the agent output
    Then no retry loop is executed
    And the raw output is returned as-is

  # ===================================================================
  # 6. Retry prompt structure
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: Retry prompt includes original command, output, schema, and error
    Given the commandAgent output fails validation with error "missing required field: decisions"
    When the retry prompt is constructed
    Then the prompt includes the original command name and arguments
    And the prompt includes the full original result.output
    And the prompt includes the JSON Schema definition
    And the prompt includes the specific validation error message
    And the prompt ends with an instruction to return only valid JSON

  @adw-u8xr9v-add-output-validatio
  Scenario: Retry prompt sends full result.output, not extracted fragments
    Given the original agent returned a mix of prose and partial JSON
    When the retry prompt is constructed
    Then the entire result.output text is included verbatim
    And no pre-extraction or truncation is applied to the output

  # ===================================================================
  # 7. Design decisions — fresh invocation, same machinery
  # ===================================================================

  @adw-u8xr9v-add-output-validatio
  Scenario: Each retry is a fresh --print invocation, not --resume
    Given the commandAgent output fails validation
    When a retry is spawned
    Then the retry uses claude --print without --resume
    And the retry is a completely new CLI session

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: Retries use the same agent spawn infrastructure as the original
    Given the commandAgent output fails validation
    When a retry is spawned
    Then the retry goes through the same spawn/invocation path as the original agent
    And no bare API calls are used for retries

  # ===================================================================
  # 8. DRY — single retry loop covers all agents
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: All 10 agents share the single retry loop in commandAgent
    Given all agents are migrated to use commandAgent with extractOutput
    When any agent's output fails schema validation
    Then the same retry loop in runCommandAgent handles the retry
    And no agent implements its own retry-on-parse-failure logic

  @adw-u8xr9v-add-output-validatio
  Scenario: Per-agent retry logic is removed after migration
    Given the files "adws/agents/validationAgent.ts" and "adws/agents/resolutionAgent.ts" are read
    Then neither file contains its own retry-on-JSON-parse-failure logic
    And neither file calls runClaudeAgentWithCommand directly for retries

  # ===================================================================
  # 9. TypeScript type-check passes
  # ===================================================================

  @adw-u8xr9v-add-output-validatio @regression
  Scenario: TypeScript type-check passes after all output validation changes
    Given the ADW codebase with output validation retry loop implemented
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
