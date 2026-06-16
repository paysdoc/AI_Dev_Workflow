# Feature: Unit-test rail onto JUnit report + restore discovery-break (generalized)

## Metadata
issueNumber: `601`
adwId: `hrl5jd-unit-test-rail-onto`
issueJson: `{"number":601,"title":"Unit-test rail onto JUnit report + restore discovery-break (generalized)","state":"OPEN","author":"paysdoc","labels":["adw:feature","adw:unverified"],"parentPrd":"specs/prd/multi-language-test-and-bdd-support.md","userStories":[2,3,4,5,9,10]}`

## Feature Description

Converge the **unit-test rail** onto the structured-report (JUnit XML) contract that issue #578 built for the scenario rail, generalized across languages. Today the unit verdict is derived from the agent-eyeballed `/test` `app_tests` step, which filters the run to `src/` (`--run src`), never executes the configured suite, and emits no real `testcase_count`. For any non-`src/` layout — including ADW's own `adws/**/__tests__` vitest suite — the count is structurally zero. Combined with the `frameworkDetected` discovery-break guard in `computeTestVerdict`, this would hard-fail every self-hosted run before a PR could open (issues #579, #580). That guard was therefore temporarily demoted from `hard-fail` to `warn` on `dev` (commit `8184877`) purely as a deadlock-breaker.

This feature makes the runner emit a JUnit report to a known path (`ADW_UNIT_TEST_REPORT_PATH`) and has `unitTestPhase` derive the unit verdict from that report via the existing `readJUnitReport`. The runner is told to emit JUnit through flags **authored in `.adw/commands.md` `## Run Tests`**; `adw_init` seeds those flags from known per-language conventions **only when the section is absent** (it never overwrites a pre-existing custom command). The `--run src` subset and the static `frameworkDetected` signal are both dropped. `lint`/`tsc`/`build` remain agent-gated and independent of the unit verdict.

The value: the unit gate becomes honest and language-agnostic. ADW's own suite finally runs and reports a real testcase count; flat-layout repos (Python/`tests/`, Go, Rust) are no longer silently green; and a genuine discovery break (zero testcases despite a report) is a `hard-fail` again — restored here, now keyed on JUnit-report presence instead of a static framework guess.

## User Story

As an **ADW maintainer running ADW against its own repository (and against multi-language target repos)**
I want **the unit-test verdict derived from a structured JUnit report that the configured suite actually emits, instead of an agent-eyeballed `src/`-filtered count**
So that **the unit gate is trustworthy and language-agnostic: real failures and genuine discovery breaks hard-fail, a missing report degrades honestly to `unverified`, and ADW's own suite stops structurally reporting zero testcases and blocking every self-hosted run.**

(Addresses parent-PRD user stories 2, 3, 4, 5, 9, 10.)

## Problem Statement

The unit-test layer is wired to a fragile, dishonest signal:

1. **`/test` filters to `src/`.** `.claude/commands/test.md` step 5 reads `## Run Tests` and appends `--run src`, then *skips and marks passed* when no `src/` directory exists. ADW (tests under `adws/`) and flat-layout repos (tests under `tests/`) never run their real suite, so `applicationTestcaseCount` is structurally `0`.
2. **The verdict keys on a static guess.** `computeTestVerdict` takes `frameworkDetected` (derived from `commands.testFramework`). Zero testcases + a configured framework is a "discovery break" that should hard-fail — but because the count is *structurally* zero for ADW-self, that branch had to be demoted to `warn` (commit `8184877`) just to let the pipeline ship. The guard is currently neutered.
3. **The agent's exit signal is not trustworthy for gating.** The unit pass/fail is LLM-mediated (the `/test` agent eyeballs and reports JSON), so a clean structured contract is needed instead — exactly what #578 gave the scenario rail but never extended to units (explicitly out of scope there).

The result: the unit gate is either silently green (wrong layout) or hard-blocked (discovery-break guard), with no honest middle ground and no real testcase count.

## Solution Statement

