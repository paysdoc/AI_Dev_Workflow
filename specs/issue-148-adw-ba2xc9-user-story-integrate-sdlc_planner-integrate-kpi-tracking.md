# Feature: Integrate Agentic KPI Tracking into ADW Workflow

## Metadata
issueNumber: `148`
adwId: `ba2xc9-user-story-integrate`
issueJson: `{"number":148,"title":"User Story: Integrate Agentic KPI Tracking into ADW Workflow","body":"## Summary\n\nAs an ADW operator, I want the workflow to automatically track agentic KPIs after each run so that I can monitor ADW performance over time without manual intervention.\n\n## Context\n\nThe `/track_agentic_kpis` slash command (`.claude/commands/track_agentic_kpis.md`) already exists and can update `app_docs/agentic_kpis.md` with per-run metrics. However, it is not wired into the automated workflow pipeline and contains hardcoded Python references that should be replaced with project-agnostic runtime resolution.\n\n## Requirements\n\n### 1. Generify the slash command\n\n**File:** `.claude/commands/track_agentic_kpis.md`\n\n- Add a **Setup** section that reads `.adw/commands.md` and extracts the **Package Manager** value (e.g., `bun`, `node`, `python3`). Fall back to `node` if `.adw/commands.md` is absent.\n- Replace all `python -c \"print(...)\"` references with `{package_manager} -e \"console.log(...)\"` using JavaScript syntax for the inline expressions.\n- Replace the preamble sentence referencing Python with a reference to the project runtime.\n- Add `worktree_path` to the state_json schema so the command can run `git -C <worktree_path> diff origin/main --shortstat` when operating on a target repo.\n\n### 2. Add `/track_agentic_kpis` to type system\n\n**File:** `adws/types/issueTypes.ts`\n\n- Add `'/track_agentic_kpis'` to the `SlashCommand` union type (alongside the existing `/commit_cost` cost-tracking entry).\n\n### 3. Add `'kpi-agent'` to agent identifiers\n\n**File:** `adws/types/agentTypes.ts`\n\n- Add `'kpi-agent'` to the `AgentIdentifier` union type.\n\n### 4. Add model and effort mappings\n\n**File:** `adws/core/config.ts`\n\n- `SLASH_COMMAND_MODEL_MAP`: `/track_agentic_kpis` → `'haiku'` (lightweight, structured task).\n- `SLASH_COMMAND_MODEL_MAP_FAST`: `/track_agentic_kpis` → `'haiku'`.\n- `SLASH_COMMAND_EFFORT_MAP`: `/track_agentic_kpis` → `'medium'`.\n- `SLASH_COMMAND_EFFORT_MAP_FAST`: `/track_agentic_kpis` → `'low'`.\n\n### 5. Create KPI agent\n\n**New file:** `adws/agents/kpiAgent.ts`\n\nFollow the `documentAgent.ts` pattern:\n\n- `formatKpiArgs(adwId, issueNumber, issueClass, planFile, allAdws, worktreePath)` — builds a JSON string containing `{ adw_id, issue_number, issue_class, plan_file, all_adws, worktree_path }`.\n- `runKpiAgent(adwId, logsDir, issueNumber, issueClass, planFile, allAdws, statePath?, worktreePath?, issueBody?)` — invokes `/track_agentic_kpis` via `runClaudeAgentWithCommand`, passing the JSON as a single string argument. CWD should be `undefined` (ADW project root, not the worktree) so the agent writes `app_docs/agentic_kpis.md` to the ADW repo.\n\n**Export from:** `adws/agents/index.ts`\n\n### 6. Create KPI phase\n\n**New file:** `adws/phases/kpiPhase.ts`\n\nFollow the `documentPhase.ts` pattern:\n\n- `executeKpiPhase(config: WorkflowConfig, reviewRetries?: number)` → `{ costUsd, modelUsage }`.\n- Initialize agent state under `agents/{adwId}/kpi-agent/`.\n- Build the `all_adws` list: always include `'adw_plan_iso'`; append `'adw_patch_iso'` once for each review retry.\n- Derive `planFile` from `getPlanFilePath(issueNumber, worktreePath)`.\n- **Non-fatal:** catch errors and log them rather than throwing — KPI tracking failure must not block workflow completion.\n- No git commit or push — the KPI file lives in the ADW repo and will be committed separately.\n\n**Export from:** `adws/phases/index.ts` and `adws/workflowPhases.ts`\n\n### 7. Integrate into SDLC orchestrator\n\n**File:** `adws/adwSdlc.tsx`\n\n- Import `executeKpiPhase`.\n- Chain it **after** the document phase and **before** `completeWorkflow`.\n- Accumulate `costUsd` and `modelUsage` and call `persistTokenCounts` as with every other phase.\n- Pass `reviewResult.totalRetries` as the `reviewRetries` argument.\n- Update the file header comment to include the new step (step 8: KPI tracking, step 9: finalize).\n\n## Acceptance Criteria\n\n- [ ] `/track_agentic_kpis` command contains no Python references; all calculation examples use `{package_manager} -e \"console.log(...)\"` with JS syntax.\n- [ ] Running `bunx tsc --noEmit -p adws/tsconfig.json` passes with the new `SlashCommand` and `AgentIdentifier` entries.\n- [ ] `bun run test` passes (existing tests unbroken).\n- [ ] The SDLC orchestrator (`adwSdlc.tsx`) invokes KPI tracking after documentation and before workflow completion.\n- [ ] KPI tracking failure does not prevent workflow completion.\n- [ ] `app_docs/agentic_kpis.md` is created/updated when the SDLC orchestrator runs end-to-end.\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T18:57:02Z","comments":[],"actionableComment":null}`

## Feature Description
This feature integrates the existing `/track_agentic_kpis` slash command into the automated ADW SDLC workflow pipeline. Currently, the command exists as a standalone tool but is not invoked during workflow execution. The integration involves: (1) generifying the command to remove hardcoded Python references and use the project's configured package manager, (2) registering the new command and agent in the ADW type system, (3) creating a dedicated KPI agent and phase following established patterns, and (4) wiring the KPI phase into the SDLC orchestrator so it runs automatically after every workflow execution.

## User Story
As an ADW operator
I want the workflow to automatically track agentic KPIs after each run
So that I can monitor ADW performance over time without manual intervention

## Problem Statement
The `/track_agentic_kpis` slash command exists and can update `app_docs/agentic_kpis.md` with per-run metrics, but it is not wired into the automated workflow pipeline. Additionally, it contains hardcoded Python references (`python -c "print(...)"`) that should be replaced with project-agnostic runtime resolution. This means KPI tracking requires manual invocation and breaks on projects that don't have Python installed.

## Solution Statement
Wire the KPI tracking command into the SDLC orchestrator by following the established agent/phase pattern (mirroring `documentAgent.ts` and `documentPhase.ts`). Generify the slash command to use the project's configured package manager instead of hardcoded Python. Make the KPI phase non-fatal so tracking failures never block workflow completion.

## Relevant Files
Use these files to implement the feature:

### Existing Files to Modify

- `.claude/commands/track_agentic_kpis.md` — The slash command template. Needs Python references replaced with `{package_manager}` JS equivalents, a Setup section for runtime resolution, and `worktree_path` added to the state_json schema.
- `adws/types/issueTypes.ts` — Contains the `SlashCommand` union type. Add `'/track_agentic_kpis'` entry (line 122-149).
- `adws/types/agentTypes.ts` — Contains the `AgentIdentifier` union type. Add `'kpi-agent'` entry (line 74-96).
- `adws/core/config.ts` — Contains model/effort maps. Add `/track_agentic_kpis` entries to all four maps: `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST` (lines 159-300).
- `adws/agents/index.ts` — Barrel export for agents. Add KPI agent exports (line 94-99 area).
- `adws/phases/index.ts` — Barrel export for phases. Add KPI phase export (line 19 area).
- `adws/workflowPhases.ts` — Top-level barrel re-export. Add `executeKpiPhase` (line 12-32).
- `adws/adwSdlc.tsx` — SDLC orchestrator. Import and chain `executeKpiPhase` after document phase, before `completeWorkflow` (lines 100-113).

### Pattern Reference Files (read-only)

- `adws/agents/documentAgent.ts` — Pattern to follow for `kpiAgent.ts`. Shows `formatDocumentArgs`, `runDocumentAgent`, and how to call `runClaudeAgentWithCommand`.
- `adws/phases/documentPhase.ts` — Pattern to follow for `kpiPhase.ts`. Shows `executeDocumentPhase`, agent state initialization, error handling, and return shape.
- `adws/agents/claudeAgent.ts` — Base agent runner. `runClaudeAgentWithCommand` signature: `(command, args, agentName, outputFile, model, effort, onProgress?, statePath?, cwd?)`.
- `adws/phases/__tests__/helpers/makeRepoContext.ts` — Test helper for mock `RepoContext`.

### Test Reference Files (read-only)

- `adws/agents/__tests__/documentAgent.test.ts` — Pattern for KPI agent unit tests (mock `runClaudeAgentWithCommand` and `../../core`).
- `adws/phases/__tests__/documentPhase.test.ts` — Pattern for KPI phase unit tests (mock agents, core, vcs; use `makeRepoContext` helper).
- `adws/core/__tests__/slashCommandModelMap.test.ts` — Tests for model/effort maps. Must be updated to cover the new `/track_agentic_kpis` entries (currently expects 19 entries per map, will become 20).

### Conditional Documentation (read for context)

- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Documents how reasoning effort was added per slash command. The `effort` parameter is inserted between `model` and `onProgress` in `runClaudeAgentWithCommand`. When `effort` is `undefined`, no `--effort` flag is added.

### Guidelines

- `guidelines/coding_guidelines.md` — Coding guidelines to follow: clarity over cleverness, modularity, immutability, type safety, functional style.

### New Files

- `adws/agents/kpiAgent.ts` — New KPI agent module following `documentAgent.ts` pattern.
- `adws/agents/__tests__/kpiAgent.test.ts` — Unit tests for KPI agent.
- `adws/phases/kpiPhase.ts` — New KPI phase module following `documentPhase.ts` pattern.
- `adws/phases/__tests__/kpiPhase.test.ts` — Unit tests for KPI phase.

## Implementation Plan
### Phase 1: Foundation — Type System & Configuration
Register the new slash command and agent identifier in the type system, then add model/effort mappings. This ensures TypeScript compilation passes before writing any runtime code.

### Phase 2: Core Implementation — Slash Command, Agent & Phase
Generify the `/track_agentic_kpis` slash command by removing Python references. Create the `kpiAgent.ts` and `kpiPhase.ts` modules following the `documentAgent`/`documentPhase` patterns. Write unit tests for both.

### Phase 3: Integration — Wire into SDLC Orchestrator
Import and chain the KPI phase into `adwSdlc.tsx` after the document phase and before `completeWorkflow`. Update barrel exports. Update existing tests to account for the new map entries.

## Step by Step Tasks

### Step 1: Add `/track_agentic_kpis` to the `SlashCommand` union type

- Open `adws/types/issueTypes.ts`
- Add `'/track_agentic_kpis'` to the `SlashCommand` union type, grouped with the existing `// Cost tracking` section (after `'/commit_cost'`):
  ```typescript
  // Cost tracking
  | '/commit_cost'
  // KPI tracking
  | '/track_agentic_kpis'
  ```

