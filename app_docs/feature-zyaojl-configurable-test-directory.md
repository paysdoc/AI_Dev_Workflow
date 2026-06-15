# Configurable Test Directory + Three-Way Verdict (Kill the `src/` Silent-Green)

**ADW ID:** zyaojl-configurable-test-di
**Date:** 2026-06-15
**Specification:** specs/issue-577-adw-zyaojl-configurable-test-di-sdlc_planner-configurable-test-directory.md

## Overview

The ADW unit-test layer was previously hardcoded to Bun/TypeScript projects with tests under `src/`, silently reporting green for flat-layout repos (e.g. Python/pytest with tests under `tests/`) because the `test.md` command skipped-as-passed when no `src/` directory existed. This feature makes the test directory and framework configurable per target repo, removes the skip-as-passed trap, and introduces an explicit three-way verdict: `pass`, `hard-fail`, or `warn (unverified)`.

## What Was Built

- `testDirectory` and `testFramework` config fields parsed from `.adw/commands.md` with backward-compatible defaults (`src` / empty)
- Pure `computeTestVerdict` module mapping `(enabled, hasFailures, testcaseCount, frameworkDetected)` to a typed verdict
- Rewritten `test.md` step 5 that runs unconditionally against `testDirectory`, dropping all `src/`-existence checks
- `testcase_count` threaded from agent output through `testAgent` → `testRetry` → `unitTestPhase`
- Three-way verdict wired into `executeUnitTestPhase`: hard-fail / warn (with `adw:unverified` comment + label) / pass
- `adw:unverified` label registered in `labelManager.ts` (provisioned by `ensureAdwLabelsExist`)
- `unverified` workflow comment stage in `workflowCommentsIssue.ts`
- `adw_init.md` updated to emit `## Test Directory` and `## Test Framework` sections (raising `.adw-version` for hash propagation)
- Flat-layout Python fixture at `test/fixtures/python-flat/` with pytest suite under `tests/`, no `src/` directory
- JSONL manifest `adw-unit-test-zero-testcases.json` scaffolding §8/§9 end-to-end scenarios (PENDING until ISSUE-3-CUTOVER subprocess driver lands)

## Technical Implementation

### Files Modified

- `adws/core/projectConfig.ts`: Added `testDirectory: string` and `testFramework: string` to `CommandsConfig`, `HEADING_TO_KEY`, and `getDefaultCommandsConfig()` (defaults: `'src'` / `''`)
- `adws/core/index.ts`: Re-exports the new `computeTestVerdict` and its types
- `adws/phases/unitTestPhase.ts`: Replaced binary pass/fail branch with `computeTestVerdict` three-way verdict; wires warn path to apply `adw:unverified` label and post comment
- `adws/agents/testAgent.ts`: Added `testcase_count?: number` to `TestResult` and `testResultsSchema`; computes `applicationTestcaseCount` from the `app_tests` entry on `TestAgentResult`
- `adws/agents/testRetry.ts`: Threads `testcaseCount` through to `TestRetryResult` via `lastApplicationTestcaseCount` capture in the `run` callback
- `adws/github/labelManager.ts`: Added `ADW_UNVERIFIED_LABEL = 'adw:unverified'` constant and `ADW_LABEL_DEFINITIONS` entry (color `fbca04`)
- `adws/github/workflowCommentsIssue.ts`: Added `formatUnverifiedComment` and wired `'unverified'` case into `formatWorkflowComment`
- `.claude/commands/test.md`: Removed `--run src` and skip-as-passed condition; added `testcase_count` to output schema; run is now unconditional
- `.claude/commands/adw_init.md`: Added `## Test Directory` and `## Test Framework` emission with detection rules
- `adws/core/__tests__/projectConfig.test.ts`: Added tests for `testDirectory` / `testFramework` parsing, defaults, and fixture-config resolution
- `adws/github/__tests__/labelManager.test.ts`: Updated to cover `adw:unverified`

### New Files

- `adws/core/testVerdict.ts`: Pure verdict module — `computeTestVerdict(input) → { verdict, reason }`, no I/O
- `adws/core/__tests__/testVerdict.test.ts`: Table-driven tests covering all five verdict branches
- `test/fixtures/python-flat/`: Flat-layout Python fixture (no `src/`) with `pyproject.toml`, `calculator.py`, `tests/test_calculator.py`, and `.adw/` config
- `test/fixtures/jsonl/manifests/adw-unit-test-zero-testcases.json`: Scripted zero-testcase manifest for §8/§9 scenarios

