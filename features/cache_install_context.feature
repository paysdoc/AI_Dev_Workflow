@adw-71pdjz-cache-install-contex
Feature: Cache /install context to eliminate redundant agent priming

  The /install command runs up to 3 times per SDLC workflow across separate
  agent processes, each independently discovering the same project structure.
  This feature runs /install once at workflow start, caches the file contents
  it read, and injects that context into subsequent agent prompts.

  # ── 1. Install agent ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: installAgent.ts agent wrapper exists
    Given the file "adws/agents/installAgent.ts" exists
    Then it should export a function to run the install agent
    And it should invoke the /install command via runClaudeAgentWithCommand

  @adw-71pdjz-cache-install-contex @regression
  Scenario: Install agent passes worktree path as cwd
    Given the file "adws/agents/installAgent.ts" exists
    Then it should pass the worktree path as the cwd parameter to runClaudeAgentWithCommand

  # ── 2. Install phase ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: installPhase.ts phase orchestration exists
    Given the file "adws/phases/installPhase.ts" exists
    Then it should export a function to execute the install phase
    And it should call the install agent
    And it should return phase cost records

  @adw-71pdjz-cache-install-contex @regression
  Scenario: Install phase parses JSONL output and extracts file contents
    Given the file "adws/phases/installPhase.ts" exists
    Then it should parse the agent's JSONL stream-json output
    And it should extract raw file contents from tool use events

  @adw-71pdjz-cache-install-contex @regression
  Scenario: Install phase writes cache to install_cache.md
    Given the file "adws/phases/installPhase.ts" exists
    Then it should write the extracted context to "agents/{adwId}/install_cache.md"

  @adw-71pdjz-cache-install-contex @regression
  Scenario: Install phase populates WorkflowConfig.installContext
    Given the file "adws/phases/installPhase.ts" exists
    Then it should set config.installContext with the cached context string

  # ── 3. WorkflowConfig updated ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: WorkflowConfig includes installContext field
    Given the file "adws/phases/workflowInit.ts" exists
    Then the WorkflowConfig interface should include an optional "installContext" field of type string

  # ── 4. runClaudeAgentWithCommand accepts contextPreamble ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: runClaudeAgentWithCommand accepts optional contextPreamble parameter
    Given the file "adws/agents/claudeAgent.ts" exists
    Then runClaudeAgentWithCommand should accept an optional "contextPreamble" parameter
    And when contextPreamble is provided it should be prepended to the prompt

  # ── 5. /install references removed from slash commands ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: /install reference removed from feature.md
    Given the file ".claude/commands/feature.md" exists
    Then it should not contain a reference to "install.md"

  @adw-71pdjz-cache-install-contex @regression
  Scenario: /install reference removed from bug.md
    Given the file ".claude/commands/bug.md" exists
    Then it should not contain a reference to "install.md"

  @adw-71pdjz-cache-install-contex @regression
  Scenario: /install reference removed from chore.md
    Given the file ".claude/commands/chore.md" exists
    Then it should not contain a reference to "install.md"

  @adw-71pdjz-cache-install-contex @regression
  Scenario: /install reference removed from scenario_writer.md
    Given the file ".claude/commands/scenario_writer.md" exists
    Then it should not contain a reference to "install.md"

  @adw-71pdjz-cache-install-contex @regression
  Scenario: /install reference removed from pr_review.md
    Given the file ".claude/commands/pr_review.md" exists
    Then it should not contain a reference to "install.md"

  @adw-71pdjz-cache-install-contex @regression
  Scenario: /install reference removed from generate_step_definitions.md
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should not contain a reference to "install.md"

  # ── 6. Agent callers pass installContext as contextPreamble ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: planAgent passes installContext as contextPreamble
    Given the file "adws/agents/planAgent.ts" exists
    Then it should accept an installContext parameter
    And it should pass installContext as contextPreamble to runClaudeAgentWithCommand

  @adw-71pdjz-cache-install-contex @regression
  Scenario: scenarioAgent passes installContext as contextPreamble
    Given the file "adws/agents/scenarioAgent.ts" exists
    Then it should accept an installContext parameter
    And it should pass installContext as contextPreamble to runClaudeAgentWithCommand

  @adw-71pdjz-cache-install-contex @regression
  Scenario: PR review agent caller passes installContext as contextPreamble
    Given the agent caller that invokes /pr_review exists
    Then it should accept an installContext parameter
    And it should pass installContext as contextPreamble to runClaudeAgentWithCommand

  @adw-71pdjz-cache-install-contex @regression
  Scenario: stepDefAgent passes installContext as contextPreamble
    Given the file "adws/agents/stepDefAgent.ts" exists
    Then it should accept an installContext parameter
    And it should pass installContext as contextPreamble to runClaudeAgentWithCommand

  # ── 7. Orchestrators call installPhase after initializeWorkflow ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario Outline: <orchestrator> calls installPhase between init and first task phase
    Given the file "adws/<orchestrator>" exists
    Then installPhase should be called after initializeWorkflow
    And installPhase should be called before the first task phase

    Examples:
      | orchestrator              |
      | adwSdlc.tsx               |
      | adwPlanBuildTestReview.tsx |
      | adwPlanBuildReview.tsx     |
      | adwPlanBuild.tsx          |
      | adwPlanBuildTest.tsx       |
      | adwPlanBuildDocument.tsx   |
      | adwPlan.tsx               |
      | adwPrReview.tsx           |

  # ── 8. Recovery behavior ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: Install agent always re-runs on recovery
    Given the file "adws/phases/installPhase.ts" exists
    Then it should not skip execution based on existing install_cache.md
    And it should always execute the install agent regardless of recovery state

  # ── 9. Context preamble format ──

  @adw-71pdjz-cache-install-contex
  Scenario: Context preamble wraps content in project-context tags
    Given the install phase has produced a context string
    When the context is injected into an agent prompt
    Then it should be wrapped in <project-context> tags
    And it should include a header instructing agents not to re-read files or run /install

  # ── 10. TypeScript integrity ──

  @adw-71pdjz-cache-install-contex @regression
  Scenario: TypeScript type-check passes after all changes
    Given the ADW codebase has been modified for issue 253
    When the TypeScript compiler runs with --noEmit
    Then the compilation should succeed with no errors
