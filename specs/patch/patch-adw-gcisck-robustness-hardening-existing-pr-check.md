# Patch: Add existing PR check before gh pr create in createMergeRequest()

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #7: Existing PR check (spec Step 6) not implemented. githubCodeHost.ts createMergeRequest() does not check gh pr list --head before creating, so re-runs will fail on duplicate PR. Resolution: Add gh pr list --head <branch> check before gh pr create in createMergeRequest(), reusing existing PR if found.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** When a workflow re-runs for the same issue, `createMergeRequest()` calls `gh pr create` without checking if a PR for that branch already exists. This causes a crash: "a pull request for branch X already exists."
**Solution:** Before creating the temp file and calling `gh pr create`, query `gh pr list --head <sourceBranch> --repo <owner/repo> --json url,number --limit 1`. If a PR already exists, log the reuse and return its URL and number immediately, skipping the create entirely. Uses `execSync` (already imported) for minimal diff. When `execWithRetry` lands from the foundation patch, this call can be upgraded.

## Files to Modify
Use these files to implement the patch:

1. `adws/providers/github/githubCodeHost.ts` — Add existing PR check before `gh pr create`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add logger import to `githubCodeHost.ts`
- Add `import { log } from '../../core/logger';` after the existing imports (after line 27)

### Step 2: Add existing PR check at the start of `createMergeRequest()`
- After `refreshTokenIfNeeded()` (line 81) and **before** the `mkdtempSync` call (line 83), insert the existing PR check:
  ```typescript
  // Check for existing PR on this branch before creating a new one
  try {
    const existingPrJson = execSync(
      `gh pr list --head "${options.sourceBranch}" --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --json url,number --limit 1`,
      { encoding: 'utf-8' },
    ).trim();
    const existingPrs: Array<{ url: string; number: number }> = JSON.parse(existingPrJson);
    if (existingPrs.length > 0) {
      log(`Existing PR found for branch ${options.sourceBranch}, reusing PR #${existingPrs[0].number}`);
      return { url: existingPrs[0].url, number: existingPrs[0].number };
    }
  } catch {
    // If the existing PR check fails, fall through to create a new one
  }
  ```
- The try/catch ensures a failure in the list query does not block PR creation — it falls through to the existing `gh pr create` logic

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — passes with no errors
2. `bun run build` — passes with no build errors
3. `bunx tsc --noEmit` — root TypeScript type checking passes
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes

## Patch Scope
**Lines of code to change:** ~14 (1 import line, ~13 lines for existing PR check with try/catch)
**Risk level:** low
**Testing required:** TypeScript compilation and linting. Manual verification requires a real GitHub repo with an existing PR for a branch.
