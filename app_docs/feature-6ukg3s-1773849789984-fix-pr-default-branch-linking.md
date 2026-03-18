# Fix PR Default Branch Linking

**ADW ID:** 6ukg3s-1773849789984
**Date:** 2026-03-18
**Specification:** specs/issue-237-adw-bwzl49-prs-target-main-inst-sdlc_planner-fix-pr-default-branch-linking.md

## Overview

Fixes two related PR creation bugs that surface when ADW targets a foreign repository: PRs were targeting `main` instead of the repo's actual default branch, and GitHub cross-repo issue linking was broken because bare `#N` references don't auto-link across repositories. Both failures stemmed from the PR creation chain lacking the target repository's owner and name.

## What Was Built

- `repoOwner` and `repoName` parameters propagated through the full PR creation chain (`prPhase.ts` → `prAgent.ts` → `pull_request.md` and `pullRequestCreator.ts`)
- Slash command `pull_request.md` updated to use `gh repo view` as the default branch fallback instead of hardcoding `main`
- Qualified issue references (`owner/repo#N`) used in PR bodies when cross-repo context is available, falling back to bare `#N` for same-repo PRs
- BDD feature file and step definitions covering all changed behaviours

## Technical Implementation

### Files Modified

- `adws/agents/prAgent.ts`: Added `repoOwner` and `repoName` optional params to `runPullRequestAgent()` and required params to `formatPullRequestArgs()`; appended them as `$6`/`$7` in the args array; added log lines
- `adws/phases/prPhase.ts`: Extracted `repoOwner`/`repoName` from `config.repoContext?.repoId` and passed them to `runPullRequestAgent()`
- `.claude/commands/pull_request.md`: Added `$6` (repoOwner) and `$7` (repoName) variables; changed default branch fallback from `'main'` to `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`; updated issue reference instruction to use qualified form when owner/name are present
- `adws/github/pullRequestCreator.ts`: Added `repoOwner?`/`repoName?` to `generatePrBody()` and `createPullRequest()`; builds `owner/repo#N` reference when both are non-empty

### Key Changes

- **Default branch hardcode removed**: The slash command no longer tells the AI to fall back to `main`; it now instructs querying `gh repo view` — consistent with what `getDefaultBranch()` already does at the TypeScript level
- **Cross-repo issue linking**: `generatePrBody()` and the slash command both produce `Closes owner/repo#N` when `repoOwner` and `repoName` are non-empty, satisfying GitHub's requirement for cross-repo PR-to-issue linking
- **Backward compatible**: Both new parameters are optional; same-repo PRs and callers that don't supply them fall back to the previous bare `#N` behaviour
- **No new dependencies**: Purely a parameter-passing change across four files

## How to Use

Cross-repo issue linking and correct default branch targeting are automatic when `config.repoContext.repoId` is populated (i.e., `.adw/providers.md` is configured for the target repo). No manual steps are needed.

To verify the fix for a given target repo:
1. Ensure the target repo's `owner` and `repo` are set in `.adw/providers.md`
2. Run the ADW workflow (e.g., `bunx tsx adws/adwPlanBuild.tsx <issueNumber>`)
3. Confirm the created PR targets the repo's actual default branch (not `main`)
4. Confirm the PR body contains `Closes owner/repo#N` linking to the correct cross-repo issue

## Configuration

No new configuration required. The fix reads `repoContext.repoId` which is already set via `.adw/providers.md` → `createRepoContext()`.

## Testing

Run the tagged BDD scenarios:

```bash
bunx cucumber-js --tags "@adw-237"
```

Run regression suite to confirm no regressions:

```bash
bunx cucumber-js --tags "@regression"
```

Spot-check the slash command:

```bash
grep "gh repo view" .claude/commands/pull_request.md   # should match
grep '\$6' .claude/commands/pull_request.md            # should match
grep '\$7' .claude/commands/pull_request.md            # should match
```

## Notes

- `pullRequestCreator.ts`'s `createPullRequest()` is not invoked by the slash command flow (which uses `gh pr create` directly), but was updated for consistency in case it is called directly in future.
- The `getDefaultBranch()` function in `branchOperations.ts` was not changed — it already uses `gh repo view` correctly.
- Be careful not to conflict with the PR auth token fix (issue #236) in `pull_request.md`: only the `## Variables` and `## Instructions` sections were modified; the `## Run` section is unchanged.
