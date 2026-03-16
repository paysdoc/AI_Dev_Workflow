# Chore: Use commands in validation and resolution agents

## Metadata
issueNumber: `183`
adwId: `cahdcr-fix-validation-and-r`
issueJson: `{"number":183,"title":"fix validation and resolution agents to use commands","body":"1. Fix implementation\nThe validation and resolution agents create their own prompts that they run using `runClaudeAgent`. \nThe agents should use claude commands instead, using `runClaudeAgentWithCommand`\n - validationAgent: ```/validate_plan_scenarios```\n- resolutionAgent: ```/resolve_plan_scenarios```\n\n2. Remove function\nThe function, runClaudeAgent(), should be removed from the code base. It invites inconsistencies","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T08:23:10Z","comments":[],"actionableComment":null}`

## Chore Description
The validation and resolution agents (`validationAgent.ts`, `resolutionAgent.ts`) currently build their own prompts in code and pass them via stdin to `runClaudeAgent()`. All other agents in the system use `runClaudeAgentWithCommand()` with slash commands from `.claude/commands/`. This inconsistency means:
1. Prompt changes require code changes instead of editing `.md` files
2. Two different code paths exist for spawning Claude CLI (stdin vs CLI args)

The chore has two parts:
1. **Fix agents**: Convert `validationAgent` and `resolutionAgent` to use `runClaudeAgentWithCommand` with their existing slash commands (`/validate_plan_scenarios` and `/resolve_plan_scenarios`)
2. **Remove `runClaudeAgent()`**: Delete the function from `claudeAgent.ts` and remove all exports/imports since it will have zero call sites

Key design change: The slash commands accept **file paths and globs** (not inline content) and **read files themselves**. The `/resolve_plan_scenarios` command also **writes updated files directly to disk** (Step 4 in the command spec). This means:
- Agent function signatures change from accepting content strings to accepting file paths
- `buildValidationPrompt()` and `buildResolutionPrompt()` become unnecessary
- `planValidationPhase.ts` no longer needs to read scenario content or write resolved files — the agents handle it
- The `ResolutionResult` type changes to match the command's JSON output format (`resolved` + `decisions` instead of `updatedPlan` + `updatedScenarios`)

## Relevant Files
Use these files to resolve the chore:

- `adws/agents/validationAgent.ts` — The validation agent to convert. Currently uses `runClaudeAgent` with `buildValidationPrompt()`. Must switch to `runClaudeAgentWithCommand('/validate_plan_scenarios', ...)`.
- `adws/agents/resolutionAgent.ts` — The resolution agent to convert. Currently uses `runClaudeAgent` with `buildResolutionPrompt()`. Must switch to `runClaudeAgentWithCommand('/resolve_plan_scenarios', ...)`.
- `adws/agents/claudeAgent.ts` — Contains both `runClaudeAgent()` (to remove) and `runClaudeAgentWithCommand()` (to keep).
- `adws/agents/index.ts` — Barrel exports. Remove `runClaudeAgent` export.
- `adws/phases/planValidationPhase.ts` — The sole caller of `runValidationAgent` and `runResolutionAgent`. Must be updated for new function signatures and behavior (no longer reads scenario content or writes resolved files).
- `adws/agents/__tests__/validationAgent.test.ts` — Tests for the validation agent. Must update mocks from `runClaudeAgent` to `runClaudeAgentWithCommand` and update test assertions for new function signatures.
- `adws/agents/__tests__/resolutionAgent.test.ts` — Tests for the resolution agent. Must update mocks and assertions similarly.
- `.claude/commands/validate_plan_scenarios.md` — The slash command spec (read-only reference). Takes: `$1=adwId`, `$2=issueNumber`, `$3=planFilePath`, `$4=scenarioGlob`.
- `.claude/commands/resolve_plan_scenarios.md` — The slash command spec (read-only reference). Takes: `$1=adwId`, `$2=issueNumber`, `$3=planFilePath`, `$4=scenarioGlob`, `$5=issueJson`, `$6=mismatches`.
- `adws/types/issueTypes.ts` — Contains `SlashCommand` union type (read-only reference).
- `adws/core/config.ts` — Contains model/effort maps for both commands (read-only reference).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Documents the `effort` parameter pattern used by all agents.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Refactor `validationAgent.ts` to use `runClaudeAgentWithCommand`

