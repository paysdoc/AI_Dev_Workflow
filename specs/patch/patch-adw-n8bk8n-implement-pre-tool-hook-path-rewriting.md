# Patch: Implement worktree path rewriting in pre-tool-use hook

## Metadata
adwId: `n8bk8n-fix-worktree-root-co`
reviewChangeRequest: `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`

## Issue Summary
**Original Spec:** `specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md`
**Issue:** Spec Step 3 (pre-tool-use hook path rewriting) was never implemented. The file `.claude/hooks/pre-tool-use.ts` has zero changes on this branch. Steps 1-2 (env var injection via `claudeAgent.ts` and `environment.ts`) and Steps 4-6 (git pull removal) are already committed. The env vars `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` are injected but nothing consumes them, so the root contamination bug remains unfixed.
**Solution:** Add a `rewriteWorktreePath()` function to `.claude/hooks/pre-tool-use.ts` that reads the two env vars, intercepts file-based tool calls (`Write`, `Edit`, `Read`, `Glob`, `Grep`, `MultiEdit`), and rewrites `file_path`/`path` parameters that point to the main repo root so they target the worktree instead. Output modified `tool_input` as JSON to stdout so Claude Code applies the rewrite.

## Files to Modify

- `.claude/hooks/pre-tool-use.ts` — Add `rewriteWorktreePath()` function and call it in `main()` before existing safety checks.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `rewriteWorktreePath` function after `isEnvFileAccess` (after line 112)

Add a pure function with the following logic:

```ts
function rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null {
  const worktreePath = process.env.ADW_WORKTREE_PATH;
  const mainRepoPath = process.env.ADW_MAIN_REPO_PATH;

  if (!worktreePath || !mainRepoPath) {
    return null;
  }

  const toolsWithFilePath = ['Write', 'Edit', 'Read', 'MultiEdit'];
  const toolsWithPath = ['Glob', 'Grep'];
  const allRewritableTools = [...toolsWithFilePath, ...toolsWithPath];

  if (!allRewritableTools.includes(toolName)) {
    return null;
  }

  const rewritePath = (p: string): string => {
    if (p.startsWith(mainRepoPath) && !p.startsWith(worktreePath)) {
      return worktreePath + p.slice(mainRepoPath.length);
    }
    return p;
  };

  const modified = { ...toolInput };
  let changed = false;

  if (toolsWithFilePath.includes(toolName) && typeof modified.file_path === 'string') {
    const rewritten = rewritePath(modified.file_path);
    if (rewritten !== modified.file_path) {
      modified.file_path = rewritten;
      changed = true;
    }
  }

  if (toolsWithPath.includes(toolName) && typeof modified.path === 'string') {
    const rewritten = rewritePath(modified.path);
    if (rewritten !== modified.path) {
      modified.path = rewritten;
      changed = true;
    }
  }

  return changed ? modified : null;
}
```

Key design decisions:
- Returns `null` when no rewriting is needed (env vars missing, tool not applicable, or path already correct).
- Only rewrites paths that start with `ADW_MAIN_REPO_PATH` but NOT `ADW_WORKTREE_PATH` — this prevents double-rewriting and ignores paths already targeting the worktree.
- Handles both `file_path` (Write/Edit/Read/MultiEdit) and `path` (Glob/Grep) parameters.
- Does NOT touch `Bash` tool commands (too hard to parse reliably, per spec).
- Pure function with no side effects — the caller handles stdout output.

### Step 2: Call `rewriteWorktreePath` in `main()` before existing safety checks

In `main()`, after parsing `toolName` and `toolInput` (after line 124), and BEFORE the `.env` file access check (line 127), insert:

```ts
// Rewrite worktree paths before safety checks so checks operate on the final path
const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
if (rewrittenInput) {
  console.log(JSON.stringify({ tool_input: rewrittenInput }));
  // Update toolInput for subsequent safety checks
  Object.assign(toolInput, rewrittenInput);
}
```

This ensures:
1. The modified `tool_input` is output as JSON to stdout (Claude Code reads this and applies the modification).
2. Subsequent safety checks (`.env` file access, dangerous `rm` commands) operate on the rewritten path, not the original.
3. The hook continues to exit 0 (allow) after outputting the modification — it does NOT exit early.

### Step 3: Run validation commands

Run all validation commands to confirm the patch compiles and existing safety checks still work.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~45 lines added to `.claude/hooks/pre-tool-use.ts`
**Risk level:** low
**Testing required:** Type-check passes; lint passes; build succeeds. Functional verification requires running an ADW workflow in a worktree with the env vars set, but the BDD scenarios for this feature are not wired to automated step definitions — manual or integration testing confirms the hook rewrites paths correctly.
