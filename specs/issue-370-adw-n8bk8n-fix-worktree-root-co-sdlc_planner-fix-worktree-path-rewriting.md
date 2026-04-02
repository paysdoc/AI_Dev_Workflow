# Bug: Fix worktree root contamination — path rewriting hook + remove git pull from root

## Metadata
issueNumber: `370`
adwId: `n8bk8n-fix-worktree-root-co`
issueJson: `{"number":370,"title":"Fix worktree root contamination: path rewriting hook + remove git pull from root","body":"## Problem\n\nTwo related issues cause ADW workflow crashes:\n\n1. **Claude Code agents write files to the main repo root instead of the worktree path.** Claude Code's `Write`/`Edit`/`Read` tools resolve absolute paths against the git repository root, not the spawned process's `cwd`. This causes files (e.g., `.feature` files from the scenario writer) to land in the main repo root instead of the worktree.\n\n2. **`git pull` in the worktree root crashes on divergent branches.** `targetRepoManager.pullLatestDefaultBranch()` runs `git checkout` + `git pull` in the main repo root during initialization. When the root is contaminated by (1), or when branches have diverged, the pull fails and crashes the entire workflow.\n\n### Evidence\n\n- `features/fix_divergent_branch_pull.feature` written to repo root by scenario writer for #368, despite CWD being correctly set to `.worktrees/bugfix-issue-368-fix-divergent-branch-pull/`\n- Scenario agent JSONL log confirms `cwd` was correct, but Claude's `Write` tool used an absolute path pointing to the main repo root\n- `git pull origin \"dev\"` crash in `targetRepoManager.ts:79` due to divergent branches\n\n## Fix Plan\n\n### Fix 1: Pre-tool hook — worktree path rewriting\n\nAdd path rewriting logic to `.claude/hooks/pre-tool-use.ts`:\n\n- The harness passes two env vars when spawning Claude processes: `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH`\n- The pre-tool hook intercepts `Write`, `Edit`, `Read` tool calls\n- Rewrites `file_path` if it starts with `ADW_MAIN_REPO_PATH` **and does NOT** start with `ADW_WORKTREE_PATH`\n- Replaces the main repo root prefix with the worktree path prefix\n- Only activates when both env vars are present (no effect on interactive sessions)\n- Does NOT rewrite `Bash` tool commands (too hard to parse reliably)\n\n### Fix 2: `targetRepoManager.pullLatestDefaultBranch` — fetch only\n\nIn `adws/core/targetRepoManager.ts`:\n- Replace `git fetch` + `git checkout` + `git pull` with just `git fetch origin`\n- The worktree creation already bases off `origin/{defaultBranch}`, so checkout and pull are unnecessary\n- Rename function to reflect new behavior (e.g., `fetchLatestRefs`)\n\n### Fix 3: `freeBranchFromMainRepo` — no pull on park\n\nIn `adws/vcs/worktreeOperations.ts:192`:\n- Replace `git checkout \"{defaultBranch}\" && git pull` with just `git checkout \"{defaultBranch}\"`\n- The checkout is necessary to free the branch for worktree use; the pull is gratuitous and dangerous\n\n### Fix 4: Deprecate `checkoutDefaultBranch` and `checkoutBranch`\n\nIn `adws/vcs/branchOperations.ts`:\n- Both contain `git pull` and are exported but not called internally\n- Mark as `@deprecated` with a warning log when called\n- Do not remove (external consumers may use them)\n\n## Files to modify\n\n- `.claude/hooks/pre-tool-use.ts` — add worktree path rewriting\n- `adws/core/targetRepoManager.ts` — fetch-only, remove checkout + pull\n- `adws/vcs/worktreeOperations.ts` — remove pull from `freeBranchFromMainRepo`\n- `adws/vcs/branchOperations.ts` — deprecate `checkoutDefaultBranch` and `checkoutBranch`\n- `adws/agents/claudeAgent.ts` — pass `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` env vars to spawned processes","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-31T07:44:46Z","comments":[],"actionableComment":null}`

## Bug Description
Two related issues cause ADW workflow crashes:

1. **Claude Code agents write files to the main repo root instead of the worktree path.** Claude Code's `Write`/`Edit`/`Read` tools resolve absolute paths against the git repository root, not the spawned process's `cwd`. When an agent runs inside a worktree (e.g., `.worktrees/bugfix-issue-368-fix-divergent-branch-pull/`), its file tool calls target the main repo root instead, contaminating it with worktree-specific files.

2. **`git pull` in the worktree root crashes on divergent branches.** `targetRepoManager.pullLatestDefaultBranch()` runs `git checkout` + `git pull --rebase` in the main repo root during initialization. When the root is contaminated by (1), or when branches have diverged, the pull fails and crashes the entire workflow. The same issue exists in `freeBranchFromMainRepo` which runs `git checkout && git pull --rebase`.

**Expected behavior:** Files written by agents should land in the worktree directory. Git operations on the main repo root should be limited to safe, non-destructive operations (fetch only).

**Actual behavior:** Files land in the main repo root. `git pull` operations crash on divergent branches or contaminated working trees.

## Problem Statement
Claude Code's file tools resolve paths against the git repository root rather than the process's `cwd`. Combined with unnecessary and dangerous `git pull` operations in the main repo root, this creates a cascade: worktree files contaminate the root, and subsequent `git pull` calls fail because the working tree is dirty or branches have diverged.

## Solution Statement
1. Add a pre-tool-use hook that rewrites `file_path` parameters from the main repo root to the worktree path when the agent is running inside a worktree.
2. Pass `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` env vars to spawned Claude processes so the hook can detect and rewrite paths.
3. Remove all `git pull` operations from the main repo root — replace with `git fetch origin` where needed, and remove pulls entirely where they serve no purpose.
4. Deprecate exported functions that contain `git pull` but are not called internally.

## Steps to Reproduce
1. Run an ADW workflow that uses worktrees (e.g., `bunx tsx adws/adwSdlc.tsx 368`).
2. Observe that the scenario writer agent writes `.feature` files to the main repo root instead of the worktree.
3. Run another workflow while the root is contaminated — `git pull` in `pullLatestDefaultBranch` fails because the working tree has uncommitted changes or divergent branches.

## Root Cause Analysis
- **Path resolution:** Claude Code's `Write`/`Edit`/`Read` tools resolve absolute paths against the git repository root (found via `git rev-parse --show-toplevel`), not the spawned process's `cwd`. When a subprocess is spawned with `cwd` pointing to a worktree, the git root still resolves to the main repo because worktrees share the same `.git` directory.
- **Unnecessary pulls:** `pullLatestDefaultBranch` does `git fetch` + `git checkout` + `git pull --rebase`, but the worktree creation (`worktreeCreation.ts`) already bases new worktrees off `origin/{defaultBranch}`. The checkout and pull are redundant and dangerous in the main repo root.
- **Pull on park:** `freeBranchFromMainRepo` appends `&& git pull --rebase` after `git checkout "{defaultBranch}"`. The checkout is needed to free the branch; the pull is gratuitous and fails when branches diverge.
- **Exported pull functions:** `checkoutDefaultBranch` and `checkoutBranch` in `branchOperations.ts` both contain `git pull` and are exported but never called internally. External consumers could trigger the same crash.

## Relevant Files
Use these files to fix the bug:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `.claude/hooks/pre-tool-use.ts` — Existing pre-tool-use hook. Add worktree path rewriting logic here. Currently handles dangerous command blocking and `.env` file access prevention.
- `adws/core/environment.ts` — Contains `getSafeSubprocessEnv()` and the `SAFE_ENV_VARS` allowlist. Must add `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` to the allowlist so they propagate to Claude CLI subprocesses.
- `adws/agents/claudeAgent.ts` — Spawns Claude CLI subprocesses in `runClaudeAgentWithCommand()`. Must compute and inject `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` into the spawn environment when `cwd` is a worktree path.
- `adws/core/targetRepoManager.ts` — Contains `pullLatestDefaultBranch()` which does fetch + checkout + pull. Must simplify to fetch-only and rename to `fetchLatestRefs()`. Also update `ensureTargetRepoWorkspace()` call site.
- `adws/core/index.ts` — Re-exports `pullLatestDefaultBranch` from `targetRepoManager`. Must update to export `fetchLatestRefs` instead (and keep the old name as a deprecated re-export for backward compatibility).
- `adws/vcs/worktreeOperations.ts` — Contains `freeBranchFromMainRepo()` which runs `git checkout && git pull --rebase`. Must remove the `git pull --rebase` portion. Also exports `getMainRepoPath()` which `claudeAgent.ts` needs to import.
- `adws/vcs/branchOperations.ts` — Contains `checkoutDefaultBranch()` and `checkoutBranch()` which are exported but never called internally. Must mark both as `@deprecated` with warning logs.
- `adws/vcs/index.ts` — Re-exports `checkoutDefaultBranch` and `checkoutBranch`. No changes needed (deprecation is on the source functions).
- `adws/index.ts` — Re-exports `checkoutBranch`. No changes needed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` to the subprocess env allowlist