- Change the import from `runClaudeAgent` to `runClaudeAgentWithCommand` in `adws/agents/validationAgent.ts`
- Remove the `buildValidationPrompt()` function (the slash command has its own prompt template)
- Create a `formatValidationArgs()` function that returns args as a `readonly string[]` matching the command's positional parameters: `[adwId, String(issueNumber), planFilePath, scenarioGlob]`
- Change the `runValidationAgent()` function signature from:
  ```ts
  (planContent: string, scenarioContent: string, issueContext: string, logsDir: string, statePath?: string, cwd?: string)
  ```
  to:
  ```ts
  (adwId: string, issueNumber: number, planFilePath: string, scenarioGlob: string, logsDir: string, statePath?: string, cwd?: string)
  ```
- Replace the `runClaudeAgent(prompt, ...)` call with `runClaudeAgentWithCommand('/validate_plan_scenarios', formatValidationArgs(adwId, issueNumber, planFilePath, scenarioGlob), ...)`
- Keep `findScenarioFiles()`, `readScenarioContents()`, `parseValidationResult()`, and all type exports unchanged (they may still be useful externally)
- Export the new `formatValidationArgs()` function

### Step 2: Refactor `resolutionAgent.ts` to use `runClaudeAgentWithCommand`

- Change the import from `runClaudeAgent` to `runClaudeAgentWithCommand` in `adws/agents/resolutionAgent.ts`
- Remove the `buildResolutionPrompt()` function (the slash command has its own prompt template)
- Update the `ResolutionResult` interface to match the `/resolve_plan_scenarios` command output:
  ```ts
  export interface ResolutionDecision {
    mismatch: string;
    action: "updated_plan" | "updated_scenarios" | "updated_both";
    reasoning: string;
  }

  export interface ResolutionResult {
    resolved: boolean;
    decisions: ResolutionDecision[];
  }
  ```
- Create a `formatResolutionArgs()` function that returns args as a `readonly string[]`: `[adwId, String(issueNumber), planFilePath, scenarioGlob, issueJson, JSON.stringify(mismatches)]`
- Change the `runResolutionAgent()` function signature from:
  ```ts
  (issueBody: string, planContent: string, scenarioContent: string, mismatches: MismatchItem[], logsDir: string, statePath?: string, cwd?: string)
  ```
  to:
  ```ts
  (adwId: string, issueNumber: number, planFilePath: string, scenarioGlob: string, issueJson: string, mismatches: MismatchItem[], logsDir: string, statePath?: string, cwd?: string)
  ```
- Replace the `runClaudeAgent(prompt, ...)` call with `runClaudeAgentWithCommand('/resolve_plan_scenarios', formatResolutionArgs(...), ...)`
- Update `parseResolutionResult()` to validate the new output format (expect `resolved` boolean and `decisions` array)
- Export the new `formatResolutionArgs()` function

### Step 3: Remove `runClaudeAgent()` from `claudeAgent.ts`

- Delete the entire `runClaudeAgent()` function (lines 70–129) from `adws/agents/claudeAgent.ts`
- Keep `runClaudeAgentWithCommand()`, the `AgentResult` interface, `savePrompt()`, `delay()`, and all re-exports

### Step 4: Update barrel exports in `adws/agents/index.ts`

- Remove `runClaudeAgent` from the export list in the "Claude Agent (base runners)" section
- Add `formatValidationArgs` to the "Validation Agent" export section
- Add `formatResolutionArgs` and `ResolutionDecision` to the "Resolution Agent" export section

### Step 5: Update `planValidationPhase.ts` for new agent signatures

