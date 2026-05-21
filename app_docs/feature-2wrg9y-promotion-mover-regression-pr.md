# Promotion Mover — @promotion tag opens a separate regression-promotion PR

**ADW ID:** 2wrg9y-promotion-mover-prom
**Date:** 2026-05-21
**Specification:** specs/issue-511-adw-2wrg9y-promotion-mover-prom-sdlc_planner-promotion-mover-regression-pr.md

## Overview

This slice completes the HITL promotion loop started by issue #509 (`promotionCommenter`). When a human edits a `@promotion-suggested-<date>` tag to bare `@promotion` on a per-issue scenario, the `promotionMover` orchestrator detects the approval on the next per-issue PR event and opens a separate PR that moves the scenario block into the regression directory — stripping all promotion tags in the destination and labelling the new PR `regression-promotion`. The `adwPromotionSweep.tsx` entry point now runs commenter-then-mover in a single invocation.

## What Was Built

- **`promotionApprovalDetector`** — pure function `detectApprovals(content)` that returns approved scenarios (those with exactly `@promotion`, excluding `@promotion-suggested-<date>`) with their line ranges and names
- **`promotionMover`** coordination module — thin orchestrator that composes deep modules and owns all GitHub/git/filesystem side effects (branch creation, file move, commit, push, PR open, label apply)
- **Extended `promotionTagWriter`** — two new `TagState` operations: `'remove-suggestion'` (strips `@promotion-suggested-<date>`) and `'strip-approval'` (strips bare `@promotion`)
- **Extended `types.ts`** — widened `TagState` union; new interfaces `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult`; `Scenario.name` field added
- **Extended `adwPromotionSweep.tsx`** — calls `runPromotionMover` after `runPromotionCommenter`; shared `fetchChangedFilesFromPR` helper; `buildMoverDeps` factory wiring real I/O
- **Smoke scenario** — `features/regression/smoke/promotion_mover.feature` (pending on ISSUE-3-CUTOVER; documents the contract)
- **Per-issue step definitions** — `features/per-issue/step_definitions/feature-511.steps.ts` (pending stubs)
- **Eight mock manifest fixtures** — under `test/fixtures/jsonl/manifests/promotion-mover-*.json`
- **README `### Scenario Promotion` subsection** — documents both tags, the human edit gate, the move PR shape, and the 14-day sweep behaviour

## Technical Implementation

### Files Modified

- `adws/promotion/types.ts`: widened `TagState`; added `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult` interfaces; added `name: string` to `Scenario`
- `adws/promotion/promotionTagWriter.ts`: added `'remove-suggestion'` and `'strip-approval'` dispatch branches in `applyTagState`
- `adws/promotion/scenarioParser.ts`: populated `Scenario.name` from `GherkinScenario.name`
- `adws/promotion/index.ts`: re-exports `detectApprovals`, `runPromotionMover`, and new types
- `adws/adwPromotionSweep.tsx`: extracted shared `fetchChangedFilesFromPR`; renamed commenter dep factory; added `buildMoverDeps`; calls both orchestrators in `main()`
- `README.md`: added `### Scenario Promotion` subsection under `## Testing`

### New Files

- `adws/promotion/promotionApprovalDetector.ts`: pure `detectApprovals` function (14 lines)
- `adws/promotion/promotionMover.ts`: `runPromotionMover` + 4 internal helpers (`slugify`, `extractIssueNumberFromPerIssuePath`, `extractScenarioBlock`, `renderRegressionFile`, `stripPromotionTags`) — ~203 lines
- `adws/promotion/__tests__/promotionApprovalDetector.test.ts`: 5 cases (happy path, exclusion of dated tags, mixed block, multiple, empty)
- `adws/promotion/__tests__/promotionMover.test.ts`: 11 dep-injection cases covering single move, no approvals, suggested-only, multiple scenarios, idempotency, file mutation, fallback dir, tag stripping, non-per-issue skip, deleted file skip
- `features/regression/smoke/promotion_mover.feature`
- `features/per-issue/step_definitions/feature-511.steps.ts`
- `test/fixtures/jsonl/manifests/promotion-mover-{single-move,labeled,strip-tag,removes-source,suggested-only,no-action,multiple-approvals,mixed-tags}.json`

