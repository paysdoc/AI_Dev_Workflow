# Feature: Implement Scenario Planner Agent

## Metadata
issueNumber: `165`
adwId: `hpq6cn-implement-scenario-p`
issueJson: `{"number":165,"title":"Implement Scenario Planner Agent: generate and maintain BDD scenarios from GitHub issues","body":"## Context\n\nA new Scenario Planner Agent is needed as part of the BDD-first testing strategy. It runs in parallel with the Plan Agent during the planning phase and produces the BDD scenarios that gate both pre-PR testing and the review phase.\n\n## Depends on\n\n- #164 (BDD scenario configuration and tagging conventions)\n\n## Requirements\n\n### Core behaviour\n\n- Reads the GitHub issue\n- Reads existing scenario files in the target repo's scenario directory (from `.adw/scenarios.md`)\n- Creates new scenarios, modifies existing ones, or flags existing ones as relevant — any combination\n- All created/modified/flagged scenarios are tagged `@adw-{issueNumber}`\n- Scenarios from previous issues are **not** in scope for this issue's tag\n\n### Tool and file format detection\n\n- Reads `## Run E2E Tests` from `commands.md` to determine the tool and expected file format\n- If `## Run E2E Tests` is `n/a` or absent:\n  - Bootstrap a Cucumber setup in the target repo (install dependencies, create config)\n  - Write scenarios as Gherkin `.feature` files\n  - Update `commands.md` with the appropriate Cucumber run commands (`## Run E2E Tests`, `## Run Scenarios by Tag`, `## Run Crucial Scenarios`)\n\n### Secondary task: `@crucial` maintenance (runs every time)\n\n- After writing scenarios for the current issue, sweeps **all** existing `@crucial`-tagged scenarios in the repo\n- Re-evaluates whether each `@crucial` designation is still appropriate, based on:\n  - Current `app_docs/` documentation\n  - The new GitHub issue's requirements\n- May promote, demote, or leave tags unchanged\n- Documents any changes to `@crucial` designations in its output\n\n### Integration\n\n- New slash command: `.claude/commands/scenario_writer.md`\n- New agent: `adws/agents/scenarioAgent.ts`\n- New phase function in `adws/phases/`\n- Runs **in parallel** with the Plan Agent — not sequentially after it\n- Outputs: list of scenario file paths and tags applied, plus summary of `@crucial` changes\n\n## Acceptance Criteria\n\n- Agent creates/modifies scenario files in the target repo's configured scenario directory\n- All created/modified/flagged scenarios carry `@adw-{issueNumber}` tag\n- When no E2E tool is configured, Cucumber is bootstrapped and `commands.md` is updated\n- `@crucial` sweep is performed and documented on every run\n- Agent runs in parallel with the Plan Agent in the planning phase","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:01:40Z","comments":[],"actionableComment":null}`

## Feature Description
Implement a new Scenario Planner Agent that generates and maintains BDD scenarios from GitHub issues. The agent reads the GitHub issue, inspects existing scenario files in the target repo's configured scenario directory, and creates/modifies/flags scenarios tagged with `@adw-{issueNumber}`. It also performs a secondary `@crucial` tag maintenance sweep on every run. The agent runs in parallel with the Plan Agent during the planning phase, producing the BDD scenarios that gate both pre-PR testing and the review phase.

## User Story
As a developer using ADW
I want BDD scenarios to be automatically generated from GitHub issues during planning
So that I have executable acceptance criteria ready before implementation begins

## Problem Statement
Currently, the ADW workflow has no automated mechanism to produce BDD scenarios from GitHub issues. Developers must manually write scenarios after planning, creating a gap between issue requirements and testable acceptance criteria. This delays the feedback loop and risks misalignment between what was planned and what gets tested.

## Solution Statement
Introduce a Scenario Planner Agent that runs in parallel with the Plan Agent during the planning phase. The agent reads the issue, reads existing scenarios from the target repo's configured scenario directory, and outputs new/modified scenario files tagged with `@adw-{issueNumber}`. If no E2E tool is configured, it bootstraps Cucumber. It also sweeps `@crucial` tags for ongoing maintenance. The agent is non-fatal (like the KPI phase) so scenario failures don't block the workflow.

## Relevant Files
Use these files to implement the feature:

