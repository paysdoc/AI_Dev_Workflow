# Patch: Add rewriteWorktreePath to pre-tool-use hook

## Metadata
adwId: `qr9z6g-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Step 3 (pre-tool-use hook path rewriting) is not implemented. The spec requires adding a rewriteWorktreePath() function to .claude/hooks/pre-tool-use.ts that reads ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH from process.env, intercepts Write/Edit/Read/Glob/Grep/MultiEdit tool calls, and rewrites file_path/path parameters from the main repo root to the worktree path. The file is completely unchanged from the dev branch. This is the primary fix for the bug — without it, env vars are injected (Step 2) but never consumed.`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** Spec Step 3 (pre-tool-use hook path rewriting) was never implemented. The env vars `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` are correctly injected by `claudeAgent.ts` (Step 2) and allowed through by `environment.ts` (Step 1), but `.claude/hooks/pre-tool-use.ts` has no code to consume them — the entire worktree path rewriting pipeline is inert.
**Solution:** Add a `rewriteWorktreePath()` function to `.claude/hooks/pre-tool-use.ts` and integrate it into `main()` before the existing safety checks. The function reads both env vars, intercepts file-based tool calls, and rewrites `file_path`/`path` parameters from `ADW_MAIN_REPO_PATH` to `ADW_WORKTREE_PATH`. Output modified `tool_input` as JSON to stdout so Claude Code applies the rewrite.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath()` function and integrate into `main()`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `rewriteWorktreePath` function after `isEnvFileAccess` (after line 112)

Add the following function between `isEnvFileAccess` and `main`:

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

  const toolsWithFilePath = ['Write', 'Edit', 'Read', 'MultiEdit'];
  const toolsWithPath = ['Glob', 'Grep'];
  const allRewritableTools = [...toolsWithFilePath, ...toolsWithPath];

  if (!allRewritableTools.includes(toolName)) {
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
- Returns `null` when no rewriting is needed (env vars missing, wrong tool, path already correct).
- Shallow-copies `toolInput` to preserve immutability per coding guidelines.
- Checks `!startsWith(worktreePath)` to prevent double-rewriting paths already targeting the worktree.
- The existing `ToolInput` interface has `file_path?: string` and `[key: string]: unknown` which covers `path`.

### Step 2: Integrate into `main()` and update safety checks to use rewritten input

Insert the worktree rewriting call after line 124 (parsing `toolName` and `toolInput`), before the `.env` file access check (line 127):

```ts
    // Rewrite paths from main repo root to worktree when running in a worktree
    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
    }

    // Use potentially-rewritten input for subsequent safety checks
    const effectiveInput = rewrittenInput || toolInput;
```

Then update the two existing safety checks to use `effectiveInput` instead of `toolInput`:

1. Line 127: `isEnvFileAccess(toolName, toolInput)` → `isEnvFileAccess(toolName, effectiveInput)`
2. Line 137: `const command = toolInput.command || ''` → `const command = effectiveInput.command || ''`

This ensures:
- Modified `tool_input` is output to stdout for Claude Code to apply the rewrite.
- Safety checks (`.env` access, dangerous `rm`) run against the rewritten paths.
- The original `inputData` is still logged for debugging (line 165 appends `inputData`, not `effectiveInput`).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project (pre-tool-use.ts is in the main tsconfig)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~55 lines (45 new function + 10 modified in main)
**Risk level:** low
**Testing required:** Type-check, lint, and build. The hook activates only when both `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` env vars are present (set by `claudeAgent.ts` when spawning in a worktree). No effect on interactive Claude Code sessions or non-worktree agent runs.