### Step 2: Add `'kpi-agent'` to the `AgentIdentifier` union type

- Open `adws/types/agentTypes.ts`
- Add `'kpi-agent'` to the `AgentIdentifier` union type, grouped after the `// PR and document agents` section:
  ```typescript
  // PR and document agents
  | 'pr-agent'
  | 'document-agent'
  // KPI tracking agent
  | 'kpi-agent';
  ```

### Step 3: Add model and effort mappings for `/track_agentic_kpis`

- Open `adws/core/config.ts`
- Add to `SLASH_COMMAND_MODEL_MAP` (after `/commit_cost` entry):
  ```typescript
  // KPI tracking
  '/track_agentic_kpis': 'haiku',
  ```
- Add to `SLASH_COMMAND_MODEL_MAP_FAST` (after `/commit_cost` entry):
  ```typescript
  '/track_agentic_kpis': 'haiku',
  ```
- Add to `SLASH_COMMAND_EFFORT_MAP` (after `/commit_cost` entry):
  ```typescript
  '/track_agentic_kpis': 'medium',
  ```
- Add to `SLASH_COMMAND_EFFORT_MAP_FAST` (after `/commit_cost` entry):
  ```typescript
  '/track_agentic_kpis': 'low',
  ```

### Step 4: Update slash command model/effort map tests