### Key Changes

- **Approval detection is strict**: `tags.some(t => t === '@promotion')` — exact equality, not substring match — so `@promotion-suggested-2026-05-21` is never treated as an approval.
- **Idempotency via branch lookup**: `findExistingPR(branchName)` is called before any worktree creation; if the move PR already exists, the scenario is recorded as `skipped: true` and no duplicate PR is opened.
- **Tag stripping uses regex with negative lookahead**: `'strip-approval'` uses `/\s*@promotion\b(?!-suggested)/g` to strip bare `@promotion` without touching `@promotion-suggested-<date>`.
- **Worktree isolation**: each move PR gets its own worktree at `.worktrees/regression-promotion-issue-{N}-{slug}` — the active per-issue worktree is never mutated.
- **Regression directory fallback**: if `loadScenariosConfig()` returns `regressionScenarioDirectory: undefined`, the mover falls back to `features/regression/`.

## How to Use

1. The `promotionCommenter` (running as part of `adwPromotionSweep`) tags high-scoring scenarios with `@promotion-suggested-<date>` and posts a PR comment listing candidates.
2. To approve a scenario, edit the tag in the per-issue `.feature` file: change `@promotion-suggested-2026-05-21` to `@promotion` (remove the date suffix).
3. Push the edit (or include it in the next commit to the per-issue PR branch).
4. On the next per-issue PR event, `adwPromotionSweep.tsx` automatically calls the mover. It opens a new PR on branch `regression-promotion-issue-{N}-{slug}` labelled `regression-promotion`, which moves the approved scenario into `features/regression/` with all promotion tags stripped.
5. The source scenario is removed from the per-issue file on that same branch.
6. Review and merge the `regression-promotion` PR to complete the promotion.

To invoke manually:
```bash
bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]
```

## Configuration

- **`## Regression Scenario Directory`** in `.adw/scenarios.md` — sets the destination directory for promoted scenarios. Falls back to `features/regression/` if absent.
- **`regression-promotion` GitHub label** — must already exist on the repository before the mover runs. Create it manually or via `gh label create regression-promotion --color 0075ca`.
- **Destination filename pattern**: `promoted-from-feature-{issueNumber}-{slug}.feature` where `slug` is derived from the scenario name (lowercased, hyphenated, max 50 chars).

## Testing

```bash
# Unit tests (all new + existing)
bun run test:unit

# Target new tests individually
bunx vitest run adws/promotion/__tests__/promotionApprovalDetector.test.ts
bunx vitest run adws/promotion/__tests__/promotionMover.test.ts
bunx vitest run adws/promotion/__tests__/promotionTagWriter.test.ts

# Smoke scenario dry-run (pending ISSUE-3-CUTOVER)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke" --dry-run

# Per-issue BDD scenarios dry-run
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-511" --dry-run
```

## Notes

- Smoke scenarios (`promotion_mover.feature`) remain pending behind the ISSUE-3-CUTOVER stub in `features/regression/step_definitions/whenSteps.ts:80`. They document the contract for the next harness cutover, consistent with the slice-#4 pattern.
- The `hitl` label on the per-issue PR (PRD §10) is still deferred — it was not in this issue's acceptance criteria. Only the `regression-promotion` label on the *move* PR is required here.
- The promotion threshold (hardcoded `3`) is unchanged. The mover acts on `@promotion` approval, not on the score.
- Worktrees created by the mover (`.worktrees/regression-promotion-issue-{N}-{slug}`) are left in place after the orchestrator exits and must be pruned by standard worktree cleanup conventions.
- Prior art: `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` (slice #4 / issue #509) covers the `adws/promotion/` module layout and the deferred items this slice picks up.
