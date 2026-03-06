# Feature: Add Reasoning Effort to Slash Command Model Map

## Metadata
issueNumber: `80`
adwId: `add-resoning-effort-4wna6z`
issueJson: `{"number":80,"title":"Add resoning effort to opus model slash commands","body":"The SLASH_COMMAND_MODEL_MAP maps claude slash commands to models. This does not cover reasoning effort which should be set for each claude call.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T07:01:03Z","comments":[],"actionableComment":null}`

## Feature Description
The ADW system currently maps slash commands to Claude model tiers (opus, sonnet, haiku) via `SLASH_COMMAND_MODEL_MAP` in `adws/core/config.ts`. However, reasoning effort (`--reasoning-effort`) is not configured per command. Different slash commands have different complexity levels and should use appropriate reasoning effort to balance quality vs. cost/speed. This feature adds a parallel effort map and threads the effort level through the Claude agent invocation pipeline.

## User Story
As an ADW workflow operator
I want each slash command to use an appropriate reasoning effort level
So that complex tasks (planning, implementing, reviewing) use maximum reasoning while simple tasks (classification, branch naming, cost tracking) use minimal reasoning for speed and cost efficiency

## Problem Statement
All Claude CLI invocations currently run without a `--reasoning-effort` flag, meaning every command uses the default effort level regardless of task complexity. This leads to unnecessary cost and latency for simple tasks and potentially suboptimal output for complex tasks that could benefit from higher effort.

## Solution Statement
Add a `SLASH_COMMAND_EFFORT_MAP` (and `SLASH_COMMAND_EFFORT_MAP_FAST` for cost-optimized mode) that maps each `SlashCommand` to a `ReasoningEffort` level. Introduce a `getEffortForCommand()` function parallel to `getModelForCommand()`. Thread the effort level through `runClaudeAgent()` and `runClaudeAgentWithCommand()` as an optional parameter that appends `--reasoning-effort <level>` to the CLI arguments. Update all agent callers to pass the effort level alongside the model.

## Relevant Files
Use these files to implement the feature:

