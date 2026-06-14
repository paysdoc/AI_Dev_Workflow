# adwUpgrade PR Closing Keyword Fix

**ADW ID:** nm1413-adwupgrade-pr-body-u
**Date:** 2026-06-14
**Specification:** specs/issue-570-adw-nm1413-adwupgrade-pr-body-u-sdlc_planner-fix-upgrade-pr-closing-keyword.md

## Overview

`adwUpgrade.tsx` was building its PR body with `Implements #N` as the sole issue reference, which is not a GitHub closing keyword. This caused upgrade tracking issues to remain permanently `OPEN` after an upgrade PR merged, which in turn permanently blocked any dependent issues parked with `## Blocked by #N`. The fix adds a `Closes #N` line to the PR body while keeping `Implements #N` as a defense-in-depth backstop for `linkedPrDetector`.

## What Was Built

- Added `Closes #${issueNumber}` line to `buildUpgradePrBody()` so upgrade PRs auto-close their tracking issue on merge
- Corrected two misleading doc comments in `adwUpgrade.tsx` that falsely claimed `Implements #N` auto-closes issues
- Added unit test assertions verifying the body contains `Closes #541` in both the `buildUpgradePrBody` unit test and the `executeUpgrade` integration test

## Technical Implementation

### Files Modified

- `adws/adwUpgrade.tsx`: Added `Closes #${issueNumber}` line after `Implements #${issueNumber}` in `buildUpgradePrBody()`; corrected file-header JSDoc and `buildUpgradePrBody` JSDoc to accurately describe the two-line scheme
- `adws/__tests__/adwUpgrade.test.ts`: Added sibling test in `describe('buildUpgradePrBody')` asserting `toContain('Closes #541')`; added sibling test in `describe('executeUpgrade — success path')` asserting `call.body` matches `/Closes #541/`

### Key Changes

- **Additive fix**: `Closes #N` is added as the second line; `Implements #N` stays as the first line. GitHub's closing keyword fires on merge-to-default-branch and creates the linked-PR relationship Projects V2 renders (the PR chip / Development section).
- **Defense-in-depth preserved**: `adws/github/linkedPrDetector.ts` (`hasLinkedMergedOrClosedPR`) scans for `Implements #<issueNumber>(?!\d)`. Keeping `Implements #N` ensures `concurrencyGuard` and `cronLabelEligibility` still recognise a merged upgrade PR even if auto-close ever silently fails.
- **Same-repo form used**: Plain `Closes #N` is correct because the `#UPG` tracking issue (created in `upgradeGate.ts`) and the upgrade PR (opened in `adwUpgrade.tsx`) always live in the same target repo. No `Closes owner/repo#N` cross-repo form is needed.
- **Root cause correction**: The `Implements` keyword only creates a bare cross-reference (`cross-referenced` timeline event). GitHub auto-close (and the `connected`/development link) requires `Closes`, `Fixes`, or `Resolves`. The bug was masked by incorrect doc comments asserting the old keyword auto-closed.
- **Blast radius**: `findOpenDependencies` (`adws/triggers/issueDependencies.ts`) gates eligibility on `getIssueState === 'OPEN'`. A never-closing tracking issue permanently blocks all dependents. The fix restores the expected state machine.

## How to Use

This fix is transparent — no configuration changes are required. When an `adwUpgrade` PR merges into the default branch of a target repo:

1. GitHub reads the `Closes #N` keyword and auto-closes the upgrade tracking issue
2. The tracking issue gets a Development-section PR link and a PR chip on the project board
3. On the next cron tick, `findOpenDependencies` sees the tracking issue as `CLOSED`, and any dependent issues parked with `## Blocked by #N` become eligible again

## Configuration

None. The fix is fully contained in `buildUpgradePrBody()`. The plain `Closes #N` form does not require `owner/repo` prefix because the tracking issue and upgrade PR are always in the same repo (enforced by `upgradeGate.ts` and `adwUpgrade.tsx` both using the target `repoInfo`/`repoId`).

## Testing

```bash
# Focused test — verifies both Implements and Closes assertions pass
bunx vitest run adws/__tests__/adwUpgrade.test.ts

# Full suite — zero regressions
bun run test:unit

# Type checks
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Build
bun run build
```

## Notes

- **Confirmed incident (2026-06-11)**: Issue #565 was parked behind tracking issue #566. Two upgrade PRs (#567, #568) merged successfully but #566 stayed `OPEN` because both PR bodies used `Implements #566`. Issue #565 remained permanently blocked.
- **Out of scope**: Duplicate `adwUpgrade` spawn (#567 + #568 — a `findPRByBranch` TOCTOU race) and non-deterministic `/adw_init` regeneration are tracked as separate follow-ups.
- **`adwMerge.tsx` not involved**: Neither `adwMerge.tsx` nor `adwUpgrade.tsx` calls `closeIssue()` — issue closure in both the normal SDLC path and the upgrade path is driven purely by the PR-body closing keyword, consistent with `.claude/commands/pull_request.md:25`.
