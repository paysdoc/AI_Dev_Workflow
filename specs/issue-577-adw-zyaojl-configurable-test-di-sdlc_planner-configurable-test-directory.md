# Feature: Configurable Test Directory + Kill the `src/` Silent-Green

## Metadata
issueNumber: `577`
adwId: `zyaojl-configurable-test-di`
issueJson: `{"number":577,"title":"Configurable test directory + kill the src/ silent-green","body":"## Parent PRD\n\n`specs/prd/multi-language-test-and-bdd-support.md`\n\n## What to build\n\nEnd-to-end: run a flat-layout (no `src/`) repo's unit suite for real. Parse `testDirectory`/`testFramework` from config; ```adw_init``` emits them; `test.md` drops the `--run src` / skip-as-passed trap and runs the `commands.md` test command against `testDirectory`. Verdict: pass / hard-fail on failures / on **0 testcases** → hard-fail if a test framework is detected in deps, else warn. Warn/unverified emits a **PR/issue comment + `adw:unverified` label**. See PRD Implementation Decisions → Unit-test layer.\n\n## Acceptance criteria\n\n- [ ] `testDirectory`/`testFramework` parsed with backward-compatible defaults (today's Bun behavior)\n- [ ] `test.md` no longer skips-as-passed when `src/` is absent; runs against `testDirectory`\n- [ ] 0-testcases hard-fails when a framework is detected, warns otherwise\n- [ ] Warn path posts `adw:unverified` comment + label\n- [ ] Running ADW's unit phase against a flat Python-style fixture actually executes the suite\n- [ ] Unit tests for the verdict logic (all branches) and config parsing\n\n## Blocked by\n\n- Blocked by #576\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 3\n- User story 4\n- User story 5\n- User story 20\n- User story 21\n- User story 30","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-15T11:51:03Z","comments":[],"actionableComment":null}`

## Feature Description

Today ADW's unit-test layer is hardcoded to a Bun / TypeScript / `src/`-layout stack. The `/test` command appends `--run src` and **skips-as-passed when no `src/` directory exists** — so a flat-layout repo (the motivating case is a Python/Flask project with tests under `tests/`) reports green on a suite that never ran. This is the "silent-green" failure the parent PRD targets.

This feature is **slice 1 of the parent PRD** (`specs/prd/multi-language-test-and-bdd-support.md` → Rollout → "PR 1: unit-test layer"). It makes the unit-test root directory and the detected test framework **configurable per target repo**, removes the `src/`-absent skip-as-passed trap, and introduces an explicit **three-way verdict**:

- **pass** — tests ran and all passed.
- **hard-fail** — tests ran and some failed (the existing gate, unchanged), **or** zero testcases ran *and a test framework was detected* in the repo (a discovery break must be loud).
- **warn (unverified)** — zero testcases ran *and no test framework was detected*. The workflow continues but posts a visible **`adw:unverified` issue comment + label** so fix-forward gets a real signal instead of a buried log line.

