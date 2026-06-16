# Feature: Structured-report (JUnit) rail + migrate ADW-self off `parseCucumberSummary`

## Metadata
issueNumber: `578`
adwId: `u3l5q0-structured-report-ju`
issueJson: `{"number":578,"title":"Structured-report (JUnit) rail + migrate ADW-self off parseCucumberSummary","body":"## Parent PRD\n\n`specs/prd/multi-language-test-and-bdd-support.md`\n\n## What to build\n\nReplace stdout-regex pass/fail with a structured-report contract. Build a single `testReportParser` (JUnit XML) returning total/passed/failed/cases; `scenarioProof` consumes it; **delete `parseCucumberSummary`**; migrate ADW's own cucumber-js `@regression` suite to emit JUnit on the same rail (reconstruct the noisy-exit/clean-tally override in structured-report terms). Drop the `.ts`-only step-def gate in favor of detection by `stepDefDirectory` + language extension. **HITL** — risks the framework's own green. See PRD Implementation Decisions → Structured-report contract & Proof layer.\n\n## Acceptance criteria\n\n- [ ] `testReportParser` handles valid/zero-testcase/malformed JUnit reports (unit-tested)\n- [ ] `scenarioProof` derives pass/fail from the parser, not stdout\n- [ ] `parseCucumberSummary` deleted; one parser only\n- [ ] ADW's own `@regression` suite green on the new rail\n- [ ] Step-def detection works for a non-`.ts` directory/extension\n\n## Blocked by\n\n- Blocked by #577\n\n## User stories addressed\n\n- User story 9\n- User story 10\n- User story 11\n- User story 30","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-06-15T11:51:04Z","comments":[],"actionableComment":null}`

## Feature Description

Today, ADW decides whether a BDD scenario run passed by **regexing cucumber-js's human-readable stdout summary line** (`parseCucumberSummary` in `adws/phases/scenarioProof.ts`). That string format is cucumber-specific and matches nothing emitted by pytest-bdd / behave / godog / cucumber-rs, so any non-cucumber suite cannot have its pass/fail derived. It is also fragile: the existing "noisy non-zero exit but clean tally" override (added for issue #492's post-suite D1/KPI write noise) only works because the cucumber summary line happens to be parseable.

This feature replaces stdout-regex pass/fail with a **structured-report contract**: the runner emits a **JUnit XML report** to a known path, and a single new pure module — **`testReportParser`** — reads it into `{ total, passed, failed, skipped, cases[] }`. `scenarioProof` consumes that report to derive pass/fail; the old `parseCucumberSummary` (and its `CucumberTally`) are **deleted** so there is exactly **one** report parser. ADW's own cucumber-js `@regression` suite is **migrated onto the same rail** by teaching `cucumber.js` to emit JUnit XML when ADW asks for it (via an `ADW_JUNIT_REPORT_PATH` env var), and the noisy-exit/clean-tally override is **reconstructed in structured-report terms** (trust the report's `failed` count over the process exit code, surfacing a transparency warning).

Finally, the **`.ts`-only step-definition gate** in `scenarioProof` (which skips BDD proof for any suite whose step defs are not `.ts` files under `features/step_definitions/`) is replaced with **detection by a configured `stepDefDirectory` plus a language extension derived from a configured `bddFramework`** — so a Python (`features/steps/*.py`) or Go (`*.go`) suite is recognized instead of silently skipped.

This is **PR 2** of the parent PRD's staged rollout (PR 1 was the unit-test layer, issue #577). It dogfoods the multi-language path on ADW's own suite and lays the JUnit rail that later slices (artifact harvest, proof publisher, coherence check) build on. It carries the `hitl` label because the cutover touches the framework's own green.

## User Story

As an **ADW operator / maintainer**
I want **pass/fail derived from a structured, machine-readable JUnit report (with zero-testcases detectable), a single report parser, ADW's own cucumber-js suite migrated onto that rail, and step-def detection that honors a configured directory + language extension**
So that **the verdict is robust across test runners (not tied to cucumber stdout formatting), the silent-green class of bug is closed, the multi-language path is dogfooded on the framework itself, and a non-`.ts` BDD suite is recognized rather than skipped**.

(Parent PRD user stories 9, 10, 11, 30.)

## Problem Statement

`adws/phases/scenarioProof.ts` derives the scenario verdict from cucumber-js stdout in two places, both stdout-coupled and cucumber-specific:

