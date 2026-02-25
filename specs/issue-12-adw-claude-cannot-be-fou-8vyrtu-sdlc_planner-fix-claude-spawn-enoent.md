# Bug: Fix `spawn ENOENT` when launching Claude CLI

## Metadata
issueNumber: `12`
adwId: `claude-cannot-be-fou-8vyrtu`
issueJson: `{"number":12,"title":"Claude cannot be found","body":"Sometimes, claude cannot be found:\n\n[2026-02-25T08:28:27.294Z] Starting adw-classifier-2 agent...\n📋 [2026-02-25T08:28:27.294Z]   Command: /Users/martin/.local/bin/claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model haiku \"<prompt>\"\n📋 [2026-02-25T08:28:27.294Z]   Slash command: /classify_adw\n📋 [2026-02-25T08:28:27.294Z]   Model: haiku\n📋 [2026-02-25T08:28:27.294Z]   Output file: /tmp/adw-trigger-adw-classifier-2.jsonl\n📋 [2026-02-25T08:28:27.294Z]   Args length: 348 characters\n❌ [2026-02-25T08:28:27.295Z] adw-classifier-2 error: spawn /Users/martin/.local/bin/claude ENOENT\n❌ [2026-02-25T08:28:27.295Z] ADW classifier agent failed for issue #2\n\n\"which claude\" returns \"/Users/martin/.local/bin/claude\"","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-25T08:56:18Z","comments":[],"actionableComment":null}`

## Bug Description
When ADW spawns a Claude Code CLI subprocess (e.g., for issue classification via `/classify_adw`), the process occasionally fails immediately with `spawn /Users/martin/.local/bin/claude ENOENT`. The error occurs within 1ms of the spawn attempt, indicating the OS cannot find the executable at the configured path at that instant. Despite this, `which claude` confirms the binary exists at `/Users/martin/.local/bin/claude`. The bug is intermittent — it happens "sometimes" rather than consistently.

**Expected behavior:** The Claude CLI subprocess should start successfully, or if the binary is temporarily unavailable, retry before failing.

**Actual behavior:** The spawn fails immediately with ENOENT and the agent reports failure with no retry.

## Problem Statement
The `runClaudeAgent` and `runClaudeAgentWithCommand` functions in `adws/agents/claudeAgent.ts` call `spawn(CLAUDE_CODE_PATH, ...)` directly with no validation or retry logic. When the Claude CLI binary is temporarily unavailable (e.g., during auto-updates, symlink recreation, or file system latency), the spawn fails with ENOENT. Additionally, the default `CLAUDE_CODE_PATH` is hardcoded to `/usr/local/bin/claude` which may not match the actual installation path, forcing users to always set the env var.

## Solution Statement
1. **Add a `resolveClaudeCodePath()` function** in `adws/core/config.ts` that dynamically resolves and validates the Claude CLI path at runtime. It checks whether the configured path exists, and if not, falls back to resolving `claude` via `which` (PATH lookup). The result is cached for performance but can be re-resolved on ENOENT.
2. **Add retry-on-ENOENT logic** in `adws/agents/claudeAgent.ts`. When `spawn` emits an ENOENT error, wait briefly (1 second) and retry once with a freshly resolved path before giving up.
3. **Change the default `CLAUDE_CODE_PATH`** from `/usr/local/bin/claude` to `claude` so PATH-based resolution works out of the box for all installation methods.

## Steps to Reproduce
1. Install Claude Code CLI at a non-default path (e.g., `/Users/martin/.local/bin/claude`).
2. Set `CLAUDE_CODE_PATH=/Users/martin/.local/bin/claude` in `.env`.
3. Run a trigger (cron or webhook) that classifies an issue: `npx tsx adws/triggers/trigger_cron.ts`.
4. Observe the intermittent `spawn ENOENT` error in the logs when the binary is momentarily unavailable.

## Root Cause Analysis
The `spawn` call in Node.js with an absolute path reports `ENOENT` when the OS cannot resolve the file at spawn time. Possible transient causes include:

