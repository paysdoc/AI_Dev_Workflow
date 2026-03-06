# PR-Review: Add spawn mock tests for reasoning effort CLI arguments

## PR-Review Description
The PR review for #81 (feat: #80 - Add reasoning effort to slash commands) contains three comments:

1. **Flag name fix (line 246)**: Reviewer noted `--reasoning-effort` is not a valid Claude CLI option — the correct flag is `--effort`. This was already resolved in commit `f52ba7a` which renamed `--reasoning-effort` to `--effort` across `claudeAgent.ts`, `config.ts`, and documentation files.

2. **Flag name confirmation (line 246)**: Reviewer confirmed the correct name is `effort`. Already resolved by the same commit.

3. **Test improvement (line 1)**: Reviewer requested improving tests by mocking `spawn` and verifying the arguments passed to it. This ensures the `--effort <level>` flag is correctly included (or omitted) in the CLI arguments. This is the remaining unresolved review comment.

## Summary of Original Implementation Plan
The original plan (`specs/issue-80-adw-add-resoning-effort-4wna6z-sdlc_planner-add-reasoning-effort-to-slash-commands.md`) adds per-command reasoning effort configuration to the ADW slash command system. It defines a `ReasoningEffort` type, `SLASH_COMMAND_EFFORT_MAP` / `SLASH_COMMAND_EFFORT_MAP_FAST` maps, and a `getEffortForCommand()` function in `config.ts`. It threads the effort level through `runClaudeAgent()` and `runClaudeAgentWithCommand()` in `claudeAgent.ts`, which append a `--effort <level>` flag to the CLI args array. All agent callers were updated to pass effort. Unit tests were added for the effort maps and getter function but not for the actual spawn arguments.

## Relevant Files
Use these files to resolve the review:

- `adws/__tests__/claudeAgentSpawnRetry.test.ts` — Existing test file that already mocks `spawn` and tests `runClaudeAgent` / `runClaudeAgentWithCommand`. Contains reusable `createMockSpawn` and `createMockSpawnWithError` helpers. This is the ideal file to add the new spawn argument tests since the mocking infrastructure is already in place.
- `adws/agents/claudeAgent.ts` — The source file containing `runClaudeAgent()` and `runClaudeAgentWithCommand()` where `--effort` is added to CLI args. Needed as reference to understand the expected argument structure.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow (testing, type safety, mocking to isolate tests).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add spawn argument verification tests to `claudeAgentSpawnRetry.test.ts`
- Add a new `describe('claudeAgent spawn arguments')` block in `adws/__tests__/claudeAgentSpawnRetry.test.ts` (after the existing retry tests).
- The tests should reuse the existing `createMockSpawn` helper and the existing mock setup for `child_process` and `config`.
- Add the following test cases for `runClaudeAgent`:
  - **Includes `--effort` when effort is provided**: Call `runClaudeAgent('test prompt', 'Test Agent', outputFile, 'sonnet', 'high')` and assert `spawn` was called with args array containing `'--effort'` followed by `'high'`.
  - **Omits `--effort` when effort is undefined**: Call `runClaudeAgent('test prompt', 'Test Agent', outputFile, 'sonnet')` (no effort) and assert the args array does NOT contain `'--effort'`.
  - **Includes correct model in args**: Call `runClaudeAgent('test prompt', 'Test Agent', outputFile, 'opus')` and assert args contain `'--model'` followed by `'opus'`.
- Add the following test cases for `runClaudeAgentWithCommand`:
  - **Includes `--effort` when effort is provided**: Call `runClaudeAgentWithCommand('/implement', 'args', 'Test Agent', outputFile, 'sonnet', 'max')` and assert `spawn` was called with args containing `'--effort'` followed by `'max'`.
  - **Omits `--effort` when effort is undefined**: Call `runClaudeAgentWithCommand('/implement', 'args', 'Test Agent', outputFile, 'sonnet')` and assert args do NOT contain `'--effort'`.
  - **Includes the prompt as last argument**: Call `runClaudeAgentWithCommand('/implement', 'test arg', 'Test Agent', outputFile)` and assert the last element of the args array is the constructed prompt string.
- To verify args, use `(spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]` to access the args array passed to `spawn`.

### Step 2: Run validation commands
- Run `npm run lint` to check for code quality issues
- Run `npx tsc --noEmit` to verify TypeScript compilation
- Run `npx tsc --noEmit -p adws/tsconfig.json` to verify adws TypeScript compilation
- Run `npm test` to validate all tests pass with zero regressions

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Verify TypeScript compilation for the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Verify TypeScript compilation for the adws subsystem
- `npm test` - Run all tests to validate the review is complete with zero regressions

## Notes
- The existing `claudeAgentSpawnRetry.test.ts` already has full mock infrastructure for `spawn`, `child_process`, and `config`. New tests should live in this file to avoid duplicating mock setup.
- The `createMockSpawn` helper returns a mock process with stdout/stderr/stdin/on handlers. After calling the agent function, inspect `(spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]` to get the args array.
- For `runClaudeAgent`, the args structure is: `['--print', '--verbose', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--model', <model>, ...optionalEffort]`
- For `runClaudeAgentWithCommand`, the args structure is: `['--print', '--verbose', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--model', <model>, ...optionalEffort, <prompt>]`
- Comments 1 and 2 from the review (flag rename from `--reasoning-effort` to `--effort`) were already resolved in commit `f52ba7a`. No further action is needed for those.