1. **`parseCucumberSummary(stdout)`** regexes the `N scenarios (… passed, … failed)` line to override a non-zero exit code to PASS when the tally is clean. This only works for cucumber-js; pytest-bdd / behave / godog / cucumber-rs emit no such line, so their pass/fail cannot be derived and the override cannot apply.
2. The **step-def pre-flight gate** (`scenarioProof.ts:165-167`) hardcodes `features/step_definitions/` + `f.endsWith('.ts')`. A non-`.ts` suite (Python `features/steps/*.py`, Go `*.go`) fails this check and the **entire BDD proof is silently skipped** with `hasBlockerFailures: false` — a silent green.

There is no structured-report parser, "zero testcases ran" is not detectable from the report (only inferred from a stdout substring), and the override mechanism is welded to cucumber's exact summary-line wording. The parent PRD mandates moving pass/fail onto a JUnit XML contract with a single parser, and migrating ADW's own suite onto that rail as the dogfood proof.

## Solution Statement

Introduce a **structured-report contract** centered on a single new parser and route the BDD proof through it:

1. **`testReportParser` (new pure module, `adws/core/testReportParser.ts`)** — `parseJUnitXml(xml) → TestReport | null` and an I/O wrapper `readJUnitReport(path) → TestReport | null`, where `TestReport = { total, passed, failed, skipped, cases[] }`. Built on `fast-xml-parser` (already in the dependency tree; declared explicitly). Handles a bare root `<testsuite>` (cucumber-js's shape) **and** a `<testsuites>` wrapper (pytest/behave's shape), the **zero-testcase** case (`total === 0`), and **malformed/missing** input (returns `null`). This is the **one** parser.

2. **Emit JUnit on the rail** — `runScenariosByTag` gains an optional `env` argument; `scenarioProof` sets `ADW_JUNIT_REPORT_PATH` to a per-tag absolute path before each run. `cucumber.js` is taught to add the built-in `junit:<path>` formatter **only when that env var is set** (so plain host runs and CI are unchanged). For ADW-self this is the entire "migrate own suite onto JUnit" step — `cucumber.js` is framework-resident, so it takes effect on merge with no hash gate.

3. **Derive pass/fail from the report, delete `parseCucumberSummary`** — `scenarioProof` reads the JUnit report after each run and derives the verdict from `report.failed` (not stdout). The **noisy-exit/clean-tally override is reconstructed in structured-report terms**: when the process exits non-zero but the report shows `failed === 0` with `total > 0`, treat as PASS and surface a `warning`. A **blocker** tag whose report shows `total === 0` is a discovery-break **failure** (closes the zero-scenario silent-green); an **optional** tag with `total === 0` is a graceful skip. When **no report is emitted** (a target repo not yet on the rail), fall back to the existing process-exit-code semantics — never to stdout. `parseCucumberSummary` and `CucumberTally` are removed.

4. **Step-def detection by directory + extension** — a new pure helper module (`adws/core/stepDefDetection.ts`) provides `stepDefExtensionsFor(bddFramework) → string[]` and `hasStepDefinitions(dir, extensions, cwd) → boolean` (recursive). `scenarioProof`'s gate uses the configured `stepDefDirectory` and the framework-derived extensions instead of the hardcoded `features/step_definitions` + `.ts`.

