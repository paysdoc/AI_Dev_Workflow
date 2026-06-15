# JUnit Report Rail + Migrate Off `parseCucumberSummary`

**ADW ID:** u3l5q0-structured-report-ju
**Date:** 2026-06-15
**Specification:** specs/issue-578-adw-u3l5q0-structured-report-ju-sdlc_planner-junit-report-rail-migration.md

## Overview

Replaces stdout-regex pass/fail (`parseCucumberSummary`) with a structured JUnit XML contract. A new pure module `testReportParser` reads JUnit reports into `{ total, passed, failed, skipped, cases[] }`; `scenarioProof` consumes it to derive verdicts; ADW's own cucumber-js `@regression` suite now emits JUnit XML when `ADW_JUNIT_REPORT_PATH` is set. The hardcoded `.ts`-only step-definition gate is replaced with configurable directory + framework-derived extension detection via `stepDefDetection`.

## What Was Built

- `adws/core/testReportParser.ts` — single JUnit XML parser (`parseJUnitXml` + `readJUnitReport`), replacing the deleted `parseCucumberSummary`
- `adws/core/stepDefDetection.ts` — `stepDefExtensionsFor(bddFramework)` and `hasStepDefinitions(dir, extensions, cwd)` for multi-language step-def gate
- `adws/core/index.ts` — re-exports for both new modules
- `adws/phases/scenarioProof.ts` — rewritten to consume the JUnit report; `parseCucumberSummary` and `CucumberTally` deleted; clean-tally override reconstructed in structured-report terms; zero-testcase blocker-fail added; `TagProofResult` gains additive `counts` and `cases` fields
- `adws/agents/bddScenarioRunner.ts` — optional `env` parameter added to `runScenariosByTag` for injecting `ADW_JUNIT_REPORT_PATH`
- `adws/core/projectConfig.ts` — `ScenariosConfig` gains `stepDefDirectory` and `bddFramework` (three-touch-point pattern with backward-compatible defaults)
- `cucumber.js` — conditionally appends `junit:<path>` formatter when `ADW_JUNIT_REPORT_PATH` is set
- `.claude/commands/adw_init.md` — emits `## BDD Framework` and `## Step Def Directory` in generated `.adw/scenarios.md`
- `.claude/commands/test.md` — updated for new validation commands
- Unit tests: `testReportParser.test.ts`, `stepDefDetection.test.ts`, extended `projectConfig.test.ts` and `scenarioTestPhase.test.ts`
- BDD acceptance: `features/per-issue/feature-578.feature` + step definitions

## Technical Implementation

### Files Modified

- `adws/core/testReportParser.ts` (**new**): `parseJUnitXml(xml) → TestReport | null` handles bare `<testsuite>` (cucumber shape), `<testsuites>` wrapper (pytest/behave shape), zero-testcase, malformed, single-testcase coercion, and bare `<failure/>` markers (PENDING/UNDEFINED → skipped). `readJUnitReport(path)` is the I/O-only wrapper.
- `adws/core/stepDefDetection.ts` (**new**): pure framework→extension map; recursive iterative directory scan via a stack (no recursion-in-loop). Unknown/empty framework defaults to `['.ts']` preserving pre-migration behavior.
- `adws/phases/scenarioProof.ts`: `parseCucumberSummary` + `CucumberTally` deleted. Per-tag JUnit report written to `junit-<safeTag>.xml` in `proofDir`. Verdict logic extracted into `deriveTagOutcome(report, result, optional)`: report-present+total>0 → structured truth; report-present+total=0 → optional skip / blocker fail; report-absent → exit-code fallback (never stdout). `buildProofMarkdown` adds a `**Report:**` counts line when available.
- `adws/agents/bddScenarioRunner.ts`: `env?: Record<string, string>` merged into subprocess env; exit-code semantics unchanged (now the report-absent fallback signal).
- `cucumber.js`: `const junitPath = process.env.ADW_JUNIT_REPORT_PATH; const format = junitPath ? ['progress', \`junit:${junitPath}\`] : ['progress']` — no behavioral change for plain host runs or CI.
- `adws/core/projectConfig.ts`: `stepDefDirectory` and `bddFramework` added to `ScenariosConfig`, `SCENARIOS_HEADING_TO_KEY`, and `getDefaultScenariosConfig()`.
- `adws/phases/scenarioTestPhase.ts`: passes `stepDefDirectory` and `stepDefExtensions` (via `stepDefExtensionsFor`) into `runScenarioProof`.

### Key Changes

