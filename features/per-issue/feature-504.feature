@adw-504 @adw-x5qlsu-auth-classify-401-as
Feature: Auth HITL gate — classify 401 as auth failure, kill in-flights, Slack notify

  CLI v2.1.132 emits api_retry envelopes with error "authentication_failed"
  and error_status 401 when the host OAuth token has expired. Today the
  JSONL parser at adws/core/claudeStreamParser.ts only matches the legacy
  error string "authentication_error", so the new envelope falls through
  to the generic server-error branch on attempt >= 2. The handler reads
  that as a rate-limit / API outage, throws RateLimitError, and the
  trigger pauses as if the API were overloaded. The next orchestrator
  spawn immediately hits the same 401, because only a human running
  `claude auth login` can recover.

  This feature classifies 401 as a host-wide HITL event end to end:

    1. The JSONL parser routes both the legacy "authentication_error"
       string AND the new "authentication_failed" string AND any other
       api_retry envelope carrying error_status 401 to
       authErrorDetected — never to serverErrorDetected.

    2. runClaudeAgentWithCommand throws a new AuthRequiredError after
       the existing one-shot auth-status retry exhausts, instead of
       returning a failed result. Every caller of the agent runner is
       forced to acknowledge the auth failure; runGenerateBranchNameAgent
       no longer silently extracts a garbage slug.

    3. The trigger writes a host-wide agents/.auth_gate file atomically
       (temp + rename), SIGTERMs every live orchestrator on the host,
       marks each state file workflowStage=paused_auth, and sends a
       Slack notification with a 2-hour cooldown.

    4. takeoverHandler recognises paused_auth as a terminal-but-resumable
       stage (branch 4b → skip_terminal). scanAuthQueue is the sole
       resumer; it runs only when the gate is absent and routes each
       paused_auth state through the existing abandoned branch so the
       original adwId is preserved.

    5. The next cron tick probes `claude auth status --json`. On
       loggedIn=true it clears the gate, sends a one-shot recovery
       Slack, and lets scanAuthQueue re-trigger every paused issue.
       On loggedIn=false it skips the rest of the tick (no spawns)
       and re-notifies Slack only after the 2-hour cooldown.

  Background:
    Given the ADW codebase is checked out

  # ── §1 parser classification ──────────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Parser classifies api_retry with error "authentication_failed" and status 401 as an auth error
    Given an api_retry envelope with error "authentication_failed", error_status 401, attempt 1
    When the JSONL stream parser processes the envelope
    Then the parser state has authErrorDetected set to true
    And the parser state has serverErrorDetected set to false

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Parser preserves legacy classification for error "authentication_error"
    Given an api_retry envelope with error "authentication_error", attempt 2
    When the JSONL stream parser processes the envelope
    Then the parser state has authErrorDetected set to true
    And the parser state has serverErrorDetected set to false

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Parser uses HTTP 401 as the backstop when the error string is unknown
    Given an api_retry envelope with error "future_auth_variant", error_status 401, attempt 2
    When the JSONL stream parser processes the envelope
    Then the parser state has authErrorDetected set to true
    And the parser state has serverErrorDetected set to false

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Parser still classifies overloaded_error as the overloaded path
    Given an api_retry envelope with error "overloaded_error", attempt 2
    When the JSONL stream parser processes the envelope
    Then the parser state has overloadedErrorDetected set to true
    And the parser state has authErrorDetected set to false

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Parser still classifies non-auth api_retry with attempt >= 2 as a server error
    Given an api_retry envelope with error "internal_server_error", attempt 2
    When the JSONL stream parser processes the envelope
    Then the parser state has serverErrorDetected set to true
    And the parser state has authErrorDetected set to false

  # ── §2 AuthRequiredError thrown from runClaudeAgentWithCommand ────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: AuthRequiredError is exported from the agent types module
    Given "adws/types/agentTypes.ts" is read
    Then "AuthRequiredError" is exported from adws/types/agentTypes.ts
    And "AuthRequiredError" extends the standard Error type

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: runClaudeAgentWithCommand throws AuthRequiredError when the auth-status retry cannot recover
    Given the claude-cli-stub emits authentication_failed with error_status 401 on every attempt
    And the claude auth status probe returns loggedIn=false
    When runClaudeAgentWithCommand is invoked for any agent
    Then AuthRequiredError is thrown

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: runClaudeAgentWithCommand does not throw RateLimitError on a pure 401 stream
    Given the claude-cli-stub emits only authentication_failed with error_status 401
    When runClaudeAgentWithCommand is invoked for any agent
    Then no RateLimitError is thrown
    And AuthRequiredError is thrown instead

  # ── §3 callers propagate AuthRequiredError (no garbage slug) ──────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: runGenerateBranchNameAgent propagates AuthRequiredError without extracting a slug
    Given runClaudeAgentWithCommand throws AuthRequiredError on the next invocation
    When runGenerateBranchNameAgent is invoked
    Then AuthRequiredError propagates to the caller
    And no branch slug is extracted from agent output
    And no branch is created in the git-mock

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: initializeWorkflow propagates AuthRequiredError out to orchestrator main()
    Given runClaudeAgentWithCommand throws AuthRequiredError during branch-name generation
    When initializeWorkflow is invoked
    Then AuthRequiredError propagates to the orchestrator main()
    And initializeWorkflow does not return a partially-populated config

  # ── §4 host-wide gate file ────────────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Gate file is written atomically via temp + rename under concurrent writers
    Given two concurrent writers attempt to write "agents/.auth_gate"
    When both writes complete
    Then the resulting auth-gate JSON is parseable
    And the file contents equal one of the two attempted payloads

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Gate file records firstDetectedAt, lastDetectedAt, host, and lastDetectedBy on first write
    Given no "agents/.auth_gate" exists
    When the auth gate is written for adwId "r9fast-1778666181570" issue 79 agent "Branch Name"
    Then "agents/.auth_gate" exists
    And the auth-gate JSON has fields "firstDetectedAt", "lastDetectedAt", "host", "lastDetectedBy"
    And the auth-gate "lastDetectedBy.adwId" equals "r9fast-1778666181570"
    And the auth-gate "lastDetectedBy.issueNumber" equals 79
    And the auth-gate "lastDetectedBy.agentName" equals "Branch Name"

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Re-detection while gated updates lastDetectedAt without resetting firstDetectedAt
    Given "agents/.auth_gate" exists with firstDetectedAt 10 minutes ago
    When the auth gate is written again for adwId "different-adw" issue 80 agent "classifier"
    Then "agents/.auth_gate" firstDetectedAt is unchanged
    And "agents/.auth_gate" lastDetectedAt equals now

  # ── §5 top-level catches at every agent caller ────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: SDLC orchestrator main catches AuthRequiredError and exits cleanly with paused_auth state
    Given runClaudeAgentWithCommand throws AuthRequiredError during workflowInit
    When the "sdlc" orchestrator is invoked with adwId "auth-fail-1" and issue 88
    Then the state file for adwId "auth-fail-1" records workflowStage "paused_auth"
    And the orchestrator subprocess exited 0
    And "agents/.auth_gate" exists with lastDetectedBy.adwId "auth-fail-1"

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: trigger_cron catches AuthRequiredError from the classifier and writes the gate
    Given no "agents/.auth_gate" exists
    And the claude-cli-stub emits authentication_failed with error_status 401 for the classifier
    When the cron probe runs once with an eligible issue 91
    Then "agents/.auth_gate" exists
    And no orchestrator is spawned for issue 91

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: trigger_webhook catches AuthRequiredError from inline agents and writes the gate
    Given no "agents/.auth_gate" exists
    And the claude-cli-stub emits authentication_failed with error_status 401 for any inline agent
    When the webhook handler receives an "issue_comment" event for issue 92
    Then "agents/.auth_gate" exists
    And the response status is 200
    And no orchestrator subprocess is spawned

  # ── §6 cron tick gate enforcement ─────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Cron tick with gate set and loggedIn=false SIGTERMs live orchestrators, marks them paused_auth, notifies Slack, spawns nothing
    Given "agents/.auth_gate" exists with lastSlackNotifiedAt null
    And the claude auth status probe returns loggedIn=false
    And a state file for adwId "live-1" records workflowStage "build_running" with a live pid
    And a state file for adwId "live-2" records workflowStage "plan_running" with a live pid
    When the cron probe runs once
    Then the orchestrator process for adwId "live-1" receives SIGTERM
    And the orchestrator process for adwId "live-2" receives SIGTERM
    And the state file for adwId "live-1" records workflowStage "paused_auth"
    And the state file for adwId "live-2" records workflowStage "paused_auth"
    And exactly one Slack detection notification is delivered to SLACK_WEBHOOK_URL
    And "agents/.auth_gate" lastSlackNotifiedAt is updated to now
    And no orchestrator is spawned during the tick

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Slack detection notifications honour the 2-hour cooldown while continuously gated
    Given "agents/.auth_gate" exists with lastSlackNotifiedAt 30 minutes ago
    And the claude auth status probe returns loggedIn=false
    When the cron probe runs once
    Then no Slack detection notification is delivered
    And "agents/.auth_gate" lastSlackNotifiedAt is unchanged

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Slack detection notification fires after the 2-hour cooldown expires
    Given "agents/.auth_gate" exists with lastSlackNotifiedAt 2 hours and 5 minutes ago
    And the claude auth status probe returns loggedIn=false
    When the cron probe runs once
    Then exactly one Slack detection notification is delivered to SLACK_WEBHOOK_URL
    And "agents/.auth_gate" lastSlackNotifiedAt is updated to now

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Cron tick with gate set and loggedIn=true clears the gate, sends recovery Slack, runs scanAuthQueue
    Given "agents/.auth_gate" exists
    And the claude auth status probe returns loggedIn=true
    And a state file for adwId "paused-1" records workflowStage "paused_auth"
    And a state file for adwId "paused-2" records workflowStage "paused_auth"
    When the cron probe runs once
    Then "agents/.auth_gate" does not exist
    And exactly one Slack recovery notification is delivered to SLACK_WEBHOOK_URL
    And scanAuthQueue re-triggers adwId "paused-1"
    And scanAuthQueue re-triggers adwId "paused-2"

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: Recovery Slack always fires on gate-clear regardless of cooldown
    Given "agents/.auth_gate" exists with lastSlackNotifiedAt 1 minute ago
    And the claude auth status probe returns loggedIn=true
    When the cron probe runs once
    Then "agents/.auth_gate" does not exist
    And exactly one Slack recovery notification is delivered to SLACK_WEBHOOK_URL

  # ── §7 takeoverHandler branch 4b ──────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: takeoverHandler returns skip_terminal with terminalStage paused_auth for paused_auth state
    Given a state file for adwId "paused-auth-1" records workflowStage "paused_auth"
    When takeoverHandler classifies the candidate for that state
    Then the decision kind is "skip_terminal"
    And the decision terminalStage is "paused_auth"

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: CandidateDecision.skip_terminal terminalStage union includes paused_auth
    Given "adws/triggers/takeoverHandler.ts" is read
    Then the CandidateDecision skip_terminal terminalStage union includes "paused_auth"

  # ── §8 scanAuthQueue resume path ──────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: scanAuthQueue does not run while the gate is set
    Given "agents/.auth_gate" exists
    When the cron probe runs once
    Then scanAuthQueue does not run during the tick

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: scanAuthQueue routes a paused_auth state through takeoverHandler abandoned branch and preserves adwId
    Given "agents/.auth_gate" does not exist
    And a state file for adwId "paused-3" records workflowStage "paused_auth"
    And no live pid exists for adwId "paused-3"
    When scanAuthQueue runs once
    Then takeoverHandler returns kind "abandoned" for adwId "paused-3"
    And the orchestrator for adwId "paused-3" is re-triggered with take_over_adwId "paused-3"

  # ── §9 WorkflowStage type ─────────────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: WorkflowStage union includes paused_auth
    Given "adws/types/workflowTypes.ts" is read
    Then the WorkflowStage union includes "paused_auth"

  # ── §10 end-to-end loop ───────────────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: End-to-end OAuth-kill-and-relogin loop classifies, gates, notifies, and resumes
    Given the OAuth token is killed while an orchestrator is mid-build
    And the claude-cli-stub emits authentication_failed with error_status 401 for the running agent
    When the cron probe runs once
    Then no RateLimitError is recorded for any agent
    And "agents/.auth_gate" exists with lastDetectedBy populated
    And exactly one Slack detection notification is delivered to SLACK_WEBHOOK_URL
    And every live orchestrator state file is marked workflowStage "paused_auth"
    When the OAuth token is restored via "claude auth login"
    And the cron probe runs once
    Then "agents/.auth_gate" does not exist
    And exactly one Slack recovery notification is delivered to SLACK_WEBHOOK_URL
    And each paused_auth orchestrator is re-triggered with the original adwId preserved

  # ── Type-check ────────────────────────────────────────────────────────

  @adw-504 @adw-x5qlsu-auth-classify-401-as
  Scenario: TypeScript type-check passes after the auth-gate changes
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