In `adws/core/environment.ts`:
- Add `'ADW_WORKTREE_PATH'` and `'ADW_MAIN_REPO_PATH'` to the `SAFE_ENV_VARS` array (around line 132-156).
- These env vars will be set per-spawn in `claudeAgent.ts` and must pass through to the Claude CLI process so the pre-tool hook can read them.

### Step 2: Inject worktree env vars when spawning Claude agents

In `adws/agents/claudeAgent.ts`:
- Import `getMainRepoPath` from `../vcs/worktreeOperations`.
- In `runClaudeAgentWithCommand()`, after calling `getSafeSubprocessEnv()` (around line 113), conditionally add the two env vars:
  - When `cwd` is provided and the `cwd` path contains `.worktrees/`, compute the main repo path using `getMainRepoPath(cwd)`.
  - Set `env.ADW_WORKTREE_PATH = cwd` and `env.ADW_MAIN_REPO_PATH = mainRepoPath`.
  - Wrap in try/catch so a failure to resolve `getMainRepoPath` does not crash the agent spawn.

### Step 3: Add worktree path rewriting to the pre-tool-use hook

In `.claude/hooks/pre-tool-use.ts`:
- Add a new function `rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null` that:
  - Reads `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` from `process.env`.
  - Returns `null` (no change) if either env var is missing.
  - Only processes tools that have `file_path`: `Write`, `Edit`, `Read`, `Glob`, `Grep`, `MultiEdit`.
  - For each `file_path`, checks if it starts with `ADW_MAIN_REPO_PATH` but does NOT start with `ADW_WORKTREE_PATH`.
  - If so, replaces the `ADW_MAIN_REPO_PATH` prefix with `ADW_WORKTREE_PATH` and returns the modified `toolInput`.
  - Also handle the `path` parameter (used by `Glob` and `Grep`).
  - Returns `null` if no rewriting is needed.
