# Patch: Add pre-flight Claude CLI validation in initializeWorkflow

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** `initializeWorkflow()` in `workflowInit.ts` does not validate Claude CLI path existence or executability before starting phases. If the CLI is missing or not executable, the workflow fails mid-phase with an opaque ENOENT error instead of failing fast at startup.
**Solution:** Add `resolveClaudeCodePath()` call and `fs.accessSync(path, fs.constants.X_OK)` check early in `initializeWorkflow()`, before any agent work begins. Throw a clear error if validation fails.

## Files to Modify
Use these files to implement the patch:

- `adws/phases/workflowInit.ts` — Add pre-flight CLI validation early in `initializeWorkflow()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add imports in `workflowInit.ts`
- Add `import { accessSync, constants as fsConstants } from 'fs';` after the existing `child_process` import (line 6)
  - Use `fsConstants` alias to avoid collision with other named exports
- Add `resolveClaudeCodePath` to the existing `import { ... } from '../core';` block (line 7–26), alongside the other core imports

### Step 2: Add pre-flight Claude CLI validation block in `initializeWorkflow()`
- Insert the check after the GitHub App auth activation (line 106) and before the issue fetch (line 109)
- Implementation:
  ```typescript
  // Pre-flight: validate Claude CLI is available and executable
  log('Pre-flight: validating Claude CLI...', 'info');
  const claudeCliPath = resolveClaudeCodePath();
  try {
    accessSync(claudeCliPath, fsConstants.X_OK);
  } catch {
    throw new Error(
      `Pre-flight check failed: Claude CLI not found or not executable at ${claudeCliPath}. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env.`
    );
  }
  log(`Pre-flight: Claude CLI validated at ${claudeCliPath}`, 'success');
  ```
- Note: `resolveClaudeCodePath()` already throws if the CLI cannot be found at all (neither absolute path nor `which`). The `accessSync` check adds the executability verification for paths that exist but lack execute permission.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~12 (2 import additions + 10-line validation block)
**Risk level:** low
**Testing required:** TypeScript compilation and linting. The validation is a fail-fast guard — it only throws on genuinely missing/non-executable CLI, so it won't break existing workflows where the CLI is correctly installed.