### Existing Files to Modify
- `adws/types/issueTypes.ts` — Add `'/scenario_writer'` to the `SlashCommand` union type
- `adws/types/agentTypes.ts` — Add `'scenario-agent'` to the `AgentIdentifier` union type
- `adws/core/config.ts` — Add `/scenario_writer` entries to all four command maps (`SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`)
- `adws/agents/index.ts` — Export the new `scenarioAgent` module
- `adws/phases/index.ts` — Export the new `scenarioPhase` module
- `adws/workflowPhases.ts` — Re-export `executeScenarioPhase` from phases
- `adws/adwSdlc.tsx` — Run scenario phase in parallel with plan phase via `Promise.all`
- `adws/adwPlanBuild.tsx` — Run scenario phase in parallel with plan phase
- `adws/adwPlanBuildTest.tsx` — Run scenario phase in parallel with plan phase
- `adws/adwPlanBuildReview.tsx` — Run scenario phase in parallel with plan phase
- `adws/adwPlanBuildDocument.tsx` — Run scenario phase in parallel with plan phase
- `adws/adwPlanBuildTestReview.tsx` — Run scenario phase in parallel with plan phase
- `.adw/conditional_docs.md` — Add entry for scenario agent documentation

### Reference Files (read for patterns, do not modify)
- `adws/agents/kpiAgent.ts` — Reference agent pattern (formatArgs + runAgent functions)
- `adws/phases/kpiPhase.ts` — Reference non-fatal phase pattern (catch errors, log warnings, return zero cost)
- `adws/agents/planAgent.ts` — Reference for how plan agent formats issue args
- `adws/phases/planPhase.ts` — Reference for plan phase execution flow
- `adws/agents/claudeAgent.ts` — Base agent runner (`runClaudeAgentWithCommand`)
- `guidelines/coding_guidelines.md` — Coding guidelines to follow strictly
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Reference for adding new slash command effort/model config (matches condition: adding new slash command)

### New Files
- `.claude/commands/scenario_writer.md` — Slash command prompt template for the scenario writer agent
- `adws/agents/scenarioAgent.ts` — Agent module with `formatScenarioArgs()` and `runScenarioAgent()`
- `adws/phases/scenarioPhase.ts` — Phase function `executeScenarioPhase()` (non-fatal pattern)

## Implementation Plan
### Phase 1: Foundation
Register the new slash command and agent identifier in the type system and configuration maps. This ensures TypeScript compilation succeeds before any implementation code is written.

### Phase 2: Core Implementation
Create the scenario agent module (`scenarioAgent.ts`) following the KPI agent pattern, and the slash command template (`scenario_writer.md`) that defines the agent's prompt. Then create the scenario phase module (`scenarioPhase.ts`) following the KPI phase's non-fatal pattern.

### Phase 3: Integration
Update all orchestrators that include a plan phase to run the scenario phase in parallel with it using `Promise.all`. Update barrel exports and conditional docs.

## Step by Step Tasks

### Step 1: Add `/scenario_writer` to SlashCommand union type
- Open `adws/types/issueTypes.ts`
- Add `| '/scenario_writer'` to the `SlashCommand` type union, under a `// Scenario writing` comment

### Step 2: Add `'scenario-agent'` to AgentIdentifier union type
- Open `adws/types/agentTypes.ts`
- Add `| 'scenario-agent'` to the `AgentIdentifier` type union, under a `// Scenario agent` comment

### Step 3: Add slash command config entries
- Open `adws/core/config.ts`
- Add to `SLASH_COMMAND_MODEL_MAP`: `'/scenario_writer': 'sonnet'`
- Add to `SLASH_COMMAND_MODEL_MAP_FAST`: `'/scenario_writer': 'haiku'`
- Add to `SLASH_COMMAND_EFFORT_MAP`: `'/scenario_writer': 'high'`
- Add to `SLASH_COMMAND_EFFORT_MAP_FAST`: `'/scenario_writer': 'medium'`

