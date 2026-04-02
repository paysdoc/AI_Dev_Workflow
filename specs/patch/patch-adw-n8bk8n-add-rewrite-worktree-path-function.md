# Patch: Add rewriteWorktreePath function to pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Step 3 of the spec is entirely missing — .claude/hooks/pre-tool-use.ts has no rewriteWorktreePath function. Implement the function that reads ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH from process.env, intercepts Write/Edit/Read/Glob/Grep/MultiEdit tool calls, and rewrites file_path/path parameters from the main repo root to the worktree path.`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** The `rewriteWorktreePath` function specified in Step 3 of the spec was never implemented. Without it, the `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` env vars set in Steps 1-2 are never consumed, and Claude Code's file tools continue writing to the main repo root instead of the worktree.
**Solution:** Add a `rewriteWorktreePath` function to `.claude/hooks/pre-tool-use.ts` and call it in `main()` before existing safety checks. If it rewrites a path, output the modified `tool_input` as JSON to stdout.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath` function and integrate it into `main()`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the `rewriteWorktreePath` function

In `.claude/hooks/pre-tool-use.ts`, add a new function after the existing `isEnvFileAccess` function (after line 112):

```ts
/**
 * Rewrite file paths from main repo root to worktree path.
 * When Claude Code agents run inside a worktree, their file tool calls
 * resolve paths against the git repository root instead of the worktree.
 * This function intercepts those paths and rewrites them.
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
  const rewritten = { ...toolInput };

  // Rewrite file_path parameter (Write, Edit, Read, MultiEdit)
  if (typeof rewritten.file_path === 'string') {
    if (rewritten.file_path.startsWith(mainRepoPath) && !rewritten.file_path.startsWith(worktreePath)) {
      rewritten.file_path = rewritten.file_path.replace(mainRepoPath, worktreePath);
      modified = true;
    }
  }

  // Rewrite path parameter (Glob, Grep)
  if (typeof rewritten.path === 'string') {
    if (rewritten.path.startsWith(mainRepoPath) && !rewritten.path.startsWith(worktreePath)) {
      rewritten.path = rewritten.path.replace(mainRepoPath, worktreePath) as string;
      modified = true;
    }
  }

  return modified ? rewritten : null;
}
```

Key requirements:
- Read `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` from `process.env`.
- Return `null` if either env var is missing (no-op for interactive sessions).
- Only process tools in the allowlist: `Write`, `Edit`, `Read`, `Glob`, `Grep`, `MultiEdit`.
- Check both `file_path` (used by Write/Edit/Read/MultiEdit) and `path` (used by Glob/Grep).
- Only rewrite if the path starts with `ADW_MAIN_REPO_PATH` but NOT `ADW_WORKTREE_PATH`.
- Use `String.replace` with the first occurrence only (prefix replacement).
- Return `null` if no rewriting was needed.

### Step 2: Add `path` to the `ToolInput` interface

Update the `ToolInput` interface (around line 11) to explicitly include the `path` property:

```ts
interface ToolInput {
  command?: string;
  file_path?: string;
  path?: string;
  [key: string]: unknown;
}
```

### Step 3: Integrate `rewriteWorktreePath` into `main()`

In `main()`, after parsing `toolName` and `toolInput` (after line 124) and **before** the existing `.env` file access check (line 127), add:

```ts
    // Rewrite worktree paths before safety checks
    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      // Output modified tool_input for Claude Code to apply
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
      // Use rewritten input for subsequent safety checks
      toolInput = rewrittenInput;
    }
```

Note: The `toolInput` variable (line 124) is currently `const`. Change it to `let` so it can be reassigned after rewriting:
```ts
    let toolInput = inputData.tool_input || {};
```

Then pass the potentially-rewritten `toolInput` to the existing `isEnvFileAccess` and other checks (they already reference `toolInput`).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~50 (new function ~40 lines, interface update ~1 line, main() integration ~6 lines, const→let ~1 line)
**Risk level:** low
**Testing required:** Type-check and lint pass. Manual verification that the function returns `null` when env vars are absent (no regression on interactive use) and rewrites correctly when env vars are present.
