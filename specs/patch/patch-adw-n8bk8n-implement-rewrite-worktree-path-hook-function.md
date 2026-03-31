# Patch: Implement rewriteWorktreePath function in pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`

## Issue Summary
**Original Spec:** specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md
**Issue:** Step 3 of the spec (rewriteWorktreePath in `.claude/hooks/pre-tool-use.ts`) is not implemented. The hook file has zero changes from origin/dev. The 6 BDD scenarios (lines 19-49 of `features/fix_worktree_path_rewriting.feature`) covering this behavior cannot pass without the implementation.
**Solution:** Add a `rewriteWorktreePath` function to `.claude/hooks/pre-tool-use.ts` that reads `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` from `process.env`, intercepts Write/Edit/Read/Glob/Grep/MultiEdit tool calls, and rewrites `file_path`/`path` parameters that start with the main repo root (but not the worktree) to target the worktree instead. Call it in `main()` before existing safety checks and output modified `tool_input` as JSON to stdout when rewriting occurs.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath` function and integrate it into `main()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the `rewriteWorktreePath` function

In `.claude/hooks/pre-tool-use.ts`, add the following function before `main()` (after the existing `isEnvFileAccess` function, around line 112):

```typescript
/**
 * Rewrites file paths from the main repo root to the worktree path.
 * When Claude Code agents run inside a worktree, their file tool calls
 * resolve against the git repository root instead of the worktree cwd.
 * This function intercepts those calls and redirects them to the worktree.
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
- Pure function: reads env vars but has no side effects beyond returning a value
- Checks both `file_path` (Write/Edit/Read/MultiEdit) and `path` (Glob/Grep)
- The `startsWith(worktreePath)` guard prevents double-rewriting when the path already targets the worktree (since worktree path is a subdirectory of main repo path)
- Returns `null` when no rewriting needed, allowing the caller to distinguish "no change" from "changed"
- Shallow-copies `toolInput` to avoid mutating the original

### Step 2: Integrate into `main()` before safety checks

In `main()`, after parsing stdin input and extracting `toolName`/`toolInput` (after line 124), add the rewrite call before the existing `.env` file access check:

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

Then update the two existing safety checks to use `effectiveInput` instead of `toolInput`:
- Line ~127: `isEnvFileAccess(toolName, effectiveInput)` instead of `isEnvFileAccess(toolName, toolInput)`
- Line ~137: `const command = effectiveInput.command || '';` instead of `const command = toolInput.command || '';`
- Line ~165: `logData.push({ ...inputData, tool_input: effectiveInput });` to log the effective (possibly rewritten) input

**Important:** The `console.log(JSON.stringify({ tool_input: rewrittenInput }))` line outputs the modified tool input to stdout. Claude Code's hook system reads this and applies the modification. The hook still exits with code 0 (allow) at the end.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~45 lines added, ~4 lines modified
**Risk level:** low
**Testing required:** Type-check passes. BDD scenarios in `features/fix_worktree_path_rewriting.feature` lines 19-49 (6 scenarios covering: path rewriting with both env vars, tool name filtering for Write/Edit/Read, no rewrite when already targeting worktree, inactive when env vars absent, no rewrite for Bash tool, prefix replacement correctness).
