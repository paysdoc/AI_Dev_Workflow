# HITL Label Gate in adwMerge.tsx

**ADW ID:** nrr167-hitl-label-gate-bypa
**Date:** 2026-04-21
**Specification:** specs/issue-483-adw-nrr167-hitl-label-gate-bypa-sdlc_planner-fix-hitl-gate-adwmerge.md

## Overview

The `hitl` (human-in-the-loop) GitHub label gate was bypassed after the `bpn4sv` refactor moved merge execution out of orchestrators into `adwMerge.tsx`. This fix adds a label check directly into `executeMerge` so that any PR on an issue labeled `hitl` is silently skipped, leaving `workflowStage` as `awaiting_merge` for the next cron cycle to re-check.

## What Was Built

- HITL guard in `executeMerge` (`adws/adwMerge.tsx`) positioned after terminal PR states (MERGED, CLOSED) and before the open-PR merge block
- `issueHasLabel` injected through the `MergeDeps` seam for unit testability
- Four new unit test cases in `adws/__tests__/adwMerge.test.ts` covering the HITL gate scenarios
- Eight new BDD scenarios in `features/hitl_label_gate_automerge.feature` tagged `@adw-483 @regression`
- Two new step definitions in `features/step_definitions/hitlLabelGateAutomergeSteps.ts` for the state-preservation and outcome-reason assertions

## Technical Implementation

### Files Modified

- `adws/adwMerge.tsx`: Added `issueHasLabel` to imports and `MergeDeps` interface; inserted HITL gate block between CLOSED branch and open-PR merge block; wired production import in `buildDefaultDeps()`
- `adws/__tests__/adwMerge.test.ts`: Extended `makeDeps` with `issueHasLabel` default (`mockReturnValue(false)`); added `describe('executeMerge — hitl label gate', ...)` suite with four cases
- `features/hitl_label_gate_automerge.feature`: Added eight new scenarios under `@adw-329-hitl-label-gate @adw-483` covering import, call ordering, skip behavior, state preservation, outcome reason, and logging
- `features/step_definitions/hitlLabelGateAutomergeSteps.ts`: Added two step definitions (`does not write workflowStage` and `returns an outcome with reason containing`) using the existing `extractHitlBlockBody` helper
- `features/step_definitions/pauseResumeCanonicalClaimSteps.ts`: Minor cleanup (8 lines removed)
- `features/step_definitions/reclassifyAbandonedDiscardedCallSitesSteps.ts`: Minor fix (1 line)
- `features/takeover_handler_integration.feature`: Minor scenario fix (1 line)

### Key Changes

- The HITL gate is placed **after** the MERGED/CLOSED terminal branches so those terminal states always win — consistent with the principle that PR state is authoritative
- On HITL hit: logs `"hitl label detected on issue #N, skipping merge"`, returns `{ outcome: 'abandoned', reason: 'hitl_blocked' }` without writing state, so `workflowStage` stays `awaiting_merge`
- On HITL miss (label absent): execution falls through to the existing open-PR merge block unchanged
- `reason: 'hitl_blocked'` is distinct from `'merge_failed'` and `'pr_closed'`, so cron telemetry can differentiate a skip from an actual failure
- `main()` already exits `0` for any `abandoned` outcome whose reason is not `'merge_failed'`, so no dispatcher changes were required

## How to Use

The gate is automatic — no configuration is needed.

1. Add the `hitl` label to a GitHub issue via the GitHub UI or `gh issue edit <N> --add-label hitl`
2. When `adwMerge.tsx` runs (triggered by the cron sweep picking up the `awaiting_merge` issue), it calls `issueHasLabel` and skips the merge silently
3. The issue stays in `workflowStage: awaiting_merge`; the next cron cycle re-enters `adwMerge`, re-checks the label, and either skips again or merges
4. Remove the `hitl` label when human review is complete; the next cron cycle will proceed to merge automatically

## Configuration

No configuration required. The label name `'hitl'` is hardcoded at the call site, matching the existing `autoMergePhase.ts` behavior.

## Testing

```bash
# Unit tests (hitl gate suite + full regression)
bun run test:unit

# BDD scenarios — new adw-483 scenarios only
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-483"

# BDD scenarios — full HITL feature (regression check)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- **`executeAutoMergePhase` is retained** in `adws/phases/autoMergePhase.ts` as-is — it is dead on the SDLC path but preserved per the `bpn4sv` note ("preserved for webhook use"). This fix does not touch that module.
- **No `blocked_hitl` stage introduced** — adding a new `WorkflowStage` would require changes to `workflowTypes.ts`, `cronStageResolver.ts`, `cronIssueFilter.ts`, and `remoteReconcile.ts`, plus a re-entry mechanism. Leaving state at `awaiting_merge` reuses the existing cron loop for free.
- **Orchestrators not modified** — `adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx` are intentionally unchanged. The check in `adwMerge` is the authoritative gate because it also catches labels added after orchestrator exit.
- **Root cause:** The `bpn4sv` refactor (`app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md`) moved merge execution to `adwMerge.tsx` but did not replicate the HITL check from `autoMergePhase.ts`. Issue #467 was merged despite having the `hitl` label.
