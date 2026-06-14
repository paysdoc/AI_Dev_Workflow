# Fix adwUpgrade: Regen Gate, Command Availability, and Asset Propagation

**ADW ID:** t6m62c-fix-adwupgrade-regen
**Date:** 2026-06-14
**Specification:** specs/issue-572-adw-t6m62c-fix-adwupgrade-regen-sdlc_planner-regen-gate-propagation.md

## Overview

`adwUpgrade.tsx` was permanently bricking target repos by stamping `.adw-version` after a no-op `/adw_init` run (the command file wasn't present in the worktree, so the agent exited 0 without writing anything). This fix adds a `adw_init.md` pre-copy step, an anti-brick verification gate, and replaces the two dead copy helpers with a single merged function that propagates all commands and skills into worktrees.

## What Was Built

- **§0 Conflict resolution:** Restored the idempotency/wontfix guard in `adwUpgrade.tsx` that was lost in an unresolved `git stash pop` (`d50cdbd`), and wired `findPRByBranch` into `UpgradeDeps`.
- **§A `copyAdwInitCommandToWorktree`:** New helper that copies `adw_init.md` from the framework repo into the upgrade worktree before `/adw_init` runs, then gitignores it so it stays out of the PR.
- **§B `verifyAdwRegen` gate:** Post-init check that verifies all six canonical `.adw/` files exist and are non-empty, `features/regression/vocabulary.md` exists, and `git status --porcelain -- .adw` is non-empty. Blocks `.adw-version` stamp and PR on failure, enabling self-healing retry.
- **§D `copyClaudeAssetsToWorktree`:** Merged replacement for `copyClaudeCommandsToWorktree` (copy-if-absent, commands only) and `copyTargetSkillsAndCommands` (dead code, no callers). New function copies all commands and all skills, always overwriting, with gitignore policy: `target: false` → gitignored for run-availability; `target: true` → committable for propagation; already-tracked files never re-gitignored (#267 invariant).
- **§C Recovery runbook:** Added to `adws/known_issues.md` for already-bricked repos.
- **E1–E4 unit tests:** Gate-fail path, gate-pass path, call-order assertion, and fixture test for `copyClaudeAssetsToWorktree`.

## Technical Implementation

### Files Modified

- `adws/adwUpgrade.tsx`: Resolved conflict markers; added `findPRByBranch`, `copyInitCommandToWorktree`, `verifyAdwRegen` to `UpgradeDeps`; wired all three into `buildDefaultUpgradeDeps`; inserted §A copy step before `runInitCommand` and §B gate between `runInitCommand` and `writeAdwVersion`.
- `adws/phases/worktreeSetup.ts`: Added `REQUIRED_ADW_FILES`, `copyAdwInitCommandToWorktree`, `verifyAdwRegen`, `copyClaudeAssetsToWorktree`, `getTrackedBasenames`, `getTrackedTopDirs`; deleted `copyClaudeCommandsToWorktree` and `copyTargetSkillsAndCommands`.
- `adws/phases/workflowInit.ts`: Replaced both `copyClaudeCommandsToWorktree` call sites with `copyClaudeAssetsToWorktree`; updated import and re-export.
- `adws/phases/index.ts`: Re-exports `copyClaudeAssetsToWorktree`; dropped deleted names.
- `adws/workflowPhases.ts`: Removed dead `copyTargetSkillsAndCommands` re-export.
- `adws/__tests__/adwUpgrade.test.ts`: Resolved conflict markers; added `findPRByBranch`, `copyInitCommandToWorktree`, `verifyAdwRegen` to `makeDeps`; added E1–E3 tests.
- `adws/phases/__tests__/workflowInit.test.ts`: Updated `vi.mock` surface to `copyClaudeAssetsToWorktree`.
- `adws/phases/__tests__/worktreeSetup.test.ts`: New fixture test file for E4.
- `adws/known_issues.md`: Appended §C recovery runbook.
- `features/per-issue/feature-572.feature`: BDD scenarios for E1–E4.
- `features/per-issue/step_definitions/feature-572.steps.ts`: Step definitions.

### Key Changes

- **Anti-brick gate** in `executeUpgrade` (step 5b): `verifyAdwRegen` returns `{ ok: false }` → post failure comment, return `{ outcome: 'failed', reason: 'regen_incomplete' }`, skip stamp/PR entirely. Next cron tick re-dispatches; idempotency guard sees no PR on the claim branch and safely re-runs.
- **Command pre-copy** (step 4): `copyInitCommandToWorktree(worktreePath, frameworkRepoRoot)` runs before `runInitCommand` so `/adw_init` can actually expand in the worktree.
- **`git status --porcelain -- .adw`** (not `git diff`) is used in `verifyAdwRegen` to catch the virgin-repo case where `.adw/` is entirely untracked (added files, not modifications).
- **Overwrite-always** in `copyClaudeAssetsToWorktree` replaces the old copy-if-absent policy so existing targets refresh skills and commands on each workflow init.
- **`target:` flag gitignore policy**: `target: false` assets are gitignored for run-availability only; `target: true` assets are left committable for propagation into product repos.

## How to Use

The gate and copy step are automatic — no operator action required for new upgrades. For repos already bricked before this fix:

1. Identify bricked repos: `.adw-version` equals the current framework hash **but** the repo has no `.adw/` directory.
2. Reset `.adw-version` to force re-trigger: see `adws/known_issues.md` → "Recovering already-bricked target repos".
3. The next cron dispatch will re-run `adwUpgrade` with the §B gate active; if `/adw_init` completes successfully the upgrade PR will contain a full `.adw/` regen.

## Configuration

No new configuration. Three new `UpgradeDeps` fields — `findPRByBranch`, `copyInitCommandToWorktree`, `verifyAdwRegen` — have defaults wired in `buildDefaultUpgradeDeps` and are injectable for testing.

## Testing

```bash
# Confirm no conflict markers remain
git grep -nE '^(<<<<<<<|=======|>>>>>>>)$'

# Type check
bunx tsc --noEmit -p adws/tsconfig.json

# Directly-affected suites (E1–E4 + idempotency guard + workflowInit determinism)
bunx vitest run adws/__tests__/adwUpgrade.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/phases/__tests__/workflowInit.test.ts

# Full unit suite
bun run test:unit

# Confirm old helpers fully removed from code
git grep -nE "copyClaudeCommandsToWorktree|copyTargetSkillsAndCommands" -- 'adws/**'
```

## Notes

- **End-to-end LLM verification** (does `/adw_init` actually write `.adw/`?) remains a manual smoke check — the mock CLI stub cannot write files in CI. Run `adwUpgrade` against a sandbox target to validate the full path.
- **Residual edge:** a framework hash bump whose regenerated `.adw/` output is byte-identical to the target's existing files will produce an empty `git status` and fail the gate, triggering re-dispatch. This is unlikely (hash inputs include `adw_init.md` + `vocabulary.md.template`) and is the intentional trade for catching no-op bricks. See `adws/known_issues.md` for the operator symptom.
- **`target: false` overwrite collision:** a target repo that has committed its own command/skill at a colliding name cannot be gitignored (gitignore can't untrack). ADW's version overwrites theirs and `git add -A` commits it. Rare; consistent with "ADW wins". Deferred.
- **Skill count:** §D is generic over the `target:` flag — no hardcoded skill count. Current `target: true` skill count is seven.