- Remove `readScenarioContents` from the import list (no longer needed)
- The phase still needs `findScenarioFiles` to check if scenarios exist before invoking validation
- Compute `planFilePath` using `getPlanFilePath(issueNumber, worktreePath)` (already used in the phase)
- Use `worktreePath` as the `scenarioGlob` parameter (the commands search recursively from there)
- Update the `runValidationAgent()` call sites (lines ~90, ~208) from:
  ```ts
  runValidationAgent(planContent, scenarioContent, issueContext, logsDir, statePath, worktreePath)
  ```
  to:
  ```ts
  runValidationAgent(adwId, issueNumber, planFilePath, worktreePath, logsDir, statePath, worktreePath)
  ```
- Update the `runResolutionAgent()` call site (line ~148) from:
  ```ts
  runResolutionAgent(issue.body, currentPlanContent, currentScenarioContent, currentMismatches, logsDir, statePath, worktreePath)
  ```
  to:
  ```ts
  runResolutionAgent(adwId, issueNumber, planFilePath, worktreePath, JSON.stringify(issue), currentMismatches, logsDir, statePath, worktreePath)
  ```
- Remove the file-writing logic for `updatedPlan` and `updatedScenarios` (lines ~172–187) — the `/resolve_plan_scenarios` command writes files directly to disk
- Determine `artifactsChanged` from the resolution result: set to `true` if `resolution.resolutionResult.decisions.length > 0`
- Remove `currentPlanContent` and `currentScenarioContent` tracking variables — the agents read files directly so the loop no longer needs to maintain in-memory content
- Remove the `readScenarioContents(currentScenarioPaths)` calls in the loop (lines ~147, ~207) since agents read files themselves
- Remove the `formatIssueContextAsArgs` import (no longer needed)
- Remove `currentScenarioPaths` variable tracking since the commands handle file discovery internally
- Keep `findScenarioFiles` call at the start to determine if scenarios exist (skip validation if none found)

### Step 6: Update `validationAgent.test.ts`

- Change the mock from `runClaudeAgent` to `runClaudeAgentWithCommand`
- Update the import from `runClaudeAgent` to `runClaudeAgentWithCommand`
- Remove tests for `buildValidationPrompt` (function removed)
- Update `runValidationAgent` tests:
  - Pass new arguments: `(adwId, issueNumber, planFilePath, scenarioGlob, logsDir, statePath?, cwd?)`
  - Assert `runClaudeAgentWithCommand` is called with `'/validate_plan_scenarios'` as the command
  - Assert args array contains `[adwId, issueNumber, planFilePath, scenarioGlob]`

### Step 7: Update `resolutionAgent.test.ts`

- Change the mock from `runClaudeAgent` to `runClaudeAgentWithCommand`
- Update the import from `runClaudeAgent` to `runClaudeAgentWithCommand`
- Remove tests for `buildResolutionPrompt` (function removed)
- Update `parseResolutionResult` tests for the new output format (`resolved`, `decisions`)
- Update `runResolutionAgent` tests:
  - Pass new arguments: `(adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatches, logsDir, statePath?, cwd?)`
  - Assert `runClaudeAgentWithCommand` is called with `'/resolve_plan_scenarios'` as the command
  - Assert args array contains `[adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatchesJson]`

### Step 8: Run validation commands

- Run all validation commands listed below to confirm zero regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check adws project
- `bun run test` - Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The `/validate_plan_scenarios` command output uses field names `planSection` and `scenarioFile` (instead of `planReference` and `scenarioReference`). The `MismatchItem` type may need field additions for compatibility, but since `parseValidationResult` already handles the outer structure, internal mismatch fields are passed through as-is. No type change needed for `MismatchItem`.
- The `/resolve_plan_scenarios` command writes files to disk in Step 4 of its instructions. This means the `planValidationPhase.ts` no longer needs to handle file writes — the resolution agent does it. After resolution, re-read `planContent` from file if needed for logging/state, but the next validation pass reads from file via the command.
- `readScenarioContents` is kept in `validationAgent.ts` for potential external use but is no longer called from `planValidationPhase.ts`.
- After this chore, `runClaudeAgentWithCommand` is the sole function for spawning Claude CLI agents, ensuring a single consistent code path.
