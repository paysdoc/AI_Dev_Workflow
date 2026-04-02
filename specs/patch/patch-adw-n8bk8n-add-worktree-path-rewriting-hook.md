# Patch: Add worktree path rewriting to pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Fix 1 (pre-tool-use hook path rewriting) is not implemented. The spec requires adding a rewriteWorktreePath() function to .claude/hooks/pre-tool-use.ts that intercepts Write/Edit/Read/Glob/Grep/MultiEdit tool calls and rewrites file_path/path parameters from ADW_MAIN_REPO_PATH to ADW_WORKTREE_PATH. The file has zero changes in this branch. Without this fix, Claude Code agents will still write files to the main repo root instead of the worktree, which is the primary bug described in issue #370.`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** Spec Step 3 (pre-tool-use hook path rewriting) was never implemented. The file `.claude/hooks/pre-tool-use.ts` has zero changes on this branch. Steps 1, 2, 4, 5, and 6 are already committed — the env vars (`ADW_WORKTREE_PATH`, `ADW_MAIN_REPO_PATH`) are injected by `claudeAgent.ts` and allowed through by `environment.ts`, but nothing reads them.
**Solution:** Add a `rewriteWorktreePath()` function to `.claude/hooks/pre-tool-use.ts` that intercepts file-based tool calls, detects paths targeting the main repo root, and rewrites them to the worktree path. Output modified `tool_input` as JSON to stdout so Claude Code applies the rewrite.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath()` function and call it in `main()` before existing safety checks.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `rewriteWorktreePath` function to `.claude/hooks/pre-tool-use.ts`

Add a new function after the existing `isEnvFileAccess` function (after line 112):

```ts
/**
 * Rewrite file paths from main repo root to worktree path.
 * When Claude Code agents run inside a worktree, their file tool calls
 * resolve paths against the git repository root instead of the worktree.
 * This function intercepts those calls and rewrites the paths.
 */
function rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null {
  const worktreePath = process.env['ADW_WORKTREE_PATH'];
  const mainRepoPath = process.env['ADW_MAIN_REPO_PATH'];

  if (!worktreePath || !mainRepoPath) {
    return null;
  }

  const filePathTools = ['Write', 'Edit', 'Read', 'MultiEdit'];
  const pathTools = ['Glob', 'Grep'];
  const allTools = [...filePathTools, ...pathTools];

  if (!allTools.includes(toolName)) {
    return null;
  }

  let modified = false;
  const rewritten = { ...toolInput };

  // Rewrite file_path parameter (Write, Edit, Read, MultiEdit, Glob, Grep)
  if (typeof rewritten.file_path === 'string' &&
      rewritten.file_path.startsWith(mainRepoPath) &&
      !rewritten.file_path.startsWith(worktreePath)) {
    rewritten.file_path = worktreePath + rewritten.file_path.slice(mainRepoPath.length);
    modified = true;
  }

  // Rewrite path parameter (Glob, Grep)
  if (typeof rewritten.path === 'string' &&
      rewritten.path.startsWith(mainRepoPath) &&
      !rewritten.path.startsWith(worktreePath)) {
    rewritten.path = worktreePath + rewritten.path.slice(mainRepoPath.length);
    modified = true;
  }

  return modified ? rewritten : null;
}
```

Key design decisions:
- The `ToolInput` interface already has `file_path?: string` and `[key: string]: unknown` (which covers `path`).
- Returns `null` when no rewriting is needed (env vars missing, wrong tool, or path already correct).
- Shallow-copies `toolInput` to preserve immutability per coding guidelines.
- Checks `!startsWith(worktreePath)` to avoid double-rewriting paths that already target the worktree.

### Step 2: Call `rewriteWorktreePath` in `main()` before existing safety checks

In the `main()` function, insert the worktree rewriting call immediately after parsing `toolName` and `toolInput` (after line 124), before the `.env` file access check:

```ts
    // Rewrite paths from main repo root to worktree when running in a worktree
    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
    }

    // Use potentially-rewritten input for subsequent safety checks
    const effectiveInput = rewrittenInput || toolInput;
```

Then update the subsequent safety checks to use `effectiveInput` instead of `toolInput`:
- Change `isEnvFileAccess(toolName, toolInput)` → `isEnvFileAccess(toolName, effectiveInput)` (line 127)
- Change `const command = toolInput.command || ''` → `const command = effectiveInput.command || ''` (line 137)

This ensures:
1. The rewritten `tool_input` is output to stdout for Claude Code to apply.
2. Safety checks (`.env` access, dangerous `rm`) run against the rewritten paths, not the originals.
3. Logging still captures the original input for debugging.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx tsc --noEmit` — Type-check the main project (pre-tool-use.ts is in the main tsconfig)
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~55 lines (45 new + 10 modified)
**Risk level:** low
**Testing required:** Type-check and lint. The hook is activated only when `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` env vars are present (set by `claudeAgent.ts` when spawning in a worktree). No effect on interactive Claude Code sessions or non-worktree agent runs.