- Open `adws/core/__tests__/slashCommandModelMap.test.ts`
- Update all four `has exactly N entries` assertions from `19` to `20`
- Add assertion for `/track_agentic_kpis` in each map's value test:
  - `SLASH_COMMAND_MODEL_MAP['/track_agentic_kpis']` → `'haiku'`
  - `SLASH_COMMAND_MODEL_MAP_FAST['/track_agentic_kpis']` → `'haiku'`
  - `SLASH_COMMAND_EFFORT_MAP['/track_agentic_kpis']` → `'medium'`
  - `SLASH_COMMAND_EFFORT_MAP_FAST['/track_agentic_kpis']` → `'low'`

### Step 5: Generify the `/track_agentic_kpis` slash command

- Open `.claude/commands/track_agentic_kpis.md`
- Add a **Setup** section after `## Variables` and before `## Instructions`:
  ```markdown
  ## Setup
  - Read `.adw/commands.md` and extract the **Package Manager** value (the line after `## Package Manager`).
  - If `.adw/commands.md` does not exist or the value is missing, fall back to `node`.
  - Store the resolved value as `{package_manager}` for use in all inline calculation commands below.
  ```
- Add `worktree_path` to the state_json schema in `### 1. Parse State Data`:
  ```markdown
  - worktree_path (optional, for target repo diff)
  ```