### Step 4: Create the slash command template
- Create `.claude/commands/scenario_writer.md`
- The prompt template should instruct the agent to:
  - Accept args: `$1` = issueNumber, `$2` = adwId, `$3` = issueJson (JSON string with issue details)
  - Read `.adw/scenarios.md` from the target repo's working directory for the scenario directory path
  - Read `.adw/commands.md` `## Run E2E Tests` section to detect the E2E tool
  - If `## Run E2E Tests` is `n/a` or absent:
    - Bootstrap Cucumber (install deps, create config)
    - Write scenarios as Gherkin `.feature` files
    - Update `.adw/commands.md` with `## Run E2E Tests`, `## Run Scenarios by Tag`, `## Run Crucial Scenarios` sections
  - Read the GitHub issue from the `$3` JSON arg
  - Read existing scenario files in the scenario directory
  - Create new, modify existing, or flag relevant scenarios — any combination
  - Tag all created/modified/flagged scenarios with `@adw-{issueNumber}`
  - Do NOT tag scenarios from previous issues with this issue's tag
  - After writing scenarios, sweep all `@crucial`-tagged scenarios in the repo
  - Re-evaluate each `@crucial` designation based on `app_docs/` documentation and the issue
  - May promote, demote, or leave `@crucial` tags unchanged
  - Document any `@crucial` changes
  - Output: list of scenario file paths, tags applied, and summary of `@crucial` changes
  - Return ONLY the output summary (no extra prose)

### Step 5: Create the scenario agent module
- Create `adws/agents/scenarioAgent.ts`
- Follow the KPI agent pattern from `adws/agents/kpiAgent.ts`:
  - Import `path`, `log`, `getModelForCommand`, `getEffortForCommand` from `../core`
  - Import `runClaudeAgentWithCommand`, `AgentResult` from `./claudeAgent`
  - Export `formatScenarioArgs(issueNumber: number, adwId: string, issueJson: string): string[]`
    - Returns `[String(issueNumber), adwId, issueJson]` (matches plan agent arg format)
  - Export `runScenarioAgent(issue: GitHubIssue, logsDir: string, statePath?: string, cwd?: string, adwId?: string): Promise<AgentResult>`
    - Build issueJson the same way `runPlanAgent` does (filter ADW comments, extract actionable content, serialize to JSON)
    - Format args via `formatScenarioArgs(issue.number, adwId || 'adw-unknown', issueJson)`
    - Set `outputFile = path.join(logsDir, 'scenario-agent.jsonl')`
    - Log startup info (`Scenario Agent starting:`, ADW ID, Issue number)
    - Call `runClaudeAgentWithCommand('/scenario_writer', args, 'Scenario', outputFile, getModelForCommand('/scenario_writer', issue.body), getEffortForCommand('/scenario_writer', issue.body), undefined, statePath, cwd)`
    - Log completion (`Scenario Agent completed`)
    - Return result

### Step 6: Create the scenario phase module
- Create `adws/phases/scenarioPhase.ts`
- Follow the KPI phase pattern from `adws/phases/kpiPhase.ts`:
  - Import `log`, `AgentStateManager`, `ModelUsageMap`, `emptyModelUsageMap` from `../core`
  - Import `runScenarioAgent` from `../agents`
  - Import `WorkflowConfig` from `./workflowLifecycle`
  - Export `executeScenarioPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }>`
  - Destructure `orchestratorStatePath`, `adwId`, `issueNumber`, `issue`, `worktreePath`, `logsDir` from config
  - Initialize `costUsd = 0`, `modelUsage = emptyModelUsageMap()`
  - Log `'Phase: Scenario Planning'`
  - Wrap in try/catch:
    - Initialize agent state: `AgentStateManager.initializeState(adwId, 'scenario-agent', orchestratorStatePath)`
    - Write running state
    - Call `runScenarioAgent(issue, logsDir, scenarioAgentStatePath, worktreePath, adwId)`
    - Extract cost and model usage from result
    - If `!result.success`: write failed state, log warning, return `{ costUsd, modelUsage }` (non-fatal)
    - If success: write completed state with truncated output, log success
  - Catch block: log `'Scenario phase error (non-fatal)'` at warn level, return `{ costUsd: 0, modelUsage: emptyModelUsageMap() }`
  - Return `{ costUsd, modelUsage }`

### Step 7: Update barrel exports
- In `adws/agents/index.ts`, add:
  ```typescript
  // Scenario Agent
  export {
    runScenarioAgent,
    formatScenarioArgs,
  } from './scenarioAgent';
  ```
- In `adws/phases/index.ts`, add:
  ```typescript
  export { executeScenarioPhase } from './scenarioPhase';
  ```
- In `adws/workflowPhases.ts`, add `executeScenarioPhase` to the re-export from `'./phases'`