- In `main()`, before the existing safety checks, call `rewriteWorktreePath()`.
- If it returns a modified `toolInput`, output the modified input as JSON to stdout: `console.log(JSON.stringify({ tool_input: modifiedInput }))`.
- Continue with existing safety checks using the potentially-modified input.

### Step 4: Simplify `pullLatestDefaultBranch` to fetch-only

In `adws/core/targetRepoManager.ts`:
- Rename `pullLatestDefaultBranch` to `fetchLatestRefs`.
- Remove the `git checkout` (line 78) and `git pull --rebase` (line 79) calls.
- Keep `git fetch origin` (line 71) and the `gh repo view` default branch detection (lines 73-76).
- Return the default branch name (still needed by callers).
- Update the log message on line 82 to reflect fetch-only behavior.
- Update `ensureTargetRepoWorkspace` to call `fetchLatestRefs` instead of `pullLatestDefaultBranch` (line 96), and update the log message (line 82 equivalent).

In `adws/core/index.ts`:
- Update the re-export: replace `pullLatestDefaultBranch` with `fetchLatestRefs`.
- Keep a deprecated re-export of `pullLatestDefaultBranch` as an alias for `fetchLatestRefs` for backward compatibility.

### Step 5: Remove `git pull` from `freeBranchFromMainRepo`

In `adws/vcs/worktreeOperations.ts`:
- On line 192, change:
  ```ts
  execSync(`git checkout "${defaultBranch}" && git pull --rebase`, { stdio: 'pipe', cwd: mainRepoPath });
  ```
  to:
  ```ts
  execSync(`git checkout "${defaultBranch}"`, { stdio: 'pipe', cwd: mainRepoPath });
  ```
- Update the log message on line 193 to remove "and pulled latest changes".

### Step 6: Deprecate `checkoutDefaultBranch` and `checkoutBranch`

In `adws/vcs/branchOperations.ts`:
- Add `@deprecated` JSDoc tags to both `checkoutDefaultBranch` (line 156) and `checkoutBranch` (line 91).
- Add a `log('WARNING: checkoutDefaultBranch is deprecated...', 'warn')` call at the start of each function body.
- The deprecation message should reference the safe alternative: "Use `git fetch origin` + worktree-based workflows instead."
- Do NOT remove the functions or their exports.

### Step 7: Run validation commands

Run all validation commands listed below to confirm the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: pure functions, immutability, meaningful error messages, strict TypeScript.
- The pre-tool-use hook's path rewriting outputs modified `tool_input` as JSON to stdout. Claude Code's hook system reads this and applies the modification. Exit code 0 allows the (possibly modified) tool call. Exit code 2 blocks it.
- The `getMainRepoPath` function (from `worktreeOperations.ts`) runs `git worktree list --porcelain` to find the main repo path. It is safe to call from `claudeAgent.ts` as there is no circular dependency — `claudeAgent.ts` imports from `core/` and `types/`, while `worktreeOperations.ts` imports from `core/` and `./branchOperations`.
- The hook must also handle the `path` parameter used by `Glob` and `Grep` tools, not just `file_path`.
- The `SAFE_ENV_VARS` allowlist in `environment.ts` is critical — without adding the new env vars, `getSafeSubprocessEnv()` would strip them from the spawn environment.