- Replace the preamble sentence "Use the python commands as suggestions and guides for how to calculate the values. Ultimately, do whatever python calculation you need to do to get the values." with: "Use the `{package_manager} -e` commands as suggestions and guides for how to calculate the values. Ultimately, do whatever calculation you need to do to get the values."
- Replace all `python -c "print(...)"` references with `{package_manager} -e "console.log(...)"` using JavaScript syntax:
  - Section "Calculate Attempts": Replace `python -c "all_adws = <list>; attempts = sum(1 for w in all_adws if any(adw in w for adw in attempts_incrementing_adws)); print(attempts)"` with `{package_manager} -e "const allAdws = <list>; const incr = ['adw_plan_iso','adw_patch_iso']; console.log(allAdws.filter(w => incr.some(a => w.includes(a))).length)"`
  - Section "Calculate Diff Statistics": Update the git diff command to support worktree_path:
    - If `worktree_path` is present in state_json, use `git -C <worktree_path> diff origin/main --shortstat`
    - Otherwise use the existing `git diff origin/main --shortstat`
  - Section "Current Streak": Replace `python -c "attempts_list = <list>; streak = 0; ..."` with `{package_manager} -e "const a = <list>; let s = 0; for (let i = a.length - 1; i >= 0; i--) { if (a[i] <= 2) s++; else break; } console.log(s)"`
  - Section "Total Plan Size": Replace `python -c "sizes = <list>; print(sum(sizes))"` with `{package_manager} -e "const s = <list>; console.log(s.reduce((a,b) => a+b, 0))"`
  - Section "Largest Plan Size": Replace `python -c "sizes = <list>; print(max(sizes) if sizes else 0)"` with `{package_manager} -e "const s = <list>; console.log(s.length ? Math.max(...s) : 0)"`
  - Section "Average Presence": Replace `python -c "attempts = <list>; print(sum(attempts) / len(attempts) if attempts else 0)"` with `{package_manager} -e "const a = <list>; console.log(a.length ? (a.reduce((x,y) => x+y, 0) / a.length).toFixed(2) : 0)"`
  - Replace all remaining references to "Python" (as a language name) with "the project runtime" or remove them
  - In section "5. Calculate Agentic KPIs", replace `IMPORTANT: All calculations must be done using Python expressions. Use \`python -c "print(expression)"\` for every numeric calculation.` with `IMPORTANT: All calculations must be done using inline expressions. Use \`{package_manager} -e "console.log(expression)"\` for every numeric calculation.`
  - Replace "Longest Streak" instruction `Use Python to calculate` with `Use {package_manager} -e to calculate`
  - Replace "Total Diff Size" instruction `Parse each diff entry and sum using Python` with `Parse each diff entry and sum using {package_manager} -e`
  - Replace "Largest Diff Size" instruction `Use Python to calculate` with `Use {package_manager} -e to calculate`