### Key Changes

- **No skip-as-passed**: `test.md` step 5 runs unconditionally; a missing `src/` directory is not a skip signal
- **Testcase count surface**: Agents report `testcase_count` in JSON output; zero is a distinct outcome from failure
- **Five-branch verdict table** (guard-clause, max depth 2): disabled → pass; failures → hard-fail; count > 0 → pass; count == 0 + framework → hard-fail; count == 0 + no framework → warn
- **Backward-compatible defaults**: Un-regenerated repos default to `testDirectory: 'src'` and `testFramework: ''` (empty ⇒ warn, not hard-fail, on zero tests)
- **Hash propagation**: `adw_init.md` change raises `.adw-version`, triggering `adwUpgrade` to regenerate `.adw/` across all target repos and propagate the new sections

## How to Use

### For target repo operators

1. Ensure your `.adw/commands.md` includes:
   ```
   ## Run Tests
   pytest

   ## Test Directory
   tests

   ## Test Framework
   pytest
   ```
2. Run the ADW unit-test phase normally — it will execute `pytest tests` and gate on the result.
3. If zero testcases are discovered and `## Test Framework` is set, the phase hard-fails (discovery break). If `## Test Framework` is empty, it warns and continues, applying the `adw:unverified` label and posting a comment on the issue.

### For un-regenerated repos (legacy `commands.md`)

No action required. Missing sections default to `testDirectory: src` and `testFramework: ''`, preserving today's Bun behaviour with a safe warn-not-fail posture on zero tests.

### Running `adw_init` after this update

Re-running `/adw_init` on a target repo will emit the new `## Test Directory` and `## Test Framework` sections, filling in detected values from the repo layout and dependency manifest.

## Configuration

| `commands.md` section | Default | Purpose |
|---|---|---|
| `## Test Directory` | `src` | Root directory passed to the test runner |
| `## Test Framework` | *(empty)* | Detected framework; empty = no framework = warn on zero tests |

**Framework detection in `adw_init`:**
- `pytest`/`pytest-asyncio` in `pyproject.toml` or `requirements*.txt` → `pytest`
- `vitest` in `package.json` devDependencies → `vitest`
- `jest` in `package.json` devDependencies → `jest`
- None detected → leave empty

**Test directory detection in `adw_init`:**
1. `tests/` at repo root → `tests`
2. `test/` at repo root → `test`
3. `src/` at repo root → `src`
4. Otherwise → `.`

## Testing

```bash
# Run full unit suite (includes new testVerdict + projectConfig tests)
bun run test:unit

# Focused run on new tests
bunx vitest run adws/core/__tests__/testVerdict.test.ts adws/core/__tests__/projectConfig.test.ts

# Verify flat-layout Python fixture (requires Python/pytest on host)
cd test/fixtures/python-flat && pytest tests

# Type-check ADW scripts
bunx tsc --noEmit -p adws/tsconfig.json
```

The `computeTestVerdict` module has table-driven tests for all five branches. Config-parsing tests cover both new fields with defaults, custom values, and the `python-flat` fixture round-trip.

## Notes

- **Staged scope**: This is PRD slice 1. JUnit-XML structured reports (`testReportParser`), deletion of `parseCucumberSummary`, ADW-self migration onto the structured rail, and Docker-CI Python execution are PR 2+ and out of scope.
- **`adw:unverified` is informational only**: It is not added to `ADW_CLASSIFICATION_LABELS` — it does not affect routing or classification.
- **Warn does not exit**: The warn path posts the comment, applies the label, and continues the workflow (no `process.exit(1)`).
- **`testFramework` whitespace guard**: `.trim()` is applied, so whitespace-only values are treated as "not detected" and take the warn path.
- **§8/§9 BDD scenarios are PENDING**: The `adw-unit-test-zero-testcases.json` manifest is present but the scenarios are not yet exercised — the ISSUE-3-CUTOVER subprocess driver (`features/regression/step_definitions/whenSteps.ts`) must land first.
- **Future**: When PR 2 introduces the JUnit rail, `testcaseCount` can be sourced from a deterministic XML parse instead of the agent's reported count. The `computeTestVerdict` signature is stable across that change.
