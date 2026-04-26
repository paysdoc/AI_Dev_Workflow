# Unify Auto-Merge HITL Gate

**ADW ID:** tvqgz4-auto-merge-unify-cho
**Date:** 2026-04-26
**Specification:** specs/issue-496-adw-tvqgz4-auto-merge-unify-cho-sdlc_planner-unify-auto-merge-hitl-gate.md

## Overview

This feature restores and unifies the auto-merge gate across all ADW orchestrators (chore, bug, feature) under a single stateless condition evaluated on every cron tick: `gate_open = (no hitl on issue) OR (PR is approved)`. It also fixes a bug where `gh pr view --json reviewDecision` returns an empty string `""` on unprotected repos, causing `fetchPRApprovalState` to short-circuit to `false` instead of falling back to per-reviewer aggregation.

## What Was Built

- **Unified merge gate in `adwMerge.tsx`** — replaced the approval-only gate (introduced by #488/#489) with a `(hitlOnIssue && !isApproved) → defer` condition; all other combinations proceed to merge
- **`issueHasLabel` injected into `MergeDeps`** — added as an injectable dependency alongside `fetchPRApprovalState`, enabling full unit-test coverage of all four gate cells
- **Chore pre-merge approval** — `adwChore.tsx` now calls `approvePR` after `executePRPhase`, gated on `!issueHasLabel('hitl')`, so chore PRs on unprotected repos can satisfy the approval-based rule 3
- **Fixed `fetchPRApprovalState` empty-string bug** — replaced `reviewDecision !== null && reviewDecision !== undefined` guard with `if (reviewDecision) return false` so `""` (returned by `gh` on unprotected repos) falls through to `isApprovedFromReviewsList`
- **Updated `@adw-488` BDD scenarios** — rewritten scenarios that previously asserted `issueHasLabel` was removed from `adwMerge.tsx` now assert its presence and correct wiring
- **New `@adw-496` BDD feature** — `features/unify_auto_merge_hitl_gate.feature` with step definitions covering: the four canonical rules matrix, chore unified path, empty-string `reviewDecision` fallback, source-file inspection contracts, and README documentation assertions
- **README and `UBIQUITOUS_LANGUAGE.md`** — new `## Auto-merge gate` section and tightened `HITL` definition reflecting the unified `(no hitl) OR approved` semantics

## Technical Implementation

### Files Modified

- `adws/github/prApi.ts`: Fixed `fetchPRApprovalState` to treat empty string `""`, `null`, and `undefined` `reviewDecision` identically — all fall back to `isApprovedFromReviewsList`
- `adws/adwMerge.tsx`: Added `issueHasLabel` to imports, `MergeDeps` interface, and `buildDefaultDeps`; replaced approval-only gate with unified `hitlOnIssue && !isApproved → defer` gate returning `reason: 'hitl_blocked_unapproved'`
- `adws/adwChore.tsx`: Added imports for `issueHasLabel`, `approvePR`, `extractPrNumber`; inserted conditional `approvePR` call between `executePRPhase` and the `awaiting_merge` state write
- `adws/__tests__/adwMerge.test.ts`: Added `issueHasLabel: vi.fn().mockReturnValue(false)` to `makeDeps`; added four-cell `(hitl × approved)` matrix test block and updated existing approval gate tests
- `adws/github/__tests__/prApi.test.ts`: Added five cases covering `reviewDecision === ""` and `undefined` with various review list states
- `features/hitl_label_gate_automerge.feature`: Inverted #488 scenarios that previously asserted `issueHasLabel` removal; rewritten to assert the unified gate's import/dependency/behavior contracts
- `features/unify_auto_merge_hitl_gate.feature`: New BDD feature with `@adw-496` tag covering all acceptance criteria
- `features/step_definitions/unifyAutoMergeHitlGateSteps.ts`: New step definitions for the unified gate feature
- `README.md`: Added `## Auto-merge gate` section with gate condition, four rules, disciplined pre-add workflow, and cancel/re-run semantics
- `UBIQUITOUS_LANGUAGE.md`: Updated `HITL` definition to reflect unified `(no hitl) OR (PR approved)` semantics with real-time evaluation note

### Key Changes

- **Single gate condition** — `adwMerge.tsx` now returns `{ outcome: 'abandoned', reason: 'hitl_blocked_unapproved' }` only when both `issueHasLabel(issueNumber, 'hitl')` is `true` AND `fetchPRApprovalState` is `false`; all other combinations (no hitl, or approved) proceed to merge
- **No state write on defer** — the gate-closed branch returns `abandoned` without writing `workflowStage`, so `awaiting_merge` is preserved and the cron re-evaluates on the next tick
- **Silent defer** — no `commentOnIssue` or `commentOnPR` call on gate-closed, only a `log(... 'info')`, avoiding issue flooding during human review
- **Empty-string fix** — `if (reviewDecision) return false` replaces `if (reviewDecision !== null && reviewDecision !== undefined) return false`, making falsy values (`""`, `null`, `undefined`) fall through to the per-reviewer aggregation fallback
- **Chore approval gated on hitl** — chore-level `approvePR` is skipped when `issueHasLabel('hitl')` is true at chore-completion time, preventing auto-bypass of an in-progress human review

## How to Use

### Controlling auto-merge with the `hitl` label

The four canonical rules, evaluated statelessly on every cron tick:

1. **No `hitl` on issue** → gate open → auto-merge fires (any issue type)
2. **`hitl` on issue, PR not approved** → gate closed → defer until next tick
3. **`hitl` on issue, PR approved** → gate open → auto-merge fires
4. **`hitl` removed** → falls back to rule 1 → auto-merge eligible on the next cron tick

### Disciplined pre-add workflow

If you want a merge to be human-gated, add the `hitl` label to the issue **before** the orchestrator opens the PR. After cancel + re-run, the new run's gate evaluates the **current** label state — the gate is stateless, so removing `hitl` between cycles is sufficient to re-enable auto-merge.

## Configuration

No new configuration required. The gate reads the `hitl` label in real time via `issueHasLabel` (a fresh API call, not cached from workflow start). The `hitl` label must be named exactly `hitl` (lowercase, case-sensitive) on the **issue** — PR labels are not read.

## Testing

```bash
# Unit tests
bun run test:unit -- adws/github/__tests__/prApi.test.ts
bun run test:unit -- adws/__tests__/adwMerge.test.ts
bun run test:unit

# New BDD feature
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-496"

# Existing BDD regression (rewritten @adw-488 scenarios)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-488"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Type-check
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- **`isApprovedFromReviewsList` fallback** — the per-reviewer aggregation helper (unchanged) is now correctly reached on unprotected repos like `paysdoc/AI_Dev_Workflow`, where `gh pr view --json reviewDecision` returns `""` rather than `null`
- **Chore idempotent double-approval** — in the `regression_possible` chore path, `executeReviewPhase` (line 110) already calls `approvePR`; the new chore-level approval may double-approve. `gh pr review --approve` is idempotent; this is harmless
- **Race window** — a human can add `hitl` between the chore-level `approvePR` and the next cron tick. The gate is permissive in that case (rule 3 — approval already granted). Operators wanting to truly stop a mid-race merge must use `## Cancel`
- **`autoMergePhase.ts` unchanged** — the `executeAutoMergePhase` used by review-pipeline orchestrators still adds `hitl` as an informational marker; this behavior is preserved per `@adw-488` scenarios
- **Fail-open** — both `issueHasLabel` and `fetchPRApprovalState` return `false` on error (fail-open), making the gate permissive if the label check or PR review fetch cannot complete
