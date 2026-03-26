# Patch: Upgrade Claude CLI ENOENT retry to 3 attempts with exponential backoff

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** The ENOENT retry block in `adws/agents/claudeAgent.ts` (lines 116–126) only retries once with a flat 1-second delay. The spec requires 3 attempts with exponential backoff and path re-resolution on every attempt. During Claude CLI auto-updates, the symlink target is deleted before the new one is written — 1 second and 1 retry is insufficient.
**Solution:** Replace the single ENOENT retry with a 3-attempt loop using exponential backoff (500ms → 1s → 2s). Call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` on every retry attempt so later attempts pick up a newly written symlink.

## Files to Modify

- `adws/agents/claudeAgent.ts` — Replace single ENOENT retry (lines 116–126) with 3-attempt exponential backoff loop

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Replace the ENOENT retry block with a 3-attempt loop
In `adws/agents/claudeAgent.ts`, replace lines 116–126 (the current single-retry ENOENT block):

```ts
  // Retry once on ENOENT (transient path resolution failure)
  if (!result.success && result.output.includes('ENOENT')) {
    log(`Claude CLI not found at ${resolvedPath}, retrying after re-resolving path...`, 'warn');
    clearClaudeCodePathCache();
    await delay(1000);

    const retryPath = resolveClaudeCodePath();
    const retryProcess = spawn(retryPath, cliArgs, spawnOptions);

    return handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
  }
```

With a 3-attempt retry loop using exponential backoff:

```ts
  // Retry up to 3 times on ENOENT with exponential backoff and path re-resolution
  if (!result.success && result.output.includes('ENOENT')) {
    const enoentBackoffMs = [500, 1000, 2000];
    for (let attempt = 0; attempt < enoentBackoffMs.length; attempt++) {
      log(`Claude CLI ENOENT at attempt ${attempt + 1}/${enoentBackoffMs.length}, re-resolving path after ${enoentBackoffMs[attempt]}ms...`, 'warn');
      clearClaudeCodePathCache();
      await delay(enoentBackoffMs[attempt]);

      const retryPath = resolveClaudeCodePath();
      log(`  Retry path resolved to: ${retryPath}`, 'info');
      const retryProcess = spawn(retryPath, cliArgs, spawnOptions);
      const retryResult = await handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);

      if (retryResult.success || !retryResult.output.includes('ENOENT')) {
        return retryResult;
      }
    }
    // All ENOENT retries exhausted — return the last failed result
    log(`Claude CLI ENOENT persisted after ${enoentBackoffMs.length} retry attempts`, 'error');
    return result;
  }
```

Key changes:
- 3 retry attempts instead of 1
- Exponential backoff: 500ms → 1000ms → 2000ms
- `clearClaudeCodePathCache()` + `resolveClaudeCodePath()` called on **every** attempt
- Each retry checks if ENOENT is resolved; returns immediately on success or non-ENOENT failure
- If all retries fail, returns the original result with an error log

### Step 2: Verify no other code references the replaced block
- Confirm no other code in `claudeAgent.ts` depends on the single-retry behavior (the OAuth retry block at lines 128+ is independent and untouched).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~15 lines replaced with ~18 lines (net +3)
**Risk level:** low
**Testing required:** TypeScript compilation and linting (unit tests disabled per `.adw/project.md`)
