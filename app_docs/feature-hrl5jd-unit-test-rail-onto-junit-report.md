# Unit-Test Rail onto JUnit Report

**ADW ID:** hrl5jd-unit-test-rail-onto
**Date:** 2026-06-17
**Specification:** specs/issue-601-adw-hrl5jd-unit-test-rail-onto-sdlc_planner-unit-test-junit-report-rail.md

## Overview

Converges the unit-test rail onto the structured JUnit XML contract that issue #578 built for the scenario rail. Previously, the unit verdict was derived from an LLM-eyeballed `app_tests` step that filtered to `src/` and emitted no real testcase count — structurally producing zero for ADW-self and any flat-layout repo. This feature makes the runner emit a JUnit report to a known path (`ADW_UNIT_TEST_REPORT_PATH`) and derives pass/fail from that report via `readJUnitReport`, making the unit gate honest and language-agnostic.

## What Was Built

- **JUnit-keyed verdict**: `computeTestVerdict` now keys on `(reportPresent, hasFailures, testcaseCount)` instead of the static `frameworkDetected` signal, restoring the discovery-break `hard-fail` that was temporarily demoted to `warn` (commit `8184877`)
- **`failureMessage` extraction**: `TestCaseResult` gains an additive `failureMessage?: string` field populated from `<failure message="…">` / `<error message="…">` attributes or text bodies; the resolver receives each failing case's name + message
- **Report-driven retry loop**: `runUnitTestsWithRetry` reads the JUnit report after each attempt; pass/fail and failure extraction are report-derived, not agent-eyeballed
- **`ADW_UNIT_TEST_REPORT_PATH` env var**: Added to `SAFE_ENV_VARS` allowlist so the path reaches the `/test` agent's subprocess
- **Conditional JUnit reporter in vitest**: `vitest.config.ts` adds the `junit` reporter when `ADW_UNIT_TEST_REPORT_PATH` is set (mirrors `cucumber.js` pattern); `--run src` and `passWithNoTests` removed
- **`adw_init` seeds JUnit flags**: When `## Run Tests` is absent, authors a JUnit-emitting command per detected language (vitest/jest/pytest/gotestsum/cargo-nextest); pre-existing custom commands are never overwritten
- **`/test` command cleanup**: Drops `--run src` and the `src/`-existence skip-as-passed; runs the full `## Run Tests` command unconditionally

## Technical Implementation

### Files Modified

- `adws/core/testReportParser.ts`: Added `failureMessage?: string` to `TestCaseResult`; added `extractFailureMessage()` helper that prefers `@_message` attribute then falls back to `#text` body
- `adws/core/testVerdict.ts`: Replaced `frameworkDetected` input with `reportPresent: boolean`; rewrote `computeTestVerdict` as a 5-branch guard-clause table (disabled → pass; no report → warn; failures → hard-fail; zero-count → hard-fail; else → pass)
- `adws/core/environment.ts`: Added `'ADW_UNIT_TEST_REPORT_PATH'` to `SAFE_ENV_VARS`
- `adws/phases/unitTestPhase.ts`: Computes absolute report path under `logsDir`; sets `process.env.ADW_UNIT_TEST_REPORT_PATH`; clears stale report; derives verdict from `{reportPresent, hasFailures, testcaseCount}`; removed `frameworkDetected` computation
- `adws/agents/testRetry.ts`: Added `unitReportPath` and `runTestsCommand` to `TestRetryOptions`; report-driven `isPassed` and `extractFailures`; added `reportPresent`/`hasFailures` to `TestRetryResult`
- `adws/agents/testAgent.ts`: Added `testResultFromCase(c: TestCaseResult, runCommand: string): TestResult` adapter for the resolver path
- `vitest.config.ts`: Conditional `junit` reporter gated on `ADW_UNIT_TEST_REPORT_PATH`; removed `passWithNoTests` and stale `--run src` comment
- `.claude/commands/test.md`: Removed `--run src` and `src/`-existence skip; unconditional run; JUnit emission note
- `.claude/commands/adw_init.md`: `## Run Tests` seeds JUnit-emitting flags per language (absent-only); preserves pre-existing custom commands verbatim
- `adws/core/__tests__/testVerdict.test.ts`: Rewritten for new `(enabled, reportPresent, hasFailures, testcaseCount)` signature
- `adws/core/__tests__/testReportParser.test.ts`: Extended with `failureMessage` extraction cases
- `features/per-issue/feature-601.feature`: New BDD feature file (273 lines) covering the full verdict contract
- `features/per-issue/step_definitions/feature-601.steps.ts`: Step definitions for feature-601
- `features/per-issue/step_definitions/feature-577.steps.ts`: Updated `computeTestVerdict` call site to new `reportPresent`-keyed signature

### Key Changes

