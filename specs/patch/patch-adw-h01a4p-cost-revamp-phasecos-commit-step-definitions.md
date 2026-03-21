# Patch: Commit already-implemented BDD step definitions for PhaseCostRecord scenarios

## Metadata
adwId: `h01a4p-cost-revamp-phasecos`
reviewChangeRequest: `specs/issue-243-adw-h01a4p-cost-revamp-phasecos-sdlc_planner-phase-cost-record-csv.md`

## Issue Summary
**Original Spec:** specs/issue-243-adw-h01a4p-cost-revamp-phasecos-sdlc_planner-phase-cost-record-csv.md
**Issue:** 16 @regression-tagged BDD scenarios in `features/phase_cost_record_csv.feature` were reported as having no step definitions, causing all to fail with "Undefined" status during review proof generation.
**Solution:** The step definitions file `features/step_definitions/phaseCostRecordCsvSteps.ts` already exists and is fully implemented — all 17 @regression scenarios pass (194/194 full regression suite passes). The file is currently untracked in git and needs to be staged and committed.

## Files to Modify

- `features/step_definitions/phaseCostRecordCsvSteps.ts` — **Already exists, untracked**: Stage and commit this file. No code changes needed.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify step definitions are functional
- Run `bunx cucumber-js --tags "@regression and @adw-h01a4p-cost-revamp-phasecos" --dry-run` to confirm all steps are defined (no "Undefined" status)
- Run `bunx cucumber-js --tags "@regression and @adw-h01a4p-cost-revamp-phasecos"` to confirm all 17 scenarios pass

### Step 2: Stage the untracked step definitions file
- Run `git add features/step_definitions/phaseCostRecordCsvSteps.ts`
- The file is already fully implemented with all required step definitions covering: type field validation, status enum assertion, phase production checks, CSV format checks, project total checks, exchange rate module checks, orchestrator commit checks, and unit test coverage assertions

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx cucumber-js --tags "@regression"` — All 194 regression scenarios pass (0 failures, 0 undefined)
2. `bunx cucumber-js --tags "@adw-h01a4p-cost-revamp-phasecos"` — All feature-specific scenarios pass
3. `bun run lint` — No lint errors
4. `bunx tsc --noEmit` — TypeScript type check passes
5. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check passes

## Patch Scope
**Lines of code to change:** 0 (file already exists and is complete)
**Risk level:** low
**Testing required:** Run @regression BDD scenarios to confirm all 17 previously-reported-undefined scenarios pass
