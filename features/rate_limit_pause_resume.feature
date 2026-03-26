@adw-chpy1a-orchestrator-refacto
Feature: Rate Limit Pause and Resume

  When the Claude CLI returns rate limit, billing limit, API outage, or
  authentication failure messages, the pipeline pauses instead of crashing.
  Paused workflows are queued and automatically resumed by the cron trigger
  after probing confirms the rate limit has lifted.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Rate limit detection in agentProcessHandler
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario Outline: agentProcessHandler detects "<pattern>" as rate limit
    Given agentProcessHandler is monitoring Claude CLI output
    When the output contains "<pattern>"
    Then the handler sets rateLimited to true on the AgentResult

    Examples:
      | pattern                             |
      | You've hit your limit               |
      | You're out of extra usage            |
      | 502 Bad Gateway                      |
      | Invalid authentication credentials   |

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: AgentResult type includes rateLimited boolean field
    Given the AgentResult type in "adws/types/agentTypes.ts"
    Then it includes a rateLimited field of type boolean

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: claudeAgent propagates rateLimited flag to caller
    Given claudeAgent runs a process via handleAgentProcess
    When handleAgentProcess returns rateLimited: true
    Then claudeAgent returns an AgentResult with rateLimited: true to the calling phase

  # ===================================================================
  # 2. Pause mechanism
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: handleRateLimitPause is exported from workflowCompletion.ts
    Given the file "adws/phases/workflowCompletion.ts" exists
    Then it exports a handleRateLimitPause function

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: handleRateLimitPause writes pause state to state.json
    Given an orchestrator has completed phases ["install", "plan"]
    When the build phase returns rateLimited: true
    And handleRateLimitPause is called
    Then state.json contains completedPhases ["install", "plan"]
    And state.json contains pausedAtPhase "build"

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: handleRateLimitPause appends entry to paused_queue.json
    Given a workflow is paused due to rate limiting
    When handleRateLimitPause is called
    Then it appends a PausedWorkflow entry to "agents/paused_queue.json"
    And the entry includes adwId, issueNumber, and orchestratorScript
    And the entry includes pausedAtPhase and pauseReason "rate_limited"
    And the entry includes pausedAt as an ISO timestamp
    And the entry includes worktreePath and branchName

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: handleRateLimitPause posts paused comment on GitHub issue
    Given a workflow is paused due to rate limiting
    When handleRateLimitPause is called
    Then it posts an issue comment containing a paused indicator
    And the comment lists the completed phases
    And the comment identifies the phase where execution paused

  # ===================================================================
  # 3. Resume mechanism — cron probe
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Cron trigger scans paused_queue.json each cycle
    Given "agents/paused_queue.json" contains paused workflow entries
    When the cron trigger runs a poll cycle
    Then it reads and processes the paused queue

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Probe runs only every PROBE_INTERVAL_CYCLES cycles
    Given PROBE_INTERVAL_CYCLES is 15
    And a paused workflow exists in the queue
    When the cron trigger has run fewer than 15 cycles since last probe
    Then it does not probe the paused workflow

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Probe uses haiku model ping command
    Given a paused workflow is due for probing
    When the cron trigger probes
    Then it executes "claude --print \"ping\" --model haiku --max-turns 1"

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Successful probe resumes workflow and posts comment
    Given a paused workflow exists in the queue
    When the probe command returns exit code 0
    Then the cron trigger spawns the same orchestrator script with the same adwId
    And it posts a resumed comment on the GitHub issue
    And the entry is removed from paused_queue.json

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Failed probe with rate limit text retries indefinitely
    Given a paused workflow exists in the queue
    When the probe returns an error containing rate limit text
    Then the entry remains in paused_queue.json
    And lastProbeAt is updated to the current timestamp
    And probeFailures is not incremented

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Failed probe without rate limit text increments probeFailures
    Given a paused workflow with probeFailures at 0
    When the probe returns an error without rate limit text
    Then probeFailures is incremented to 1
    And the entry remains in paused_queue.json

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Probe failures exceeding MAX_UNKNOWN_PROBE_FAILURES removes entry
    Given MAX_UNKNOWN_PROBE_FAILURES is 3
    And a paused workflow with probeFailures at 2
    When the probe fails again without rate limit text
    Then the entry is removed from paused_queue.json
    And an error comment is posted on the GitHub issue

  # ===================================================================
  # 4. Resume execution
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Resumed workflow skips completed phases
    Given a resumed workflow with completedPhases ["install", "plan", "scenario"]
    And pausedAtPhase is "build"
    When the orchestrator is respawned with the same adwId
    Then it reads completedPhases from state.json
    And it skips the install, plan, and scenario phases
    And it re-runs from the build phase

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Stale queue entry triggers restart from scratch
    Given a paused queue entry whose worktree path no longer exists
    When the cron trigger processes the stale entry
    Then it removes the entry from paused_queue.json
    And it posts a warning comment on the GitHub issue
    And it restarts the workflow from scratch with a new adwId
    And it uses the stored orchestratorScript from the queue entry

  # ===================================================================
  # 5. Configuration
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: PROBE_INTERVAL_CYCLES defaults to 15 and is configurable via env
    Given the environment variable PROBE_INTERVAL_CYCLES is not set
    Then the default probe interval is 15 cycles
    When PROBE_INTERVAL_CYCLES is set to 10
    Then the probe interval becomes 10 cycles

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: MAX_UNKNOWN_PROBE_FAILURES defaults to 3 and is configurable via env
    Given the environment variable MAX_UNKNOWN_PROBE_FAILURES is not set
    Then the default max unknown probe failures is 3
    When MAX_UNKNOWN_PROBE_FAILURES is set to 5
    Then the max unknown probe failures becomes 5

  # ===================================================================
  # 6. TypeScript compilation
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: TypeScript type-check passes after rate limit pause/resume
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
