# Patch: Implement rewriteWorktreePath function in pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Step 3 not implemented — rewriteWorktreePath() function missing from .claude/hooks/pre-tool-use.ts`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** Step 3 of the spec was never executed. The `rewriteWorktreePath()` function does not exist in `.claude/hooks/pre-tool-use.ts`. Without it, the env vars injected in Steps 1–2 (`ADW_WORKTREE_PATH`, `ADW_MAIN_REPO_PATH`) are inert, and files continue to be written to the main repo root instead of the worktree.
**Solution:** Add `rewriteWorktreePath()` to `.claude/hooks/pre-tool-use.ts` and call it in `main()` before existing safety checks. When both env vars are present and a tool's `file_path`/`path` parameter points to the main repo root (but not the worktree), rewrite the prefix. Output the modified `tool_input` as JSON to stdout.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath` function and integrate it into `main()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the `rewriteWorktreePath` function

In `.claude/hooks/pre-tool-use.ts`, add a new function after the existing `isEnvFileAccess` function (after line 112):

```typescript
/**
 * Rewrites file paths from the main repo root to the worktree path.
 * When Claude Code agents run inside a worktree, their file tools resolve
 * absolute paths against the git repository root instead of the worktree cwd.
 * This function intercepts those paths and rewrites them to target the worktree.
 *
 * @returns Modified toolInput if rewriting occurred, null otherwise.
 */
function rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null {
  const worktreePath = process.env.ADW_WORKTREE_PATH;
  const mainRepoPath = process.env.ADW_MAIN_REPO_PATH;

  if (!worktreePath || !mainRepoPath) {
    return null;
  }

  const toolsWithFilePath = ['Write', 'Edit', 'Read', 'Glob', 'Grep', 'MultiEdit'];
  if (!toolsWithFilePath.includes(toolName)) {
    return null;
  }

  let modified = false;
  const updatedInput = { ...toolInput };

  // Rewrite file_path parameter (Write, Edit, Read, MultiEdit)
  if (typeof updatedInput.file_path === 'string') {
    if (updatedInput.file_path.startsWith(mainRepoPath) && !updatedInput.file_path.startsWith(worktreePath)) {
      updatedInput.file_path = worktreePath + updatedInput.file_path.slice(mainRepoPath.length);
      modified = true;
    }
  }

  // Rewrite path parameter (Glob, Grep)
  if (typeof updatedInput.path === 'string') {
    if (updatedInput.path.startsWith(mainRepoPath) && !updatedInput.path.startsWith(worktreePath)) {
      updatedInput.path = worktreePath + updatedInput.path.slice(mainRepoPath.length);
      modified = true;
    }
  }

  return modified ? updatedInput : null;
}
```

### Step 2: Integrate `rewriteWorktreePath` into `main()`

In the `main()` function, after parsing `toolName` and `toolInput` (after line 124), and **before** the existing `.env` file access check (line 127), add:

```typescript
    // Rewrite file paths from main repo root to worktree path
    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
      toolInput = rewrittenInput;
    }
```

Note: The `toolInput` variable on line 124 is declared with `const`. Change it to `let` so it can be reassigned after rewriting:
```typescript
    let toolInput = inputData.tool_input || {};
```

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~45 (new function + 4-line integration in main)
**Risk level:** low
**Testing required:** Type-check passes. Feature scenarios for pre-tool hook path rewriting (`features/fix_worktree_path_rewriting.feature` scenarios 1–6) should now be satisfiable by code inspection.
