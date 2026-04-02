# Patch: Implement rewriteWorktreePath in pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`

## Issue Summary
**Original Spec:** specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md
**Issue:** Spec Step 3 (Fix 1) is not implemented: `.claude/hooks/pre-tool-use.ts` has no `rewriteWorktreePath` function. The hook file only contains `isDangerousRmCommand` and `isEnvFileAccess` checks. Without this function, the env var plumbing from Steps 1-2 serves no purpose — Claude Code agents continue writing files to the main repo root instead of the worktree.
**Solution:** Add a `rewriteWorktreePath(toolName, toolInput)` function that reads `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` from `process.env`, intercepts Write/Edit/Read/Glob/Grep/MultiEdit tools, rewrites `file_path` and `path` parameters from main repo root to worktree path, and outputs modified `tool_input` as JSON to stdout. Integrate it into `main()` before existing safety checks.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath` function and integrate into `main()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `rewriteWorktreePath` function after `isEnvFileAccess` (after line 112)

Add the following function between `isEnvFileAccess` and `main()`:

```typescript
/**
 * Rewrites file paths from the main repo root to the worktree path.
 * When Claude Code agents run inside a worktree, their file tool calls
 * resolve against the git repository root instead of the worktree cwd.
 * This intercepts those calls and redirects them to the worktree.
 *
 * Returns modified toolInput if rewriting occurred, null otherwise.
 */
function rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null {
  const worktreePath = process.env.ADW_WORKTREE_PATH;
  const mainRepoPath = process.env.ADW_MAIN_REPO_PATH;

  if (!worktreePath || !mainRepoPath) {
    return null;
  }

  const rewritableTools = ['Write', 'Edit', 'Read', 'Glob', 'Grep', 'MultiEdit'];
  if (!rewritableTools.includes(toolName)) {
    return null;
  }

  let modified = false;
  const result = { ...toolInput };

  // Rewrite file_path parameter (Write, Edit, Read, MultiEdit)
  if (typeof result.file_path === 'string') {
    if (result.file_path.startsWith(mainRepoPath) && !result.file_path.startsWith(worktreePath)) {
      result.file_path = worktreePath + result.file_path.slice(mainRepoPath.length);
      modified = true;
    }
  }

  // Rewrite path parameter (Glob, Grep)
  if (typeof result.path === 'string') {
    if (result.path.startsWith(mainRepoPath) && !result.path.startsWith(worktreePath)) {
      result.path = worktreePath + result.path.slice(mainRepoPath.length);
      modified = true;
    }
  }

  return modified ? result : null;
}
```

Key design decisions:
- Pure function: reads env vars, returns modified input or null — no side effects
- Checks both `file_path` (Write/Edit/Read/MultiEdit) and `path` (Glob/Grep)
- The `!startsWith(worktreePath)` guard prevents double-rewriting (worktree path is a subdirectory of main repo path)
- Shallow-copies `toolInput` to preserve immutability
- Returns `null` when no change is needed

### Step 2: Integrate `rewriteWorktreePath` into `main()` and update safety checks

In `main()`, after extracting `toolName` and `toolInput` (line 123-124), insert the rewrite call **before** the existing `.env` file access check (line 127):

```typescript
    const toolName = inputData.tool_name || '';
    const toolInput = inputData.tool_input || {};

    // Rewrite paths from main repo root to worktree when running inside a worktree
    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
    }

    // Use the potentially-rewritten input for subsequent safety checks
    const effectiveInput = rewrittenInput || toolInput;
```

Then update the two existing safety checks to use `effectiveInput`:

1. **Line ~127** — Change `isEnvFileAccess(toolName, toolInput)` to `isEnvFileAccess(toolName, effectiveInput)`
2. **Line ~137** — Change `const command = toolInput.command || '';` to `const command = effectiveInput.command || '';`
3. **Line ~165** — Change `logData.push(inputData)` to `logData.push({ ...inputData, tool_input: effectiveInput })` to log the effective input

The `console.log(JSON.stringify({ tool_input: rewrittenInput }))` outputs modified tool input to stdout. Claude Code's hook system reads this and applies the modification. The hook still exits with code 0 (allow) at the end.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~45 lines added, ~4 lines modified in `.claude/hooks/pre-tool-use.ts`
**Risk level:** low
**Testing required:** Type-check and lint pass. The 6 BDD scenarios in `features/fix_worktree_path_rewriting.feature` cover: path rewriting with both env vars set, tool name filtering, no rewrite when path already targets worktree, inactive when env vars absent, no rewrite for Bash tool, and prefix replacement correctness.
