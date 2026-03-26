# Patch: Add pre-flight Claude CLI validation in workflowInit

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #5: Pre-flight CLI validation missing in adws/phases/workflowInit.ts. Workflow does not verify Claude CLI is available before starting phases, leading to mid-phase ENOENT crashes. Resolution: Add resolveClaudeCodePath() + fs.accessSync(path, fs.constants.X_OK) check early in initializeWorkflow() before any agent calls. Throw clear error if not found.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** `initializeWorkflow()` in `workflowInit.ts` does not verify the Claude CLI binary exists and is executable before launching phases. When Claude CLI is missing or not executable, the workflow crashes mid-phase with an opaque ENOENT error instead of failing fast at startup.
**Solution:** Add a pre-flight check at the top of `initializeWorkflow()` that calls `resolveClaudeCodePath()` and verifies the resolved path is executable via `fs.accessSync(path, fs.constants.X_OK)`. Throw a clear, actionable error message if the check fails.

## Files to Modify
Use these files to implement the patch:

- `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation early in `initializeWorkflow()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `fs` import to `workflowInit.ts`
- Add `import { accessSync, constants as fsConstants } from 'fs';` at the top of the file (after the existing `child_process` import on line 6)
- Use `fsConstants` alias to avoid collision with other `constants` imports

### Step 2: Add `resolveClaudeCodePath` to the existing `../core` import
- In the existing `import { ... } from '../core';` block (lines 7-26), add `resolveClaudeCodePath` to the imported names

### Step 3: Add pre-flight Claude CLI check in `initializeWorkflow()`
- Insert the check after the GitHub App auth activation (line 106) and before the issue fetch (line 109)
- Call `resolveClaudeCodePath()` to get the CLI path
- Wrap the executability check in a try/catch around `accessSync(resolvedCliPath, fsConstants.X_OK)`
- On failure (path not found or not executable), throw: `"Pre-flight check failed: Claude CLI not found or not executable at <path>. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env."`
- On success, log: `"Pre-flight check: Claude CLI found at <path>"`

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~15
**Risk level:** low
**Testing required:** TypeScript compilation and linting (unit tests disabled per project config)
