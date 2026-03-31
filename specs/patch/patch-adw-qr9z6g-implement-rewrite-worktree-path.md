# Patch: Implement rewriteWorktreePath function in pre-tool-use hook

## Metadata
adwId: `qr9z6g-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Step 3 not implemented — .claude/hooks/pre-tool-use.ts has no rewriteWorktreePath function`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** The pre-tool-use hook is missing the `rewriteWorktreePath` function described in spec Step 3. Without it, Claude Code agents still write files to the main repo root instead of the worktree when `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` env vars are set.
**Solution:** Add a `rewriteWorktreePath` function to `.claude/hooks/pre-tool-use.ts` that intercepts file-tool calls, detects paths targeting the main repo root, and rewrites them to the worktree path. Call it in `main()` before existing safety checks.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath` function and integrate into `main()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the `rewriteWorktreePath` function

Add a new function to `.claude/hooks/pre-tool-use.ts` (after the `isEnvFileAccess` function, before `main()`):

```ts
/**
 * Rewrite file paths from main repo root to worktree path.
 * When Claude Code resolves paths against the git root instead of the
 * worktree cwd, this function corrects the prefix so files land in
 * the worktree.
 */
function rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null {
  const worktreePath = process.env.ADW_WORKTREE_PATH;
  const mainRepoPath = process.env.ADW_MAIN_REPO_PATH;

  if (!worktreePath || !mainRepoPath) {
    return null;
  }

  // Determine which property to check based on tool name
  const filePathTools = ['Write', 'Edit', 'Read', 'MultiEdit'];
  const pathTools = ['Glob', 'Grep'];

  let propertyName: string | null = null;
  if (filePathTools.includes(toolName)) {
    propertyName = 'file_path';
  } else if (pathTools.includes(toolName)) {
    propertyName = 'path';
  }

  if (!propertyName) {
    return null;
  }

  const currentPath = toolInput[propertyName];
  if (typeof currentPath !== 'string') {
    return null;
  }

  // Only rewrite if path starts with main repo root but NOT the worktree path
  if (currentPath.startsWith(mainRepoPath) && !currentPath.startsWith(worktreePath)) {
    const rewrittenPath = worktreePath + currentPath.slice(mainRepoPath.length);
    return { ...toolInput, [propertyName]: rewrittenPath };
  }

  return null;
}
```

Key behaviors:
- Returns `null` (no change) if either env var is missing
- Checks `file_path` for Write/Edit/Read/MultiEdit tools
- Checks `path` for Glob/Grep tools
- Only rewrites when the path starts with `ADW_MAIN_REPO_PATH` but NOT `ADW_WORKTREE_PATH`
- Returns a shallow copy with the rewritten property, leaving the original untouched

### Step 2: Integrate into `main()` before existing safety checks

In the `main()` function, after parsing `toolName` and `toolInput` (line 123-124), insert the rewrite call before the `.env` access check (line 127):

```ts
const toolName = inputData.tool_name || '';
const toolInput = inputData.tool_input || {};

// Rewrite file paths from main repo root to worktree path
const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
if (rewrittenInput) {
  console.log(JSON.stringify({ tool_input: rewrittenInput }));
}

// Use potentially-rewritten input for subsequent safety checks
const effectiveInput = rewrittenInput || toolInput;
```

Then update the two safety checks to use `effectiveInput` instead of `toolInput`:
- `isEnvFileAccess(toolName, effectiveInput)` (currently line 127)
- `isDangerousRmCommand(effectiveInput.command || '')` (currently inside the Bash check at line 138)

Also update the logging section to log `effectiveInput` data (the `inputData` object still logs the original for audit purposes — no change needed there since `inputData` is logged, not `toolInput` directly).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~45 lines added/modified
**Risk level:** low
**Testing required:** Lint, type-check, build. BDD scenarios in `features/fix_worktree_path_rewriting.feature` cover the expected behavior at the code-review level (Given file is read / Then function exists pattern).