New config fields are parsed with backward-compatible defaults (un-regenerated repos behave like today's Bun stack) and **emitted by `adw_init`** so they propagate to every target repo on the next framework upgrade. The change is validated against a flat-layout Python fixture whose pytest suite actually executes.

**Explicitly out of scope for this slice** (deferred to PRD PR 2+, user stories 9/10/11/28): the JUnit-XML structured-report contract (`testReportParser`), deletion of `parseCucumberSummary`, migrating ADW's own cucumber-js suite onto the structured rail, the proof/screenshot overhaul, and wiring the Python fixture into the hermetic Docker CI runner. The verdict module designed here is structured so PR 2 can later feed it a JUnit-parsed testcase count with no signature change.

## User Story

As an ADW operator pointing ADW at a flat-layout (non-`src/`) repository — Python first, but any language whose tests live outside `src/` —
I want the unit-test root directory and test framework to be configurable, the `src/`-absent skip-as-passed trap removed, and a zero-testcases run to fail loudly (or warn visibly) instead of reporting green
So that ADW actually executes my test suite and never reports a verified PR on work it never verified.

## Problem Statement

The unit-test layer is hardcoded to the Bun/`src/` stack in two places that conspire to produce silent-green:

1. **`.claude/commands/test.md` step 5 ("Application Tests")** appends `--run src` to the test command and is gated on `Only execute if a src/ directory exists ... If src/ does not exist, skip this test and mark it as passed`. A flat-layout repo therefore never runs its suite yet reports passed.
2. **`adws/core/projectConfig.ts` (`CommandsConfig`)** has no notion of a test directory or a detected test framework, so there is nothing to configure even if `test.md` were fixed.

There is also no concept of a "zero testcases ran" outcome: the current aggregate (`allPassed = testResults.length > 0 && failedTests.length === 0`) cannot distinguish "100 tests passed" from "the runner discovered 0 tests," so a misconfigured or non-discovering runner cannot be caught.

## Solution Statement

Introduce a **typed-config + pure-verdict** seam, mirroring the existing config-parser and pure-decision-helper conventions:

1. **Extend `CommandsConfig`** with `testDirectory` and `testFramework`, parsed by the existing `HEADING_TO_KEY`-driven `parseCommandsMd`, with backward-compatible defaults (`testDirectory: 'src'`, `testFramework: ''`). Empty `testFramework` ⇒ "no framework detected" ⇒ zero-testcases warns (bounds the blast radius for un-regenerated repos).
2. **Teach `adw_init.md` to emit** `## Test Directory` and `## Test Framework` in generated `commands.md` (detected from the repo layout and dependency manifest). Per the PRD **hash-propagation rule**, adding a parsed `.adw/` field and teaching `adw_init` to emit it must be the **same PR** — editing `adw_init.md` raises `.adw-version`, which triggers `adwUpgrade` to regenerate `.adw/` across targets.
3. **Rewrite `test.md` step 5** to drop `--run src` and the skip-as-passed condition, run the `## Run Tests` command scoped to `## Test Directory`, and surface a **testcase count** (so zero-testcases is detectable) in the JSON output.
4. **Add a pure `computeTestVerdict` module** (`adws/core/testVerdict.ts`) that maps `(enabled, hasFailures, testcaseCount, frameworkDetected)` → `pass | hard-fail | warn`, fully table-tested.
5. **Wire the verdict into `executeUnitTestPhase`**: hard-fail uses the existing `process.exit(1)` gate; warn posts an `adw:unverified` comment + label and continues; pass continues.
6. **Register the `adw:unverified` label** in `labelManager.ts` so it is provisioned and applied like the other `adw:*` labels.
7. **Add a flat-layout Python fixture** under `test/fixtures/` whose pytest suite actually runs against `testDirectory`.

## Relevant Files

Use these files to implement the feature:

- `adws/core/projectConfig.ts` — **edit.** Add `testDirectory` + `testFramework` to the `CommandsConfig` interface, the `HEADING_TO_KEY` map, and `getDefaultCommandsConfig()`. `parseCommandsMd` already iterates `HEADING_TO_KEY`, so parsing is automatic once the map entries exist. This is the single locus for the new descriptor fields (see `app_docs/feature-670i6z-dead-schema-cleanup.md` for the three touch-points: interface, `HEADING_TO_KEY`, defaults).
- `.claude/commands/adw_init.md` — **edit.** In step 2 ("Create `.adw/commands.md`") add emission of `## Test Directory` (detected source/test layout) and `## Test Framework` (detected from the dependency manifest; empty when none). This raises the framework hash and propagates the new fields to targets. **Must be the same PR as the `projectConfig.ts` change.**
- `.claude/commands/test.md` — **edit.** Rewrite step 5 ("Application Tests"): remove `--run src` and the `src/`-existence skip-as-passed condition; read `## Run Tests` + `## Test Directory` from `commands.md` and run the test command scoped to that directory; report a `testcase_count` (and pass/fail) in the JSON output so zero-testcases is detectable.
- `adws/phases/unitTestPhase.ts` — **edit.** Read `testDirectory`/`testFramework` from `config.projectConfig.commands`; compute `frameworkDetected = Boolean(commands.testFramework?.trim())`; after the run, call `computeTestVerdict` and branch: `hard-fail` → existing fail path; `warn` → post `adw:unverified` comment + apply label, then continue; `pass` → continue.
- `adws/agents/testAgent.ts` — **edit.** Extend `TestResult` with an optional `testcase_count?: number` (or `ran_zero_tests?: boolean`), update `testResultsSchema`, and surface the application-tests count on `TestAgentResult` so the phase can read it.
- `adws/agents/testRetry.ts` — **edit.** Thread the testcase count (or zero-testcases boolean) from `TestAgentResult` through `TestRetryResult` so `executeUnitTestPhase` receives it.
- `adws/github/labelManager.ts` — **edit.** Add `export const ADW_UNVERIFIED_LABEL = 'adw:unverified'` and an entry in `ADW_LABEL_DEFINITIONS` so `ensureAdwLabelsExist` provisions it; the warn path applies it via the existing `applyLabel(...)`.
- `adws/github/workflowCommentsIssue.ts` — **edit.** Add an `unverified` workflow-comment stage (or a dedicated formatter) describing why the run is marked unverified (zero testcases, no framework detected) so `postIssueStageComment` can post it. Confirm the `WorkflowStage` union (in `adws/core`) gains the new stage.
- `adws/core/adwYmlConfig.ts` — **reference (read-only).** The unit-test gate (`unitTests`, opt-out, default enabled) already lives here from #576; this feature reads `config.adwYmlConfig.unitTests` exactly as `unitTestPhase` does today. Do not change the gate semantics. (See `app_docs/feature-6zw7n2-hitl-opt-in-adw-yml.md`.)
- `adws/phases/workflowInit.ts` — **reference (read-only).** Confirms `WorkflowConfig` already carries `projectConfig: ProjectConfig` (→ `commands`) and `adwYmlConfig`, so no new plumbing into the phase is needed.
- `adws/phases/phaseCommentHelpers.ts` — **reference.** `postIssueStageComment(repoContext, issueNumber, stage, ctx)` is the wrapper used for the warn comment.
- `adws/core/__tests__/projectConfig.test.ts` — **edit (add tests).** Mirror the existing `healthCheckPath` / scenarios-field tests to cover the new `testDirectory`/`testFramework` parse + defaults.
- `test/fixtures/cli-tool/` — **reference (template).** Model the new Python fixture's `.adw/` layout on this existing fixture.

### New Files

- `adws/core/testVerdict.ts` — pure verdict module: `computeTestVerdict(input) → { verdict: 'pass' | 'hard-fail' | 'warn'; reason: string }`, where `input = { enabled: boolean; hasFailures: boolean; testcaseCount: number; frameworkDetected: boolean }`. No I/O — directly unit-testable, following the `hungOrchestratorDetector.ts` / `remoteReconcile.ts` pure-helper convention.
- `adws/core/__tests__/testVerdict.test.ts` — table-driven unit tests covering every verdict branch.
- `test/fixtures/python-flat/` — flat-layout Python fixture: `pyproject.toml` (declares `pytest`), a module at repo root, `tests/test_*.py` with at least one passing test, **no `src/` directory**, and a `.adw/` config with `## Run Tests` (`pytest`), `## Test Directory` (`tests`), and `## Test Framework` (`pytest`). Used to prove the suite actually executes against `testDirectory` and that the skip-as-passed trap is gone.
- `test/fixtures/jsonl/manifests/adw-unit-test-zero-testcases.json` — scripted claude-cli-stub manifest backing the §8/§9 end-to-end channel scenarios in `features/per-issue/feature-577.feature`. Scripts plan + build success and a unit-test agent run reporting **zero discovered testcases** (`testcase_count: 0`), so the only variable between §8 (warn) and §9 (hard-fail) is the worktree's framework declaration. Model it on the existing manifests under `test/fixtures/jsonl/manifests/`. (§8/§9 are PENDING until the ISSUE-3-CUTOVER subprocess driver lands, but the scenario contract lists this manifest as a deliverable of this feature, so it is created now.)

#### Relevant conditional documentation (read before implementing)
- `app_docs/feature-670i6z-dead-schema-cleanup.md` — the three `CommandsConfig` touch-points (interface, `HEADING_TO_KEY`, defaults) when adding a schema field.
- `app_docs/feature-4jvczx-adw-init-schema-updates.md` and `app_docs/feature-8w4fep-adw-init-commands-md-scenario-sections.md` — how `adw_init.md` generates `.adw/commands.md` sections and the emit-parse coupling.
- `app_docs/feature-6zw7n2-hitl-opt-in-adw-yml.md` — the `.github/adw.yml` gate (`unitTests`) read by the test phase.
- `app_docs/feature-q9kms5-bdd-scenarios-before-pr.md` — test-phase execution order and the `## Unit Tests` gate history.
- `app_docs/feature-jjxkk9-conditional-unit-tests-plan-template.md` — `## Unit Tests` setting and conditional plan/test behaviour.

## Implementation Plan

### Phase 1: Foundation — typed config + pure verdict
Extend `CommandsConfig` with `testDirectory`/`testFramework` and their defaults, and add the pure `computeTestVerdict` module with its unit tests. These are leaf, side-effect-free changes that everything else builds on, and they can be fully proven before any phase wiring.

### Phase 2: Core Implementation — emission, command, threading, verdict wiring
Teach `adw_init.md` to emit the new sections (same PR, for hash propagation). Rewrite `test.md` step 5 to drop the `src/` trap and surface a testcase count. Thread the count through `testAgent` → `testRetry` → `executeUnitTestPhase`, and replace the phase's pass/fail branch with the three-way verdict (hard-fail / warn / pass).

### Phase 3: Integration — label, comment, fixture
Register the `adw:unverified` label and the `unverified` comment stage, wire the warn path to post both, and add the flat-layout Python fixture demonstrating real execution against `testDirectory`. Also add the scripted zero-testcases manifest backing the (pending) §8/§9 end-to-end channel scenarios. Finish by running the full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 0: Restore the contaminated worktree baseline
- This worktree starts with **stray uncommitted changes** that are NOT part of #577: `git diff` shows `.claude/commands/adw_init.md` with #576's `## Create .github/adw.yml (only if absent)` step **deleted** and a `README.md` line reverted. Leaving these would drop #576's adw.yml step and corrupt hash propagation.
- Restore the committed baseline before doing anything else: `git checkout -- .claude/commands/adw_init.md README.md`.
- Verify `git diff` is now empty and `.claude/commands/adw_init.md` still contains the `Create .github/adw.yml (only if absent)` step (the heredoc that must stay byte-identical to `ADW_YML_TEMPLATE`).

### Step 1: Extend `CommandsConfig` in `projectConfig.ts`
- Add `testDirectory: string` and `testFramework: string` to the `CommandsConfig` interface.
- Add to `HEADING_TO_KEY`: `'test directory': 'testDirectory'` and `'test framework': 'testFramework'`.
- Add to `getDefaultCommandsConfig()`: `testDirectory: 'src'` (preserves today's `--run src` behaviour) and `testFramework: ''` (empty ⇒ no framework detected ⇒ zero-testcases warns for un-regenerated repos).
- No change to `parseCommandsMd` is required — it iterates `HEADING_TO_KEY` and will pick up the new sections automatically.

### Step 2: Add config-parser unit tests
- In `adws/core/__tests__/projectConfig.test.ts`, add `describe` blocks mirroring the existing `healthCheckPath` tests:
  - `testDirectory` defaults to `'src'` when content is empty and when the section is absent; reads/trims a custom value (e.g. `tests`); preserves other defaults.
  - `testFramework` defaults to `''` when absent; reads a custom value (e.g. `pytest`); preserves other defaults.
  - `getDefaultCommandsConfig()` includes `testDirectory: 'src'` and `testFramework: ''`.

### Step 3: Add the pure `computeTestVerdict` module
- Create `adws/core/testVerdict.ts` exporting `computeTestVerdict({ enabled, hasFailures, testcaseCount, frameworkDetected })`.
- Verdict table (guard-clause style, no nesting beyond depth 2):
  - `enabled === false` → `pass` (gate disabled; reason: "unit tests disabled").
  - `hasFailures === true` → `hard-fail` (reason: "unit tests failed").
  - `testcaseCount > 0` → `pass` (reason: "N testcases passed").
  - `testcaseCount === 0 && frameworkDetected === true` → `hard-fail` (reason: "zero testcases ran but a test framework is configured — discovery break").
  - `testcaseCount === 0 && frameworkDetected === false` → `warn` (reason: "zero testcases ran and no test framework detected — marking unverified").
- Export the result type and verdict union so the phase and tests share it.
- The verdict tokens are the exact strings `pass` / `hard-fail` / `warn` — the phrasing the issue uses and the strings `feature-577.feature` §4–§7 assert — so the value `computeTestVerdict` returns is compared directly with no display-mapping layer.
- Re-export from `adws/core/index.ts` following the existing pattern.

### Step 4: Add `testVerdict` unit tests (all branches)
- Create `adws/core/__tests__/testVerdict.test.ts` with a table-driven test over every combination of `(enabled, hasFailures, testcaseCount∈{0,>0}, frameworkDetected)` asserting the expected verdict, so all five branches above are covered explicitly.

### Step 5: Surface a testcase count from `test.md`
- Rewrite step 5 ("Application Tests") of `.claude/commands/test.md`:
  - Remove the `--run src` append and the entire `Condition: Only execute if a src/ directory exists ... mark it as passed` clause.
  - Instruct the agent to read `## Run Tests` and `## Test Directory` from `.adw/commands.md` and run the test command **scoped to `testDirectory`**, appending the directory in the runner-appropriate way (positional for `pytest`/`go test`; via the run filter `-- --run <dir>` for Vitest/Bun). Default `testDirectory` is `src` when the section is absent.
  - The test must run unconditionally (no skip-as-passed). If the runner discovers zero tests (e.g. pytest "collected 0 items", Vitest "no test files found"), report it as `passed: true` with `testcase_count: 0` rather than failing — the verdict layer (not the agent) decides pass/warn/hard-fail.
  - Add `testcase_count` (integer; number of tests executed) to the Application Tests entry in the JSON `Output Structure` and the example, read from the runner's own summary line.

### Step 6: Thread the testcase count through the agent layer
- In `adws/agents/testAgent.ts`: add optional `testcase_count?: number` to `TestResult`, add it to `testResultsSchema` properties, and compute/expose the application-tests count (and/or a derived `zeroTestcases: boolean`) on `TestAgentResult`. Keep `allPassed` semantics unchanged for the failures path.
- In `adws/agents/testRetry.ts`: add `testcaseCount` (and/or `zeroTestcases`) to `TestRetryResult` and populate it from the final `TestAgentResult` so the phase can read it.

### Step 7: Register the `adw:unverified` label
- In `adws/github/labelManager.ts`: add `export const ADW_UNVERIFIED_LABEL = 'adw:unverified'` and an `ADW_LABEL_DEFINITIONS` entry (e.g. color `fbca04`, description `ADW could not verify tests`) so `ensureAdwLabelsExist` provisions it on every target repo.
- The label is informational only — it is **not** a classification label, so do not add it to `ADW_CLASSIFICATION_LABELS` or the read-side classification logic.

### Step 8: Add the `unverified` comment stage
- In `adws/github/workflowCommentsIssue.ts` (and the `WorkflowStage` union in `adws/core`), add an `unverified` stage whose formatted comment explains: the unit phase ran zero testcases, no test framework was detected, so the run is marked `adw:unverified` and proceeded without a hard gate. Keep wording self-explanatory (a reviewer should understand the signal without reading logs).

### Step 9: Wire the three-way verdict into `executeUnitTestPhase`
- In `adws/phases/unitTestPhase.ts`, inside the `unitTestsEnabled` branch, after `runUnitTestsWithRetry` returns:
  - Derive `frameworkDetected = Boolean(config.projectConfig.commands.testFramework?.trim())` and `testcaseCount`/`hasFailures` from the retry result.
  - Call `computeTestVerdict({ enabled: true, hasFailures: !unitTestsResult.passed, testcaseCount, frameworkDetected })`.
  - `hard-fail` → keep the existing error path (log, `appendLog`, error comment, write failed state, `process.exit(1)`). Use this for both the existing failures case and the new zero-testcases-with-framework case.
  - `warn` → log; `appendLog`; apply the `adw:unverified` label (`applyLabel(issueNumber, ADW_UNVERIFIED_LABEL, repoInfo)` — derive `repoInfo` from `config.targetRepo` when present, else `getRepoInfo()`, matching sibling phases); post the `unverified` comment via `postIssueStageComment(repoContext, issueNumber, 'unverified', ctx)`; **do not exit** — continue the phase as success.
  - `pass` → existing success log/append.
- Preserve the existing `unitTestsEnabled === false` skip path unchanged (gate is upstream of the verdict).

### Step 10: Add the flat-layout Python fixture
- Create `test/fixtures/python-flat/` with:
  - `pyproject.toml` declaring `pytest` as a dev/test dependency (this is the "test framework detected in deps" signal).
  - A small module at the repo root (e.g. `calculator.py`) — **no `src/` directory**.
  - `tests/test_calculator.py` with at least one passing `pytest` test.
  - `.adw/commands.md` modeled on `test/fixtures/cli-tool/.adw/commands.md` with `## Run Tests` → `pytest`, `## Test Directory` → `tests`, `## Test Framework` → `pytest` (plus the standard sections).
  - `.adw/project.md`, `.adw/scenarios.md`, `.adw/providers.md`, `.adw/review_proof.md` mirrored from the cli-tool fixture (CLI app type).
  - A `README.md` noting it is a flat-layout (no-`src/`) fixture proving the unit phase executes against `testDirectory`.

### Step 11: Add the §8/§9 end-to-end channel manifest (scaffolding for the pending scenarios)
- Create `test/fixtures/jsonl/manifests/adw-unit-test-zero-testcases.json`, modeled on the existing manifests under `test/fixtures/jsonl/manifests/`. It scripts plan + build success and a unit-test agent run that reports **zero discovered testcases** (`testcase_count: 0`).
- This single manifest backs both `feature-577.feature` §8 (warn) and §9 (hard-fail); the only variable between them is the worktree's framework declaration (`testFramework` present vs empty in the worktree `commands.md`), so the same zero-testcase script yields opposite verdicts.
- §8/§9 are **PENDING** until the ISSUE-3-CUTOVER W1 subprocess driver lands (`features/regression/step_definitions/whenSteps.ts` currently returns `'pending'`), so the manifest is not yet exercised by a green run — it is created now because the scenario contract lists it as a deliverable of this feature.

### Step 12: Add fixture-config coverage and (optional) execution check
- Add a unit test (in `projectConfig.test.ts` or a small fixture test) asserting `loadProjectConfig('test/fixtures/python-flat')` yields `commands.testDirectory === 'tests'`, `commands.testFramework === 'pytest'`, and `commands.runTests === 'pytest'` — proving the parser honours a non-`src/` layout.
- If `pytest` is available on the host, add a validation step that runs `pytest tests` inside the fixture and confirms it exits 0 with a non-zero collected count (proves real execution). Guard/skip cleanly when Python is absent — wiring the fixture into the hermetic Docker CI runner is PRD US28 / PR 2 and is **out of scope here**.

### Step 13: Run the Validation Commands
- Run every command in the **Validation Commands** section below and confirm zero errors and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope and are an explicit acceptance criterion ("Unit tests for the verdict logic (all branches) and config parsing").

- **`computeTestVerdict` (`adws/core/__tests__/testVerdict.test.ts`)** — table-driven over `(enabled, hasFailures, testcaseCount∈{0, N>0}, frameworkDetected)`, asserting all five branches:
  - disabled → `pass`
  - enabled + failures → `hard-fail`
  - enabled + passing + count>0 → `pass`
  - enabled + count==0 + frameworkDetected → `hard-fail`
  - enabled + count==0 + no framework → `warn`
- **Config parsing (`adws/core/__tests__/projectConfig.test.ts`)** — `testDirectory` default `'src'` (empty/absent), custom value read + trimmed; `testFramework` default `''` (absent), custom value read; other defaults preserved; `getDefaultCommandsConfig()` includes both new keys.
- **Fixture config (`projectConfig.test.ts`)** — `loadProjectConfig('test/fixtures/python-flat')` returns `testDirectory: 'tests'`, `testFramework: 'pytest'`, `runTests: 'pytest'`.

Follow the existing pure-function test conventions (Vitest, `describe`/`it`, `mkdtempSync` for any filesystem fixtures) seen in `projectConfig.test.ts` and `adwYmlConfig.test.ts`. Do not test private helpers or call sequencing — assert verdicts/values through each module's public interface.

### Edge Cases
- **No `src/` directory and no `testDirectory` configured** — must NOT skip-as-passed; runs against the default `src`, discovers zero tests, and (with empty `testFramework`) **warns** rather than reporting silent green.
- **Zero testcases with a framework detected** — `testFramework` non-empty + `testcase_count == 0` → **hard-fail** (discovery break).
- **Zero testcases with no framework** — `testFramework == ''` + `testcase_count == 0` → **warn** + `adw:unverified` comment/label, workflow continues.
- **Tests fail** — unchanged hard-fail gate; the verdict returns `hard-fail` regardless of `testcaseCount`/`frameworkDetected`.
- **Unit-test gate disabled** (`.github/adw.yml` `unitTests: false`) — phase still skips entirely before the verdict runs (no comment, no label).
- **Un-regenerated target repo** (legacy `commands.md` lacking the new sections) — defaults apply (`src` / empty framework); behaviour degrades safely to warn-not-fail on zero tests.
- **Whitespace-only `testFramework`** — treated as "not detected" (`.trim()` guard) → warn path.
- **`adw:unverified` label missing on the repo** — `applyLabel` lazy-creates it (existing not-found fallback), so the warn path never crashes.

## Acceptance Criteria
- `testDirectory` and `testFramework` are parsed from `.adw/commands.md` with backward-compatible defaults (`testDirectory: 'src'`, `testFramework: ''`) so existing Bun targets behave as today.
- `.claude/commands/test.md` no longer appends `--run src` and no longer skips-as-passed when `src/` is absent; it runs the `## Run Tests` command scoped to `## Test Directory` unconditionally and reports a `testcase_count`.
- The unit phase hard-fails on test failures (unchanged) and on zero testcases when a framework is detected; it warns (continues) on zero testcases when no framework is detected.
- The warn path posts an `adw:unverified` issue comment and applies the `adw:unverified` label; the label is provisioned by `ensureAdwLabelsExist`.
- A flat-layout Python fixture (`test/fixtures/python-flat/`, no `src/`) is present, its `.adw/` config resolves to `testDirectory: tests` / `testFramework: pytest`, and its pytest suite executes against `testDirectory` (verified by a host run when Python is available).
- `adw_init.md` emits `## Test Directory` and `## Test Framework` in generated `commands.md` (same PR, raising the framework hash for propagation).
- Unit tests cover every `computeTestVerdict` branch and the new config-parsing fields, and all validation commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint over application + ADW code (code quality, unused imports).
- `bunx tsc --noEmit` — type-check the application (root tsconfig).
- `bunx tsc --noEmit -p adws/tsconfig.json` — type-check the ADW scripts (catches the new `CommandsConfig`/`testVerdict`/threading types).
- `bun run build` — verify the build compiles with no errors.
- `bun run test:unit` — run the full Vitest suite (must pass with zero regressions, including the new `testVerdict.test.ts` and extended `projectConfig.test.ts`).
- `bunx vitest run adws/core/__tests__/testVerdict.test.ts adws/core/__tests__/projectConfig.test.ts` — focused run proving the new verdict + config-parsing tests pass and all branches are covered.
- `git diff --stat` — confirm only intended files changed and the Step 0 contamination is not reintroduced (no stray deletion of the `adw.yml` step in `adw_init.md`).
- (When Python is available) `cd test/fixtures/python-flat && pytest tests` — confirm the flat-layout fixture's suite actually executes (non-zero collected, exit 0), proving the skip-as-passed trap is gone.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply: keep `computeTestVerdict` pure with guard-clause flattening (max depth ~2), prefer explicit types over `any`, isolate I/O (comment/label) at the phase boundary, and keep files under 300 lines. The verdict is a pure deep module so its branches are testable without mocking GitHub.
- **No new libraries required** — all changes use existing modules (`fs`, the `gh` CLI via `execWithRetry`, Vitest). The Python fixture declares `pytest` only as fixture-local config (the ADW host does not need Python for the TypeScript unit tests; the optional fixture-execution check is guarded). Library install command for reference (`.adw/commands.md`): `bun add <package>`.
- **Hash-propagation / emit-parse coupling (critical).** Adding the parsed `testDirectory`/`testFramework` fields and teaching `adw_init.md` to emit them **must ship in the same PR**. Editing `adw_init.md` raises `.adw-version` (it is a declared `hashInput`), which triggers `adwUpgrade` to regenerate `.adw/` across targets. If the parser ships without the emitter, the hash does not move, regeneration never runs, and targets get the new parser reading old config (absent field → silent default). See PRD "Further Notes → Hash propagation / emit-parse coupling rule."
- **Worktree contamination (handle in Step 0).** The worktree was created with stray uncommitted edits that delete #576's `Create .github/adw.yml` step from `adw_init.md` and revert a `README.md` line. These are unrelated to #577 and must be discarded (`git checkout --`) before implementation, or #576's adw.yml gate regresses and the hash propagation breaks.
- **Staged scope (do not over-build).** This is PRD slice 1. The JUnit-XML `testReportParser`, deletion of `parseCucumberSummary`, ADW-self migration onto the structured rail, the proof/screenshot overhaul, and Docker-CI Python execution are **PR 2+** (user stories 9/10/11/12–15/28) and are out of scope. Design `computeTestVerdict` to accept a numeric `testcaseCount` so PR 2 can later source it from a JUnit parser instead of the agent's reported count with no signature change.
- **Backward-compatibility rationale.** `testFramework` defaults to empty (not `bun`/`vitest`) on purpose: an un-regenerated repo that hits zero testcases should **warn**, not hard-fail, until `adw_init` regeneration emits the real framework — this bounds the blast radius of defaulting the gate to enabled (PRD "Further Notes").
- **Future consideration.** When PR 2 introduces the JUnit rail, revisit whether `test.md`'s agent-reported `testcase_count` should be replaced by a deterministic file-based parse; the verdict module and phase wiring built here are intended to remain stable across that change.
