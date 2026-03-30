@adw-locx5w-refactor-runner-toke
Feature: Runner token-limit continuation as cross-cutting concern

  Move token-limit continuation logic from individual phases into the
  declarative orchestrator runner. Phases optionally provide an
  onTokenLimit(state, previousResult) callback that returns a continuation
  prompt. The runner detects token-limit results and manages the retry loop
  (up to MAX_CONTEXT_RESETS). Phases without onTokenLimit fail on token
  limit. buildPhase migrates its existing continuation logic to this pattern.

  Background:
    Given the ADW codebase is checked out

  # ── 1: PhaseDefinition extended with onTokenLimit ─────────────────────

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: PhaseDefinition interface includes optional onTokenLimit callback
    Given the phase definition type in "adws/core/orchestratorRunner.ts" is read
    Then PhaseDefinition includes an optional "onTokenLimit" property
    And onTokenLimit is a function type

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: onTokenLimit callback has explicit typed signature
    Given the phase definition type in "adws/core/orchestratorRunner.ts" is read
    Then onTokenLimit accepts a WorkflowConfig parameter and a previous PhaseResult parameter
    And onTokenLimit returns a string (the continuation prompt)
    And neither parameter type uses "any"

  @adw-locx5w-refactor-runner-toke
  Scenario: PhaseDefinition without onTokenLimit compiles without errors
    Given a PhaseDefinition is declared without an onTokenLimit property
    When TypeScript type-checks the definition
    Then no type error is reported
    And the phase definition is valid

  # ── 2: Runner detects token-limit and invokes onTokenLimit ────────────

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Runner detects token-limit result from a phase with onTokenLimit
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns a result indicating token_limit on the first execution
    When runOrchestrator executes that phase
    Then the runner calls the phase's onTokenLimit with config and the token-limit result
    And the runner re-executes the phase with the continuation prompt returned by onTokenLimit

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Runner retries up to MAX_CONTEXT_RESETS on repeated token-limit results
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit on every execution
    When runOrchestrator executes that phase
    Then the runner retries the phase up to MAX_CONTEXT_RESETS times
    And after MAX_CONTEXT_RESETS retries, the runner throws an error indicating maximum resets exceeded

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner stops retrying when phase succeeds after token-limit continuation
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit on the first execution
    And the phase succeeds on the second execution
    When runOrchestrator executes that phase
    Then onTokenLimit is called once
    And the phase executes exactly twice
    And the runner proceeds to the next phase

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner passes the latest result to onTokenLimit on each retry
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit three times with different output each time
    When the runner retries the phase
    Then onTokenLimit receives the result from the most recent execution each time
    And the continuation prompt is rebuilt from the latest result

  # ── 3: Phases without onTokenLimit fail on token limit ────────────────

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Phase without onTokenLimit fails immediately on token-limit result
    Given an orchestrator with a phase that does not define onTokenLimit
    And the phase returns a result indicating token_limit
    When runOrchestrator executes that phase
    Then the runner does not retry the phase
    And handleWorkflowError is called with the token-limit error
    And subsequent phases are not executed

  @adw-locx5w-refactor-runner-toke
  Scenario: Phase without onTokenLimit that succeeds is unaffected by continuation logic
    Given an orchestrator with a phase that does not define onTokenLimit
    And the phase succeeds on the first execution
    When runOrchestrator executes that phase
    Then the phase executes exactly once
    And the runner proceeds to the next phase normally

  # ── 4: Cost and model usage accumulation across continuations ─────────

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Runner accumulates costs across token-limit continuations
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit on the first execution with costUsd = 0.05
    And the phase succeeds on the second execution with costUsd = 0.03
    When runOrchestrator executes that phase
    Then the CostTracker accumulates a total of 0.08 for that phase
    And the accumulated cost is passed to completeWorkflow on success

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner accumulates model usage across token-limit continuations
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit on the first execution with modelUsage data
    And the phase succeeds on the second execution with its own modelUsage data
    When runOrchestrator executes that phase
    Then the total model usage is the merged sum of both executions
    And CostTracker.persist is called with the merged model usage

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner accumulates costs across multiple continuations before success
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit twice with costUsd = 0.04 each
    And the phase succeeds on the third execution with costUsd = 0.02
    When runOrchestrator executes that phase
    Then the CostTracker accumulates a total of 0.10 for that phase

  # ── 5: buildPhase migration to onTokenLimit pattern ───────────────────

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: buildPhase provides onTokenLimit with existing continuation prompt logic
    Given "adws/phases/buildPhase.ts" is read
    Then the build phase definition includes an onTokenLimit callback
    And the callback invokes buildContinuationPrompt with the original plan and previous result output
    And the callback returns the continuation prompt string

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: buildPhase internal continuation loop is removed
    Given "adws/phases/buildPhase.ts" is read
    Then the file does not contain a while loop for token-limit or compaction continuation
    And the file does not track a continuationNumber or contextResetCount for token limits
    And the file does not check MAX_CONTEXT_RESETS internally

  @adw-locx5w-refactor-runner-toke
  Scenario: buildPhase onTokenLimit uses buildContinuationPrompt from planPhase
    Given the build phase definition includes an onTokenLimit callback
    When onTokenLimit is invoked with config and a token-limit result
    Then buildContinuationPrompt is called with the original plan content and the result output
    And the continuation prompt includes the previous agent output in <previous-agent-output> tags

  @adw-locx5w-refactor-runner-toke
  Scenario: buildPhase onTokenLimit handles compaction reason
    Given the build phase definition includes an onTokenLimit callback
    And the previous result indicates compactionDetected = true
    When onTokenLimit is invoked
    Then buildContinuationPrompt is called with reason = "compaction"
    And the continuation prompt references context compaction rather than token limit

  # ── 6: Runner continuation interacts correctly with other runner concerns ─

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Runner continuation persists costs after each retry via CostTracker
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit on the first execution
    When the runner retries the phase
    Then CostTracker.persist is called after the initial execution
    And CostTracker.persist is called after the continuation execution

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner continuation does not skip subsequent phases on success
    Given an orchestrator with phases "build", "test", "pr"
    And "build" has onTokenLimit defined and returns token_limit once then succeeds
    When runOrchestrator is called
    Then "build" executes twice (initial + continuation)
    And "test" executes after "build" succeeds
    And "pr" executes after "test" succeeds

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner continuation failure triggers handleWorkflowError
    Given an orchestrator with a phase that has onTokenLimit defined
    And the phase returns token_limit on every execution exceeding MAX_CONTEXT_RESETS
    When runOrchestrator is called
    Then handleWorkflowError is called with an error indicating max context resets exceeded
    And subsequent phases are not executed

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner resume skips phases completed via continuation
    Given an orchestrator with phases "install", "build", "test"
    And "build" previously completed after a token-limit continuation
    When runOrchestrator is called in resume mode
    Then "install" and "build" are skipped
    And "test" executes normally

  # ── 7: Runner unit tests ──────────────────────────────────────────────

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Runner unit test verifies phase with onTokenLimit retries on token limit
    Given runner unit tests exist
    Then there is a test with a mock phase that defines onTokenLimit
    And the mock phase returns token_limit on the first call and succeeds on the second
    And the test verifies onTokenLimit is called with the token-limit result
    And the test verifies the phase executes twice

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Runner unit test verifies phase without onTokenLimit fails on token limit
    Given runner unit tests exist
    Then there is a test with a mock phase that does not define onTokenLimit
    And the mock phase returns token_limit
    And the test verifies the runner does not retry the phase
    And the test verifies handleWorkflowError is called

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: Runner unit test verifies MAX_CONTEXT_RESETS is honored
    Given runner unit tests exist
    Then there is a test with a mock phase that always returns token_limit
    And the mock phase defines onTokenLimit
    And the test verifies the phase is retried exactly MAX_CONTEXT_RESETS times
    And the test verifies an error is thrown after exceeding the limit

  @adw-locx5w-refactor-runner-toke
  Scenario: Runner unit test verifies cost accumulation across continuations
    Given runner unit tests exist
    Then there is a test with a mock phase that returns token_limit once
    And each execution reports a known costUsd
    And the test verifies the CostTracker accumulates the sum of both costs

  # ── 8: Type safety ───────────────────────────────────────────────────

  @adw-locx5w-refactor-runner-toke @regression
  Scenario: All type checks pass with runner token-limit continuation changes
    Given the ADW codebase with runner token-limit continuation implemented
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0

  @adw-locx5w-refactor-runner-toke
  Scenario: No any types at onTokenLimit boundaries
    Given the onTokenLimit type definition in orchestratorRunner.ts is read
    Then the function parameter types are explicitly annotated
    And the return type is explicitly annotated as string
    And no "any" type appears in the onTokenLimit signature or its callers