### Step 8: Update orchestrators to run scenario phase in parallel with plan phase
- For each orchestrator that calls `executePlanPhase`:
  - Import `executeScenarioPhase` from `'./workflowPhases'`
  - Replace the sequential `const planResult = await executePlanPhase(config);` with:
    ```typescript
    const [planResult, scenarioResult] = await Promise.all([
      executePlanPhase(config),
      executeScenarioPhase(config),
    ]);
    ```
  - After the `Promise.all`, merge scenario cost into totals:
    ```typescript
    totalCostUsd += planResult.costUsd + scenarioResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(
      mergeModelUsageMaps(totalModelUsage, planResult.modelUsage),
      scenarioResult.modelUsage,
    );
    ```
  - The rest of the orchestrator remains unchanged (build, test, etc. follow sequentially)
- Update these files:
  - `adws/adwSdlc.tsx`
  - `adws/adwPlanBuild.tsx`
  - `adws/adwPlanBuildTest.tsx`
  - `adws/adwPlanBuildReview.tsx`
  - `adws/adwPlanBuildDocument.tsx`
  - `adws/adwPlanBuildTestReview.tsx`

### Step 9: Update conditional docs
- Open `.adw/conditional_docs.md`
- Add an entry for the scenario agent documentation (to be generated after implementation):
  ```
  - app_docs/feature-implement-scenario-p-hpq6cn-scenario-planner-agent.md
    - Conditions:
      - When working with BDD scenario generation or the scenario agent
      - When modifying `adws/agents/scenarioAgent.ts` or `adws/phases/scenarioPhase.ts`
      - When working with `.adw/scenarios.md` configuration
      - When adding or modifying `@crucial` tag maintenance logic
  ```

### Step 10: Run validation commands
- Run all validation commands listed below to confirm zero regressions

## Testing Strategy
### Unit Tests
- ADW does not use unit tests per `guidelines/coding_guidelines.md` — BDD scenarios are the validation mechanism
- TypeScript compilation (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`) validates all type additions compile correctly
- Lint validates code quality

### Edge Cases
- Scenario phase failure should not block the workflow (non-fatal pattern)
- Missing `.adw/scenarios.md` in target repo — agent should handle gracefully
- Missing or `n/a` `## Run E2E Tests` in `.adw/commands.md` — triggers Cucumber bootstrap
- No existing scenario files — agent creates new ones from scratch
- Issue with no body — agent handles gracefully via issueJson
- Plan phase failure while scenario phase succeeds — scenario result cost still accumulated but plan failure throws and is caught by orchestrator error handler

## Acceptance Criteria
- `'/scenario_writer'` exists in `SlashCommand` union type
- `'scenario-agent'` exists in `AgentIdentifier` union type
- All four slash command maps in `config.ts` have entries for `'/scenario_writer'`
- `.claude/commands/scenario_writer.md` exists with the complete prompt template
- `adws/agents/scenarioAgent.ts` exports `formatScenarioArgs` and `runScenarioAgent`
- `adws/phases/scenarioPhase.ts` exports `executeScenarioPhase` with non-fatal error handling
- All six orchestrators (`adwSdlc`, `adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildReview`, `adwPlanBuildDocument`, `adwPlanBuildTestReview`) run scenario phase in parallel with plan phase via `Promise.all`
- Barrel exports updated in `agents/index.ts`, `phases/index.ts`, and `workflowPhases.ts`
- All validation commands pass with zero errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW scripts
- `bun run lint` — Run linter to check for code quality issues
- `bun run test` — Run tests to validate zero regressions

## Notes
- **Guidelines compliance**: Implementation must follow `guidelines/coding_guidelines.md` — clarity over cleverness, modularity (files < 300 lines), immutability, type safety, pure functions, no decorators.
- **Non-fatal pattern**: The scenario phase follows the KPI phase pattern — errors are caught and logged at `'warn'` level, never thrown. This ensures scenario failures don't block the workflow.
- **Parallel execution**: The scenario phase runs via `Promise.all` with the plan phase. Since both phases only read `config` (no mutations), they are safe to run concurrently.
- **Depends on #164**: This issue depends on #164 (BDD scenario configuration and tagging conventions). The `.adw/scenarios.md` file referenced by this agent is defined by that issue. If `scenarios.md` does not exist yet, the agent should handle the absence gracefully.
- **Slash command args match plan agent**: The scenario agent uses the same `[issueNumber, adwId, issueJson]` arg pattern as the plan agent for consistency.
- **No new libraries needed**: The implementation uses only existing dependencies (path, fs) and internal modules.
