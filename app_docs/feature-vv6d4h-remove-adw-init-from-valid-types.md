# Remove `/adw_init` from `VALID_ISSUE_TYPES`

**ADW ID:** vv6d4h-classifier-can-assig
**Date:** 2026-06-15
**Specification:** specs/issue-584-adw-vv6d4h-classifier-can-assig-sdlc_planner-remove-adw-init-from-valid-types.md

## Overview

The AI classifier and `--issue-type` CLI override could assign an issue the `/adw_init` bootstrap type even though its dedicated orchestrator was removed in #547. Because `/adw_init` had no orchestrator mapping it fell back to `adwPlanBuildTest.tsx`, ran as a plan agent that writes no plan file, and the build phase crashed with `ENOENT` — blocking the issue. This fix removes `/adw_init` from `VALID_ISSUE_TYPES` (the array both the classifier regex and CLI validation draw from), while keeping it in the `IssueClassSlashCommand`/`SlashCommand` unions so all dependent maps keep compiling.

## What Was Built

- Removed `/adw_init` from the `VALID_ISSUE_TYPES` array in `adws/types/issueTypes.ts`, narrowing it to the four real auto-runnable workflow types: `/chore`, `/bug`, `/feature`, `/pr_review`
- Added an explanatory comment above the array documenting why `/adw_init` is excluded
- Added regression test `adws/core/__tests__/issueClassifier.test.ts` with three test cases (domain invariant, cannot route to `/adw_init`, degrades to last real type)
- Added two JSONL test fixture payloads (`classify-bug-then-adw-init.json`, `classify-emits-adw-init-only.json`) for the regression scenarios

## Technical Implementation

### Files Modified

- `adws/types/issueTypes.ts`: Removed `/adw_init` from the `VALID_ISSUE_TYPES` array; added comment explaining the exclusion

### New Files

- `adws/core/__tests__/issueClassifier.test.ts`: Regression test covering domain invariant and `/adw_init` degradation behaviour
- `features/per-issue/feature-584.feature`: BDD feature file for this bugfix
- `features/per-issue/step_definitions/feature-584.steps.ts`: Step definitions for the BDD scenarios
- `test/fixtures/jsonl/payloads/classify-bug-then-adw-init.json`: Fixture for "last real type wins" scenario
- `test/fixtures/jsonl/payloads/classify-emits-adw-init-only.json`: Fixture for "only `/adw_init` in output → `/feature`" scenario

### Key Changes

- **`VALID_ISSUE_TYPES` array** (the single production change): dropping `/adw_init` from this array simultaneously removes it from the classifier's capture regex (built from the array at `issueClassifier.ts:67`) and from the `--issue-type` CLI validation domain (`orchestratorCli.ts:57`). No changes to those files were required.
- **`IssueClassSlashCommand` / `SlashCommand` unions remain intact**: all `Record<IssueClassSlashCommand, ...>` maps (`commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases`, model routing, comments) and the manual init/upgrade flow keep compiling without modification.
- **Classifier degradation**: when the AI model emits `/adw_init`, the regex built from `VALID_ISSUE_TYPES` no longer matches it; `classifyWithIssueCommand` falls back to the last captured real type or defaults to `/feature` — the same safe fallback already used for unrecognised output.
- **CLI rejection**: `--issue-type /adw_init` is now an invalid value and prints a usage error listing only the four real types.
- **`workflowMapping.test.ts` untouched**: that test documents the intentional `/adw_init` → undefined → fallback mapping and still compiles because the union is unchanged.

## How to Use

This is a transparent bug fix. No operator action is required after it merges. Existing issues in the queue that were mis-classified as `/adw_init` (e.g. issue #576) should be manually reset:

1. Run `## Cancel` on any issue stuck in `Blocked` due to the `ENOENT` failure.
2. The issue re-enters the queue and the classifier now routes it to a real workflow type.
3. Optionally clean up the stranded worktree (`.worktrees/adwinit-issue-576-adw-yml-unit-test-gate`) and the misplaced plan file (`specs/issue-576-adw-adw-unknown-sdlc_planner-*.md`) from the main repo root.

## Configuration

No configuration changes. The fix is a one-line array change in `adws/types/issueTypes.ts`.

## Testing

```bash
# Type checks
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Linting
bun run lint

# Build
bun run build

# Full unit suite (includes new regression test and unchanged workflowMapping.test.ts)
bun run test:unit

# Targeted regression test only
bunx vitest run adws/core/__tests__/issueClassifier.test.ts
```

To confirm the test guards the bug: temporarily re-add `/adw_init` to `VALID_ISSUE_TYPES` — Test A and Test B go RED. Restore the fix — GREEN.

## Notes

- The `adw:*` label-override path was never able to produce `/adw_init` (`issueTypeToAdwLabel('/adw_init')` returns `null`), so the classifier and `--issue-type` CLI were the only two producers. This fix closes both paths at the source.
- Root-cause context for why `/adw_init` lost its orchestrator: see `app_docs/feature-cy2xzc-delete-adwinit-tsx-orchestrator.md` (#547).
- Classifier routing and `/classify_issue` context: see `app_docs/feature-u8okxe-bug-sdlc-chore-classifier.md`.
- The `ENOENT` crash site is `adws/phases/buildPhase.ts:49–56` (`getPlanFilePath` / `readFileSync` on the legacy `specs/issue-{N}-plan.md` fallback). No change was made there.