### Step 6: Create KPI agent (`adws/agents/kpiAgent.ts`)

- Create new file `adws/agents/kpiAgent.ts` following the `documentAgent.ts` pattern
- Implement `formatKpiArgs(adwId, issueNumber, issueClass, planFile, allAdws, worktreePath)`:
  - Returns a single-element string array containing a JSON string: `[JSON.stringify({ adw_id: adwId, issue_number: issueNumber, issue_class: issueClass, plan_file: planFile, all_adws: allAdws, worktree_path: worktreePath })]`
- Implement `runKpiAgent(adwId, logsDir, issueNumber, issueClass, planFile, allAdws, statePath?, worktreePath?, issueBody?)`:
  - Build args via `formatKpiArgs`
  - Set `outputFile = path.join(logsDir, 'kpi-agent.jsonl')`
  - Log agent start info (ADW ID, issue number)
  - Call `runClaudeAgentWithCommand('/track_agentic_kpis', args, 'KPI', outputFile, getModelForCommand('/track_agentic_kpis', issueBody), getEffortForCommand('/track_agentic_kpis', issueBody), undefined, statePath, undefined)` — CWD is `undefined` so it runs from the ADW project root
  - Log completion and return `AgentResult`
- Import `log`, `getModelForCommand`, `getEffortForCommand` from `'../core'`
- Import `runClaudeAgentWithCommand`, `AgentResult` from `'./claudeAgent'`

### Step 7: Export KPI agent from barrel

- Open `adws/agents/index.ts`
- Add KPI agent exports after the Document Agent section:
  ```typescript
  // KPI Agent
  export {
    runKpiAgent,
    formatKpiArgs,
  } from './kpiAgent';
  ```

### Step 8: Create KPI agent tests (`adws/agents/__tests__/kpiAgent.test.ts`)

- Create new file `adws/agents/__tests__/kpiAgent.test.ts` following `documentAgent.test.ts` pattern
- Mock `../claudeAgent` with `runClaudeAgentWithCommand` returning `{ success: true, output: 'Updated app_docs/agentic_kpis.md', totalCostUsd: 0.05 }`
- Mock `../../core` with `log`, `getModelForCommand` → `'haiku'`, `getEffortForCommand` → `'medium'`
- Test `formatKpiArgs`:
  - Returns single-element array with valid JSON string
  - JSON contains all expected keys (`adw_id`, `issue_number`, `issue_class`, `plan_file`, `all_adws`, `worktree_path`)
  - Handles undefined `worktreePath` (should be `undefined` in JSON)
- Test `runKpiAgent`:
  - Calls `runClaudeAgentWithCommand` with `/track_agentic_kpis` command
  - Passes KPI args as JSON string in array
  - Sets output file to `kpi-agent.jsonl` in logsDir
  - Passes `undefined` as CWD (9th argument)
  - Passes `statePath` as 8th argument when provided
  - Passes `issueBody` to `getModelForCommand` and `getEffortForCommand`
  - Returns the agent result

### Step 9: Create KPI phase (`adws/phases/kpiPhase.ts`)

