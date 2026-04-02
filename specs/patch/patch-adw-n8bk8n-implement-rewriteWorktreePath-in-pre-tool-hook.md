# Patch: Implement rewriteWorktreePath in pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `Issue #1: Spec Step 3 (Fix 1: pre-tool-use hook path rewriting) is not implemented. .claude/hooks/pre-tool-use.ts has zero changes on this branch. The rewriteWorktreePath() function that should intercept Write/Edit/Read/Glob/Grep/MultiEdit tool calls and rewrite file_path/path parameters from ADW_MAIN_REPO_PATH to ADW_WORKTREE_PATH does not exist.`

## Issue Summary
**Original Spec:** specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md
**Issue:** Spec Step 3 (Fix 1: pre-tool-use hook path rewriting) was not implemented. The env vars `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` were correctly injected (Steps 1-2) but nothing consumed them — the entire path rewriting pipeline was inert.
**Solution:** Implement the `rewriteWorktreePath()` function in `.claude/hooks/pre-tool-use.ts` that reads the env vars, intercepts file-based tool calls (`Write`, `Edit`, `Read`, `Glob`, `Grep`, `MultiEdit`), rewrites `file_path` and `path` parameters from the main repo root to the worktree path, and outputs modified `tool_input` as JSON to stdout. Call it in `main()` before existing safety checks and use the rewritten input for subsequent checks.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath()` function and integrate into `main()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `rewriteWorktreePath` function to `.claude/hooks/pre-tool-use.ts`
- Add a new function `rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null` after the existing `isEnvFileAccess` function (after line 112)
- Read `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` from `process.env`
- Return `null` (no change) if either env var is missing — this ensures the hook is inert during interactive sessions
- Define `rewritableTools = ['Write', 'Edit', 'Read', 'Glob', 'Grep', 'MultiEdit']` and return `null` if `toolName` is not in the list
- Create a shallow copy of `toolInput` to avoid mutation
- Rewrite `file_path` parameter: if it starts with `mainRepoPath` but does NOT start with `worktreePath`, replace the `mainRepoPath` prefix with `worktreePath`
- Rewrite `path` parameter (used by `Glob` and `Grep`): same logic as `file_path`
- Return the modified copy if any rewriting occurred, `null` otherwise

### Step 2: Integrate `rewriteWorktreePath` into `main()`
- In `main()`, after parsing `toolName` and `toolInput` from stdin, call `rewriteWorktreePath(toolName, toolInput)` **before** the existing safety checks
- If the function returns a non-null result, output it to stdout: `console.log(JSON.stringify({ tool_input: rewrittenInput }))`
- Create `effectiveInput = rewrittenInput || toolInput` and use it for all subsequent safety checks (`isEnvFileAccess`, `isDangerousRmCommand`) and logging
- This ensures rewritten paths are also validated by the safety checks

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~55 lines added to `.claude/hooks/pre-tool-use.ts`
**Risk level:** low
**Testing required:** Lint, type-check, and build pass. The function is a pure transformation that is inert when env vars are absent, so no runtime side effects on existing behavior.
