# Patch: Remove re-introduced CSV files from projects/ directory

## Metadata
adwId: `ak03s5-remove-csv-cost-pipe`
reviewChangeRequest: `Issue #1: The projects/ directory still exists with 4 tracked CSV files re-introduced by an in-progress merge. Acceptance criteria require "No CSV files remain in projects/ directory" and "projects/ directory removed from git".`

## Issue Summary
**Original Spec:** `specs/issue-335-adw-ak03s5-remove-csv-cost-pipe-sdlc_planner-remove-csv-cost-pipeline.md`
**Issue:** An in-progress merge (status: "All conflicts fixed but you are still merging") re-introduced 4 CSV files in `projects/AI_Dev_Workflow/`: `332-github-actions-worker-deploy-workflow.csv`, `334-adw-d1-client-and-dual-write-integration.csv`, `335-remove-csv-cost-pipeline.csv`, and `total-cost.csv`. Additionally, `README.md` remains in an unmerged state (UU).
**Solution:** Resolve the README.md merge conflict, run `git rm -r projects/` to remove the re-introduced CSV files, then complete the merge commit so the `projects/` directory is fully gone.

## Files to Modify
Use these files to implement the patch:

- `projects/` — Remove entire directory via `git rm -r`
- `README.md` — Resolve unmerged state by staging the current (conflict-free) version

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Resolve README.md merge state
- The README.md file shows UU (unmerged) status but has no conflict markers remaining — the content is already correct.
- Run `git add README.md` to mark the merge conflict as resolved.

### Step 2: Remove the projects/ directory from git
- Run `git rm -r projects/` to remove all 4 re-introduced CSV files from the index:
  - `projects/AI_Dev_Workflow/332-github-actions-worker-deploy-workflow.csv`
  - `projects/AI_Dev_Workflow/334-adw-d1-client-and-dual-write-integration.csv`
  - `projects/AI_Dev_Workflow/335-remove-csv-cost-pipeline.csv`
  - `projects/AI_Dev_Workflow/total-cost.csv`
- Verify `projects/` no longer appears in `git status` or `git ls-files`.

### Step 3: Complete the merge commit
- The worktree is in an active merge state ("All conflicts fixed but you are still merging"). After steps 1-2, all conflicts are resolved and unwanted files removed.
- Run `git commit` (no `--no-edit`) to finalize the merge with an appropriate message that notes the removal of re-introduced CSV files.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git ls-files projects/` — Should return empty (no tracked CSV files).
- `test ! -d projects/ && echo "PASS: projects/ removed"` — Confirm directory no longer exists on disk.
- `git status` — Should show a clean working tree with no unmerged paths.
- `bunx tsc --noEmit` — Type-check passes (no broken imports from this change).
- `bun run test` — Run test suite to confirm no regressions.

## Patch Scope
**Lines of code to change:** 0 (only git index operations — removing files, resolving merge)
**Risk level:** low
**Testing required:** Verify `projects/` directory is gone from git tracking and no unmerged paths remain.
