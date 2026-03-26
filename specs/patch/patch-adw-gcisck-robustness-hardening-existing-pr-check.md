# Patch: Add existing PR check before gh pr create in createMergeRequest()

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #7: No existing PR check in githubCodeHost.ts createMergeRequest(). Re-runs crash with 'pull request already exists' instead of reusing the existing PR. Resolution: Before gh pr create, run gh pr list --head <branch> --json url,number. If PR exists, return its URL/number. Use execWithRetry for both calls.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** When a workflow re-runs for the same issue, `createMergeRequest()` calls `gh pr create` without checking if a PR for that branch already exists. This crashes with "a pull request for branch X already exists" instead of reusing the existing PR.
**Solution:** Before calling `gh pr create`, query `gh pr list --head <sourceBranch>` to check for an existing PR. If found, return its URL and number directly. Use `execWithRetry` for both the list check and the create call. This patch depends on the `execWithRetry` utility from `patch-adw-gcisck-robustness-hardening-create-exec-with-retry.md` being applied first.

## Files to Modify
Use these files to implement the patch:

1. `adws/providers/github/githubCodeHost.ts` — Add existing PR check before `gh pr create`, switch `execSync` to `execWithRetry`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update imports in `githubCodeHost.ts`
- Add `import { execWithRetry } from '../../core';`
- Add `import { log } from '../../core/logger';`
- Remove `execSync` from the `'child_process'` import (no longer needed after replacement)

### Step 2: Add existing PR check and replace execSync in `createMergeRequest()`
- After `refreshTokenIfNeeded()` (line 81) and before the temp file creation (line 83), add the existing PR check:
  - Build the `gh pr list` command: `gh pr list --head "${options.sourceBranch}" --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --json url,number --limit 1`
  - Execute with `execWithRetry(command, { encoding: 'utf-8' })`
  - Parse the JSON result (will be an array)
  - If the array has at least one element, log `"Existing PR found for branch ${options.sourceBranch}, reusing PR #${pr.number}"` and return `{ url: pr.url, number: pr.number }` immediately
- Replace the existing `execSync` call for `gh pr create` (line 90-93) with `execWithRetry`, using the same options minus `encoding` since `execWithRetry` returns a trimmed string
  - Pass `{ encoding: 'utf-8', shell: '/bin/bash' }` to preserve the existing shell behavior

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — passes with no errors
2. `bun run build` — passes with no build errors
3. `bunx tsc --noEmit` — root TypeScript type checking passes
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes

## Patch Scope
**Lines of code to change:** ~15 (3 import changes, ~10 lines for existing PR check, 1 line execSync→execWithRetry replacement)
**Risk level:** low
**Testing required:** TypeScript compilation and linting. Manual verification requires a real GitHub repo with an existing PR for a branch.
