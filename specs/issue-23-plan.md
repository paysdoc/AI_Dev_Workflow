# PR-Review: Ensure copied `.claude/commands/` are gitignored in target repo worktrees

## PR-Review Description
The PR reviewer (paysdoc) identified that `copyClaudeCommandsToWorktree()` in `adws/phases/workflowLifecycle.ts` copies the ADW repo's `.claude/commands/` directory to the target repo worktree, but there is no mechanism to prevent these files from being accidentally committed to the target repo. The reviewer notes that simply removing the commands after the job finishes is not viable because they are needed for subsequent phases (e.g., review comments, retry cycles). The reviewer suggests adding `.claude/commands/` to the target repo's `.gitignore` as a solution.

The fix is to ensure `.claude/commands/` is added to the target repo worktree's `.gitignore` immediately after copying the command files. This way:
- The command files remain available on disk for all workflow phases (plan, build, review, retry)
- Git will not track or stage them, preventing accidental commits to the target repo
- When the worktree is removed during cleanup, the files are deleted along with it

## Summary of Original Implementation Plan
The original plan at `specs/issue-23-adw-multiple-problems-wi-pkdnfi-sdlc_planner-fix-adw-classifier-and-plan.md` addresses three cascading failures when ADW runs against an external target repo:
1. **Classifier fix**: Added deterministic regex pre-check for `/adw_*` patterns before invoking haiku AI classifier
2. **Plan agent fix**: Copy ADW repo's `.claude/commands/` to target repo worktree during setup so slash commands are available
3. **Worktree cleanup fix**: Accept optional `cwd` parameter in cleanup functions and pass target repo path from webhook handler

The PR review is specifically about item #2 — the copied `.claude/commands/` files need to be gitignored so they don't leak into the target repo's git history.

## Relevant Files
Use these files to resolve the review:

- `adws/phases/workflowLifecycle.ts` — Contains `copyClaudeCommandsToWorktree()` (lines 19-44) which copies `.claude/commands/` to the target repo worktree. This function needs to be extended to also add a `.gitignore` entry.
- `adws/__tests__/worktreeOperations.test.ts` — Existing worktree tests. A new test should be added for the gitignore behavior.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add a helper function to ensure `.gitignore` entry exists in the worktree

In `adws/phases/workflowLifecycle.ts`:

- Add a new function `ensureGitignoreEntry(worktreePath: string, entry: string): void` that:
  - Reads the `.gitignore` file at `<worktreePath>/.gitignore` if it exists (or treats as empty string if it doesn't)
  - Checks if the entry (`.claude/commands/`) already exists in the file (match line-by-line, trimmed)
  - If not present, appends the entry to the file with a preceding newline (to avoid corrupting existing content) and a comment explaining why it's there (e.g., `# ADW: copied slash commands (do not commit)`)
  - Creates the `.gitignore` file if it doesn't exist
  - Logs the operation

### 2. Call `ensureGitignoreEntry` from `copyClaudeCommandsToWorktree`

In `adws/phases/workflowLifecycle.ts`:

- At the end of `copyClaudeCommandsToWorktree()`, after copying the files, call `ensureGitignoreEntry(worktreePath, '.claude/commands/')` to ensure the copied commands are gitignored
- This should be called regardless of whether any new files were copied (the `.gitignore` entry should always be present if we're operating on a target repo worktree)

### 3. Add unit tests for the gitignore behavior

In `adws/__tests__/worktreeOperations.test.ts` (or create a new focused test file if appropriate):

- Add tests verifying that after `copyClaudeCommandsToWorktree` runs:
  - `.claude/commands/` entry is appended to `.gitignore` when it doesn't exist
  - `.claude/commands/` entry is NOT duplicated when it already exists in `.gitignore`
  - `.gitignore` file is created if it doesn't already exist
  - Existing `.gitignore` content is preserved

Since `copyClaudeCommandsToWorktree` is a private function in `workflowLifecycle.ts`, test the exported `ensureGitignoreEntry` helper directly (export it for testing) or write an integration-style test that exercises the copy flow through `initializeWorkflow`. The simpler approach is to export `ensureGitignoreEntry` and test it directly.

### 4. Run validation commands

Run all validation commands to ensure no regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check adws directory
- `npm test` - Run all tests to validate the review is complete with zero regressions
- `npm run build` - Build the application to verify no build errors

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`. Key requirements: strict TypeScript (no `any`), functional style, immutability, pure functions, meaningful variable names.
- The `.gitignore` entry should be `.claude/commands/` (with trailing slash to match the directory pattern).
- The `ensureGitignoreEntry` function should be idempotent — safe to call multiple times without duplicating the entry.
- This approach is preferred over `.git/info/exclude` because `.git/info/exclude` behaves differently for worktrees and is less portable.
- The `.gitignore` modification in the worktree is intentional and expected — it prevents the ADW command files from being tracked while keeping them available for all workflow phases.
