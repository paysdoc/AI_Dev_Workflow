# Feature: Cache /install context to eliminate redundant agent priming

## Metadata
issueNumber: `253`
adwId: `71pdjz-cache-install-contex`
issueJson: `{"number":253,"title":"Cache /install context to eliminate redundant agent priming","body":"## Problem\n\nThe `/install` command (which chains `/prime`) is embedded in 6 slash commands: `/feature`, `/bug`, `/chore`, `/scenario_writer`, `/pr_review`, and `/generate_step_definitions`. In a full SDLC run, `/install` executes up to 3 times across separate agent processes (plan, scenario, review), each independently discovering the same project structure, reading the same files, and evaluating the same conditional docs. This wastes tokens and increases latency.\n\nA previous attempt (`runPrimedClaudeAgentWithCommand`, issue #189) prepended `/install` to agent prompts within the same CLI invocation, but it was removed as dead code during the cost revamp (#242).\n\n## Solution\n\nIntroduce an **install phase** that runs the `/install` agent once at the start of every orchestrator, caches the raw file contents it read, and injects that cached context into subsequent agent prompts — eliminating redundant priming.\n\n### New Components\n\n- **`installAgent.ts`** — Agent wrapper that spawns a Claude CLI process running `/install` with the issue context and `cwd = worktreePath`\n- **`installPhase.ts`** — Phase that:\n  1. Runs the install agent\n  2. Parses its JSONL `stream-json` output to extract raw file contents from Read/Bash tool use events\n  3. Writes the cache to `agents/{adwId}/install_cache.md`\n  4. Stores the context string on `WorkflowConfig.installContext`\n\n### Modified Components\n\n- **`WorkflowConfig`** (in `workflowInit.ts`) — Add `installContext?: string` field\n- **`runClaudeAgentWithCommand`** (in `claudeAgent.ts`) — Add optional `contextPreamble?: string` parameter; when provided, prepend it to the prompt\n- **6 slash commands** — Remove \"Read and execute .claude/commands/install.md\" from `/feature`, `/bug`, `/chore`, `/scenario_writer`, `/pr_review`, `/generate_step_definitions`\n- **6 agent callers** — Pass `config.installContext` as `contextPreamble` to `runClaudeAgentWithCommand` (in `planAgent.ts`, `scenarioAgent.ts`, and wherever `/pr_review` and `/generate_step_definitions` are invoked)\n- **All orchestrators** — Insert `installPhase` between `initializeWorkflow()` and the first task phase\n\n## Acceptance Criteria\n\n- [ ] `installAgent.ts` exists and spawns a Claude CLI process running `/install`\n- [ ] `installPhase.ts` parses JSONL output, writes `install_cache.md`, populates `WorkflowConfig.installContext`\n- [ ] `runClaudeAgentWithCommand` accepts optional `contextPreamble` parameter\n- [ ] `/install` references removed from all 6 slash commands\n- [ ] All 6 agent callers pass `installContext` as `contextPreamble`\n- [ ] All orchestrators call `installPhase` after `initializeWorkflow` and before the first task phase\n- [ ] On recovery, install agent always re-runs (does not skip based on existing cache)\n- [ ] Existing tests pass","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-21T19:48:53Z","comments":[],"actionableComment":null}`

## Feature Description
Introduce an install phase that runs the `/install` agent once at the start of every orchestrator, caches the raw file contents it read, and injects that cached context into subsequent agent prompts. Currently, `/install` (which chains `/prime`) is embedded in 6 slash commands (`/feature`, `/bug`, `/chore`, `/scenario_writer`, `/pr_review`, `/generate_step_definitions`). In a full SDLC run, `/install` executes up to 3 times across separate agent processes, each independently discovering the same project structure, reading the same files, and evaluating the same conditional docs. This wastes tokens and increases latency.

## User Story
As a workflow orchestrator operator
I want install/prime context cached once and injected into subsequent agents
So that tokens and latency are not wasted on redundant file discovery across plan, scenario, and review phases

## Problem Statement
In a full SDLC run (`adwSdlc.tsx`), the `/install` command executes up to 3 times across separate agent processes (plan, scenario, step-def-gen), each independently reading the same project structure files, running `bun install`, and evaluating conditional docs. This wastes tokens (3x the install cost) and adds latency.

