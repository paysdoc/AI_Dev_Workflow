@adw-2sqt1r-error
Feature: Structured JSONL rate limit detection and runPhasesParallel pause fix

  Replace brittle text.includes() string matching in agentProcessHandler with
  structured JSON parsing of JSONL messages emitted by Claude Code CLI. This
  eliminates false-positive rate limit detection when agents read ADW source
  code containing the detection strings. Also fix runPhasesParallel() so that
  RateLimitError triggers the pause queue instead of a hard workflow failure.

  # --- Cross-chunk line buffering in parseJsonlOutput ---

  @adw-2sqt1r-error @regression
  Scenario: Complete JSONL line in a single chunk is parsed
    Given a JsonlParserState with an empty lineBuffer
    When parseJsonlOutput receives a chunk containing a complete JSONL line ending with newline
    Then the JSONL line is parsed and state is updated
    And lineBuffer remains empty

  @adw-2sqt1r-error @regression
  Scenario: JSONL line split across two chunks is reassembled and parsed
    Given a JsonlParserState with an empty lineBuffer
    When parseJsonlOutput receives a chunk with a partial JSONL line (no trailing newline)
    Then the partial line is stored in lineBuffer
    And no parse occurs for the partial line
    When parseJsonlOutput receives a second chunk completing the line with a trailing newline
    Then the reassembled line is parsed correctly
    And lineBuffer is cleared

  @adw-2sqt1r-error
  Scenario: Multiple complete lines in a single chunk are all parsed
    Given a JsonlParserState with an empty lineBuffer
    When parseJsonlOutput receives a chunk with three complete JSONL lines each ending with newline
    Then all three lines are parsed
    And lineBuffer remains empty

  @adw-2sqt1r-error
  Scenario: Trailing partial line is buffered across multiple chunks
    Given a JsonlParserState with an empty lineBuffer
    When parseJsonlOutput receives a chunk with one complete line and one partial line
    Then the complete line is parsed
    And the partial line is stored in lineBuffer
    When parseJsonlOutput receives a third chunk completing the partial line
    Then the reassembled partial line is parsed correctly

  # --- Structured detection: rate_limit_event ---

  @adw-2sqt1r-error @regression
  Scenario: rate_limit_event with status "rejected" sets rateLimitRejected flag
    Given a JsonlParserState with rateLimitRejected = false
    When parseJsonlOutput receives a JSONL line with type "rate_limit_event" and rate_limit_info.status "rejected"
    Then state.rateLimitRejected is true

  @adw-2sqt1r-error
  Scenario: rate_limit_event with status "allowed" does NOT set rateLimitRejected
    Given a JsonlParserState with rateLimitRejected = false
    When parseJsonlOutput receives a JSONL line with type "rate_limit_event" and rate_limit_info.status "allowed"
    Then state.rateLimitRejected remains false

  @adw-2sqt1r-error
  Scenario: rate_limit_event with status "allowed_warning" does NOT set rateLimitRejected
    Given a JsonlParserState with rateLimitRejected = false
    When parseJsonlOutput receives a JSONL line with type "rate_limit_event" and rate_limit_info.status "allowed_warning"
    Then state.rateLimitRejected remains false

  # --- Structured detection: authentication error ---

  @adw-2sqt1r-error @regression
  Scenario: system api_retry with authentication_error sets authErrorDetected flag
    Given a JsonlParserState with authErrorDetected = false
    When parseJsonlOutput receives a JSONL line with type "system", subtype "api_retry", and error "authentication_error"
    Then state.authErrorDetected is true

  # --- Structured detection: server error ---

  @adw-2sqt1r-error @regression
  Scenario: system api_retry with non-auth error at attempt >= 2 sets serverErrorDetected
    Given a JsonlParserState with serverErrorDetected = false
    When parseJsonlOutput receives a JSONL line with type "system", subtype "api_retry", error "unknown", and attempt 2
    Then state.serverErrorDetected is true

  @adw-2sqt1r-error
  Scenario: system api_retry with non-auth error at attempt 1 does NOT set serverErrorDetected
    Given a JsonlParserState with serverErrorDetected = false
    When parseJsonlOutput receives a JSONL line with type "system", subtype "api_retry", error "unknown", and attempt 1
    Then state.serverErrorDetected remains false

  # --- Structured detection: overloaded error ---

  @adw-2sqt1r-error @regression
  Scenario: system api_retry with overloaded_error sets overloadedErrorDetected
    Given a JsonlParserState with overloadedErrorDetected = false
    When parseJsonlOutput receives a JSONL line with type "system", subtype "api_retry", and error "overloaded_error"
    Then state.overloadedErrorDetected is true

  # --- Structured detection: compaction ---

  @adw-2sqt1r-error @regression
  Scenario: system compact_boundary sets compactionDetected flag
    Given a JsonlParserState with compactionDetected = false
    When parseJsonlOutput receives a JSONL line with type "system" and subtype "compact_boundary"
    Then state.compactionDetected is true

  # --- False-positive prevention ---

  @adw-2sqt1r-error @regression
  Scenario: Tool result content containing detection strings does NOT set any flags
    Given a JsonlParserState with all detection flags set to false
    When parseJsonlOutput receives a JSONL line with type "tool_result" whose content contains "overloaded_error", "compact_boundary", "rate_limit_event", and "authentication_error"
    Then state.rateLimitRejected remains false
    And state.authErrorDetected remains false
    And state.serverErrorDetected remains false
    And state.overloadedErrorDetected remains false
    And state.compactionDetected remains false

  @adw-2sqt1r-error
  Scenario: Assistant message containing detection strings does NOT set any flags
    Given a JsonlParserState with all detection flags set to false
    When parseJsonlOutput receives a JSONL line with type "assistant" whose content contains "You've hit your limit" and "502 Bad Gateway"
    Then no detection flags are set

  # --- agentProcessHandler flag-based process kill ---

  @adw-2sqt1r-error @regression
  Scenario: agentProcessHandler kills process when rateLimitRejected flag is set
    Given agentProcessHandler is processing stdout chunks
    And parseJsonlOutput sets state.rateLimitRejected to true
    When the handler checks the state flags after parseJsonlOutput returns
    Then the agent process is killed with SIGTERM
    And a "Rate limit / API outage detected" warning is logged

  @adw-2sqt1r-error @regression
  Scenario: agentProcessHandler kills process when authErrorDetected flag is set
    Given agentProcessHandler is processing stdout chunks
    And parseJsonlOutput sets state.authErrorDetected to true
    When the handler checks the state flags after parseJsonlOutput returns
    Then the agent process is killed with SIGTERM
    And a "Fatal authentication error detected" error is logged

  @adw-2sqt1r-error @regression
  Scenario: agentProcessHandler kills process when overloadedErrorDetected flag is set
    Given agentProcessHandler is processing stdout chunks
    And parseJsonlOutput sets state.overloadedErrorDetected to true
    When the handler checks the state flags after parseJsonlOutput returns
    Then the agent process is killed with SIGTERM
    And a "Rate limit / API outage detected" warning is logged

  @adw-2sqt1r-error
  Scenario: agentProcessHandler kills process only once per detection type
    Given agentProcessHandler is processing stdout chunks
    When parseJsonlOutput sets state.rateLimitRejected to true on the first chunk
    And parseJsonlOutput sets state.rateLimitRejected to true on a subsequent chunk
    Then SIGTERM is sent only once for rate limit detection
    And the local rateLimitDetected guard prevents duplicate kills

  # --- runPhasesParallel RateLimitError routing ---

  @adw-2sqt1r-error @regression
  Scenario: runPhasesParallel routes RateLimitError through handleRateLimitPause
    Given runPhasesParallel is executing multiple phase functions in parallel
    When one of the phase functions throws a RateLimitError
    Then handleRateLimitPause is called with the error's phase name and "rate_limited" status
    And the RateLimitError is re-thrown after handling

  @adw-2sqt1r-error
  Scenario: runPhasesParallel does not catch non-RateLimitError exceptions
    Given runPhasesParallel is executing multiple phase functions in parallel
    When one of the phase functions throws a generic Error
    Then handleRateLimitPause is NOT called
    And the error propagates to the caller

  @adw-2sqt1r-error @regression
  Scenario: runPhasesParallel still accumulates cost when all phases succeed
    Given runPhasesParallel is executing multiple phase functions in parallel
    When all phase functions complete successfully with cost data
    Then the cost tracker accumulates the merged totals from all phases
    And the cost is persisted and committed

  # --- Type checks ---

  @adw-2sqt1r-error @regression
  Scenario: All type checks pass with structured JSONL detection changes
    Given the ADW codebase with structured JSONL rate limit detection implemented
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