5. **Config + hash propagation** — `ScenariosConfig` gains `stepDefDirectory` and `bddFramework` (three-touch-point pattern), with backward-compatible defaults (`features/step_definitions` / `''` → `['.ts']`, preserving today's behavior). Per the PRD's **emit-parse coupling rule**, `adw_init.md` is updated to **emit** `## Step Def Directory` and `## BDD Framework` in the same PR (this raises `.adw-version`, triggering regeneration across targets).

Out of scope for this PR (later PRD slices): screenshot/artifact harvest, the PR proof publisher, the `stackCoherenceCheck`, and rewiring the **unit-test** path's `testcaseCount` onto the JUnit parser. The unit path keeps its agent-reported count from #577; `computeTestVerdict`'s signature is stable for that future change.

## Relevant Files

Use these files to implement the feature:

- `adws/phases/scenarioProof.ts` — **primary change site.** Delete `parseCucumberSummary` + `CucumberTally`; consume `readJUnitReport`; set `ADW_JUNIT_REPORT_PATH` per tag; derive pass/fail from the report with the reconstructed clean-tally override and the report-absent exit-code fallback; replace the `.ts`-only step-def gate with `hasStepDefinitions(stepDefDirectory, extensions)`. Add additive `counts`/`cases` to `TagProofResult`.
- `adws/agents/bddScenarioRunner.ts` — add an optional `env?: Record<string,string>` parameter to `runScenariosByTag`, merged into the spawned subprocess env (`{ ...process.env, ...env }`). Additive; `allPassed = exitCode === 0` semantics unchanged (it becomes the report-absent fallback signal).
- `cucumber.js` — conditionally append the built-in `junit:<ADW_JUNIT_REPORT_PATH>` formatter when the env var is set; otherwise unchanged (`format: ['progress']`). This is the ADW-self "emit JUnit" migration.
- `adws/core/projectConfig.ts` — add `stepDefDirectory` and `bddFramework` to `ScenariosConfig`, `SCENARIOS_HEADING_TO_KEY`, and `getDefaultScenariosConfig()` (three touch points; defaults `features/step_definitions` / `''`).
- `adws/core/index.ts` — re-export the new `testReportParser` and `stepDefDetection` symbols/types (mirrors the existing `testVerdict` export block).
- `adws/phases/scenarioTestPhase.ts` — the sole runtime caller of `runScenarioProof`; pass `stepDefDirectory` (from `projectConfig.scenarios.stepDefDirectory`) and `stepDefExtensions` (from `stepDefExtensionsFor(projectConfig.scenarios.bddFramework)`) into the options.
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — update the `runScenarioProof` mock-call assertions for the new options.
- `adws/github/proofCommentFormatter.ts` — consumer of `TagProofResult` (read-only; verify the additive fields don't break it — it uses `passed`/`skipped`/`output`/`severity`/`resolvedTag`). No change required beyond a type-check pass.
- `adws/phases/scenarioFixPhase.ts` — consumer of `TagProofResult` (`output`, `exitCode`, `passed`, `skipped`, `resolvedTag`); confirm unaffected.
- `.claude/commands/adw_init.md` — **hash-propagation requirement.** Update step 7 to emit `## Step Def Directory` and `## BDD Framework` in generated `.adw/scenarios.md` (Gherkin-mandate: never a non-Gherkin framework). `adw_init.md` is a `hashInputs:` file, so this raises `.adw-version` and triggers `adwUpgrade` regeneration across targets — the intended propagation.
- `package.json` — declare `fast-xml-parser` as an explicit dependency (currently transitive-only).
- `specs/prd/multi-language-test-and-bdd-support.md` — parent PRD (Implementation Decisions → Structured-report contract & Proof layer; Further Notes → hash/emit-parse coupling rule). Read-only reference.
- `app_docs/feature-2evbnk-bdd-smoke-surface-scenarios.md` and `specs/patch/patch-adw-2evbnk-bdd-rewrite-2-3-auth-scenario-proof-pass-on-clean-tally.md` — the original clean-tally override to reconstruct in structured-report terms. Read-only reference.
- `app_docs/feature-zyaojl-configurable-test-directory.md` — PR 1 (issue #577) context: `computeTestVerdict`, the three-touch-point config pattern, `adw:unverified`. Read-only reference.

### New Files

- `adws/core/testReportParser.ts` — the single JUnit XML parser. Exports `TestReport`, `TestCaseResult` types and `parseJUnitXml(xml: string): TestReport | null` (pure) + `readJUnitReport(filePath: string): TestReport | null` (I/O wrapper; `null` on missing/malformed).
- `adws/core/__tests__/testReportParser.test.ts` — unit tests covering valid multi-case, all-pass, with-failures (`<failure>` and `<error>`), skipped, zero-testcase, malformed XML, missing file, the `<testsuites>` wrapper shape, and single-testcase array coercion.
- `adws/core/stepDefDetection.ts` — `stepDefExtensionsFor(bddFramework: string): string[]` (pure framework→extensions map; default/empty → `['.ts']`) and `hasStepDefinitions(stepDefDir: string, extensions: string[], cwd: string): boolean` (recursive filesystem scan).
- `adws/core/__tests__/stepDefDetection.test.ts` — unit tests: extension map for cucumber-js/behave/pytest-bdd/godog/cucumber-rs/empty-default; recursive detection over temp dirs containing `.py`/`.go`/`.ts` files; missing directory → `false`; nested step defs found.

## Implementation Plan

### Phase 1: Foundation
Establish the single structured-report parser and the step-def detection primitives as pure, independently-testable modules, and declare the XML dependency. Extend the scenarios config schema (with the matching `adw_init.md` emission) so the directory/framework descriptor flows from config. None of this touches the live proof path yet, so it is risk-free to land first and unit-test in isolation.

### Phase 2: Core Implementation
Teach the runner to emit JUnit (`runScenariosByTag` env param + `cucumber.js` conditional formatter), then rewrite `scenarioProof` to consume `readJUnitReport`: delete `parseCucumberSummary`/`CucumberTally`, derive pass/fail from `report.failed`, reconstruct the clean-tally override in report terms, add the zero-testcase blocker-fail, keep an exit-code fallback for report-absent repos, and swap the `.ts`-only gate for `hasStepDefinitions`.

### Phase 3: Integration
Thread the new options from `scenarioTestPhase` (the sole caller) into `runScenarioProof`, update its test, verify the read-only `TagProofResult` consumers still type-check, and validate end-to-end that ADW's own `@regression` suite emits a JUnit report, parses cleanly, and reports PASS on the new rail (including under the post-suite-noise non-zero exit).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Declare the `fast-xml-parser` dependency
- Run the library install command from `.adw/commands.md` (`## Library Install Command`): `bun add fast-xml-parser`. (`fast-xml-parser` v5.x is already resolved transitively; this makes it an explicit, declared dependency rather than relying on hoisting.)
- Confirm it appears under `dependencies` in `package.json`.

### Task 2 — Create the `testReportParser` module
- Create `adws/core/testReportParser.ts`.
- Define `TestCaseResult = { name: string; classname?: string; status: 'passed' | 'failed' | 'skipped' }` and `TestReport = { total: number; passed: number; failed: number; skipped: number; cases: TestCaseResult[] }`.
- Implement `parseJUnitXml(xml: string): TestReport | null`:
  - Validate first with `XMLValidator.validate(xml)`; on invalid or empty input return `null`.
  - Parse with `new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (name) => name === 'testcase' || name === 'testsuite' })`.
  - Normalize both shapes: collect every `<testsuite>` from either `parsed.testsuites?.testsuite` (wrapper) or `parsed.testsuite` (bare root). If neither key is present, return `null`.
  - For each `<testcase>`: it is **failed** if it has a `failure` or `error` child key, **skipped** if it has a `skipped` child key, otherwise **passed**. Build `cases[]` with `{ name: @_name, classname: @_classname, status }`.
  - `total = cases.length`; `failed`/`skipped` = counts by status; `passed = total - failed - skipped`. Return the `TestReport`. A valid `<testsuite tests="0">` with no testcases yields `{ total: 0, passed: 0, failed: 0, skipped: 0, cases: [] }` (the zero-testcase case).
- Implement `readJUnitReport(filePath: string): TestReport | null`: return `null` if the file does not exist; otherwise read it and return `parseJUnitXml(contents)` (which itself returns `null` on malformed content). Keep I/O isolated to this wrapper (guideline: purity / side effects at the edges).
- Apply guard clauses / max-depth-2 nesting (extract the per-testcase classification into a small named helper).

### Task 3 — Unit-test `testReportParser`
- Create `adws/core/__tests__/testReportParser.test.ts` (mirror the `describe/it/expect` style of `testVerdict.test.ts`). Use inline XML string fixtures. Cover:
  - **Valid, mixed**: a bare `<testsuite tests="3" failures="1" skipped="1">` with one passing, one `<failure>`, one `<skipped>` testcase → `{ total: 3, passed: 1, failed: 1, skipped: 1 }` and the right `cases[]` statuses.
  - **All passed**: cucumber-shaped report (root `<testsuite>`, several `<testcase>` with no failure child) → `failed === 0`, `total > 0`.
  - **`<error>` counts as failed**: a testcase with an `<error>` child → `failed === 1`.
  - **Zero testcases**: `<testsuite tests="0"/>` (no children) → `{ total: 0, passed: 0, failed: 0 }`.
  - **Malformed**: not-XML / truncated string → `null`.
  - **`<testsuites>` wrapper**: pytest/behave shape with nested `<testsuite>` → counts summed across suites.
  - **Single testcase coercion**: one `<testcase>` (parser returns object, not array) is handled as one case.
  - `readJUnitReport` on a missing path → `null`; on a temp file with valid XML → parsed report.

### Task 4 — Create the `stepDefDetection` module
- Create `adws/core/stepDefDetection.ts`.
- `stepDefExtensionsFor(bddFramework: string): string[]` — pure, case-insensitive, trimmed map. Minimum entries: `cucumber-js`/`cucumber` → `['.ts', '.js']`; `behave`/`pytest-bdd` → `['.py']`; `godog` → `['.go']`; `cucumber-rs` → `['.rs']`; `cucumber-ruby` → `['.rb']`; default/empty/unknown → `['.ts']` (preserves today's `.ts`-only behavior for un-migrated repos). Document that the map is extensible and that an unknown framework conservatively defaults to `['.ts']`.
- `hasStepDefinitions(stepDefDir: string, extensions: string[], cwd: string): boolean` — resolve `stepDefDir` against `cwd`; return `false` if it does not exist; otherwise scan **recursively** for any file whose name ends with one of `extensions`. Use an iterative stack (guideline: max depth ~2, no sideways-christmas-tree recursion-in-loop nesting) and return early on first match.

### Task 5 — Unit-test `stepDefDetection`
- Create `adws/core/__tests__/stepDefDetection.test.ts`. Cover:
  - `stepDefExtensionsFor`: `'cucumber-js'`, `'behave'`, `'pytest-bdd'`, `'godog'`, `'cucumber-rs'`, `''`/unknown (default `['.ts']`), and case/whitespace insensitivity (`'  Behave '`).
  - `hasStepDefinitions` over `fs.mkdtempSync(os.tmpdir())` fixtures (mirror `projectConfig.test.ts`/`adwYmlConfig.test.ts` temp-dir style): a dir with `steps.py` + `extensions=['.py']` → `true`; same dir + `['.ts']` → `false`; a **nested** `sub/steps.go` + `['.go']` → `true` (proves recursion + non-`.ts` directory/extension); a missing directory → `false`. Clean up temp dirs in `afterEach`.

### Task 6 — Extend `ScenariosConfig` (three touch points) in `projectConfig.ts`
- Add `stepDefDirectory: string` and `bddFramework: string` to the `ScenariosConfig` interface.
- Add to `SCENARIOS_HEADING_TO_KEY`: `'step def directory': 'stepDefDirectory'`, `'bdd framework': 'bddFramework'`.
- Add to `getDefaultScenariosConfig()`: `stepDefDirectory: 'features/step_definitions'`, `bddFramework: ''` (empty → `['.ts']` via `stepDefExtensionsFor`, preserving current behavior for un-regenerated repos).
- Add tests to `adws/core/__tests__/projectConfig.test.ts`: parsing a `scenarios.md` containing the two new sections; default fallback when absent; round-trip values preserved.

### Task 7 — Re-export from `adws/core/index.ts`
- Add an export block mirroring the existing `// Test verdict` block:
  - `export type { TestReport, TestCaseResult } from './testReportParser';` and `export { parseJUnitXml, readJUnitReport } from './testReportParser';`
  - `export { stepDefExtensionsFor, hasStepDefinitions } from './stepDefDetection';`
- Confirm `ScenariosConfig` is already re-exported (it is, line 107) so the new fields flow through.

### Task 8 — Add an `env` parameter to `runScenariosByTag`
- In `adws/agents/bddScenarioRunner.ts`, change the signature to `runScenariosByTag(tagCommand, tag, cwd?, env?: Record<string, string>)`.
- Pass `env: env ? { ...process.env, ...env } : process.env` into the existing `spawn(...)` options. Leave the `'N/A'`/empty short-circuit and the `allPassed = exitCode === 0` derivation unchanged (per the #492 patch note, `allPassed` is the source-of-truth process signal — it remains, now as the report-absent fallback).
- Update the JSDoc to document the new parameter.

### Task 9 — Emit JUnit from `cucumber.js` when on the rail
- In `cucumber.js`, read `process.env.ADW_JUNIT_REPORT_PATH`. When set, build `format` as `['progress', \`junit:${junitPath}\`]`; when unset, keep `['progress']` exactly as today.
- Rationale to capture in a comment: the `junit` formatter is built into `@cucumber/cucumber` v12 (delegates to `@cucumber/junit-xml-formatter`, already installed). Gating on the env var keeps plain host runs (`bunx cucumber-js`) and the CI `regression.yml` job (which sets no such var) byte-for-byte unchanged, while ADW's `scenarioProof` opts in per run. `progress` targets stdout and `junit:<path>` targets a file, so there is no formatter-target conflict.

### Task 10 — Rewrite `scenarioProof.ts` onto the structured rail
- **Delete** `parseCucumberSummary` and the `CucumberTally` interface entirely.
- Import `readJUnitReport` and `hasStepDefinitions` from `../core`.
- **Signature**: extend `runScenarioProof`'s options with `stepDefDirectory: string` and `stepDefExtensions: string[]`.
- **Step-def gate**: replace the hardcoded `features/step_definitions` + `.ts` check (current lines 165-167) with `hasStepDefinitions(stepDefDirectory, stepDefExtensions, cwd ?? process.cwd())`. Keep the existing "no step defs → write a skip proof and return `hasBlockerFailures: false`" behavior.
- **Per-tag JUnit emission + parse** inside the loop:
  - `fs.mkdirSync(proofDir, { recursive: true })` once before the loop (so report paths exist).
  - Compute `const reportPath = path.resolve(proofDir, \`junit-${tagName}.xml\`)` (sanitize `tagName` for filename safety — replace non-`[A-Za-z0-9_-]` with `-`). Remove any stale file at that path (`fs.rmSync(reportPath, { force: true })`).
  - `const result = await runScenariosByTag(runByTagCommand, tagName, cwd, { ADW_JUNIT_REPORT_PATH: reportPath });`
  - `const report = readJUnitReport(reportPath);`
- **Verdict derivation** (extract into a small named helper for clarity, e.g. `deriveTagOutcome(report, result, optional)` returning `{ passed, skipped, noScenarios, warning, counts }`):
  - **Report present, `total > 0`**: `passed = report.failed === 0` (structured truth — not stdout). If `!result.allPassed && passed`, set `warning` describing the override (process exited `${exitCode}` but JUnit report is clean: `${report.passed} passed, ${report.failed} failed of ${report.total}` — treating as PASS; post-suite noise preserved in Output). Carry `counts = { total, passed, failed }`.
  - **Report present, `total === 0`**: `noScenarios = true`. Optional tag → graceful skip (`passed: true, skipped: true`). **Non-optional (blocker) tag → `passed: false`** (zero-testcase discovery break — closes the silent-green hole; mirrors `computeTestVerdict`'s zero-testcase rule). This will not affect ADW-self's `@regression` (always ~1600 scenarios) or the optional `@adw-{N}` tag.
  - **Report absent (`null`)**: fall back to the process exit code — `passed = result.allPassed`; for optional tags retain the existing graceful-skip-on-empty behavior via the retained stdout `isNoScenariosOutput` helper. This keeps un-migrated target repos behaving exactly as today (no regression, no override). Never derive pass/fail from the cucumber summary string.
- Keep `output` = truncated stdout (still used for the proof markdown and as the scenario-fix agent's error context). Keep the existing `warning` field on `TagProofResult`; add an **additive** optional `counts?: { total: number; passed: number; failed: number }` (and optionally `cases?: TestCaseResult[]`) for downstream proof surfacing — additive, so `proofCommentFormatter`/`scenarioFixPhase` are unaffected.
- `buildProofMarkdown` continues to render `**Warning:**` when present (unchanged); optionally include a counts line. Recompute `hasBlockerFailures` exactly as today (`severity === 'blocker' && !passed && !skipped`).

### Task 11 — Thread the new options from `scenarioTestPhase.ts`
- In `executeScenarioTestPhase`, destructure `stepDefDirectory` and `bddFramework` from `projectConfig.scenarios`, compute `const stepDefExtensions = stepDefExtensionsFor(bddFramework)` (import from `../core`), and pass `stepDefDirectory` + `stepDefExtensions` into the `runScenarioProof({ ... })` options object (both the direct call and the `withDevServer`-wrapped `runProof` closure use the same options builder).
- Update `adws/phases/__tests__/scenarioTestPhase.test.ts`: extend the `expect(mockRunScenarioProof).toHaveBeenCalledWith(...)` assertions to include the new `stepDefDirectory` / `stepDefExtensions` options (default config → `'features/step_definitions'` / `['.ts']`).

### Task 12 — Emit the new descriptor fields from `adw_init.md` (hash propagation)
- In `.claude/commands/adw_init.md` step 7 ("Create `.adw/scenarios.md`"), add emission of:
  - `## BDD Framework` — the detected **Gherkin** step-def runtime for the stack (cucumber-js for JS/TS, behave or pytest-bdd for Python, godog for Go, cucumber-rs for Rust, cucumber-ruby for Ruby). Per the PRD Gherkin mandate, **never emit a non-Gherkin framework**; on non-recognition fall back to `cucumber-js`.
  - `## Step Def Directory` — the conventional step-def directory for that framework (cucumber-js → `features/step_definitions`; behave → `features/steps`; default → `features/step_definitions`).
- Keep these consistent with the scenario tool already detected in step 7 (the same detection that drives `## Run Scenarios by Tag`).
- Note in step 8's Report that the two new sections were written.
- **Call out in the plan/PR description** that editing `adw_init.md` (a `hashInputs:` file) raises `.adw-version`, which triggers `adwUpgrade` to regenerate `.adw/` across all registered target repos and ADW-self — this is the intended emit-parse propagation, and the reason the issue is `hitl`. Un-regenerated repos read the new fields as their backward-compatible defaults until regeneration runs.

### Task 13 — Run the Validation Commands
- Run every command in the `Validation Commands` section below and confirm zero errors and zero regressions, including the end-to-end JUnit-rail check that proves ADW's own `@regression` suite is green on the new rail.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope.

- **`testReportParser` (`adws/core/__tests__/testReportParser.test.ts`)** — the core acceptance-criterion test. Inline JUnit XML fixtures → assert `{ total, passed, failed, skipped, cases[] }` for: valid mixed (pass/fail/skip), all-passed cucumber-shape, `<failure>` and `<error>` both counted as failed, **zero-testcase**, **malformed/missing** (`null`), `<testsuites>` wrapper, and single-testcase coercion. Asserts external behavior through the public `parseJUnitXml`/`readJUnitReport` interface only (guideline: test public interface, not internals).
- **`stepDefDetection` (`adws/core/__tests__/stepDefDetection.test.ts`)** — `stepDefExtensionsFor` map (all framework keys + default + case-insensitivity); `hasStepDefinitions` over temp-dir fixtures proving a **non-`.ts` directory/extension** (`.py`, nested `.go`) is detected and `.ts`-only matching is correctly negative — the step-def acceptance criterion.
- **`projectConfig` (`adws/core/__tests__/projectConfig.test.ts`, extended)** — `stepDefDirectory` / `bddFramework` parse from a `scenarios.md`; defaults when absent; round-trip preserved.
- **`scenarioTestPhase` (`adws/phases/__tests__/scenarioTestPhase.test.ts`, extended)** — `runScenarioProof` is invoked with the new `stepDefDirectory` / `stepDefExtensions` options derived from the project config.

### Edge Cases
- JUnit report present but `total === 0`: optional tag → graceful skip; blocker tag → fail (zero-testcase discovery break). Verified by the parser's zero-testcase test plus the scenarioProof verdict logic.
- Process exits non-zero (post-suite D1/KPI noise) but report is clean (`failed === 0`, `total > 0`) → PASS with a `warning`. This is the reconstructed #492 override; verified end-to-end by the `@regression` run, whose subprocess still exits 1 on post-suite D1 write noise.
- JUnit report **missing** (runner crashed before writing, or a target repo not yet on the rail) → `readJUnitReport` returns `null`; scenarioProof falls back to the process exit code (no override, no stdout parse) — no regression for un-migrated repos.
- Malformed JUnit XML → parser returns `null` → report-absent fallback path.
- `<testsuites>` wrapper (pytest/behave shape) vs bare `<testsuite>` (cucumber shape) both parse correctly.
- Single `<testcase>` (XML parser returns an object, not an array) is coerced and counted.
- Tag name containing `@`/slashes → sanitized into a safe JUnit filename.
- Step defs present only under a nested subdirectory of `stepDefDirectory` → detected (recursive scan).
- `bddFramework` empty/unknown → extensions default to `['.ts']` → ADW-self stays green pre-regeneration.
- Plain host `bunx cucumber-js` run and CI `regression.yml` (no `ADW_JUNIT_REPORT_PATH`) → `cucumber.js` format unchanged (`['progress']`), no behavior change.

## Acceptance Criteria
- [ ] `testReportParser` (`parseJUnitXml` + `readJUnitReport`) handles **valid**, **zero-testcase**, and **malformed/missing** JUnit reports, returning `{ total, passed, failed, skipped, cases[] }` (or `null`), and is covered by unit tests.
- [ ] `scenarioProof` derives pass/fail from the parsed JUnit report (`report.failed`), **not** from cucumber stdout; the report-absent path falls back to the process exit code, never to a stdout summary regex.
- [ ] `parseCucumberSummary` and `CucumberTally` are **deleted**; `testReportParser` is the **only** report parser in the codebase.
- [ ] ADW's own `@regression` suite is **green on the new rail**: `cucumber.js` emits a JUnit report when `ADW_JUNIT_REPORT_PATH` is set, `scenarioProof` parses it, and the suite reports PASS even though the subprocess exits non-zero on post-suite D1/KPI noise (override reconstructed in structured-report terms, with a transparency warning).
- [ ] Step-def detection works for a **non-`.ts` directory/extension**: `stepDefDirectory` + `bddFramework`-derived extensions recognize a `.py`/`.go` step-def suite (unit-tested), and the hardcoded `.ts`-only gate is removed.
- [ ] `ScenariosConfig` gains `stepDefDirectory` + `bddFramework` with backward-compatible defaults, and `adw_init.md` emits both sections (same PR; `.adw-version` raised for propagation).
- [ ] `fast-xml-parser` is declared in `package.json` dependencies.
- [ ] All Validation Commands pass with zero regressions (lint, both type-checks, unit tests, build, and the full `@regression` suite).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint clean across the new modules and edits.
- `bunx tsc --noEmit` — host TypeScript type-check passes (new parser, config fields, `fast-xml-parser` types).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type-check passes (critical: `TagProofResult` is re-exported and consumed by `proofCommentFormatter.ts` and `scenarioFixPhase.ts`; additive fields must be type-compatible with all readers, and `runScenarioProof`'s new options must flow from `scenarioTestPhase`).
- `bun run test:unit` — full Vitest suite green, including the new `testReportParser` and `stepDefDetection` tests and the extended `projectConfig` / `scenarioTestPhase` tests.
- `bun run build` — full build succeeds (`tsc`).
- **End-to-end JUnit-rail check (proves ADW-self green on the new rail):**
  ```sh
  ADW_JUNIT_REPORT_PATH="$PWD/agents/u3l5q0-structured-report-ju/junit-regression.xml" \
    NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"; \
    echo "cucumber exit: $?"
  # Then confirm the structured report was emitted and parses to a clean tally:
  ADW_JUNIT_REPORT_PATH="$PWD/agents/u3l5q0-structured-report-ju/junit-regression.xml" \
    bunx tsx -e 'import("./adws/core/testReportParser.ts").then(({ readJUnitReport }) => { const r = readJUnitReport(process.env.ADW_JUNIT_REPORT_PATH); console.log(JSON.stringify({ total: r && r.total, passed: r && r.passed, failed: r && r.failed })); if (!r || r.failed !== 0 || r.total === 0) process.exit(1); })'
  ```
  Expected: a `junit-regression.xml` file is written; the parser reports `failed: 0` and `total > 0`; the cucumber subprocess may exit non-zero (post-suite D1/KPI noise) yet the structured report is clean — confirming the reconstructed override.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full `@regression` suite runs with a clean scenario tally (0 failed, 0 undefined), confirming no scenario regressions from the cutover.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the new modules pure with side effects at the edges (`parseJUnitXml` pure; `readJUnitReport` is the only I/O surface); use guard clauses and max-depth-2 nesting (extract the per-testcase classifier and the per-tag verdict helper); explicit types, no `any` (lean on `fast-xml-parser` typings + local interfaces); files under 300 lines.
- **New library**: `fast-xml-parser` (already in the tree transitively via cucumber). Install with `bun add fast-xml-parser` per `.adw/commands.md` `## Library Install Command`. Chosen over hand-rolled XML regex precisely because the point of this feature is to stop parsing fragile text; a real XML parser keeps the rail robust across runners (cucumber bare `<testsuite>`, pytest/behave `<testsuites>` wrapper).
- **JUnit shape reference** (from `@cucumber/junit-xml-formatter`): root `<testsuite name tests skipped failures errors>` with `<testcase classname name>` children; a failed/errored/skipped case carries a single child element whose tag is the kind (`<failure>`, `<error>`, or `<skipped>`). The parser keys off the presence of those child elements (most robust cross-runner) and also tolerates a `<testsuites>` wrapper.
- **Override reconstruction**: the #492 behavior ("clean tally beats non-zero exit") is preserved but re-expressed against `report.failed === 0 && report.total > 0` instead of a stdout regex. The non-zero exit is still surfaced in the proof markdown via the existing `warning` field for reviewer transparency. Source: `specs/patch/patch-adw-2evbnk-bdd-rewrite-2-3-auth-scenario-proof-pass-on-clean-tally.md`.
- **Hash propagation is mandatory and in-scope** (PRD Further Notes → emit-parse coupling rule): adding parsed `.adw/scenarios.md` fields (`stepDefDirectory`, `bddFramework`) **requires** teaching `adw_init.md` to emit them in the same PR, otherwise `.adw-version` does not move, regeneration does not run, and targets get the new parser reading old config. This is why Task 12 is non-optional.
- **ADW-self's own `.adw/scenarios.md`** is intentionally **not** hand-edited here: the backward-compatible defaults (`features/step_definitions` + `['.ts']`) keep ADW's own suite green immediately, and `adwUpgrade` will regenerate the file with the explicit `## BDD Framework` / `## Step Def Directory` sections after this PR merges (raising the hash). Editing generated config by hand would diverge from what `adw_init` emits.
- **Backward compatibility / blast radius**: target repos not yet emitting JUnit hit the report-absent fallback and behave exactly as today (process-exit-code verdict, no override, no stdout regex). Only repos that emit a JUnit report (ADW-self via `cucumber.js`) get the structured verdict and the zero-testcase blocker-fail. The "hard-fail only when a report is present and shows zero testcases" rule bounds the blast radius the same way #577's "framework detected" rule did.
- **Explicitly out of scope** (later PRD slices, do not build here): `proofArtifactHarvester` (screenshot/R2 harvest), the `prProofPublisher` PR proof comment, `stackCoherenceCheck`, the polymorphic `generate_step_definitions.md` / `scenario_writer.md` prompt changes, and rewiring the **unit-test** path's `testcaseCount` onto `testReportParser` (the unit path keeps #577's agent-reported count; `computeTestVerdict` is stable for that future change).
- **Known remaining stdout touch (not a parser)**: `adws/github/proofCommentFormatter.ts` still has a display-only `parseScenarioCounts(output)` regex for the "passed/total" cell in the PR proof table. It is not a pass/fail parser (pass/fail comes from `r.passed`), so it does not violate "one parser only." It can later read the additive `TagProofResult.counts` and be removed — noted as a follow-up, not done here to keep this PR focused on the acceptance criteria.