- `adws/core/config.ts` — Contains `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `getModelForCommand()`, `isFastMode()`. Add effort maps and `getEffortForCommand()` here.
- `adws/agents/claudeAgent.ts` — Contains `runClaudeAgent()` and `runClaudeAgentWithCommand()` that build CLI args. Add optional `effort` parameter and `--reasoning-effort` flag.
- `adws/agents/buildAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/implement`. Update to pass effort.
- `adws/agents/planAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/feature`, `/bug`, `/chore`, `/pr_review`. Update to pass effort.
- `adws/agents/gitAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/generate_branch_name`, `/commit`. Update to pass effort.
- `adws/agents/testAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/test`, `/resolve_failed_test`, `/resolve_failed_e2e_test`. Update to pass effort.
- `adws/agents/reviewAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/review`. Update to pass effort.
- `adws/agents/prAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/pull_request`. Update to pass effort.
- `adws/agents/documentAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/document`. Update to pass effort.
- `adws/agents/patchAgent.ts` — Calls `runClaudeAgentWithCommand()` for `/patch`. Update to pass effort.
- `adws/core/issueClassifier.ts` — Calls `runClaudeAgentWithCommand()` for `/classify_issue`. Update to pass effort.
- `adws/core/index.ts` — Re-exports from config.ts. Add new exports for effort map and getter.
- `adws/__tests__/slashCommandModelMap.test.ts` — Tests for model maps. Add parallel tests for effort maps and `getEffortForCommand()`.
- `guidelines/coding_guidelines.md` — Follow coding guidelines (enums for named constant sets, type safety, immutability).

### New Files
No new files needed. All changes are additions to existing files.

## Implementation Plan
### Phase 1: Foundation
Add the `ReasoningEffort` type, effort maps (`SLASH_COMMAND_EFFORT_MAP` and `SLASH_COMMAND_EFFORT_MAP_FAST`), and `getEffortForCommand()` function to `adws/core/config.ts`. Export them via `adws/core/index.ts`. The effort values per command are:

| Command | Default Effort | Fast Effort |
|---|---|---|
| `/classify_issue` | `low` | `low` |
| `/feature` | `max` | `high` |
| `/bug` | `high` | `high` |
| `/chore` | `high` | `high` |
| `/pr_review` | `high` | `high` |
| `/implement` | `max` | `high` |
| `/patch` | `high` | `high` |
| `/review` | `max` | `high` |
| `/test` | `undefined` | `undefined` |
| `/resolve_failed_test` | `high` | `high` |
| `/resolve_failed_e2e_test` | `high` | `high` |
| `/generate_branch_name` | `low` | `low` |
| `/commit` | `medium` | `low` |
| `/pull_request` | `high` | `medium` |
| `/document` | `high` | `medium` |
| `/commit_cost` | `undefined` | `undefined` |
| `/find_plan_file` | `low` | `low` |
| `/adw_init` | `high` | `medium` |

Note: `undefined` means no `--reasoning-effort` flag is passed (haiku commands where the flag may not apply).

### Phase 2: Core Implementation
Modify `runClaudeAgent()` and `runClaudeAgentWithCommand()` in `claudeAgent.ts` to accept an optional `effort` parameter. When provided, append `--reasoning-effort <effort>` to the CLI args array.

### Phase 3: Integration
Update all agent callers (buildAgent, planAgent, gitAgent, testAgent, reviewAgent, prAgent, documentAgent, patchAgent, issueClassifier) to call `getEffortForCommand()` and pass the result to the agent runner functions.

## Step by Step Tasks

### Step 1: Add ReasoningEffort type and effort maps to config.ts
- Define `ReasoningEffort` type as `'low' | 'medium' | 'high' | 'max'`
- Add `SLASH_COMMAND_EFFORT_MAP: Record<SlashCommand, ReasoningEffort | undefined>` with the default effort values from the table above
- Add `SLASH_COMMAND_EFFORT_MAP_FAST: Record<SlashCommand, ReasoningEffort | undefined>` with the fast effort values from the table above
- Add `getEffortForCommand(command: SlashCommand, issueBody?: string): ReasoningEffort | undefined` function following the same pattern as `getModelForCommand()`

### Step 2: Export new symbols from core/index.ts
- Add `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`, and `getEffortForCommand` to the exports in `adws/core/index.ts`

### Step 3: Add effort parameter to claudeAgent.ts
- Add optional `effort?: string` parameter to `runClaudeAgent()` (after `model`, before `onProgress`)
- When `effort` is defined, add `'--reasoning-effort', effort` to the `args` array
- Add optional `effort?: string` parameter to `runClaudeAgentWithCommand()` (after `model`, before `onProgress`)
- When `effort` is defined, add `'--reasoning-effort', effort` to the `cliArgs` array
- Log the effort level in the startup logs (similar to model logging)

### Step 4: Update buildAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- In `runPrReviewBuildAgent()`: call `getEffortForCommand('/implement', issueBody)` and pass it to `runClaudeAgentWithCommand()`
- In `runBuildAgent()`: call `getEffortForCommand('/implement', issue.body)` and pass it to `runClaudeAgentWithCommand()`

### Step 5: Update planAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- In `runPrReviewPlanAgent()`: call `getEffortForCommand('/pr_review', issueBody)` and pass it to `runClaudeAgentWithCommand()`
- In `runPlanAgent()`: call `getEffortForCommand(issueType, issue.body)` and pass it to `runClaudeAgentWithCommand()`

### Step 6: Update gitAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- In `runGenerateBranchNameAgent()`: call `getEffortForCommand('/generate_branch_name', issue.body)` and pass it to `runClaudeAgentWithCommand()`
- In `runCommitAgent()`: call `getEffortForCommand('/commit', issueBody)` and pass it to `runClaudeAgentWithCommand()`

### Step 7: Update testAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- For `/test`, `/resolve_failed_test`, `/resolve_failed_e2e_test`: call `getEffortForCommand()` and pass to `runClaudeAgentWithCommand()`

### Step 8: Update reviewAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- Call `getEffortForCommand('/review', issueBody)` and pass it to `runClaudeAgentWithCommand()`

### Step 9: Update prAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- Call `getEffortForCommand('/pull_request', issueBody)` and pass it to `runClaudeAgentWithCommand()`

### Step 10: Update documentAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- Call `getEffortForCommand('/document', issueBody)` and pass it to `runClaudeAgentWithCommand()`

### Step 11: Update patchAgent.ts to pass effort
- Import `getEffortForCommand` from `../core`
- Call `getEffortForCommand('/patch', issueBody)` and pass it to `runClaudeAgentWithCommand()`

### Step 12: Update issueClassifier.ts to pass effort
- Import `getEffortForCommand` from core
- Call `getEffortForCommand('/classify_issue', issueBody)` and pass it to `runClaudeAgentWithCommand()`

### Step 13: Add unit tests for effort maps
- In `adws/__tests__/slashCommandModelMap.test.ts`, add:
  - `describe('SLASH_COMMAND_EFFORT_MAP')` with tests for all 18 commands matching the default effort values
  - `describe('SLASH_COMMAND_EFFORT_MAP_FAST')` with tests for all 18 commands matching the fast effort values
  - `describe('getEffortForCommand')` with tests mirroring `getModelForCommand` tests:
    - Returns default effort when no issue body
    - Returns default effort when body has no keywords
    - Returns fast effort when body contains `/fast`
    - Returns fast effort when body contains `/cheap`
    - Returns `undefined` for haiku commands (`/test`, `/commit_cost`)
  - Verify both maps have exactly 18 entries

### Step 14: Run validation commands
- Run `npm run lint` to check for code quality issues
- Run `npx tsc --noEmit` to verify TypeScript compilation
- Run `npx tsc --noEmit -p adws/tsconfig.json` to verify adws TypeScript compilation
- Run `npm test` to validate all tests pass with zero regressions

## Testing Strategy
### Unit Tests
- Test `SLASH_COMMAND_EFFORT_MAP` has correct effort values for all 18 commands
- Test `SLASH_COMMAND_EFFORT_MAP_FAST` has correct fast effort values for all 18 commands
- Test `getEffortForCommand()` returns default effort when no issue body
- Test `getEffortForCommand()` returns fast effort when `/fast` or `/cheap` in issue body
- Test `getEffortForCommand()` returns `undefined` for `/test` and `/commit_cost` (haiku commands)
- Existing tests for `getModelForCommand()` must continue to pass

### Edge Cases
- Commands with `undefined` effort (haiku commands) should NOT add `--reasoning-effort` to CLI args
- Fast mode should correctly downgrade effort levels for applicable commands
- `/fast` and `/cheap` keywords should be case-insensitive (reuses existing `isFastMode()`)
- Both `runClaudeAgent` and `runClaudeAgentWithCommand` must handle the `undefined` effort case (no flag added)

## Acceptance Criteria
- All 18 slash commands have a defined reasoning effort (or explicit `undefined` for haiku commands)
- `SLASH_COMMAND_EFFORT_MAP` matches the effort values specified in the issue
- `SLASH_COMMAND_EFFORT_MAP_FAST` provides cost-optimized effort levels
- `getEffortForCommand()` correctly switches between default and fast maps
- `runClaudeAgent()` and `runClaudeAgentWithCommand()` pass `--reasoning-effort <level>` to CLI when effort is defined
- No `--reasoning-effort` flag when effort is `undefined`
- All existing tests pass with zero regressions
- New unit tests cover effort maps, getter function, and edge cases
- TypeScript compiles without errors
- Linter passes without errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Verify TypeScript compilation for the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Verify TypeScript compilation for the adws subsystem
- `npm test` - Run all tests to validate the feature works with zero regressions

## Notes
- The `--reasoning-effort` flag is the Claude Code CLI flag for controlling reasoning effort. Verify the exact flag name during implementation by checking `claude --help` if needed.
- Haiku commands (`/test`, `/commit_cost`) use `undefined` effort because haiku may not support or benefit from reasoning effort configuration.
- The fast mode effort map reduces effort levels for cost optimization (e.g., `max` -> `high`, `high` -> `high`, `medium` -> `low`), while keeping haiku commands unchanged.
- Follow `guidelines/coding_guidelines.md`: use type aliases for the effort union type, maintain immutability with `readonly` where appropriate, and keep functions pure.
