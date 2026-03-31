# Patch: Add rewriteWorktreePath function to pre-tool-use hook

## Metadata
adwId: `qr9z6g-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Step 3 not implemented: .claude/hooks/pre-tool-use.ts has no rewriteWorktreePath function. The spec requires a function that reads ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH from process.env, intercepts Write/Edit/Read/Glob/Grep/MultiEdit tool calls, and rewrites file_path/path parameters from the main repo root to the worktree path. Without this, the primary bug (agents writing files to the main repo root instead of the worktree) remains unfixed.`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** Step 3 of the original spec was never implemented. `.claude/hooks/pre-tool-use.ts` is unchanged from main — the `rewriteWorktreePath()` function is entirely absent. Steps 1-2 (env var allowlist + injection in claudeAgent) are implemented but inert without the hook function. This is the primary fix for issue #370.
**Solution:** Add `rewriteWorktreePath()` to `.claude/hooks/pre-tool-use.ts` and integrate it into `main()`. Single-file change with ~40 lines added.

## Files to Modify
Use these files to implement the patch:

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath` function and call it in `main()` before existing safety checks

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `rewriteWorktreePath` function after `isEnvFileAccess` (after line 112)

Add the following function between `isEnvFileAccess` and `main()`:

```typescript
/**
 * Rewrites file paths from the main repo root to the worktree path.
 * When Claude Code agents run inside a worktree, their file tools resolve
 * absolute paths against the git repository root instead of the worktree cwd.
 * This intercepts those paths and rewrites them to target the worktree.
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

### Step 2: Integrate into `main()` — change `const` to `let` and add rewriting call

Two edits in `main()`:

1. **Line 124:** Change `const toolInput` to `let toolInput`:
   ```typescript
   let toolInput = inputData.tool_input || {};
   ```

2. **After line 124, before the `.env` access check (line 127):** Insert the rewriting call:
   ```typescript
   // Rewrite file paths from main repo root to worktree path
   const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
   if (rewrittenInput) {
     console.log(JSON.stringify({ tool_input: rewrittenInput }));
     toolInput = rewrittenInput;
   }
   ```

   The `console.log` outputs modified `tool_input` as JSON to stdout — Claude Code's hook system reads this and applies the modification. The `toolInput` reassignment ensures subsequent safety checks (`.env` access, dangerous `rm`) operate on the rewritten paths.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~45 lines added (new function + 5-line integration in main)
**Risk level:** low
**Testing required:** Lint and type-check must pass. Verify `rewriteWorktreePath` exists in `.claude/hooks/pre-tool-use.ts` and is called in `main()` before the `.env` and `rm` safety checks.