- **Verdict branch table** (guard-clause order, max depth 2): `!enabled` → pass; `!reportPresent` → warn/unverified; `hasFailures` → hard-fail; `testcaseCount === 0` → hard-fail (discovery break restored); else → pass
- **Report cleared before each attempt**: `fs.rmSync(unitReportPath, { force: true })` before each retry so the verdict reflects only the current run
- **`isPassed` logic change**: `!(report !== null && report.failed > 0)` — only "report present with failures" is retryable; zero-testcase and report-absent exit the loop for the phase to classify
- **Deliberate divergence from scenario rail**: scenario rail falls back to subprocess exit code when no report found; unit rail goes straight to `unverified` (LLM-mediated exit signal not trusted for gating)
- **`testFramework` retained**: Still consumed by `stackCoherenceCheck.ts`; only `frameworkDetected` leaves the verdict computation

## How to Use

### For ADW-self (vitest)

The `bun run test:unit` command already works — `vitest.config.ts` now emits JUnit when `ADW_UNIT_TEST_REPORT_PATH` is set:

```sh
# Manual round-trip verification
ADW_UNIT_TEST_REPORT_PATH="$PWD/logs/junit-unit-manual.xml" bun run test:unit

# Parse and verify the report
ADW_UNIT_TEST_REPORT_PATH="$PWD/logs/junit-unit-manual.xml" \
  bunx tsx -e 'import("./adws/core/testReportParser.ts").then(({ readJUnitReport }) => {
    const r = readJUnitReport(process.env.ADW_UNIT_TEST_REPORT_PATH);
    console.log(JSON.stringify({ total: r?.total, passed: r?.passed, failed: r?.failed }));
  })'
```

### For target repos

During `adw_init`, the `## Run Tests` section is authored with JUnit-emitting flags for the detected language:

| Language | Seeded command |
|---|---|
| vitest | `vitest run --reporter=default --reporter=junit --outputFile=$ADW_UNIT_TEST_REPORT_PATH` |
| jest | `jest --reporters=default --reporters=jest-junit` (needs `JEST_JUNIT_OUTPUT_FILE` env) |
| pytest | `pytest --junitxml=$ADW_UNIT_TEST_REPORT_PATH` |
| go/gotestsum | `gotestsum --junitfile=$ADW_UNIT_TEST_REPORT_PATH` |
| cargo nextest | `cargo nextest run --profile ci` with nextest JUnit profile |

Pre-existing `## Run Tests` sections are **never overwritten**. A repo whose custom command emits no JUnit report resolves to `adw:unverified` (by design).

### Verdict outcomes

| State | Verdict | Action |
|---|---|---|
| Unit tests disabled | pass | Phase skipped |
| No JUnit report emitted | warn + `adw:unverified` | Unverified — check runner config |
| Report present, failures | hard-fail | `process.exit(1)`, retry loop activated |
| Report present, zero testcases | hard-fail | Discovery break — check test globs/include |
| Report present, count > 0, no failures | pass | Success |

## Configuration

- **`ADW_UNIT_TEST_REPORT_PATH`**: Absolute path for the JUnit report. Set automatically by `unitTestPhase` to `<logsDir>/junit-unit.xml`. In `SAFE_ENV_VARS` so it reaches the `/test` agent subprocess.
- **`## Run Tests` in `.adw/commands.md`**: The runner command. Must emit JUnit to `$ADW_UNIT_TEST_REPORT_PATH` via configured flags. Seeded by `adw_init` when absent; preserved verbatim if present.
- **`unitTests: false` in `.github/adw.yml`**: Disables the phase entirely; no report logic runs.

## Testing

```sh
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
bun run build
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Unit-test coverage:
- `testVerdict.test.ts`: All 5 verdict branches + disabled-overrides-failures
- `testReportParser.test.ts`: `failureMessage` from `@_message` attribute, text body, `<error message>`, bare `<failure/>` → skipped + no message, multiple failed cases

## Notes

- **Hash propagation**: `.claude/commands/adw_init.md` is a `hashInputs:` file. This edit raises `.adw-version` and triggers `adwUpgrade` to regenerate `.adw/` across all registered target repos (same mechanism issue #578 used for `scenarios.md` sections).
- **`testDirectory` is now vestigial**: The `--run src` path that consumed it is gone. Retained to avoid config churn outside this feature's scope — flagged for future cleanup.
- **Predecessor docs**: `app_docs/feature-u3l5q0-junit-report-rail-migration.md` (scenario-rail JUnit contract, #578) and `app_docs/feature-zyaojl-configurable-test-directory.md` (three-way verdict + configurable test dir, #577). Note: the #577 doc claims `test.md` already dropped `--run src`, but this feature is what actually removes it — trust the live files over that doc.
- **Discovery-break restored**: The `warn`→`hard-fail` restoration (commit `8184877`'s temporary demotion) lives entirely in `computeTestVerdict`'s zero-testcase branch, now reachable honestly because the report is present and the count is real.
- This is PRD slice "unit-test layer, PR 1" of `specs/prd/multi-language-test-and-bdd-support.md`. The generation/proof/screenshot overhaul and ADW-self scenario migration are separate PRs.
