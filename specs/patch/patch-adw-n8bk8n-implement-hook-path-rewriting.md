# Patch: Implement rewriteWorktreePath in pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Spec Step 3 (Fix 1: pre-tool-use hook path rewriting) is not implemented. .claude/hooks/pre-tool-use.ts has zero changes on this branch. The rewriteWorktreePath() function that should intercept Write/Edit/Read/Glob/Grep/MultiEdit tool calls and rewrite file_path/path parameters from ADW_MAIN_REPO_PATH to ADW_WORKTREE_PATH does not exist. The env vars are correctly injected (Steps 1-2) but nothing consumes them — the entire path rewriting pipeline is inert. Three patch specs exist in specs/patch/ describing the exact implementation but none were applied.`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** Spec Step 3 was never applied. `.claude/hooks/pre-tool-use.ts` has zero changes on this branch. `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` are injected by `claudeAgent.ts` (Step 2) and allowed through `environment.ts` (Step 1), but the pre-tool-use hook does not read them — the entire path rewriting pipeline is inert.
**Solution:** Add a `rewriteWorktreePath()` function to `.claude/hooks/pre-tool-use.ts` that reads the two env vars, intercepts file-based tool calls (`Write`, `Edit`, `Read`, `Glob`, `Grep`, `MultiEdit`), rewrites `file_path` and `path` parameters from the main repo root to the worktree path, and outputs modified `tool_input` as JSON to stdout. Integrate into `main()` before existing safety checks, and feed the rewritten input through to those checks.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath()` function; update `main()` to call it and use rewritten input for safety checks.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `rewriteWorktreePath` function after `isEnvFileAccess` (after line 112)

Add the following function between `isEnvFileAccess` and `main()`:

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
- Returns `null` when no rewriting needed (env vars missing, wrong tool, or path already correct).
- Shallow-copies `toolInput` to preserve immutability.
- Checks `!startsWith(worktreePath)` to avoid double-rewriting paths that already target the worktree.
- Handles both `file_path` (all file tools) and `path` (Glob, Grep).

### Step 2: Integrate into `main()` before existing safety checks

Insert the following immediately after line 124 (`const toolInput = inputData.tool_input || {};`), before the `.env` file access check:

```ts
    // Rewrite paths from main repo root to worktree when running in a worktree
    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
    }

    // Use potentially-rewritten input for subsequent safety checks
    const effectiveInput = rewrittenInput || toolInput;
```

Then update the two subsequent safety checks to use `effectiveInput`:
- Line 127: `isEnvFileAccess(toolName, toolInput)` -> `isEnvFileAccess(toolName, effectiveInput)`
- Line 137: `const command = toolInput.command || ''` -> `const command = effectiveInput.command || ''`

This ensures:
1. The rewritten `tool_input` is output to stdout for Claude Code to apply.
2. Safety checks (`.env` access, dangerous `rm`) run against the rewritten paths.
3. Logging still captures the original `inputData` for debugging.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx tsc --noEmit` — Type-check the main project (pre-tool-use.ts is in the main tsconfig)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~55 lines (45 new function + 10 modified in `main()`)
**Risk level:** low
**Testing required:** Type-check and lint. The hook only activates when both `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` env vars are present (set by `claudeAgent.ts` when spawning in a worktree). No effect on interactive Claude Code sessions or non-worktree agent runs.
