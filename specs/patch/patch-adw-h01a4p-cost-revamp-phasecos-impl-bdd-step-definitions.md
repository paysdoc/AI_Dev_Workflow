# Patch: Implement missing BDD step definitions for phase_cost_record_csv.feature

## Metadata
adwId: `h01a4p-cost-revamp-phasecos`
reviewChangeRequest: `specs/issue-243-adw-h01a4p-cost-revamp-phasecos-sdlc_planner-phase-cost-record-csv.md`

## Issue Summary
**Original Spec:** specs/issue-243-adw-h01a4p-cost-revamp-phasecos-sdlc_planner-phase-cost-record-csv.md
**Issue:** 5 @regression scenarios in `features/phase_cost_record_csv.feature` have undefined step definitions — `Given the cost type definitions are read`, `Then PhaseCostRecord includes field {string} of type string/number`, `Then PhaseCostRecord includes field {string} as a Record of string to number`, `Then PhaseCostRecord status field allows {string}, {string}, and {string}`, and `Then the <phase> phase produces or returns PhaseCostRecord instances` for plan/build/test phases.
**Solution:** Create a new step definition file `features/step_definitions/phaseCostRecordCsvSteps.ts` implementing all missing steps. Steps read `adws/cost/types.ts` for type assertions and check phase files for PhaseCostRecord references via `sharedCtx`.

## Files to Modify

- `features/step_definitions/phaseCostRecordCsvSteps.ts` — **NEW FILE**: all missing step definitions for `phase_cost_record_csv.feature`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `features/step_definitions/phaseCostRecordCsvSteps.ts`
- Import `Given`, `Then` from `@cucumber/cucumber`, `readFileSync` from `fs`, `join` from `path`, `assert` from `assert`, and `sharedCtx` from `./commonSteps.ts`
- Define `const ROOT = process.cwd()`

### Step 2: Implement `Given the cost type definitions are read`
- Read `adws/cost/types.ts` into `sharedCtx.fileContent` and `sharedCtx.filePath`
- This makes the type file content available for subsequent Then steps

### Step 3: Implement type field assertion steps
- `Then PhaseCostRecord includes field {string} of type string` — assert `sharedCtx.fileContent` contains `readonly <fieldName>: string` (or just the field name with `: string`)
- `Then PhaseCostRecord includes field {string} of type number` — assert `sharedCtx.fileContent` contains `readonly <fieldName>: number`
- `Then PhaseCostRecord includes field {string} as a Record of string to number` — assert `sharedCtx.fileContent` contains `readonly <fieldName>:` and `Record<string, number>`
- Use regex or string matching on the interface definition. Pattern: check that `sharedCtx.fileContent` includes the field name followed by the expected type annotation.

### Step 4: Implement status enum assertion step
- `Then PhaseCostRecord status field allows {string}, {string}, and {string}` — assert all three enum values (`success`, `partial`, `failed`) appear in `sharedCtx.fileContent` (they are defined in `PhaseCostStatus` enum)

### Step 5: Implement phase-specific PhaseCostRecord production steps
- `Then the plan phase produces or returns PhaseCostRecord instances` — assert `sharedCtx.fileContent` (already loaded with `planPhase.ts` by the Background `Given "{file}" is read` step in commonSteps) contains `PhaseCostRecord` or `phaseCostRecord` or `createPhaseCostRecords`
- `Then the build phase produces or returns PhaseCostRecord instances` — same assertion on `sharedCtx.fileContent` (loaded with `buildPhase.ts`)
- `Then the test phase produces or returns PhaseCostRecord instances` — same assertion on `sharedCtx.fileContent` (loaded with `testPhase.ts`)
- Also implement the non-@regression phase steps for completeness: PR, review, document, scenario, KPI phases — same pattern

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx cucumber-js --tags "@regression"` — All regression scenarios pass including the 5 previously-failing scenarios
2. `bunx cucumber-js --tags "@adw-h01a4p-cost-revamp-phasecos"` — All feature-specific scenarios pass
3. `bun run lint` — No lint errors
4. `bunx tsc --noEmit` — TypeScript type check passes
5. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check passes

## Patch Scope
**Lines of code to change:** ~80 (new file)
**Risk level:** low
**Testing required:** Run @regression and feature-specific BDD scenarios to confirm all 5 previously-undefined steps are now defined and passing