1. **Symlink target unavailability**: The Claude CLI at `/Users/martin/.local/bin/claude` is typically a symlink (created by npm/installer) pointing to the actual binary or script. During auto-updates, the symlink target may be briefly removed before the new version is linked.
2. **Shebang interpreter resolution**: If `claude` is a script with `#!/usr/bin/env node`, the ENOENT can occur if the shebang interpreter can't be resolved by the OS at spawn time.
3. **File system latency**: On some configurations (encrypted volumes, network drives, spotlight indexing), file system operations may briefly return stale results.

The code currently has **zero resilience** to any of these transient failures — no path validation before spawn, no retry logic, and an inflexible default path. The `handleAgentProcess` function's `error` handler resolves with `success: false` immediately, propagating the failure upward.

## Relevant Files
Use these files to fix the bug:

- `adws/core/config.ts` — Contains `CLAUDE_CODE_PATH` constant (line 14) with hardcoded default `/usr/local/bin/claude`, and `getSafeSubprocessEnv()` for subprocess environment. This is where `resolveClaudeCodePath()` will be added.
- `adws/agents/claudeAgent.ts` — Contains `runClaudeAgent()` (line 211) and `runClaudeAgentWithCommand()` (line 266) that spawn the Claude CLI process. The `handleAgentProcess()` function (line 42) handles spawn errors. This is where retry-on-ENOENT logic will be added.
- `adws/core/index.ts` — Barrel exports for the core module. Must export the new `resolveClaudeCodePath` function.
- `adws/__tests__/claudeAgent.test.ts` — Existing tests for claudeAgent (currently tests `computeTotalTokens`). New tests will be added here.
- `adws/healthCheckChecks.ts` — Contains `checkClaudeCodeCLI()` (line 136) which validates the Claude CLI path using `fs.existsSync`. Should be updated to use the new `resolveClaudeCodePath()` for consistency.
- `adws/README.md` — Read for ADW documentation context since we're operating in the `adws/` directory.

### New Files
- `adws/__tests__/resolveClaudeCodePath.test.ts` — Unit tests for the new `resolveClaudeCodePath()` function.
- `adws/__tests__/claudeAgentSpawnRetry.test.ts` — Unit tests for the ENOENT retry logic in `claudeAgent.ts`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read referenced files
- Read `adws/README.md` for ADW documentation context.
- Read `adws/core/config.ts` to understand the current `CLAUDE_CODE_PATH` setup.
- Read `adws/agents/claudeAgent.ts` to understand the current spawn logic.
- Read `adws/core/index.ts` to understand barrel exports.
- Read `adws/healthCheckChecks.ts` to understand current CLI validation.

### Step 2: Add `resolveClaudeCodePath()` to `adws/core/config.ts`
- Change the default value of `CLAUDE_CODE_PATH` from `'/usr/local/bin/claude'` to `'claude'` so PATH-based resolution works by default.
- Add a `resolveClaudeCodePath()` exported function that:
  - If `CLAUDE_CODE_PATH` is an absolute path (starts with `/`) and `fs.existsSync(CLAUDE_CODE_PATH)` returns true, return it.
  - If `CLAUDE_CODE_PATH` is a relative name (e.g., `'claude'`), or the absolute path doesn't exist, attempt to resolve via `execSync('which claude', { encoding: 'utf-8' }).trim()`.
  - If `which` succeeds, return the resolved absolute path.
  - If all resolution fails, throw a descriptive error: `"Claude CLI not found. Set CLAUDE_CODE_PATH in .env or ensure 'claude' is in your PATH."`.
- Add a `clearClaudeCodePathCache()` exported function that resets the cached resolved path (needed for retry-on-ENOENT and testing).
- Cache the resolved path in a module-level variable for performance. `clearClaudeCodePathCache()` resets this cache.

### Step 3: Export new functions from `adws/core/index.ts`
- Add `resolveClaudeCodePath` and `clearClaudeCodePathCache` to the config exports line in `adws/core/index.ts`.