- Create new file `adws/phases/kpiPhase.ts` following `documentPhase.ts` pattern
- Import from `'../core'`: `log`, `AgentStateManager`, `ModelUsageMap`, `emptyModelUsageMap`
- Import from `'../agents'`: `getPlanFilePath`, `runKpiAgent`
- Import `WorkflowConfig` from `'./workflowLifecycle'`
- Implement `executeKpiPhase(config: WorkflowConfig, reviewRetries?: number)`:
  - Destructure from config: `orchestratorStatePath`, `adwId`, `issueNumber`, `issueType`, `issue`, `worktreePath`, `logsDir`
  - Initialize `costUsd = 0` and `modelUsage = emptyModelUsageMap()`
  - Log `'Phase: KPI Tracking'`
  - Append log to orchestrator state: `'Starting KPI tracking phase'`
  - **Wrap entire body in try/catch** — on error, log error and return `{ costUsd: 0, modelUsage: emptyModelUsageMap() }` (non-fatal)
  - Initialize agent state: `AgentStateManager.initializeState(adwId, 'kpi-agent', orchestratorStatePath)`
  - Write initial agent state with `agentName: 'kpi-agent'` and execution status `'running'`
  - Build `allAdws` list: start with `['adw_plan_iso']`; append `'adw_patch_iso'` for each review retry (`for (let i = 0; i < (reviewRetries ?? 0); i++) allAdws.push('adw_patch_iso')`)
  - Get `planFile` from `getPlanFilePath(issueNumber, worktreePath)`
  - Call `runKpiAgent(adwId, logsDir, issueNumber, issueType, planFile, allAdws, kpiAgentStatePath, worktreePath, issue.body)`
  - Update `costUsd` and `modelUsage` from result
  - If `!result.success`: write failure state, log error, but **do not throw** — just return current cost/usage
  - If success: write success state, log completion
  - No git commit or push (KPI file lives in ADW repo)
  - Return `{ costUsd, modelUsage }`

### Step 10: Export KPI phase from barrels

- Open `adws/phases/index.ts`
- Add export: `export { executeKpiPhase } from './kpiPhase';`
- Open `adws/workflowPhases.ts`
- Add `executeKpiPhase` to the re-export list from `'./phases'`

### Step 11: Create KPI phase tests (`adws/phases/__tests__/kpiPhase.test.ts`)

- Create new file following `documentPhase.test.ts` pattern
- Mock `../../core` with `log`, `AgentStateManager` (with `writeState`, `appendLog`, `initializeState`, `createExecutionState`, `completeExecution`), `emptyModelUsageMap`
- Mock `../../agents` with `getPlanFilePath` → `'specs/issue-42-plan.md'`, `runKpiAgent` → `{ success: true, output: 'Updated app_docs/agentic_kpis.md', totalCostUsd: 0.05, modelUsage: {...} }`
- Use `makeRepoContext` helper from `./helpers/makeRepoContext`
- Build `makeConfig()` helper function returning a `WorkflowConfig` object
- Tests:
  - Runs KPI agent and returns cost/modelUsage
  - Initializes agent state with `'kpi-agent'` identifier
  - Passes correct arguments to `runKpiAgent` (adwId, logsDir, issueNumber, issueType, planFile, allAdws, statePath, worktreePath, issueBody)
  - Builds `allAdws` with only `'adw_plan_iso'` when `reviewRetries` is 0 or undefined
  - Builds `allAdws` with `'adw_plan_iso'` + N `'adw_patch_iso'` entries when `reviewRetries` is N
  - Does NOT throw when KPI agent fails — returns `{ costUsd: 0, modelUsage: emptyModelUsageMap() }`
  - Logs error when KPI agent fails
  - Writes failure state when agent fails (but does not throw)
  - Does NOT call `pushBranch` or `runCommitAgent` (no git operations)
  - Returns model usage data on success

### Step 12: Integrate KPI phase into SDLC orchestrator

- Open `adws/adwSdlc.tsx`
- Update the import from `'./workflowPhases'` to include `executeKpiPhase`
- After the document phase block (after line ~105 `persistTokenCounts`), add:
  ```typescript
  const kpiResult = await executeKpiPhase(config, reviewResult.totalRetries);
  totalCostUsd += kpiResult.costUsd;
  totalModelUsage = mergeModelUsageMaps(totalModelUsage, kpiResult.modelUsage);
  persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
  if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
  ```
- Update the file header comment workflow list:
  - Step 7 stays: `Document Phase`
  - Add Step 8: `KPI Phase: track agentic KPIs (non-fatal)`
  - Step 9 (was 8): `Finalize: update state, post completion comment`

### Step 13: Run validation commands