- **One parser only**: `parseCucumberSummary` is gone; `testReportParser` is the single source of truth for scenario verdicts.
- **Zero-testcase closes silent-green**: a blocker tag whose JUnit report is present but has `total === 0` is now a hard failure instead of a silent pass.
- **Clean-tally override preserved**: when the process exits non-zero but `report.failed === 0 && report.total > 0`, the outcome is PASS with a transparency `warning` (reconstructed from the `#492` patch in structured-report terms).
- **Report-absent fallback**: target repos not yet emitting JUnit hit the exit-code path exactly as before — no regression.
- **Hash propagation**: `adw_init.md` emits the two new `scenarios.md` sections in the same PR, raising `.adw-version` and triggering `adwUpgrade` regeneration across registered repos.

## How to Use

### ADW-self (automatic)

ADW's `cucumber.js` emits a JUnit report automatically when `scenarioProof` sets `ADW_JUNIT_REPORT_PATH` before each run. No manual configuration needed — it activates on the next scenario test phase.

### Target repos

Target repos that already emit JUnit XML (e.g. via `--format junit:<path>`) gain structured verdicts immediately once they set `ADW_JUNIT_REPORT_PATH` in their run command. Repos that do not emit JUnit continue to use the exit-code fallback path unchanged.

### Manual end-to-end check

```sh
ADW_JUNIT_REPORT_PATH="$PWD/agents/u3l5q0-structured-report-ju/junit-regression.xml" \
  NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Confirm the report is clean
ADW_JUNIT_REPORT_PATH="$PWD/agents/u3l5q0-structured-report-ju/junit-regression.xml" \
  bunx tsx -e 'import("./adws/core/testReportParser.ts").then(({ readJUnitReport }) => {
    const r = readJUnitReport(process.env.ADW_JUNIT_REPORT_PATH);
    console.log(JSON.stringify({ total: r?.total, passed: r?.passed, failed: r?.failed }));
    if (!r || r.failed !== 0 || r.total === 0) process.exit(1);
  })'
```

Expected: `junit-regression.xml` written; parser reports `failed: 0`, `total > 0`; subprocess may exit non-zero (post-suite D1/KPI noise) but structured report is clean.

## Configuration

### `.adw/scenarios.md` (auto-generated by `adw_init`)

```md
## BDD Framework
cucumber-js

## Step Def Directory
features/step_definitions
```

Supported `bddFramework` values and their extensions:
- `cucumber-js` / `cucumber` → `.ts`, `.js`
- `behave` / `pytest-bdd` → `.py`
- `godog` → `.go`
- `cucumber-rs` → `.rs`
- `cucumber-ruby` → `.rb`
- empty / unknown → `.ts` (backward-compatible default)

Un-regenerated repos use the defaults (`features/step_definitions` + `['.ts']`) automatically until `adwUpgrade` regenerates their `.adw/` directory.

### `ADW_JUNIT_REPORT_PATH` environment variable

Set by `scenarioProof` per tag before each run. The value is an absolute path under `proofDir` (`junit-<safeTagName>.xml`). Unset in plain host runs and CI `regression.yml` — `cucumber.js` stays on `['progress']` in those contexts.

## Testing

```sh
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit       # includes new testReportParser, stepDefDetection, extended projectConfig + scenarioTestPhase tests
bun run build
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Unit test coverage:
- `testReportParser`: valid mixed, all-pass, `<error>` as failed, zero-testcase, malformed/missing, `<testsuites>` wrapper, single-testcase coercion, bare `<failure/>` → skipped
- `stepDefDetection`: all framework keys, case/whitespace insensitivity, recursive detection of `.py`/`.go`/`.ts`, missing directory → false
- `projectConfig`: `stepDefDirectory`/`bddFramework` parse, defaults when absent

## Notes

- **Bare `<failure/>` semantics**: cucumber-js emits a bare `<failure/>` (no attributes, no text) for PENDING and UNDEFINED scenarios. The parser treats an empty failure marker as `skipped`, not `failed`, preserving the pre-migration behavior where pending scenarios did not count as failures.
- **`proofCommentFormatter.ts` unchanged**: its `parseScenarioCounts(output)` regex is display-only (not a pass/fail parser) and is unaffected. It can later read `TagProofResult.counts` as a follow-up.
- **Out of scope**: `prProofPublisher`, screenshot/R2 harvest, `stackCoherenceCheck`, polymorphic `generate_step_definitions`/`scenario_writer` prompt changes, rewiring the unit-test path's `testcaseCount` onto `testReportParser`.
- **`adw_init.md` is a `hashInputs:` file**: editing it raises `.adw-version`, which triggers `adwUpgrade` regeneration across all registered target repos — the intended emit-parse coupling propagation.
