# Reasoning Effort Per Slash Command

**ADW ID:** add-resoning-effort-4wna6z
**Date:** 2026-03-06
**Specification:** specs/issue-80-adw-add-resoning-effort-4wna6z-sdlc_planner-add-reasoning-effort-to-slash-commands.md

## Overview

This feature adds per-command reasoning effort control to the ADW system by introducing a `SLASH_COMMAND_EFFORT_MAP` parallel to the existing `SLASH_COMMAND_MODEL_MAP`. Each slash command is now assigned an appropriate `--effort` level (`low`, `medium`, `high`, or `max`), enabling complex tasks like planning and reviewing to use maximum reasoning while simple tasks like branch naming use minimal effort for speed and cost efficiency.

## What Was Built

- `ReasoningEffort` type alias (`'low' | 'medium' | 'high' | 'max'`)
- `SLASH_COMMAND_EFFORT_MAP` — default reasoning effort per slash command (18 commands)
- `SLASH_COMMAND_EFFORT_MAP_FAST` — cost-optimized effort map activated by `/fast` or `/cheap` in the issue body
- `getEffortForCommand()` — getter function mirroring `getModelForCommand()` pattern
- `runClaudeAgent()` and `runClaudeAgentWithCommand()` updated to accept optional `effort` parameter and pass `--effort <level>` to the Claude CLI
- All agent callers updated to pass effort alongside model
- Unit tests covering both effort maps and `getEffortForCommand()`

## Technical Implementation

### Files Modified

- `adws/core/config.ts`: Added `ReasoningEffort` type, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`, and `getEffortForCommand()` function
- `adws/core/index.ts`: Exported `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`, `getEffortForCommand`, and `ReasoningEffort` type
- `adws/agents/claudeAgent.ts`: Added optional `effort?: string` parameter to `runClaudeAgent()` and `runClaudeAgentWithCommand()`; appends `--effort <level>` to CLI args when defined; logs effort level
- `adws/agents/buildAgent.ts`: Imports and passes `getEffortForCommand('/implement', ...)` to agent runner
- `adws/agents/planAgent.ts`: Imports and passes effort for `/pr_review`, `/feature`, `/bug`, `/chore`
- `adws/agents/gitAgent.ts`: Imports and passes effort for `/generate_branch_name`, `/commit`
- `adws/agents/testAgent.ts`: Imports and passes effort for `/test`, `/resolve_failed_test`, `/resolve_failed_e2e_test`
- `adws/agents/reviewAgent.ts`: Imports and passes effort for `/review`
- `adws/agents/prAgent.ts`: Imports and passes effort for `/pull_request`
- `adws/agents/documentAgent.ts`: Imports and passes effort for `/document`
- `adws/agents/patchAgent.ts`: Imports and passes effort for `/patch`
- `adws/core/issueClassifier.ts`: Imports and passes effort for `/classify_issue`
- `adws/__tests__/slashCommandModelMap.test.ts`: Added test suites for `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`, and `getEffortForCommand()`

### Key Changes

- The `effort` parameter is inserted between `model` and `onProgress` in both `runClaudeAgent()` and `runClaudeAgentWithCommand()` signatures
- When `effort` is `undefined` (for `/test` and `/commit_cost`), no `--effort` flag is added to CLI args
- Fast mode (triggered by `/fast` or `/cheap` in issue body) reduces effort for several commands: `/feature` max→high, `/commit` medium→low, `/pull_request` high→medium, `/document` high→medium, `/adw_init` high→medium
- Effort level is logged to agent state and console alongside the model for observability

## How to Use

The effort level is automatically selected based on the slash command and issue body — no manual configuration is required for normal use.

1. Create or trigger an ADW issue as usual
2. If you want cost-optimized execution, include `/fast` or `/cheap` in the issue body
3. The system automatically applies the correct `--effort` level per command
4. Check agent logs for `Reasoning effort: <level>` lines to confirm the setting

## Configuration

Effort levels are defined in `adws/core/config.ts`:

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

`undefined` means no `--effort` flag is passed (haiku commands where the flag may not apply).

## Testing

```bash
npm test -- --testPathPattern slashCommandModelMap
```

The test file `adws/__tests__/slashCommandModelMap.test.ts` covers:
- All 18 commands in `SLASH_COMMAND_EFFORT_MAP` match expected values
- All 18 commands in `SLASH_COMMAND_EFFORT_MAP_FAST` match expected values
- `getEffortForCommand()` returns default effort with no issue body
- `getEffortForCommand()` returns fast effort when body contains `/fast` or `/cheap`
- `getEffortForCommand()` returns `undefined` for `/test` and `/commit_cost`
- Both maps contain exactly 18 entries

## Notes

- Haiku-tier commands (`/test`, `/commit_cost`) use `undefined` effort as haiku may not benefit from reasoning effort configuration
- The `effort` parameter position in function signatures (after `model`, before `onProgress`) must be respected by all callers
- This feature is purely additive — existing behavior is preserved when `effort` is `undefined`
