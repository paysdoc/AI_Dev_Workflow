# PR-Review: Restore Application Tests in test.md

## PR-Review Description
The PR reviewer (paysdoc) identified that the "Application Tests" section (test #6) was removed from `.claude/commands/test.md` in commit `e81b25f`. This section runs `npm test -- --run src` to validate application-level tests (tests under the `src/` directory). The reviewer states: "Application tests should not be removed, they are essential." The removal appears to have been an unintentional side-effect of the pre-PR commit cleanup, as the external repo feature has no reason to remove application-level testing from the validation suite.

## Summary of Original Implementation Plan
The original implementation plan (`specs/issue-1-adw-enable-adw-to-run-on-uwva44-sdlc_planner-external-repo-workspace.md`) describes enabling ADW to operate on external git repositories by:
- Introducing a `TargetRepoManager` module to manage workspace directories for external repos
- Extracting target repo info from webhook/cron payloads
- Propagating target repo context through the entire workflow lifecycle
- Updating GitHub API modules, worktree operations, and workflow phases to support external repo context
- Keeping all ADW state (logs, agents, specs) in the ADW repository while operating on external repos

The plan did not include any changes to `.claude/commands/test.md`. The removal of the Application Tests section was not part of the original plan and was an unintended change.

## Relevant Files
Use these files to resolve the review:

- `.claude/commands/test.md` — The test validation suite command file where the "Application Tests" section was incorrectly removed. This is the only file that needs to be modified to resolve this review comment.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore the Application Tests section in test.md
- In `.claude/commands/test.md`, restore the "Application Tests" section that was removed
- The section should be re-added after the "Build" section (test #5) and before the "## Report" section
- The restored content must match the original from the `main` branch exactly:
  ```markdown
  ### Application Tests

  6. **Application Tests**
     - Command: `npm test -- --run src`
     - test_name: "app_tests"
     - test_purpose: "Validates all ADW (AI Developer Workflow) script functionality including workflow execution and utilities"
  ```
- Note: The `test_purpose` in the original file incorrectly says "ADW" — this is an existing issue from `main` and should be preserved as-is to keep the change minimal and focused on the review comment

### Step 2: Verify the restoration is correct
- Run `git diff main -- .claude/commands/test.md` to confirm the "Application Tests" section no longer appears as a removed section in the diff
- The diff should show zero changes for this file (assuming no other modifications were made to test.md in this branch)

### Step 3: Run validation commands
- Run all validation commands listed below to confirm zero regressions

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the review is complete with zero regressions

## Notes
- This is a minimal, single-file change. The "Application Tests" section was removed as an unintended side-effect of the pre-PR commit and needs to be restored verbatim.
- The test command `npm test -- --run src` validates application tests under the `src/` directory, which is separate from the ADW tests (`adws/__tests__/`). Both test suites are essential for full validation coverage.