Mirror the scenario-rail JUnit contract (#578) on the unit rail, with one deliberate divergence:

- **Runner emits JUnit.** ADW exports `ADW_UNIT_TEST_REPORT_PATH` (an absolute path) into the `/test` agent's subprocess env via the `getSafeSubprocessEnv` allowlist. The configured runner emits a JUnit report there. For **ADW-self**, `vitest.config.ts` conditionally adds a `junit` reporter when that var is set (the exact mirror of `cucumber.js`'s conditional `junit:` formatter), so `## Run Tests` stays `bun run test:unit`. For **fresh target repos**, `adw_init` seeds JUnit-emitting flags into `## Run Tests` from per-language conventions — only when the section is absent.
- **Verdict keys on the report, not `frameworkDetected`.** `unitTestPhase` reads the report and computes the verdict from `(reportPresent, hasFailures, testcaseCount)`:
  - report present, failures → **hard-fail**
  - report present, zero testcases → **hard-fail** (discovery break — restored)
  - report present, count > 0, no failures → **pass**
  - report absent → **unverified** (warn + `adw:unverified` label), regardless of the agent's eyeballed result
- **`lint`/`tsc`/`build` stay agent-gated**, independent of the unit verdict (no change to those steps).
- **Deliberate divergence from the scenario rail:** the scenario rail falls back to the subprocess exit code when no report is found; the unit rail goes straight to `unverified`. This keeps the verdict honest without fallback complexity, because the `/test` agent's exit signal is LLM-mediated and not trusted for gating.
- **Plumbing for resolution:** `TestCaseResult` gains an additive `failureMessage` (scenario rail unaffected); the retry/resolution loop feeds the resolver each failing case's name + message read from `report.cases`, instead of the agent's eyeballed JSON.
- **Drop `--run src`.** `/test` runs the full `## Run Tests` command unconditionally; the static `frameworkDetected` signal is removed from the verdict (the `testFramework` config field is retained — it is still load-bearing for `stackCoherenceCheck`).

## Relevant Files

Use these files to implement the feature:

