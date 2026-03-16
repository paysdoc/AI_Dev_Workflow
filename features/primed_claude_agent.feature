@adw-uzfskg-add-runprimedclaudea
Feature: runPrimedClaudeAgentWithCommand primes context before executing a command

  Before the plan and scenario agents execute their slash commands, the agent
  context must be primed with /install so that codebase exploration tokens are
  shared rather than duplicated across invocations. The new
  runPrimedClaudeAgentWithCommand function composes a two-step prompt — first
  /install, then the target command — in the same Claude CLI invocation.

  Background:
    Given the ADW codebase contains "adws/agents/claudeAgent.ts"
    And the ADW codebase contains "adws/agents/planAgent.ts"
    And the ADW codebase contains "adws/agents/scenarioAgent.ts"
    And the ADW codebase contains "adws/agents/index.ts"

  @adw-uzfskg-add-runprimedclaudea @regression
  Scenario: runPrimedClaudeAgentWithCommand is exported from claudeAgent.ts
    Given "adws/agents/claudeAgent.ts" is read
    When searching for the exported symbol "runPrimedClaudeAgentWithCommand"
    Then the function is defined with the "export" keyword
    And its signature accepts command, args, agentName, outputFile, model, effort, onProgress, statePath, and cwd parameters
    And it returns a Promise<AgentResult>

  @adw-uzfskg-add-runprimedclaudea @regression
  Scenario: runPrimedClaudeAgentWithCommand composes a prompt with /install first
    Given runPrimedClaudeAgentWithCommand is called with command "/feature" and args ["42", "abc123", "{}"]
    When the composed prompt is constructed
    Then the prompt begins with "/install"
    And the prompt contains "Once /install completes, run: /feature"
    And the prompt contains the provided args in single-quoted form

  @adw-uzfskg-add-runprimedclaudea @regression
  Scenario: Plan agent calls runPrimedClaudeAgentWithCommand instead of runClaudeAgentWithCommand
    Given "adws/agents/planAgent.ts" is read
    When searching for the call that launches the plan agent subprocess
    Then it calls "runPrimedClaudeAgentWithCommand"
    And it does not call "runClaudeAgentWithCommand" for the plan agent subprocess

  @adw-uzfskg-add-runprimedclaudea @regression
  Scenario: Scenario agent calls runPrimedClaudeAgentWithCommand instead of runClaudeAgentWithCommand
    Given "adws/agents/scenarioAgent.ts" is read
    When searching for the call that launches the scenario agent subprocess
    Then it calls "runPrimedClaudeAgentWithCommand"
    And it does not call "runClaudeAgentWithCommand" for the scenario agent subprocess

  @adw-uzfskg-add-runprimedclaudea @regression
  Scenario: runPrimedClaudeAgentWithCommand is re-exported from the agents barrel
    Given "adws/agents/index.ts" is read
    When searching for the export of "runPrimedClaudeAgentWithCommand"
    Then the symbol is exported from the barrel file

  @adw-uzfskg-add-runprimedclaudea
  Scenario: runPrimedClaudeAgentWithCommand delegates spawning and streaming to existing internals
    Given runPrimedClaudeAgentWithCommand is called with valid parameters
    When the agent subprocess is spawned
    Then the spawning, streaming, and state tracking behaviour matches runClaudeAgentWithCommand
    And no new process-management logic is introduced outside the prompt composition

  @adw-uzfskg-add-runprimedclaudea
  Scenario: Primed prompt escapes single quotes in args correctly
    Given runPrimedClaudeAgentWithCommand is called with an arg containing a single quote
    When the composed prompt is constructed
    Then the single quote is escaped so the shell argument remains valid

  @adw-uzfskg-add-runprimedclaudea
  Scenario: Primed prompt handles an array of args
    Given runPrimedClaudeAgentWithCommand is called with args ["issueNumber", "adwId", "issueJson"]
    When the composed prompt is constructed
    Then all three args appear in the prompt in the correct order after the command name

  @adw-uzfskg-add-runprimedclaudea
  Scenario: Primed prompt handles a single string arg
    Given runPrimedClaudeAgentWithCommand is called with a single string arg "myArg"
    When the composed prompt is constructed
    Then the prompt contains the command followed by "'myArg'"
