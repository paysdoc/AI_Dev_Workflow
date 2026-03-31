# Patch: Implement rewriteWorktreePath in pre-tool-use hook

## Metadata
adwId: `qr9z6g-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Step 3 of the spec is not implemented — rewriteWorktreePath() function missing from .claude/hooks/pre-tool-use.ts. This is the primary fix for issue #370.`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** Step 3 of the spec was never executed. `.claude/hooks/pre-tool-use.ts` has zero changes — the `rewriteWorktreePath()` function that intercepts Write/Edit/Read/Glob/Grep/MultiEdit tool calls and rewrites `file_path`/`path` from `ADW_MAIN_REPO_PATH` to `ADW_WORKTREE_PATH` is entirely absent. Without this function, the env vars injected in Steps 1–2 are inert and Claude Code agents continue writing files to the main repo root instead of the worktree.
**Solution:** Add `rewriteWorktreePath()` function to `.claude/hooks/pre-tool-use.ts` and integrate it into `main()`. When both env vars are present and a tool's `file_path`/`path` starts with `ADW_MAIN_REPO_PATH` but not `ADW_WORKTREE_PATH`, rewrite the prefix. Output the modified `tool_input` as JSON to stdout.

## Files to Modify
Use these files to implement the patch:

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath` function and call it in `main()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the `rewriteWorktreePath` function

In `.claude/hooks/pre-tool-use.ts`, add a new function after the `isEnvFileAccess` function (after line 112, before `async function main()`):

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

Two changes in `main()`:

1. **Change `const toolInput` to `let toolInput`** on line 124 so it can be reassigned after rewriting:
   ```typescript
   let toolInput = inputData.tool_input || {};
   ```

2. **Add rewriting call** after line 124 (`let toolInput = ...`) and **before** the `.env` file access check (line 127). Insert:
   ```typescript
       // Rewrite file paths from main repo root to worktree path
       const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
       if (rewrittenInput) {
         console.log(JSON.stringify({ tool_input: rewrittenInput }));
         toolInput = rewrittenInput;
       }
   ```

   The `console.log` outputs modified `tool_input` as JSON to stdout — Claude Code's hook system reads this and applies the modification. The reassignment ensures subsequent safety checks (`.env` access, dangerous `rm`) operate on the rewritten paths.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~45 lines added (new function + 5-line integration in main)
**Risk level:** low
**Testing required:** Type-check and lint must pass. Manual verification: confirm `rewriteWorktreePath` function exists in `.claude/hooks/pre-tool-use.ts` and is called in `main()` before safety checks.
