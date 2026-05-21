# HITL Label and Tag Lifecycle

**ADW ID:** 28aysq-hitl-label-tag-lifec
**Date:** 2026-05-21
**Specification:** specs/issue-510-adw-28aysq-hitl-label-tag-lifec-sdlc_planner-hitl-label-tag-lifecycle.md

## Overview

Slice #5 of the scenario-rot-prevention-and-promotion PRD. Closes the loop on the promotion commenter's tag lifecycle and HITL gate: every comment the promotion commenter posts now applies the `hitl` label to the linked issue, `@promotion-suggested-<date>` tags are refreshed at most once per day, score-drop withdrawals remove the tag silently, and duplicate same-day reminders are suppressed. This slice extends the five deep modules shipped in slice #4 (issue #509) without restructuring the dep-injection architecture.

## What Was Built

- **`TagState` union widened** — `'add-suggestion' | 'refresh-date' | 'remove-suggestion'` replaces the original single-value union
- **`detectExistingSuggestionDate` query helper** — pure function on `promotionTagWriter` that returns the existing `@promotion-suggested-<date>` date or `null`
- **`refresh-date` and `remove-suggestion` operations** in `promotionTagWriter.applyTagState`
- **`decideTagAction` pure helper** — six-row decision matrix (existing tag × score threshold) that determines the tag operation and comment eligibility per scenario
- **`applyHitlLabel` dep on `PromotionCommenterDeps`** — injectable; production wiring calls `addIssueLabel(issueNumber, 'hitl', repoInfo)`
- **`hitlLabelApplied` field on `PromotionResult`** — boolean tracking whether the label was applied this run
- **`issueNumber` added to `runPromotionCommenter` signature** — second positional arg derived from the PR's head branch in `adwPromotionSweep.tsx`
- **Per-issue BDD scenarios** (`features/per-issue/feature-510.feature`) — six scenarios across §1–§5 covering all lifecycle paths
- **Smoke suite extended** (`features/regression/smoke/promotion_commenter.feature`) — three new scenarios plus a `hitl` label assertion on the existing high-score scenario
- **Vocabulary registry extended** — new Given/Then phrases for label-accept, fixture-seeding, pre-tagging (dated-today and dated-N-days-ago), and all assertion variants
- **Step definitions added** in `givenSteps.ts` and `thenSteps.ts` (pending-pattern, consistent with slice #4)
- **New test fixtures** — `promotion-sweep-lifecycle-mixed.json` manifest plus three scenario source files under `test/fixtures/scenarios/promotion/`

## Technical Implementation

### Files Modified

- `adws/promotion/types.ts`: `TagState` union widened to three values
- `adws/promotion/promotionTagWriter.ts`: added `detectExistingSuggestionDate`, `'refresh-date'`, `'remove-suggestion'` operations, and private `findTagBlockBounds` helper
- `adws/promotion/__tests__/promotionTagWriter.test.ts`: eleven new test cases for the query helper and two new operations
- `adws/promotion/promotionCommenter.ts`: added `decideTagAction` decision matrix, `applyHitlLabel` dep, `issueNumber` param, `hitlLabelApplied` return field
- `adws/promotion/__tests__/promotionCommenter.test.ts`: nine new test cases covering all six matrix branches plus mixed-file, withdraw-only, and label-failure cases
- `adws/promotion/index.ts`: re-exports `detectExistingSuggestionDate` and the widened `TagState`
- `adws/adwPromotionSweep.tsx`: wires `applyHitlLabel` via `addIssueLabel`; passes `issueNumber` (from `extractIssueNumberFromBranch(pr.headRefName)`) to `runPromotionCommenter`
- `features/per-issue/feature-510.feature`: new per-issue BDD file with six lifecycle scenarios
- `features/regression/smoke/promotion_commenter.feature`: three new smoke scenarios plus `hitl` assertion on the existing high-score scenario
- `features/regression/vocabulary.md`: new Given/Then vocabulary rows
- `features/regression/step_definitions/givenSteps.ts`: pending-pattern step definitions for all new Given phrases
- `features/regression/step_definitions/thenSteps.ts`: pending-pattern step definitions for all new Then phrases
- `test/fixtures/jsonl/manifests/promotion-sweep-lifecycle-mixed.json`: new manifest for the §5 mixed-lifecycle scenario
- `test/fixtures/scenarios/promotion/high-score-subprocess.feature`: seed fixture for above-threshold scenarios
- `test/fixtures/scenarios/promotion/low-score-mock-query.feature`: seed fixture for below-threshold scenarios
- `test/fixtures/scenarios/promotion/lifecycle-mixed.feature`: seed fixture with three named scenarios at different scoring levels
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md`: "Notes" updated to remove the now-resolved slice #5 deferrals

### Key Changes

- **Decision matrix as a pure helper** (`decideTagAction`) — keeps the per-scenario loop readable and the six rows directly unit-testable without orchestrator setup boilerplate
- **`today` captured once per run** at the top of `runPromotionCommenter`, guaranteeing consistent date comparisons across all scenarios in a single invocation
- **`applyHitlLabel` failure is non-fatal** — the commenter catches, logs at `warn`, and returns `hitlLabelApplied: false`; the PR comment still posts and the run still returns a valid `PromotionResult`
- **`remove-suggestion` is idempotent** — if no `@promotion-suggested-*` tag exists, the operation returns the content unchanged (no-op); only `refresh-date` throws defensively when the tag is missing
- **`hitl` label applied on comment, not on tag write** — withdrawal-only runs (where every scenario's tag is removed but no comment is eligible) apply no label

## How to Use

The HITL lifecycle is automatic once `adwPromotionSweep.tsx` runs on a per-issue PR:

1. On the first run where a scenario scores ≥ threshold: the `@promotion-suggested-<today>` tag is written, a consolidated PR comment is posted, and the `hitl` label is applied to the linked issue.
2. On a same-day re-run: no duplicate comment, no tag change, no label re-application call (daily suppression).
3. On a later-day re-run with the scenario still above threshold: the tag date is refreshed to today, a reminder comment is posted, and `hitl` is applied again (idempotent at the GitHub API).
4. If the scenario drops below threshold: the tag is removed silently, no comment, no label.
5. Once a human acts (manually removes the `hitl` label or approves the PR), `adwMerge.tsx` permits auto-merge via its existing `issueHasLabel` gate.

## Configuration

No new configuration keys. The vocabulary registry path is read from `config.scenarios.vocabularyRegistry` (defaulting to `features/regression/vocabulary.md`), unchanged from slice #4. The `hitl` label name is hardcoded to `'hitl'` — consistent with the existing `adwMerge.tsx` gate.

## Testing

```bash
# Unit tests (tag writer + commenter)
bun run test:unit

# Type-check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Smoke suite (new scenarios will report pending per W1 pattern)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"

# CLI smoke-test
bunx tsx adws/adwPromotionSweep.tsx --help 2>&1 | head -20
```

## Notes

- **`promotionMover` removed from this orchestrator.** `adwPromotionSweep.tsx` previously called both `runPromotionCommenter` and `runPromotionMover`; the mover is removed in this slice to focus on the commenter lifecycle. The approval-detection flow (`@promotion` no-date tag) remains deferred to a later slice.
- **No webhook wiring yet.** The orchestrator is still invoked manually; slice #6 adds the `pull_request.opened` / `pull_request.synchronize` webhook trigger.
- **No `runWithOrchestratorLifecycle` wrapping.** Duplicate-suppression is data-driven (tag date check), so spawn-lock wrapping is not required for this slice.
- **`hitl` label lives on the issue, not the PR.** Matches the `adwMerge.tsx` gate (`issueHasLabel(issueNumber, 'hitl', repoInfo)`). See `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md`.
- **Slice #4 deferrals resolved.** The append-rather-than-refresh known limitation, missing duplicate-suppression, and missing `hitl` label application are all closed by this slice.
