# Patch: Remove committed node_modules and fix .gitignore depth

## Metadata
adwId: `avb4f5-github-actions-worke`
reviewChangeRequest: `Issue #1: workers/screenshot-router/node_modules/ (1522 files, 809,842 lines) committed to git. Root .gitignore has /node_modules which only matches the root directory, not workers/screenshot-router/node_modules/. Introduced in commit bba05ae.`

## Issue Summary
**Original Spec:** `specs/issue-332-adw-avb4f5-github-actions-worke-sdlc_planner-deploy-workers-github-actions.md`
**Issue:** The root `.gitignore` uses `/node_modules` (leading slash) which only matches `node_modules/` at the repository root. This allowed `workers/screenshot-router/node_modules/` (1522 files, ~810K lines) to be committed and tracked by git, introduced in commit bba05ae.
**Solution:** Change `/node_modules` to `node_modules/` in `.gitignore` so it matches at any depth, then remove the tracked files from git's index with `git rm -r --cached`.

## Files to Modify

- `.gitignore` — Change `/node_modules` to `node_modules/` to match at any directory depth

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `.gitignore` to match `node_modules/` at any depth
- In `.gitignore`, change `/node_modules` to `node_modules/` (remove leading slash, ensure trailing slash)
- This ensures any `node_modules/` directory at any depth in the repo is ignored

### Step 2: Remove tracked `node_modules` from git index
- Run `git rm -r --cached workers/screenshot-router/node_modules/` to unstage all 1522 committed files
- This removes them from git tracking without deleting them from disk

### Step 3: Commit the cleanup
- Stage `.gitignore` and the removals
- Commit with a descriptive message explaining the fix

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git ls-files workers/screenshot-router/node_modules/ | wc -l` — Should output `0` (no tracked node_modules files)
- `git diff --cached --stat | tail -5` — Verify the staged changes show ~1522 file deletions and `.gitignore` modification
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-workers.yml'))"` — Validate existing workflow YAML still parses
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** 1 line in `.gitignore` + removal of 1522 tracked files from index
**Risk level:** low
**Testing required:** Verify no node_modules files remain tracked; verify .gitignore correctly ignores nested node_modules; verify build/lint still pass