## Solution Statement
Run a single install agent at the start of every orchestrator, parse its JSONL `stream-json` output to extract all file contents it read, write the cache to `agents/{adwId}/install_cache.md`, and prepend the cached context to the prompts of the 6 agents that previously ran `/install` themselves. The 6 slash commands are stripped of their "Read and execute install.md" directives since the context is now injected externally.

## Relevant Files
Use these files to implement the feature:

**Core infrastructure (modify):**
- `adws/agents/claudeAgent.ts` — Add `contextPreamble` parameter to `runClaudeAgentWithCommand()`. Currently at line 83, signature takes: command, args, agentName, outputFile, model, effort, onProgress, statePath, cwd. Append `contextPreamble?: string` at the end.
- `adws/phases/workflowInit.ts` — Add `installContext?: string` field to `WorkflowConfig` interface (currently around line 20).
- `adws/phases/prReviewPhase.ts` — Add `installContext?: string` field to `PRReviewWorkflowConfig` interface (currently at line 24).
- `adws/core/config.ts` — Add `/install` to `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, and `SLASH_COMMAND_EFFORT_MAP_FAST`.

**Agent callers (modify to accept + pass contextPreamble):**
- `adws/agents/planAgent.ts` — `runPlanAgent()` and `runPrReviewPlanAgent()` both call `runClaudeAgentWithCommand` with install-dependent commands (`/feature`, `/bug`, `/chore`, `/pr_review`). Add `contextPreamble` parameter and pass through.
- `adws/agents/scenarioAgent.ts` — `runScenarioAgent()` calls `runClaudeAgentWithCommand('/scenario_writer', ...)`. Add `contextPreamble` parameter and pass through.
- `adws/agents/stepDefAgent.ts` — `runStepDefAgent()` calls `runClaudeAgentWithCommand('/generate_step_definitions', ...)`. Add `contextPreamble` parameter and pass through.

**Phases (modify to pass installContext from config to agent callers):**
- `adws/phases/planPhase.ts` — Pass `config.installContext` to `runPlanAgent()`.
- `adws/phases/scenarioPhase.ts` — Pass `config.installContext` to `runScenarioAgent()`.
- `adws/phases/stepDefPhase.ts` — Pass `config.installContext` to `runStepDefAgent()`.
- `adws/phases/prReviewPhase.ts` — Pass `config.installContext` to `runPrReviewPlanAgent()` in `executePRReviewPlanPhase()`.

**Slash commands (modify to remove /install reference):**
- `.claude/commands/feature.md` — Remove "Read and exectute .claude/commands/install.md" block.
- `.claude/commands/bug.md` — Remove "Read and exectute .claude/commands/install.md" block.
- `.claude/commands/chore.md` — Remove "Read and exectute .claude/commands/install.md" block.
- `.claude/commands/scenario_writer.md` — Remove "Read and exectute .claude/commands/install.md" block.
- `.claude/commands/pr_review.md` — Remove "Read and exectute .claude/commands/install.md" block.
- `.claude/commands/generate_step_definitions.md` — Remove "Read and execute .claude/commands/install.md" block.

**Orchestrators (modify to add install phase):**
- `adws/adwSdlc.tsx` — Add `executeInstallPhase(config)` after `initializeWorkflow()`, before plan+scenario phases.
- `adws/adwPlanBuild.tsx` — Add `executeInstallPhase(config)` after `initializeWorkflow()`, before plan phase.
- `adws/adwPlanBuildTest.tsx` — Add `executeInstallPhase(config)` after `initializeWorkflow()`, before plan phase.
- `adws/adwPlanBuildReview.tsx` — Add `executeInstallPhase(config)` after `initializeWorkflow()`, before plan+scenario phases.
- `adws/adwPlanBuildTestReview.tsx` — Add `executeInstallPhase(config)` after `initializeWorkflow()`, before plan+scenario phases.
- `adws/adwPlanBuildDocument.tsx` — Add `executeInstallPhase(config)` after `initializeWorkflow()`, before plan phase.
- `adws/adwPlan.tsx` — Add `executeInstallPhase(config)` after `initializeWorkflow()`, before plan phase.
- `adws/adwPrReview.tsx` — Add `executeInstallPhase(config)` after `initializePRReviewWorkflow()`, before PR review plan phase. Uses `PRReviewWorkflowConfig`.

**Export barrels (modify to export new module):**
- `adws/agents/index.ts` — Export `runInstallAgent` from new `installAgent.ts`.
- `adws/phases/index.ts` — Export `executeInstallPhase` from new `installPhase.ts`.
- `adws/workflowPhases.ts` — Re-export `executeInstallPhase` for backward compatibility.
- `adws/index.ts` — Re-export `executeInstallPhase`.

**Reference (read-only, for patterns and context):**
- `adws/agents/jsonlParser.ts` — Understand JSONL message types (`ToolUseContentBlock`, `ToolResultContentBlock`) for building the cache extraction parser.
- `adws/agents/agentProcessHandler.ts` — Understand how agent output is processed.
- `adws/agents/stepDefAgent.ts` — Reference for new agent wrapper pattern.
- `adws/phases/stepDefPhase.ts` — Reference for new phase implementation pattern.
- `adws/types/workflowTypes.ts` — WorkflowStage type for adding install stages.
- `.claude/commands/install.md` — The install command that will be run by the new agent.
- `.claude/commands/prime.md` — Chained by install.md; reads README.md, adws/README.md, conditional_docs.md.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Documents how `runClaudeAgentWithCommand` signature was last extended (effort parameter position).

### New Files
- `adws/agents/installAgent.ts` — Agent wrapper that spawns Claude CLI running `/install` with issue context and `cwd = worktreePath`. Returns `AgentResult`.
- `adws/phases/installPhase.ts` — Phase that runs the install agent, parses JSONL output to extract file contents, writes `agents/{adwId}/install_cache.md`, and sets `config.installContext`.

## Implementation Plan
### Phase 1: Foundation
Extend the core infrastructure to support context preamble injection:
1. Add `contextPreamble?: string` parameter to `runClaudeAgentWithCommand()` in `claudeAgent.ts`. When provided, prepend it to the prompt before the slash command.
2. Add `installContext?: string` field to `WorkflowConfig` in `workflowInit.ts`.
3. Add `installContext?: string` field to `PRReviewWorkflowConfig` in `prReviewPhase.ts`.
4. Add `/install` to model and effort maps in `config.ts`.
5. Add install-related stages to `WorkflowStage` in `workflowTypes.ts`.

### Phase 2: Core Implementation
Create the install agent and install phase:
1. Create `installAgent.ts` following the `stepDefAgent.ts` pattern — accepts issue context, spawns `/install` agent with `cwd = worktreePath`, returns `AgentResult`.
2. Create `installPhase.ts` following the `stepDefPhase.ts` pattern — runs install agent, reads the JSONL output file, parses it to extract file contents from Read and Bash tool results, writes `agents/{adwId}/install_cache.md`, populates `config.installContext` with the formatted context string.
3. JSONL content extraction: parse the raw JSONL output file after the install agent completes. For each assistant message containing `tool_use` blocks with `name === 'Read'`, capture the `input.file_path`. For `name === 'Bash'`, capture `input.command`. Match these to subsequent `tool_result` messages by `tool_use_id` to get the actual content. Build a formatted markdown document with all extracted file contents.

### Phase 3: Integration
Wire the install phase into the existing workflow:
1. Update 4 agent callers (`planAgent.ts`, `scenarioAgent.ts`, `stepDefAgent.ts`, `prReviewPhase.ts` via `runPrReviewPlanAgent`) to accept and pass `contextPreamble` to `runClaudeAgentWithCommand`.
2. Update 4 phases (`planPhase.ts`, `scenarioPhase.ts`, `stepDefPhase.ts`, `prReviewPhase.ts`) to read `config.installContext` and pass as `contextPreamble` to their agent callers.
3. Remove "Read and execute .claude/commands/install.md" from all 6 slash commands.
4. Add `executeInstallPhase(config)` to all 8 orchestrators between initialization and the first task phase.
5. Update export barrels (`agents/index.ts`, `phases/index.ts`, `workflowPhases.ts`, `adws/index.ts`).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `contextPreamble` parameter to `runClaudeAgentWithCommand`
- Open `adws/agents/claudeAgent.ts`
- Add `contextPreamble?: string` as the last parameter of `runClaudeAgentWithCommand()`
- When `contextPreamble` is provided, prepend it to the prompt: `const prompt = contextPreamble ? \`${contextPreamble}\n\n${command} ${quotedArgs}\` : \`${command} ${quotedArgs}\``
- Log when context preamble is being used: `if (contextPreamble) log(\`  Context preamble: ${contextPreamble.length} chars\`, 'info')`
- Save the full prompt (including preamble) via `savePrompt()`

