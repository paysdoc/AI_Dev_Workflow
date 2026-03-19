# Patch: Verify and commit staged BDD step definitions for PhaseCostRecord scenarios

## Metadata
adwId: `h01a4p-cost-revamp-phasecos`
reviewChangeRequest: `specs/issue-243-adw-h01a4p-cost-revamp-phasecos-sdlc_planner-phase-cost-record-csv.md`

## Issue Summary
**Original Spec:** specs/issue-243-adw-h01a4p-cost-revamp-phasecos-sdlc_planner-phase-cost-record-csv.md
**Issue:** 17 @regression-tagged BDD scenarios in `features/phase_cost_record_csv.feature` were reported as failing with "Undefined" step definitions during scenario proof generation. The affected scenarios cover PhaseCostRecord type fields, phase file production, per-issue CSV format, project total CSV format, exchange rate module location, per-phase CSV commits, unit test coverage, and TypeScript type-check.
**Solution:** The step definitions file `features/step_definitions/phaseCostRecordCsvSteps.ts` is already fully implemented (284 lines, 37 step definitions) and staged in git (`A` status). All 17 @regression scenarios pass, and the full 194-scenario regression suite is green. The scenario proof failure occurred before this file was committed. No code changes are needed — only confirm the file is included in the next commit.

## Files to Modify

- `features/step_definitions/phaseCostRecordCsvSteps.ts` — **Already exists and staged**: No code changes needed. Ensure this file is included in the commit.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify step definitions are loaded and all scenarios pass
- Run `bunx cucumber-js --tags "@regression and @adw-h01a4p-cost-revamp-phasecos" --dry-run` — confirm 17 scenarios, 66 steps, 0 undefined
- Run `bunx cucumber-js --tags "@regression and @adw-h01a4p-cost-revamp-phasecos"` — confirm 17 scenarios (17 passed)

### Step 2: Confirm file is staged in git
- Run `git status -- features/step_definitions/phaseCostRecordCsvSteps.ts` — confirm the file shows as staged (`new file` or `A`)
- If the file is untracked, stage it with `git add features/step_definitions/phaseCostRecordCsvSteps.ts`

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx cucumber-js --tags "@regression and @adw-h01a4p-cost-revamp-phasecos"` — All 17 feature-specific regression scenarios pass
2. `bunx cucumber-js --tags "@regression"` — All 194 regression scenarios pass (0 failures, 0 undefined)
3. `bun run lint` — No lint errors
4. `bunx tsc --noEmit` — TypeScript type check passes
5. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check passes

## Patch Scope
**Lines of code to change:** 0 (file already exists, is complete, and is staged)
**Risk level:** low
**Testing required:** Run @regression BDD scenarios to confirm all 17 previously-reported-undefined scenarios pass with the full 194-scenario regression suite green