- `adws/core/testReportParser.ts` — **edit.** The single JUnit parser (`parseJUnitXml` / `readJUnitReport`). Extend `TestCaseResult` with an additive `failureMessage?: string` and extract the message from `<failure message="…">…</failure>` / `<error message="…">` (attribute first, then text body). Additive only — `scenarioProof` keeps working unchanged.
- `adws/core/testVerdict.ts` — **edit.** Replace `frameworkDetected` in `TestVerdictInput` with `reportPresent: boolean`; rewrite `computeTestVerdict` to the report-keyed 5-branch table (guard clauses, max depth 2). This is where the discovery-break `hard-fail` is restored.
- `adws/core/environment.ts` — **edit.** Add `'ADW_UNIT_TEST_REPORT_PATH'` to the `SAFE_ENV_VARS` allowlist so the value reaches the `/test` agent's subprocess (and the test command it spawns).
- `adws/phases/unitTestPhase.ts` — **edit.** Compute the absolute report path under `logsDir`; set `process.env.ADW_UNIT_TEST_REPORT_PATH`; clear any stale report; pass the path into `runUnitTestsWithRetry`; derive `(reportPresent, hasFailures, testcaseCount)` from the report; call the new `computeTestVerdict`; keep the existing hard-fail / warn(+label+comment) / pass handling. Remove the `frameworkDetected` computation.
- `adws/agents/testRetry.ts` — **edit.** `runUnitTestsWithRetry` accepts the report path + the configured `runTests` command; after each `/test` attempt it reads the JUnit report; report-derived signals drive pass/fail (`isPassed = !(report present && failed > 0)`) and `extractFailures` (failed `report.cases` → resolver payloads with name + `failureMessage`); the final report-derived fields are returned in `TestRetryResult`.
- `adws/agents/testAgent.ts` — **edit (light).** Reuse `runResolveTestAgent(failedTest: TestResult, …)`; provide a small helper to build a `TestResult` from a failing `TestCaseResult` (name → `test_name`, `failureMessage` → `error`, configured command → `execution_command`). `applicationTestcaseCount` from the agent becomes informational (no longer gating).
- `vitest.config.ts` — **edit.** Add a conditional `junit` reporter gated on `process.env.ADW_UNIT_TEST_REPORT_PATH` (mirror `cucumber.js`). Drop the now-stale `--run src` / `passWithNoTests` comment; the full `include` globs now run.
- `.claude/commands/test.md` — **edit.** Step 5: remove `--run src` and the `src/`-existence skip-as-passed; run the full `## Run Tests` command unconditionally; state that the runner emits JUnit to `$ADW_UNIT_TEST_REPORT_PATH` via its configured flags. Keep `testcase_count` in the output schema as informational.
- `.claude/commands/adw_init.md` — **edit.** Step 2 `## Run Tests`: when the section is **absent**, author JUnit-emitting flags per detected language convention (referencing `$ADW_UNIT_TEST_REPORT_PATH`); when a `## Run Tests` already exists, preserve it verbatim (never overwrite). This file is a `hashInputs:` file — the edit raises `.adw-version` and triggers `adwUpgrade` regeneration across registered target repos.
- `adws/core/index.ts` — **reference / edit if needed.** Already re-exports `computeTestVerdict`, `TestVerdictInput`, `readJUnitReport`, `TestReport`, `TestCaseResult`. No new export expected (signature change only).
- `adws/phases/scenarioProof.ts` — **reference (do not break).** Consumer of `TestCaseResult`/`readJUnitReport` on the scenario rail. The `failureMessage` addition must remain additive so this is unaffected.
- `cucumber.js` — **reference.** The conditional-emitter pattern to mirror in `vitest.config.ts`.
- `adws/agents/claudeAgent.ts` — **reference.** Confirms the subprocess env is built from `getSafeSubprocessEnv()` (line 118) — why the allowlist entry is required.
- `app_docs/feature-u3l5q0-junit-report-rail-migration.md` / `app_docs/feature-zyaojl-configurable-test-directory.md` — **reference.** The two predecessor slices (#578 scenario rail, #577 configurable test directory + three-way verdict). Conditions for both match this task (see `.adw/conditional_docs.md`).

### New Files

- `adws/core/__tests__/testReportParser.test.ts` — **extend (exists, 164 lines).** Add cases for `failureMessage` extraction (attribute, text body, `<error message>`, bare `<failure/>` → no message + skipped, multiple failures).
- `adws/core/__tests__/testVerdict.test.ts` — **rewrite (exists, 52 lines).** Table-driven over the new `(enabled, reportPresent, hasFailures, testcaseCount)` signature covering all branches, including report-absent → warn and report-present + zero → hard-fail (discovery-break restored).
- No brand-new source modules are required; the change is contained to the modules above.

## Implementation Plan

### Phase 1: Foundation — parser + verdict + env allowlist (pure, no I/O wiring)

Land the report-keyed primitives before wiring them into the phase:

1. Extend `TestCaseResult` in `testReportParser.ts` with `failureMessage?: string` and populate it in `buildCase`, keeping `classifyTestCase` semantics intact (bare `<failure/>` stays `skipped` with no message). Additive — `scenarioProof` is untouched.
2. Rewrite `computeTestVerdict` to key on `reportPresent` and drop `frameworkDetected`. Guard-clause order: disabled → pass; `!reportPresent` → warn; `hasFailures` → hard-fail; `testcaseCount === 0` → hard-fail (discovery break); else → pass.
3. Add `'ADW_UNIT_TEST_REPORT_PATH'` to `SAFE_ENV_VARS` in `environment.ts`.
4. Update/rewrite the two unit-test files (`testVerdict.test.ts`, `testReportParser.test.ts`) for the new contracts.

### Phase 2: Core Implementation — runner emission + report-driven retry loop

5. Add the conditional `junit` reporter to `vitest.config.ts`, gated on `ADW_UNIT_TEST_REPORT_PATH` (mirror `cucumber.js`); remove the stale `--run src` comment.
6. In `testRetry.ts`, thread the report path + configured `runTests` command through `TestRetryOptions`; clear stale report before each attempt; read the JUnit report after each attempt; derive pass/fail and failing cases (name + `failureMessage`) from `report.cases`; feed those to `runResolveTestAgent`; return report-derived fields (`reportPresent`, `hasFailures`, `testcaseCount`) on `TestRetryResult`.
7. In `testAgent.ts`, add the small `TestCaseResult → TestResult` adapter used by the resolver path.

### Phase 3: Integration — phase verdict wiring + prompts + hash propagation

8. In `unitTestPhase.ts`: compute the absolute report path under `logsDir`, set `process.env.ADW_UNIT_TEST_REPORT_PATH`, clear stale report, pass the path + command into `runUnitTestsWithRetry`, compute the verdict from report-derived signals, and keep the hard-fail / warn(+`adw:unverified` label + `unverified` comment) / pass handling. Delete the `frameworkDetected` computation.
9. Update `.claude/commands/test.md` step 5 (drop `--run src` + skip-as-passed; full command; JUnit via env var).
10. Update `.claude/commands/adw_init.md` step 2 `## Run Tests` (seed JUnit flags per language convention only when absent; preserve custom commands). Note the `.adw-version` hash bump / `adwUpgrade` propagation in the step-8 report block.
11. Run the full `Validation Commands` and confirm ADW's own vitest suite now runs in the unit phase with a real testcase count > 0.

## Step by Step Tasks

Execute every step in order, top to bottom.

> `.adw/project.md` contains `## Unit Tests: enabled`, and the issue explicitly requires unit tests for the parser/verdict/failure-message changes. Unit-test tasks are therefore included below.

### Task 1: Extend `TestCaseResult` with the failure message (additive)
- In `adws/core/testReportParser.ts`, add `failureMessage?: string` to the `TestCaseResult` interface.
- In `buildCase`, when the case classifies as `failed`, extract the message: prefer the `@_message` attribute of the `<failure>`/`<error>` child, else fall back to its `#text` body; leave `failureMessage` undefined for `passed`/`skipped` (including bare `<failure/>` markers).
- Keep `classifyTestCase` and `isEmptyFailureMarker` behavior unchanged.
- Verify `scenarioProof.ts` still type-checks (it reads `cases` but not `failureMessage`) — the change must be purely additive.

### Task 2: Re-key the verdict on report presence
- In `adws/core/testVerdict.ts`, change `TestVerdictInput`: remove `frameworkDetected`, add `reportPresent: boolean`.
- Rewrite `computeTestVerdict` with guard clauses (max depth ~2):
  - `!enabled` → `{ verdict: 'pass', reason: 'unit tests disabled' }`
  - `!reportPresent` → `{ verdict: 'warn', reason: 'no JUnit report emitted — marking unverified' }`
  - `hasFailures` → `{ verdict: 'hard-fail', reason: 'unit tests failed' }`
  - `testcaseCount === 0` → `{ verdict: 'hard-fail', reason: 'zero testcases ran but a JUnit report was emitted — discovery break' }`
  - else → `{ verdict: 'pass', reason: \`${testcaseCount} testcases passed\` }`
- Remove the temporary `8184877` warn-demotion comment block.

### Task 3: Allowlist the new env var
- In `adws/core/environment.ts`, add `'ADW_UNIT_TEST_REPORT_PATH'` to `SAFE_ENV_VARS` (near `ADW_WORKTREE_PATH` / `ADW_MAIN_REPO_PATH`).

### Task 4: Unit tests for the parser and verdict
- Rewrite `adws/core/__tests__/testVerdict.test.ts` for the new signature: cover disabled→pass (incl. disabled overrides failures), report-absent→warn, report-present+failures→hard-fail, report-present+zero→hard-fail (discovery break), report-present+count>0→pass.
- Extend `adws/core/__tests__/testReportParser.test.ts` with `failureMessage` cases: message from `@_message` attribute, message from text body, `<error message="…">`, bare `<failure/>` → `skipped` + no `failureMessage`, multiple failed cases each with their own message.

### Task 5: Emit JUnit from ADW's own runner
- In `vitest.config.ts`, read `const junitReportPath = process.env.ADW_UNIT_TEST_REPORT_PATH;` and set `reporters: junitReportPath ? ['default', ['junit', { outputFile: junitReportPath }]] : ['default']`.
- Remove the stale `--run src` / `passWithNoTests` comment; keep `passWithNoTests` only if still desired (the full `include` globs now run, so it is no longer needed — remove it to avoid masking a real future discovery break).

### Task 6: Make the retry/resolution loop report-driven
- In `adws/agents/testRetry.ts`, add to `TestRetryOptions`: `unitReportPath: string` and `runTestsCommand: string`.
- Before the retry loop (and before each attempt), `fs.rmSync(unitReportPath, { force: true })` to clear stale reports; ensure the parent dir exists.
- Change the `run` callback to return both the agent result and `readJUnitReport(unitReportPath)` (e.g. `{ agent, report }`); capture the latest report in a closure variable.
- `isPassed` → `!(report !== null && report.failed > 0)` (only "report present with failures" is retryable; zero-testcase and report-absent exit the loop for the phase verdict to classify).
- `extractFailures` → failed `report.cases` mapped to resolver payloads via the Task 7 adapter (empty when report is null).
- Extend `TestRetryResult` with `reportPresent: boolean`, `hasFailures: boolean`, and keep `testcaseCount` sourced from `report?.total ?? 0`.

### Task 7: Build the resolver payload from a failing case
- In `adws/agents/testAgent.ts`, add a small pure helper `testResultFromCase(c: TestCaseResult, runCommand: string): TestResult` mapping `test_name: c.name`, `passed: false`, `execution_command: runCommand`, `test_purpose: c.classname ?? 'unit test'`, `error: c.failureMessage`.
- Use it in `testRetry.ts`'s `extractFailures` so `runResolveTestAgent` receives name + message.

### Task 8: Wire the verdict into the phase
- In `adws/phases/unitTestPhase.ts`:
  - Compute `const unitReportPath = path.join(logsDir, 'junit-unit.xml');` (absolute) and `process.env.ADW_UNIT_TEST_REPORT_PATH = unitReportPath;` before running the agent.
  - Pass `unitReportPath` and `config.projectConfig.commands.runTests` into `runUnitTestsWithRetry`.
  - After it returns, derive `reportPresent`/`hasFailures`/`testcaseCount` from the result and call `computeTestVerdict({ enabled: true, reportPresent, hasFailures, testcaseCount })`.
  - Delete `const frameworkDetected = Boolean(commands.testFramework?.trim());` and its use.
  - Keep the existing branches: `hard-fail` → log/comment/state/`process.exit(1)`; `warn` → `applyLabel(ADW_UNVERIFIED_LABEL)` + `unverified` comment; else success log. Retain `import * as path` if not already present.

### Task 9: Drop `--run src` in `/test`
- In `.claude/commands/test.md` step 5: remove the "append the application test subset path" / `--run src` instruction and the `src/`-existence skip-as-passed condition. Run the exact `## Run Tests` command from `.adw/commands.md` unconditionally.
- Add a note that the runner emits a JUnit report to `$ADW_UNIT_TEST_REPORT_PATH` via its configured flags, and that the agent must not delete/relocate that file.
- Keep `testcase_count` in the output schema/examples but mark it informational (the verdict now comes from the JUnit report).

### Task 10: Seed JUnit flags in `adw_init` (only when absent)
- In `.claude/commands/adw_init.md` step 2, expand the `## Run Tests` guidance: **if `.adw/commands.md` already has a `## Run Tests` section, preserve it verbatim (never overwrite a custom command)**; otherwise author a JUnit-emitting command per detected language convention referencing `$ADW_UNIT_TEST_REPORT_PATH`. Provide conventions for at least:
  - vitest → `vitest run --reporter=default --reporter=junit --outputFile=$ADW_UNIT_TEST_REPORT_PATH`
  - jest → `jest --reporters=default --reporters=jest-junit` (with `JEST_JUNIT_OUTPUT_FILE=$ADW_UNIT_TEST_REPORT_PATH`)
  - pytest → `pytest --junitxml=$ADW_UNIT_TEST_REPORT_PATH`
  - go → `gotestsum --junitfile=$ADW_UNIT_TEST_REPORT_PATH`
  - cargo → `cargo nextest run --profile ci` (JUnit via nextest config) or document the fallback to `unverified`
- State explicitly that a repo whose pre-existing custom command emits no report resolves to `unverified` (by design).
- Update the step-8 report block to note the `.adw-version` bump / `adwUpgrade` propagation (consistent with how #578 documented its `scenarios.md` emit changes).

### Task 11: Validate end-to-end with zero regressions
- Run every command in `Validation Commands` below and confirm all pass.
- Confirm the manual JUnit round-trip (below) writes `junit-unit.xml`, that `readJUnitReport` reports `failed: 0` and `total > 0`, and that the unit phase would compute `pass`.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`. The following Vitest unit tests are in scope (pure modules, asserted through public interfaces — no internal/call-sequence assertions, per the project's testing conventions):

- **`testReportParser` (`testReportParser.test.ts`)** — `failureMessage` extraction: from the `<failure message="…">` attribute; from the `<failure>` text body when no attribute; from `<error message="…">`; `undefined` for passed/skipped and for bare `<failure/>` (still classified `skipped`); multiple failed cases each carrying their own message. Existing cases (mixed/all-pass/zero-testcase/malformed/`<testsuites>` wrapper/single-case coercion) must still pass unchanged.
- **`testVerdict` (`testVerdict.test.ts`)** — table-driven over the new `(enabled, reportPresent, hasFailures, testcaseCount)` input: disabled→pass (and disabled overrides failures); report-absent→warn (unverified); report-present+failures→hard-fail; report-present+zero-testcase→hard-fail (discovery-break restored); report-present+count>0→pass. Assert both `verdict` and a representative `reason` substring.

(No unit test is added for `unitTestPhase`/`testRetry` wiring — those are side-effectful orchestration shells exercised by the manual round-trip and the `@regression`/per-issue BDD scenarios; the gating logic lives in the pure `computeTestVerdict`/`testReportParser` modules that are unit-tested.)

### Edge Cases
- **Malformed / unreadable report** → `readJUnitReport` returns `null` → treated as report-absent → `unverified` (not a crash, not a false pass).
- **Stale report from a prior run/phase** → cleared before the run so the verdict reflects only the current attempt.
- **Report present, only skipped cases** (`total > 0`, `failed === 0`) → `pass` (count > 0, no failures) — consistent with scenario-rail pending semantics.
- **`unitTests: false` in `.github/adw.yml`** → phase short-circuits before any report logic (unchanged).
- **Target repo with a pre-existing custom `## Run Tests` that emits no JUnit** → report absent → `unverified` + `adw:unverified` label/comment (by design; not a hard-fail).
- **Absolute vs relative report path** — the path is absolute (under `logsDir`) so it resolves correctly even though the `/test` agent runs with `cwd = worktreePath`.
- **Retry exhaustion with persistent failures** → loop exits with failures present → phase reads report → `hard-fail` → `process.exit(1)`.
- **Failure message with XML entities / multiline stack trace** → preserved as parsed by `fast-xml-parser`; passed through to the resolver `error` field verbatim.

## Acceptance Criteria

- [ ] `unitTestPhase` derives unit pass/fail + count from a JUnit report via `readJUnitReport`; `frameworkDetected` is removed from the verdict decision.
- [ ] `/test` no longer appends `--run src` (and no `src/`-existence skip); the unit step runs the full command declared in `commands.md`.
- [ ] The runner emits JUnit to `ADW_UNIT_TEST_REPORT_PATH`; the var is in the `environment.ts` `SAFE_ENV_VARS` allowlist.
- [ ] `adw_init` writes JUnit-emitting `## Run Tests` flags from known conventions only when the section is absent; a pre-existing custom command is left untouched (and that repo's runs resolve to `unverified` when it emits no report).
- [ ] The verdict matches the table: present+failures → hard-fail; present+zero → hard-fail (discovery break restored); present+count>0+no-failures → pass; absent → unverified (warn + `adw:unverified` label).
- [ ] `lint`/`tsc`/`build` remain agent-gated and independent of the unit verdict.
- [ ] `TestCaseResult` carries `failureMessage`; the resolver receives each failing case's name + message from `report.cases`; the scenario rail (`scenarioProof`) is unaffected.
- [ ] ADW's own vitest suite (`adws/**/__tests__`) runs in the unit phase and reports a real testcase count > 0.
- [ ] Unit tests cover: report present/absent, zero-testcase, malformed report, and failure-message extraction.
- [ ] All `Validation Commands` pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint over the repo (code hygiene, unused imports).
- `bunx tsc --noEmit` — root type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW scripts type check (catches the `TestVerdictInput`/`TestRetryOptions`/`TestCaseResult` signature changes across all call sites).
- `bun run test:unit` — full Vitest suite (includes the updated `testVerdict` + `testReportParser` tests and confirms the suite itself runs with a real testcase count).
- `bun run build` — `tsc` build, verifies no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD suite (no scenario-rail regression from the additive `failureMessage` change).

Manual JUnit round-trip (proves emission + parse + a `pass` verdict end-to-end for ADW-self):

```sh
# Emit a JUnit report from ADW's own suite
ADW_UNIT_TEST_REPORT_PATH="$PWD/logs/junit-unit-manual.xml" bun run test:unit

# Confirm the report is present, non-empty, and clean
ADW_UNIT_TEST_REPORT_PATH="$PWD/logs/junit-unit-manual.xml" \
  bunx tsx -e 'import("./adws/core/testReportParser.ts").then(({ readJUnitReport }) => {
    const r = readJUnitReport(process.env.ADW_UNIT_TEST_REPORT_PATH);
    console.log(JSON.stringify({ total: r?.total, passed: r?.passed, failed: r?.failed }));
    if (!r || r.failed !== 0 || r.total === 0) process.exit(1);
  })'
```

Expected: `junit-unit-manual.xml` is written; the parser reports `failed: 0` and `total > 0`; the corresponding verdict (`reportPresent: true, hasFailures: false, testcaseCount > 0`) is `pass`.

## Notes

- `.adw/coding_guidelines.md` is in force. Apply: guard clauses with the happy path at the leftmost indent (the verdict and parser both stay ≤ depth 2); immutability (build new `TestCaseResult`/payload objects, no mutation); type safety (no `any`; type guards over `!`); pure core logic with side effects isolated at the phase boundary; declarative `map`/`filter` over imperative loops; files under 300 lines; JSDoc on the changed public functions. No decorators.
- **Deliberate scenario/unit-rail divergence:** the scenario rail (`scenarioProof.deriveTagOutcome`) falls back to the subprocess exit code when no report is found; the unit rail intentionally goes to `unverified` instead. This is accepted to keep the verdict honest without fallback complexity, because the `/test` agent's exit signal is LLM-mediated and not trusted for gating. Do **not** copy the exit-code fallback onto the unit rail.
- **Two emission mechanisms, one contract:** ADW-self emits JUnit via the `vitest.config.ts` conditional reporter (mirroring `cucumber.js`), so its `## Run Tests` (`bun run test:unit`) is untouched by `adw_init`'s "only-when-absent" rule. Fresh target repos get the flags authored into `## Run Tests` by `adw_init`. Both satisfy "runner emits JUnit to `ADW_UNIT_TEST_REPORT_PATH`".
- **`testFramework` is retained.** It is still consumed by `stackCoherenceCheck.ts` / `stackCoherenceReporter.ts`; only `frameworkDetected` leaves the verdict. `testDirectory` is now vestigial (the `--run src` path that consumed it is gone) but is left in place to avoid a three-touch-point config churn outside this feature's scope — flag it for a future cleanup rather than removing it here.
- **Hash propagation:** `.claude/commands/adw_init.md` is a `hashInputs:` file. Editing it raises `.adw-version`, which triggers `adwUpgrade` to regenerate `.adw/` across all registered target repos — the intended emit-parse coupling propagation (same mechanism #578 used for its `scenarios.md` sections).
- **Predecessor docs:** `app_docs/feature-u3l5q0-junit-report-rail-migration.md` (scenario-rail JUnit contract, #578) and `app_docs/feature-zyaojl-configurable-test-directory.md` (three-way verdict + configurable test dir, #577). Note: the #577 doc claims `test.md` already dropped `--run src`, but the live `test.md` on both this branch and `dev` still appends it — this feature is what actually removes it. Trust the live files over that doc.
- **Restores discovery-break:** the `warn`→`hard-fail` restoration lives entirely in `computeTestVerdict`'s zero-testcase branch (now reachable honestly because the report is present and the count is real). Commit `8184877`'s temporary demotion and its explanatory comment are removed.
- This is PRD slice "unit-test layer, PR 1" of `specs/prd/multi-language-test-and-bdd-support.md` → §Implementation Decisions → Structured-report contract. The generation/proof/screenshot overhaul and the ADW-self scenario migration are separate PRs and out of scope here.
