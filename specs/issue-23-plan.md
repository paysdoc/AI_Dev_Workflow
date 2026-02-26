# PR-Review: Gitignore only specific copied commands, not the entire `.claude/commands/` directory

## PR-Review Description
Two related review comments from paysdoc on `adws/phases/workflowLifecycle.ts`:

1. **Line 47** — There's no mechanism for removing the copied claude commands when the job is finished. The reviewer acknowledges this is tricky since commands are needed for review comments, and suggests adding lines to `.gitignore` as an option.

2. **Line 73** — The `.gitignore` entry currently ignores the entire `.claude/commands/` directory. The reviewer wants only the **specific copied command files** to be gitignored, not the whole directory, because blanket-ignoring `.claude/commands/` could interfere with the target project's own claude commands.

The current implementation calls `ensureGitignoreEntry(worktreePath, '.claude/commands/')` which adds a single directory-level ignore pattern. This must be changed to add individual file entries (e.g., `.claude/commands/bug.md`, `.claude/commands/feature.md`) — one per copied file — so that any commands the target project already owns remain tracked by git.

## Summary of Original Implementation Plan
The original plan at `specs/issue-23-adw-multiple-problems-wi-pkdnfi-sdlc_planner-fix-adw-classifier-and-plan.md` addresses three cascading failures when ADW runs against an external target repo:
1. **Classifier fix**: Added deterministic regex pre-check for `/adw_*` patterns before invoking haiku AI classifier
2. **Plan agent fix**: Copy ADW repo's `.claude/commands/` to target repo worktree during setup so slash commands are available
3. **Worktree cleanup fix**: Accept optional `cwd` parameter in cleanup functions and pass target repo path from webhook handler

The first PR-review iteration (commit `52ea4ed`) implemented `ensureGitignoreEntry()` and added `.claude/commands/` as a single directory-level entry. This second round refines that to use per-file entries.

## Relevant Files
Use these files to resolve the review:

- `adws/phases/workflowLifecycle.ts` — Contains `ensureGitignoreEntry()` (lines 20-38) and `copyClaudeCommandsToWorktree()` (lines 47-74). The `copyClaudeCommandsToWorktree` function must be modified to pass only the specific copied file paths to the gitignore helper instead of the whole directory. A new bulk helper `ensureGitignoreEntries()` should be added to handle multiple entries efficiently with a single comment header.
- `adws/__tests__/ensureGitignoreEntry.test.ts` — Existing tests for `ensureGitignoreEntry()`. New tests must be added for the bulk `ensureGitignoreEntries()` function, and existing tests should be updated to use per-file entry examples.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow (functional style, immutability, strict TypeScript, etc.).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add a bulk `ensureGitignoreEntries` helper function

In `adws/phases/workflowLifecycle.ts`:

- Add a new exported function `ensureGitignoreEntries(worktreePath: string, entries: string[]): void` that:
  - Returns immediately if `entries` is empty
  - Reads the `.gitignore` file at `<worktreePath>/.gitignore` (or treats content as empty string if file doesn't exist)
  - Splits existing content into lines and filters `entries` to only those not already present (trimmed comparison)
  - If no new entries remain after filtering, logs "all entries already present" and returns
  - Builds append content: a single `# ADW: copied slash commands (do not commit)` comment header followed by all new entries, each on its own line
  - Prepends a newline if the existing content doesn't end with one
  - Writes the combined content in a single `fs.writeFileSync` call
  - Logs the number of entries added
- This replaces calling `ensureGitignoreEntry` in a loop, which would produce a duplicate comment header for every entry. The bulk function ensures one comment and one write.
- Keep the existing `ensureGitignoreEntry` function unchanged (it's exported and tested) for single-entry use cases.

### 2. Modify `copyClaudeCommandsToWorktree` to gitignore individual copied files

In `adws/phases/workflowLifecycle.ts`:

- Replace the single `ensureGitignoreEntry(worktreePath, '.claude/commands/')` call on line 73 with a call to `ensureGitignoreEntries` using the `copiedFiles` array.
- Build the entries array from `copiedFiles`: `copiedFiles.map((file) => \`.claude/commands/${file}\`)`
- Call `ensureGitignoreEntries(worktreePath, gitignoreEntries)` only when `copiedFiles.length > 0`
- Example:
  ```typescript
  // Replace:
  ensureGitignoreEntry(worktreePath, '.claude/commands/');

  // With:
  if (copiedFiles.length > 0) {
    const gitignoreEntries = copiedFiles.map((file) => `.claude/commands/${file}`);
    ensureGitignoreEntries(worktreePath, gitignoreEntries);
  }
  ```

### 3. Update tests for per-file gitignore entries

In `adws/__tests__/ensureGitignoreEntry.test.ts`:

- Add a new `describe('ensureGitignoreEntries')` block (import `ensureGitignoreEntries` from `../phases/workflowLifecycle`):
  - **"adds multiple file entries with a single comment header"** — Given no existing `.gitignore` and 3 file entries, verify all 3 entries and exactly one comment header appear in the written content.
  - **"skips entries that already exist in .gitignore"** — Given a `.gitignore` containing `.claude/commands/bug.md`, pass `['.claude/commands/bug.md', '.claude/commands/chore.md']` and verify only `.claude/commands/chore.md` is added.
  - **"does not write when all entries already exist"** — Given a `.gitignore` containing all passed entries, verify `writeFileSync` is not called.
  - **"does nothing for empty entries array"** — Pass `[]` and verify no file read or write occurs.
  - **"creates .gitignore when file does not exist"** — Given `existsSync` returning false, verify file is created with the comment and all entries.
- Keep existing `ensureGitignoreEntry` tests as-is (the function is still exported and may be used elsewhere).

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
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`. Key requirements: strict TypeScript (no `any`), functional style (map/filter/reduce over loops), immutability, pure functions, meaningful variable names.
- The key insight from the reviewer is that ignoring `.claude/commands/` as a directory would hide the target project's OWN commands from git. Only the specific ADW-copied files should be ignored.
- The `ensureGitignoreEntries` bulk function is preferred over calling `ensureGitignoreEntry` in a loop because it results in a single file read/write and a single comment header, producing a cleaner `.gitignore` file.
- Files that already existed in the target repo's `.claude/commands/` are NOT overwritten by `copyClaudeCommandsToWorktree` (the `fs.existsSync(destPath)` check on line 62 prevents this), and therefore should NOT be added to `.gitignore` — they belong to the target project.
- The `ensureGitignoreEntry` function is already idempotent and remains unchanged for backwards compatibility.