- Run `bunx tsc --noEmit -p adws/tsconfig.json` — must pass with zero errors
- Run `bun run test` — all existing and new tests must pass with zero failures
- Run `bun run lint` — no new lint errors

## Testing Strategy
### Unit Tests

- **KPI agent tests** (`adws/agents/__tests__/kpiAgent.test.ts`):
  - `formatKpiArgs` produces valid JSON with all required fields
  - `runKpiAgent` invokes `runClaudeAgentWithCommand` with correct command (`/track_agentic_kpis`), model (`haiku`), effort (`medium`), and CWD (`undefined`)
  - Agent result is returned correctly

- **KPI phase tests** (`adws/phases/__tests__/kpiPhase.test.ts`):
  - Phase initializes agent state, runs agent, and returns cost/usage
  - `allAdws` list is built correctly based on `reviewRetries` count
  - Phase does NOT throw on agent failure (non-fatal)
  - Phase logs errors on failure
  - No git commit/push operations occur

- **Model/effort map tests** (`adws/core/__tests__/slashCommandModelMap.test.ts`):
  - Updated entry counts from 19 → 20
  - New `/track_agentic_kpis` entries verified in all four maps

### Edge Cases

- `reviewRetries` is `undefined` → `allAdws` is `['adw_plan_iso']` only
- `reviewRetries` is `0` → `allAdws` is `['adw_plan_iso']` only
- `reviewRetries` is `3` → `allAdws` is `['adw_plan_iso', 'adw_patch_iso', 'adw_patch_iso', 'adw_patch_iso']`
- KPI agent fails → phase catches error, logs it, returns `{ costUsd: 0, modelUsage: {} }`, orchestrator continues to `completeWorkflow`
- KPI agent throws an exception → same non-fatal behavior
- `.adw/commands.md` missing → slash command falls back to `node` as package manager
- `worktree_path` absent from state_json → slash command uses regular `git diff` without `-C` flag

## Acceptance Criteria
- [ ] `/track_agentic_kpis` command contains no Python references; all calculation examples use `{package_manager} -e "console.log(...)"` with JS syntax
- [ ] Running `bunx tsc --noEmit -p adws/tsconfig.json` passes with the new `SlashCommand` and `AgentIdentifier` entries
- [ ] `bun run test` passes (existing tests unbroken, new tests pass)
- [ ] The SDLC orchestrator (`adwSdlc.tsx`) invokes KPI tracking after documentation and before workflow completion
- [ ] KPI tracking failure does not prevent workflow completion (non-fatal try/catch in `executeKpiPhase`)
- [ ] `app_docs/agentic_kpis.md` is created/updated when the SDLC orchestrator runs end-to-end
- [ ] New slash command model/effort map tests pass with updated entry counts (20)
- [ ] KPI agent unit tests pass with correct mock assertions
- [ ] KPI phase unit tests pass, including non-fatal failure behavior

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript compilation check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript compilation check (verifies new `SlashCommand` and `AgentIdentifier` entries are valid)
- `bun run lint` — Lint check for code quality
- `bun run test` — Full test suite (existing + new KPI agent/phase tests + updated model map tests)

## Notes
- **Guidelines compliance**: All new code must follow `guidelines/coding_guidelines.md` — clarity over cleverness, modularity (files under 300 lines), immutability, type safety, functional style, JSDoc for public APIs.
- **No new libraries required** — all implementation uses existing project dependencies.
- **Effort parameter position**: Per the reasoning effort documentation, the `effort` parameter is inserted between `model` and `onProgress` in `runClaudeAgentWithCommand(command, args, agentName, outputFile, model, effort, onProgress?, statePath?, cwd?)`.
- **Non-fatal design**: The KPI phase must never block workflow completion. Use try/catch around the entire phase body and return zero-cost defaults on any error. This is a critical design requirement.
- **CWD for KPI agent**: The agent CWD must be `undefined` (ADW project root) so it writes `app_docs/agentic_kpis.md` to the ADW repo, not to the target worktree.
- **No git operations in KPI phase**: Unlike the document phase, the KPI phase does not commit or push. The KPI file lives in the ADW repo and will be committed separately (e.g., via `/commit_cost` or manual commit).