### Step 4: Add retry-on-ENOENT logic in `adws/agents/claudeAgent.ts`
- Update the import from `'../core'` to include `resolveClaudeCodePath` and `clearClaudeCodePathCache`.
- Create a private helper function `spawnClaudeWithRetry(args, options)` that:
  - Resolves the claude path via `resolveClaudeCodePath()`.
  - Calls `spawn(resolvedPath, args, options)`.
  - Listens for the `'error'` event. If the error code is `'ENOENT'`:
    - Log a warning: `"Claude CLI not found at {path}, retrying after re-resolving path..."`.
    - Call `clearClaudeCodePathCache()` to force re-resolution.
    - Wait 1 second (`setTimeout` wrapped in a promise).
    - Re-resolve the path via `resolveClaudeCodePath()`.
    - Spawn again with the new path.
    - If the second attempt also fails, emit the error as before.
  - Returns the `ChildProcess` from the successful spawn, or rejects if both attempts fail.
- Refactor `runClaudeAgent()` to use `spawnClaudeWithRetry()` instead of directly calling `spawn(CLAUDE_CODE_PATH, ...)`.
- Refactor `runClaudeAgentWithCommand()` to use `spawnClaudeWithRetry()` instead of directly calling `spawn(CLAUDE_CODE_PATH, ...)`.
- Update the log messages that reference `CLAUDE_CODE_PATH` to use the resolved path.
- Ensure `handleAgentProcess()` is still called with the final `ChildProcess` from the retry helper.

### Step 5: Update `adws/healthCheckChecks.ts` to use `resolveClaudeCodePath()`
- Import `resolveClaudeCodePath` from `'./core'`.
- In `checkClaudeCodeCLI()`, use `resolveClaudeCodePath()` (wrapped in try/catch) instead of manual `fs.existsSync(CLAUDE_CODE_PATH)` + `commandExists('claude')` checks. This ensures the health check uses the same resolution logic as the agent runner.
- Keep the version check using the resolved path.

### Step 6: Create unit tests for `resolveClaudeCodePath()` in `adws/__tests__/resolveClaudeCodePath.test.ts`
- Test that when `CLAUDE_CODE_PATH` points to an existing file, it returns that path.
- Test that when `CLAUDE_CODE_PATH` points to a non-existent file, it falls back to `which claude`.
- Test that when `CLAUDE_CODE_PATH` is a bare name (e.g., `'claude'`), it resolves via `which`.
- Test that when both configured path and `which` fail, it throws a descriptive error.
- Test that the cache works (second call returns the same result without re-resolving).
- Test that `clearClaudeCodePathCache()` forces re-resolution on the next call.
- Mock `fs.existsSync` and `execSync` to avoid real file system dependency.

### Step 7: Create unit tests for spawn retry logic in `adws/__tests__/claudeAgentSpawnRetry.test.ts`
- Test that when spawn succeeds on the first attempt, no retry occurs.
- Test that when the first spawn emits ENOENT, the retry fires after clearing the cache.
- Test that when both spawn attempts emit ENOENT, the error is propagated as `success: false`.
- Test that non-ENOENT errors (e.g., EACCES) are not retried.
- Mock `child_process.spawn` and the config functions.

### Step 8: Run Validation Commands
- Execute all validation commands listed below to confirm the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the bug is fixed with zero regressions

## Notes
- No `guidelines/` directory exists in this repository, so no coding guidelines apply.
- The `.env.sample` comment says `CLAUDE_CODE_PATH` "defaults to 'claude'" but the code defaulted to `/usr/local/bin/claude`. This inconsistency is fixed by changing the default to `'claude'`.
- The retry logic uses a 1-second delay which is long enough for transient file system issues (symlink recreation, auto-updates) but short enough not to significantly impact workflow execution time.
- No new npm packages are required for this fix.
- The `resolveClaudeCodePath()` function uses `which` (via `execSync`) as a fallback — this is consistent with the existing `commandExists()` pattern in `healthCheckChecks.ts`.