### Step 2: Add `installContext` to WorkflowConfig and PRReviewWorkflowConfig
- Open `adws/phases/workflowInit.ts` — add `installContext?: string` to `WorkflowConfig` interface
- Open `adws/phases/prReviewPhase.ts` — add `installContext?: string` to `PRReviewWorkflowConfig` interface
- Open `adws/types/workflowTypes.ts` — add `'install_running' | 'install_completed' | 'install_failed'` to `WorkflowStage` union type

### Step 3: Add `/install` to model and effort maps
- Open `adws/core/config.ts`
- Add `'/install': 'sonnet'` to `SLASH_COMMAND_MODEL_MAP`
- Add `'/install': 'sonnet'` to `SLASH_COMMAND_MODEL_MAP_FAST`
- Add `'/install': 'medium'` to `SLASH_COMMAND_EFFORT_MAP`
- Add `'/install': 'low'` to `SLASH_COMMAND_EFFORT_MAP_FAST`

### Step 4: Create `installAgent.ts`
- Create `adws/agents/installAgent.ts`
- Follow `stepDefAgent.ts` pattern
- Export `runInstallAgent(issueNumber, adwId, logsDir, statePath?, cwd?, issueBody?): Promise<AgentResult>`
- Build args as `[String(issueNumber), adwId]` (install command doesn't need full issueJson, just issue context for conditional docs)
- Output file: `path.join(logsDir, 'install-agent.jsonl')`
- Call `runClaudeAgentWithCommand('/install', args, 'Install', outputFile, getModelForCommand('/install', issueBody), getEffortForCommand('/install', issueBody), undefined, statePath, cwd)`
- Return the `AgentResult`

### Step 5: Create `installPhase.ts`
- Create `adws/phases/installPhase.ts`
- Follow `stepDefPhase.ts` non-fatal pattern (try-catch, errors logged but not thrown)
- Export `executeInstallPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>`
- Implementation flow:
  1. Initialize agent state: `AgentStateManager.initializeState(adwId, 'install-agent', orchestratorStatePath)`
  2. Run install agent: `await runInstallAgent(issueNumber, adwId, logsDir, installAgentStatePath, worktreePath, issue.body)`
  3. On failure: log warning, return empty results (non-fatal — downstream agents can still run /install themselves if context is missing)
  4. On success: read the JSONL output file at `path.join(logsDir, 'install-agent.jsonl')`
  5. Parse JSONL to extract file contents using `extractInstallContext()` helper
  6. Write cache to `agents/{adwId}/install_cache.md`
  7. Set `config.installContext` to the formatted context string
  8. Return cost records

- Implement `extractInstallContext(jsonlPath: string): string` helper:
  1. Read the JSONL file line by line
  2. Parse each line as JSON
  3. For assistant messages: find `tool_use` blocks, track `{id, name, input}` in a Map keyed by `id`
  4. For tool_result messages: look up the corresponding `tool_use` by `tool_use_id`, extract content
  5. For Read tool results: format as `## File: {file_path}\n\`\`\`\n{content}\n\`\`\``
  6. For Bash tool results: format as `## Command: {command}\n\`\`\`\n{output}\n\`\`\``
  7. Skip tool results that are errors (`is_error: true`)
  8. Wrap everything in the preamble format:
     ```
     The following project context has been pre-loaded. Use it as your understanding of the codebase. Do not re-read these files or run /install.

     <project-context>
     {extracted file contents}
     </project-context>
     ```
  9. Return the full context string

### Step 6: Update export barrels
- `adws/agents/index.ts` — Add `export { runInstallAgent } from './installAgent'`
- `adws/phases/index.ts` — Add `export { executeInstallPhase } from './installPhase'`
- `adws/workflowPhases.ts` — Add `executeInstallPhase` to the re-export list
- `adws/index.ts` — Add `executeInstallPhase` to the phases re-export block

### Step 7: Update agent callers to accept contextPreamble
- **`adws/agents/planAgent.ts`**:
  - Add `contextPreamble?: string` as last parameter to `runPlanAgent()`
  - Pass it as the last arg to `runClaudeAgentWithCommand(issueType, args, 'Plan', outputFile, model, effort, undefined, statePath, cwd, contextPreamble)`
  - Add `contextPreamble?: string` as last parameter to `runPrReviewPlanAgent()`
  - Pass it as the last arg to `runClaudeAgentWithCommand('/pr_review', args, 'PR Review Plan', outputFile, model, effort, undefined, statePath, cwd, contextPreamble)`
- **`adws/agents/scenarioAgent.ts`**:
  - Add `contextPreamble?: string` as last parameter to `runScenarioAgent()`
  - Pass it as the last arg to `runClaudeAgentWithCommand('/scenario_writer', args, 'Scenario', outputFile, model, effort, undefined, statePath, cwd, contextPreamble)`
- **`adws/agents/stepDefAgent.ts`**:
  - Add `contextPreamble?: string` as last parameter to `runStepDefAgent()`
  - Pass it as the last arg to `runClaudeAgentWithCommand('/generate_step_definitions', args, 'StepDef', outputFile, model, effort, undefined, statePath, cwd, contextPreamble)`

### Step 8: Update phases to pass installContext to agents
- **`adws/phases/planPhase.ts`**: Pass `config.installContext` as `contextPreamble` to `runPlanAgent()`
- **`adws/phases/scenarioPhase.ts`**: Pass `config.installContext` as `contextPreamble` to `runScenarioAgent()`
- **`adws/phases/stepDefPhase.ts`**: Pass `config.installContext` as `contextPreamble` to `runStepDefAgent()`
- **`adws/phases/prReviewPhase.ts`**: In `executePRReviewPlanPhase()`, pass `config.installContext` as `contextPreamble` to `runPrReviewPlanAgent()`

### Step 9: Remove /install references from 6 slash commands
- **`.claude/commands/feature.md`**: Remove the "Before you do anything else" section that reads and executes `.claude/commands/install.md`
- **`.claude/commands/bug.md`**: Remove the same section
- **`.claude/commands/chore.md`**: Remove the same section
- **`.claude/commands/scenario_writer.md`**: Remove the same section
- **`.claude/commands/pr_review.md`**: Remove the same section
- **`.claude/commands/generate_step_definitions.md`**: Remove the same section

### Step 10: Add install phase to all orchestrators
For each orchestrator, add `executeInstallPhase(config)` between `initializeWorkflow()` and the first task phase. Aggregate cost and model usage into the total.

- **`adws/adwSdlc.tsx`**: After `initializeWorkflow()`, before plan+scenario parallel phase. Add install phase call, accumulate `costUsd` and `modelUsage`, collect `phaseCostRecords`.
- **`adws/adwPlanBuild.tsx`**: After `initializeWorkflow()`, before plan phase.
- **`adws/adwPlanBuildTest.tsx`**: After `initializeWorkflow()`, before plan phase.
- **`adws/adwPlanBuildReview.tsx`**: After `initializeWorkflow()`, before plan+scenario parallel phase.
- **`adws/adwPlanBuildTestReview.tsx`**: After `initializeWorkflow()`, before plan+scenario parallel phase.
- **`adws/adwPlanBuildDocument.tsx`**: After `initializeWorkflow()`, before plan phase.
- **`adws/adwPlan.tsx`**: After `initializeWorkflow()`, before plan phase.
- **`adws/adwPrReview.tsx`**: After `initializePRReviewWorkflow()`, before PR review plan phase. Note: this orchestrator uses `PRReviewWorkflowConfig`, not `WorkflowConfig`. Create a standalone install agent run (call `runInstallAgent` directly, parse JSONL, set `config.installContext`) since the install phase function expects `WorkflowConfig`.

### Step 11: Validate
- Run `bun run lint` to check for code quality issues
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws-specific TypeScript compilation
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run` to verify BDD step definitions still parse correctly

## Testing Strategy
### Edge Cases
- Install agent fails (network issue, CLI not found): phase returns empty results, downstream agents receive no context preamble and can still function (they just won't have pre-loaded context — the slash commands no longer have `/install`, so agents will operate without install context)
- JSONL output is empty or malformed: `extractInstallContext()` returns empty string, `installContext` is empty, preamble is not prepended
- Very large JSONL output (many files read): context string could be very large. No truncation needed since Claude CLI handles context window limits
- Recovery scenario: install agent always re-runs per design decision (repo contents may have changed)
- PR review orchestrator uses `PRReviewWorkflowConfig` instead of `WorkflowConfig`: handle separately with direct agent call in `adwPrReview.tsx`

## Acceptance Criteria
- [ ] `adws/agents/installAgent.ts` exists and exports `runInstallAgent()` that spawns a Claude CLI process running `/install`
- [ ] `adws/phases/installPhase.ts` exists and exports `executeInstallPhase()` that parses JSONL output, writes `agents/{adwId}/install_cache.md`, and populates `config.installContext`
- [ ] `runClaudeAgentWithCommand()` accepts optional `contextPreamble?: string` parameter and prepends it to the prompt when provided
- [ ] `/install` references removed from all 6 slash commands: `/feature`, `/bug`, `/chore`, `/scenario_writer`, `/pr_review`, `/generate_step_definitions`
- [ ] All 4 agent callers (`runPlanAgent`, `runScenarioAgent`, `runStepDefAgent`, `runPrReviewPlanAgent`) accept and pass `contextPreamble`
- [ ] All 4 phases (`planPhase`, `scenarioPhase`, `stepDefPhase`, `prReviewPhase`) pass `config.installContext` as `contextPreamble`
- [ ] All 8 orchestrators call install phase/agent after initialization and before the first task phase
- [ ] On recovery, install agent always re-runs (no skip based on existing cache)
- [ ] `/install` is registered in all 4 model/effort maps in `config.ts`
- [ ] Install stages added to `WorkflowStage` type
- [ ] Export barrels updated (`agents/index.ts`, `phases/index.ts`, `workflowPhases.ts`, `adws/index.ts`)
- [ ] `bun run lint` passes
- [ ] `bun run build` passes
- [ ] `bunx tsc --noEmit` passes
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run` — Verify BDD step definitions still parse

## Notes
- **No unit tests**: Per `.adw/project.md`, unit tests are disabled for this project. BDD scenarios are the validation mechanism.
- **Non-fatal install phase**: The install phase follows the `stepDefPhase.ts` pattern — errors are caught and logged but do not block the workflow. If install fails, downstream agents simply don't receive pre-loaded context. This is a deliberate graceful degradation: the agents will function without context (albeit without the optimization).
- **JSONL message format**: The Claude CLI `--output-format stream-json` emits JSONL where each line is a JSON object. Assistant messages contain `content` arrays with `ToolUseContentBlock` (`{type: 'tool_use', id, name, input}`) entries. Tool results appear as separate messages with `ToolResultContentBlock` (`{type: 'tool_result', tool_use_id, content}`). The extraction logic must correlate `tool_use.id` with `tool_result.tool_use_id` to pair file paths with their contents.
- **PR review orchestrator**: `adwPrReview.tsx` uses `PRReviewWorkflowConfig` (not `WorkflowConfig`), so the install phase integration requires a slightly different approach — call the install agent directly and parse the output inline, then set `config.installContext`.
- **Existing slashCommandModelMap tests**: The test file `adws/__tests__/slashCommandModelMap.test.ts` likely checks map sizes. Adding `/install` to the maps will require updating the expected count in those tests.
- **Coding guidelines compliance**: All new code follows the project's coding guidelines: strict TypeScript, no `any`, pure functions for parsing logic, side effects isolated at boundaries, files under 300 lines.
