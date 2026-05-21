# Feature: Promotion Commenter MVP — Deep Modules + Tracer-Bullet Orchestrator (Hardcoded N=3)

## Metadata
issueNumber: `509`
adwId: `tdauam-promotion-commenter`
issueJson: `{"number":509,"title":"Promotion commenter MVP — deep modules + orchestrator (hardcoded N=3)","body":"## Parent PRD\n\n`specs/prd/scenario-rot-prevention-and-promotion.md`\n\n## What to build\n\nEnd-to-end tracer bullet for the promotion mechanism. A per-issue PR is opened → the scoring agent runs on the PR event → high-scoring scenarios receive a `@promotion-suggested-<date>` tag and a comment on the PR.\n\n### Deep modules (pure, unit-tested)\n\n1. `vocabularyParser` — parses `vocabulary.md` table into `Map<phrase, assertionTarget>` and an ordered list of surface examples\n2. `scenarioParser` — wraps the Gherkin parser; returns structured scenarios with tags, steps, and line positions\n3. `promotionScorer` — given `(scenario, vocabularyRegistry, examplesBlock)`, returns `{ total, breakdown }`. Scoring weights: surface match 3, subprocess 3, phase-import 2, extra phase 1, mock-query 0\n4. `promotionThreshold` — hardcoded to return `3` in this slice (auto-ramp arrives in slice #7)\n5. `promotionTagWriter` — pure string transform; only the `add-suggestion` operation in this slice (refresh/remove arrive in slice #5)\n\n### Orchestrator (shallower, integration-tested)\n\n6. `promotionCommenter` — entry point invoked on per-issue PR events. For each scenario block in changed files: parse → score → check threshold → add tag if score ≥ N → write file → post a comment on the PR. No `hitl` label, no duplicate-suppression, no score-drop withdrawal — those land in slice #5.\n7. A new orchestrator (e.g. `adwPromotionSweep.tsx`) that wraps `promotionCommenter` and is wired into per-issue PR events.\n\n## Acceptance criteria\n\n- [ ] Each of the five deep modules has a unit test file covering happy path and edge cases (per the PRD's testing section)\n- [ ] `promotionScorer` unit tests cover every branch of the scoring rules (surface match present/absent, all three execution patterns, varying phase counts)\n- [ ] `promotionCommenter` is covered by at least one smoke scenario under `features/regression/` driving a synthetic per-issue PR through the mock GitHub harness\n- [ ] A per-issue PR containing a scenario with all phrases in the vocabulary and using the subprocess pattern receives a `@promotion-suggested-<today>` tag and a comment\n- [ ] A per-issue PR containing a scenario below the threshold receives no tag and no comment\n- [ ] Tag insertion preserves byte-exact positions of surrounding scenario content\n\n## Blocked by\n\n- Blocked by #507\n\n## User stories addressed\n\n- User story 4 (confidence score computed per scenario)\n- User story 5 (score combines surface match with blast radius)\n- User story 8 (tag colocated with scenario block)\n- User story 16 (PR-event triggered only)\n- User story 20 (promotionScorer is a deep module with unit tests)\n- User story 21 (promotionThreshold is a deep module with unit tests)\n- User story 22 (vocabularyParser is a deep module with unit tests)\n- User story 23 (scenarioParser is a deep module with unit tests)\n- User story 24 (promotionTagWriter is a deep module with unit tests)\n- User story 25 (promotionCommenter is a thin coordination layer)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-20T22:44:47Z","comments":[],"actionableComment":null}`

## Feature Description

This is slice #4 of the parent PRD `specs/prd/scenario-rot-prevention-and-promotion.md`. It builds the end-to-end tracer bullet for the **downstream promotion mechanism**: a per-issue PR is opened → a scoring step runs on the PR event → high-scoring scenarios receive a `@promotion-suggested-<date>` tag and a comment is posted on the PR.

Two artefact groups ship with this slice:

1. **Five deep modules** under `adws/promotion/` (pure, unit-tested) that own the scoring, parsing, threshold, and tag-writing logic:
   - `vocabularyParser` — parses `features/regression/vocabulary.md` into a `Map<phrase, assertionTarget>` plus an ordered list of surface examples.
   - `scenarioParser` — thin wrapper around the Cucumber Gherkin parser that returns structured scenarios with tags, steps, and line positions.
   - `promotionScorer` — given `(scenario, vocabularyRegistry, examplesBlock)`, returns `{ total, breakdown: { surfaceMatch, executionPattern, phaseCount } }` using the published weights (surface match 3, subprocess 3, phase-import 2, extra phase 1, mock-query 0).
   - `promotionThreshold` — returns the hardcoded bootstrap constant `3` in this slice (auto-ramp formula arrives in slice #7).
   - `promotionTagWriter` — pure string transforms over `.feature` content. Only the `add-suggestion` operation is implemented (date-refresh, removal, and approval-detection arrive in slice #5).

2. **A tracer-bullet orchestrator** (`adws/adwPromotionSweep.tsx`) that wraps a thin coordination module (`promotionCommenter`) and is invokable on per-issue PR events. The coordination module composes the deep modules — it parses → scores → checks the hardcoded threshold → writes the tag → posts a PR comment. No `hitl` label, no duplicate-suppression, no score-drop withdrawal in this slice (those arrive in slice #5).

The intentional simplifications for this slice (hardcoded `N=3`, single-operation tag writer, no duplicate suppression, no `hitl` apply, no `promotionMover`) keep the surface small enough to ship as a single tracer-bullet PR while still exercising every interface the later slices will extend.

## User Story

As an ADW developer
I want a per-issue PR containing a high-quality behavioural scenario to receive an inline `@promotion-suggested-<today>` tag and a comment on the PR
So that the team is told which scenarios are worth promoting into `features/regression/` instead of having to scan every per-issue PR diff by hand.

## Problem Statement

The framework distributes `features/regression/vocabulary.md` and the per-issue/regression directory polymorphism flags to target repos via slice #2 (issue #507, merged 2026-05-21). Per-issue scenarios written by `scenario_writer` now land under `features/per-issue/` and are swept 14 days after PR merge. There is, however, no automated signal that a per-issue scenario should be promoted into `features/regression/` before the sweep deletes it.

Without an automated scoring step:

- Every per-issue PR has to be hand-scanned for promotion-worthy scenarios.
- The promotion gate (slice #5: `hitl` label, mover orchestrator) has nothing to lift off the ground because no `@promotion-suggested-<date>` tags are ever written.
- The 90-day promotion-activity ratio that drives the auto-ramp threshold (slice #7) cannot be observed because the promoted-scenarios numerator is always zero.

This slice ships the **smallest end-to-end vertical** that addresses all three — the deep modules that own the scoring/parsing/tag-writing logic, plus a tracer-bullet orchestrator that proves the wiring works end-to-end against the mock GitHub harness.

## Solution Statement

Five pure deep modules under `adws/promotion/` plus one thin coordination module (`promotionCommenter`), wrapped by a CLI orchestrator (`adwPromotionSweep.tsx`) that can be invoked against a per-issue PR.

The deep modules are pure functions with stable inputs/outputs (`string` content → typed data) and live behind dependency-injected boundaries so the orchestrator can be smoke-tested through the existing mock GitHub harness without re-mocking the scoring or parsing logic. The threshold module returns a constant `3` in this slice; the auto-ramp formula and the supporting 90-day git-history queries are deferred to slice #7. The tag writer implements only `add-suggestion`; the other operations are deferred to slice #5 along with `hitl` labelling, duplicate suppression, and `promotionMover`.

The orchestrator is intentionally **shallower** than `adwSdlc.tsx`/`adwChore.tsx` — it does not go through plan/build/test/review phases. It is event-driven, idempotent (tag insertion is byte-stable), and short-lived. For this tracer-bullet slice it does **not** wrap with `runWithOrchestratorLifecycle` (spawn lock + heartbeat) because duplicate-suppression is explicitly out of scope and the slice acceptance criteria do not require it; the locking wrapper arrives in slice #5 when duplicate-suppression becomes required.

## Relevant Files

Use these files to implement the feature:

### Read-only references (existing code/docs informing the design)

- `specs/prd/scenario-rot-prevention-and-promotion.md` — Parent PRD. **Sections to load**: Modules, Interfaces, Activity ratio formula, State storage, Backwards compatibility, Testing Decisions. User stories 4, 5, 8, 16, 20–25 are the acceptance gates for this slice.
- `features/regression/vocabulary.md` — Canonical phrase registry for the framework repo. Defines the table shape (`# | Phrase | Semantics | Pattern | Assertion target`) that `vocabularyParser` parses, and the `## Observability Surfaces (Examples)` section that drives the `surfaceMatch` axis.
- `templates/vocabulary.md.template` — Template copied into target repos by `adwInit` (slice #2, issue #507). The parser must read both the framework `vocabulary.md` and target-repo copies of the template.
- `features/per-issue/feature-507.feature` — Reference for the per-issue scenario file shape (`@adw-{N} @adw-{adwId}` tag block, Background, Scenario blocks). The promotion scorer parses scenario blocks in files matching this shape.
- `features/regression/smoke/adw_chore_diff_verdicts.feature` — Reference for the smoke-scenario style (Background + multiple Scenario blocks driving an orchestrator subprocess through the mock harness). The new promotion smoke scenarios follow the same pattern.
- `features/regression/smoke/adw_sdlc_happy_path.feature` — Reference for a single-scenario smoke driving an orchestrator subprocess. Pattern for the high-score smoke scenario.
- `features/regression/step_definitions/whenSteps.ts` — Defines `ORCHESTRATOR_FILES` (lines 53–65) which maps orchestrator name → script path. The promotion sweep entry is added here.
- `features/regression/step_definitions/world.ts` — `RegressionWorld` shape; nothing to change but consumed by the new smoke scenario.
- `features/regression/support/hooks.ts` — `@regression` Before/After hooks; the new smoke scenarios pick these up automatically by tagging `@regression`.
- `adws/adwSdlc.tsx` and `adws/adwChore.tsx` — Reference for full-fat orchestrator wiring (CLI arg parsing, `runWithOrchestratorLifecycle`, `CostTracker`, `runPhase`). `adwPromotionSweep.tsx` follows the same CLI shape but **skips** the lifecycle wrapper and phase machinery (this is a tracer bullet, not a multi-phase pipeline).
- `adws/adwMerge.tsx` — Reference for a lighter orchestrator that uses the raw spawnGate primitives (relevant if a future maintainer chooses to add locking). Not adopted in this slice.
- `adws/triggers/perIssueScenarioSweep.ts` — Reference pattern for a small, dependency-injected, event-driven module that reads filesystem state and operates on per-issue feature files. The same dep-injection shape (`Deps` interface, optional override, default factory) is used by `promotionCommenter`.
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — Reference for unit-testing dep-injected event modules with hoisted module mocks plus deps-override. The orchestrator tests in this slice (`promotionCommenter`) follow this pattern.
- `adws/triggers/issueDependencies.ts` — Reference for a deep module that parses Markdown text (sections, references) and returns structured data without side effects. `vocabularyParser` follows the same shape.
- `adws/__tests__/issueDependencies.test.ts` — Reference for vitest unit tests that mock external modules at the top level and re-import the tested module. Used as a template for the deep-module unit tests.
- `adws/triggers/webhookHandlers.ts` — Reference for the `extractIssueNumberFromBranch` helper (lines 25–29). Used to identify per-issue PRs by their head branch name pattern. Re-used in `promotionCommenter` to locate the linked issue from a PR head branch.
- `adws/triggers/trigger_webhook.ts` — Reference for how the existing webhook trigger dispatches on `pull_request` events (lines 197–205). Documented as the integration site for slice #5 (this slice does not wire the webhook).
- `adws/github/issueApi.ts`, `adws/github/prApi.ts`, `adws/github/githubApi.ts` — GitHub API helpers (`getIssueState`, `fetchPRDetails`, `commentOnIssue`, `getRepoInfo`). Used by `promotionCommenter` to fetch PR changed files and post comments.
- `adws/core/projectConfig.ts` — `loadProjectConfig` resolves `.adw/scenarios.md`, including `## Vocabulary Registry` and `## Per-Issue Scenario Directory`. `promotionCommenter` consults these to find the vocabulary file and per-issue directory.
- `adws/core/utils.ts` — `log`, `slugify`, etc. Used by the orchestrator for structured logging.
- `adws/core/orchestratorCli.ts` — `parseOrchestratorArguments` for CLI arg parsing in `adwPromotionSweep.tsx`.
- `test/mocks/test-harness.ts` and `test/mocks/github-api-server.ts` — Mock harness used by the smoke scenarios. No change in this slice; the harness already supports issue comments.
- `test/fixtures/jsonl/manifests/safe-verdict.json` — Reference for the manifest fixture shape used by smoke scenarios (claude-cli-stub manifest pre-seeding state and recording behaviour).
- `cucumber.js` — Cucumber paths/imports config. No change needed; new `.feature` files and step definitions are picked up automatically.
- `vitest.config.ts` — Vitest config (`adws/**/__tests__/**/*.test.ts` is the unit-test pattern). New unit tests are picked up automatically.
- `.adw/project.md` — Confirms `## Unit Tests: enabled` (line 34), so unit tests are required for this slice.
- `.adw/scenarios.md` — Polymorphism flags including `## Vocabulary Registry: features/regression/vocabulary.md` (line 29). Consumed by `promotionCommenter`.
- `.adw/coding_guidelines.md` — Mandatory coding guidelines (TypeScript strict, no `any`, guard clauses, max nesting depth ~2, declarative over imperative, isolate side effects). Strictly followed.
- `app_docs/feature-nnny1e-vocabulary-template-and-flags.md` — Slice #2 (issue #507) documentation. Background for the vocabulary distribution that this slice consumes.
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — Slice #1 (issue #506) documentation. Background for the rot-prevention rubric that the surface-match axis enforces.
- `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md` — BDD cutover + polymorphism flags context. Background for the per-issue scenario layout.
- `app_docs/feature-2evbnk-bdd-smoke-surface-scenarios.md` — Smoke/surface scenario suite documentation. Background for how new smoke scenarios are added.
- `app_docs/feature-lnef5d-mock-infrastructure-layer.md` — Mock harness documentation (claude-cli-stub, GitHub API mock server). Background for the smoke-scenario harness.
- `app_docs/feature-jjxkk9-conditional-unit-tests-plan-template.md` — Conditional unit tests in plan templates. Confirms that this slice (with `## Unit Tests: enabled`) must include unit test tasks.
- `app_docs/feature-6wnymj-shared-orchestrator-lifecycle-wrapper.md` — `runWithOrchestratorLifecycle` pattern. Documented as deferred for slice #5; not adopted in this slice.

### New Files

#### Deep modules (`adws/promotion/`)

- `adws/promotion/index.ts` — Barrel export for the new module: re-exports the public surfaces of the five deep modules plus `promotionCommenter`.
- `adws/promotion/types.ts` — Shared types: `ExecutionPattern` (`'subprocess' | 'phase-import' | 'mock-query'`), `VocabularyEntry` (`{ phrase, assertionTarget, pattern }`), `VocabularyRegistry` (`{ entries: Map<string, VocabularyEntry>, surfaceExamples: string[] }`), `Scenario` (`{ tags: string[], steps: Step[], startLine, endLine, headerLine }`), `Step` (`{ keyword, text, line }`), `PromotionStats`, `ScoreBreakdown`, `ScoreResult`, `TagState` (`'add-suggestion'` only in this slice; the union grows in slice #5).
- `adws/promotion/vocabularyParser.ts` — Pure function `parse(content: string): VocabularyRegistry`. Parses the Given/When/Then Markdown tables (5-column rows) and the `## Observability Surfaces (Examples)` section. Hides Markdown table parsing.
- `adws/promotion/scenarioParser.ts` — Pure function `parse(content: string, fileUri?: string): Scenario[]`. Wraps `@cucumber/gherkin`'s `Parser` + `AstBuilder` + `GherkinClassicTokenMatcher`. Returns scenarios with their tags, steps, and source-line positions.
- `adws/promotion/promotionScorer.ts` — Pure function `score(scenario: Scenario, registry: VocabularyRegistry, examplesBlock: string[]): ScoreResult`. Returns `{ total, breakdown: { surfaceMatch, executionPattern, phaseCount } }`. Scoring weights live as named constants in this module (`SURFACE_MATCH_WEIGHT = 3`, `SUBPROCESS_WEIGHT = 3`, `PHASE_IMPORT_WEIGHT = 2`, `MOCK_QUERY_WEIGHT = 0`, `EXTRA_PHASE_WEIGHT = 1`).
- `adws/promotion/promotionThreshold.ts` — Pure function `computeThreshold(stats: PromotionStats): number`. Returns the hardcoded bootstrap value `3` in this slice. The `PromotionStats` interface is defined in `types.ts` so slice #7 can extend the body without churning consumers.
- `adws/promotion/promotionTagWriter.ts` — Pure function `applyTagState(content: string, scenarioHeaderLine: number, state: TagState, today: string): string`. In this slice the only supported `state` is `'add-suggestion'`. Returns content with `@promotion-suggested-<today>` inserted on the tag line immediately above the scenario header. Byte-exact preservation of surrounding scenario content is the test contract.

#### Orchestrator coordination layer (`adws/promotion/`)

- `adws/promotion/promotionCommenter.ts` — Thin coordination function `runPromotionCommenter(prNumber: number, deps?: PromotionCommenterDeps): Promise<PromotionResult>`. Reads PR changed files via `deps.fetchChangedFiles`, filters to per-issue `.feature` files, parses scenarios, scores each, conditionally applies the `add-suggestion` tag, writes the file, and posts a comment via `deps.postComment`. All decisions delegated to the five deep modules; this module owns the GitHub API surface only.

#### CLI orchestrator entry point

- `adws/adwPromotionSweep.tsx` — Standalone CLI orchestrator. Parses `<issueNumber> [adwId]`, resolves the linked PR via `findPRByBranch`, and invokes `runPromotionCommenter`. Logs the resulting `PromotionResult`. No `runWithOrchestratorLifecycle` wrapper, no `CostTracker` (this slice is event-driven and short-lived; lock/heartbeat are deferred to slice #5).

#### Unit tests (`adws/promotion/__tests__/`)

- `adws/promotion/__tests__/vocabularyParser.test.ts` — Happy path: parses a valid `vocabulary.md`-shaped input and asserts the extracted phrase→entry map and ordered examples list. Edge cases: malformed table rows (skipped, no throw), missing `## Observability Surfaces (Examples)` section (empty list), missing tables (empty map).
- `adws/promotion/__tests__/scenarioParser.test.ts` — Happy path: parses a `.feature` with multiple scenarios. Edge cases: scenarios with multi-line tag blocks, scenarios with no tags, scenarios with a Background, malformed input (`Parser` throws → propagates).
- `adws/promotion/__tests__/promotionScorer.test.ts` — Every branch of the scoring rules: surface match present/absent, all three execution patterns (subprocess, phase-import, mock-query), varying phase counts (0/1/2/3+ phases), unknown phrases (treated as missing surface match), mixed-pattern scenarios (highest-weight pattern wins). Assertions on both `total` and `breakdown`.
- `adws/promotion/__tests__/promotionThreshold.test.ts` — Returns `3` for bootstrap (zero denominator), low ratio, high ratio. Slice #7 will extend this; the test asserts the **interface** (`computeThreshold(PromotionStats) → number`) is stable.
- `adws/promotion/__tests__/promotionTagWriter.test.ts` — Add suggestion to a scenario with no existing tag line → tag inserted on a new line above the scenario header. Add suggestion to a scenario with existing tags → new tag appended to the tag line. Byte-exact positions of surrounding scenario content preserved (assert via diff slicing). Edge cases: scenario header at file start, scenario header at file end, multi-line scenario name, scenario inside `Rule:` block.
- `adws/promotion/__tests__/promotionCommenter.test.ts` — Dep-injection style. Inject `fetchChangedFiles` returning a fixture diff, `readFile`/`writeFile` mocks, `postComment` mock, and a fixed `today` date. Assert: high-score scenarios get `add-suggestion` applied + comment posted; below-threshold scenarios get neither tag nor comment; files outside `features/per-issue/` are skipped; non-`.feature` changes are skipped.

#### Smoke scenarios

- `features/regression/smoke/promotion_commenter.feature` — Tagged `@regression @smoke`. Two scenarios driving `adwPromotionSweep.tsx` through the mock harness via manifest-driven claude-cli-stub: (a) high-score scenario → `@promotion-suggested-<today>` tag + PR comment recorded; (b) low-score scenario → no tag, no comment.

#### Per-issue BDD scenarios (build-agent input, not executed)

- `features/per-issue/feature-509.feature` — Tagged `@adw-509 @adw-tdauam-promotion-commenter`. Behavioural scenarios describing the acceptance contract from a target-repo operator's perspective. These are input to the build agent (not executed by the runner); they assert against observable artefacts (file content after orchestrator run, recorded mock-API comments).

#### Mock manifest fixtures

- `test/fixtures/jsonl/manifests/promotion-sweep-high-score.json` — Claude-CLI-stub manifest pre-seeding a high-score scenario in the worktree's seeded per-issue feature file and recording a PR comment.
- `test/fixtures/jsonl/manifests/promotion-sweep-low-score.json` — Manifest variant pre-seeding a below-threshold scenario; asserts no tag insertion and no recorded PR comment.
- `test/fixtures/jsonl/manifests/promotion-sweep-byte-exact.json` — Manifest pre-seeding a multi-scenario feature file used by the byte-exact preservation per-issue scenario.
- `test/fixtures/jsonl/manifests/promotion-sweep-mixed-scores.json` — Manifest pre-seeding a feature file containing scenarios of mixed scores; asserts only above-threshold scenarios receive tags.
- `test/fixtures/jsonl/manifests/promotion-sweep-comment-body.json` — Manifest pre-seeding a single-named scenario; asserts the recorded PR comment identifies the promoted scenario.

## Implementation Plan

### Phase 1: Foundation

Install the Gherkin parser dependency and lay out the `adws/promotion/` directory with its barrel export and shared type definitions. No logic yet — purely structural so subsequent phases can land independently.

The parser dep is `@cucumber/gherkin` (the standalone Gherkin AST parser; `@cucumber/cucumber` already pulls a transitive copy via `devDependencies`, but a direct dependency keeps the API surface stable and visible). `@cucumber/messages` is a peer dep of `@cucumber/gherkin` and is required for the AST type imports.

### Phase 2: Core Implementation (Deep Modules)

Implement the five deep modules in dependency order so each one's unit tests can run independently:

1. `vocabularyParser` (no internal deps) — first, since `promotionScorer` consumes its output.
2. `scenarioParser` (depends on `@cucumber/gherkin`) — second, also consumed by the scorer and commenter.
3. `promotionScorer` (depends on the two parsers' types) — third.
4. `promotionThreshold` (no deps) — fourth; trivial in this slice but the interface is locked.
5. `promotionTagWriter` (depends only on `Scenario` type for line positions) — fifth.

Each module ships with its unit test file in `adws/promotion/__tests__/` and lands as a self-contained build artefact. The five test files run under `bun run test:unit` (Vitest, already wired via `vitest.config.ts`).

### Phase 3: Integration (Orchestrator + Smoke Scenarios)

Compose the deep modules into `promotionCommenter` (a thin coordination function with injected GitHub/filesystem deps), then wrap it in the `adwPromotionSweep.tsx` CLI entry point. Add the smoke scenario and step-definition mapping so the orchestrator can be driven through the mock harness.

The smoke scenario tags `@regression @smoke` so the existing `Before/After` hooks in `features/regression/support/hooks.ts` automatically provision the mock harness. The orchestrator name `promotion-sweep` is added to `ORCHESTRATOR_FILES` in `features/regression/step_definitions/whenSteps.ts`. The W1 step (`the "X" orchestrator is invoked with adwId {string} and issue {int}`) follows the existing `pending` pattern until the harness gains full subprocess support — the smoke scenario is the documented contract, not a green test in this slice.

The per-issue BDD scenarios for issue #509 are written to `features/per-issue/feature-509.feature` as input to the build agent. They describe the acceptance contract from a target-repo operator's perspective and assert against observable artefacts (file content, recorded comments).

Webhook wiring (`pull_request.opened` / `pull_request.synchronize` event → spawn `adwPromotionSweep.tsx`) is **not** part of this slice. The orchestrator is invokable via `bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]` and is documented as such. Webhook + cron wiring + duplicate-suppression land in slice #5.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Install Gherkin parser dependencies

- Run `bun add @cucumber/gherkin @cucumber/messages` to add the standalone Gherkin AST parser as a direct dependency.
- Verify `package.json` `dependencies` block now includes both packages and `bun.lock` is updated.
- Confirm `bunx tsc --noEmit` still passes (no incidental type breakage from the new types).

### Step 2: Lay out the `adws/promotion/` module skeleton

- Create `adws/promotion/` directory.
- Create `adws/promotion/index.ts` as a barrel that re-exports the five deep modules plus `promotionCommenter` (placeholders for now; populated as each module lands).
- Create `adws/promotion/types.ts` with the shared type definitions: `ExecutionPattern`, `VocabularyEntry`, `VocabularyRegistry`, `Scenario`, `Step`, `PromotionStats`, `ScoreBreakdown`, `ScoreResult`, `TagState`. Use TypeScript `interface`/`type` per coding guidelines (no enums needed; string literal unions are clearer).
- Create `adws/promotion/__tests__/` directory.

### Step 3: Implement `vocabularyParser` + unit tests

- Implement `adws/promotion/vocabularyParser.ts` exporting `parse(content: string): VocabularyRegistry`.
- Algorithm: split content by Markdown headers (`## Given`, `## When`, `## Then`) and parse each table's rows. Each row has 5 columns separated by `|`; columns 2 (phrase, stripped of backticks), 4 (pattern), and 5 (assertion target) populate a `VocabularyEntry`. Skip rows where any required column is missing. Find `## Observability Surfaces (Examples)` and parse subsequent bullet/text lines into the ordered `surfaceExamples` array; tolerate the section being absent (return an empty list).
- Implement `adws/promotion/__tests__/vocabularyParser.test.ts` covering: (a) happy path on a valid fixture string asserts map keys and `surfaceExamples` order; (b) malformed row (only 3 columns) is skipped without throwing; (c) missing `## Observability Surfaces (Examples)` section yields empty `surfaceExamples`; (d) entirely empty content returns an empty registry; (e) unknown pattern column value is parsed but flagged for the caller (treat as `'mock-query'` fallback, document in code comment).
- Run `bunx vitest run adws/promotion/__tests__/vocabularyParser.test.ts` and confirm green.

### Step 4: Implement `scenarioParser` + unit tests

- Implement `adws/promotion/scenarioParser.ts` exporting `parse(content: string, fileUri?: string): Scenario[]`.
- Algorithm: instantiate `@cucumber/gherkin`'s `Parser` with `AstBuilder` (using a UUID provider via `@cucumber/messages.IdGenerator.uuid()`) and `GherkinClassicTokenMatcher`. Call `parser.parse(content)` to get a `GherkinDocument`. Walk `document.feature?.children` extracting each `scenario` entry. For each scenario, collect: `tags` (from `scenario.tags[].name`), `steps` (`scenario.steps.map(s => ({ keyword: s.keyword.trim(), text: s.text, line: s.location?.line ?? 0 }))`), `startLine` (line of the first tag if any, else scenario header), `endLine` (last step line, or scenario header if no steps), and `headerLine` (scenario keyword location).
- Implement `adws/promotion/__tests__/scenarioParser.test.ts` covering: (a) parses a multi-scenario feature and returns `length === N` with correct tags per scenario; (b) scenarios with multi-line tag blocks return all tags; (c) tagless scenarios return empty `tags` array; (d) Background blocks are excluded from `Scenario[]` results; (e) line positions are byte-accurate (assert known scenario header line); (f) malformed Gherkin throws (propagates `@cucumber/gherkin` `ParserException`).
- Run the test and confirm green.

### Step 5: Implement `promotionScorer` + unit tests

- Implement `adws/promotion/promotionScorer.ts` exporting `score(scenario: Scenario, registry: VocabularyRegistry, examplesBlock: string[]): ScoreResult` and the named weight constants.
- Algorithm:
  - **surfaceMatch axis** (0 or `SURFACE_MATCH_WEIGHT=3`): for each step's text, look up its phrase in `registry.entries` (longest-match wins for parameterised phrases — text matches a registry phrase modulo `{string}`/`{int}` placeholders). Collect each matched phrase's `assertionTarget`. If every step's matched phrase's target appears as a substring in some element of `examplesBlock`, set `surfaceMatch = SURFACE_MATCH_WEIGHT`. If any step's phrase is unknown or its target absent, set `surfaceMatch = 0`.
  - **executionPattern axis**: from the matched phrases, collect the set of patterns used by the scenario's `When` steps (filter `step.keyword === 'When' || step.keyword === 'And'` immediately after a `When`). Apply the highest-weight pattern present: `subprocess` → `SUBPROCESS_WEIGHT=3`, else `phase-import` → `PHASE_IMPORT_WEIGHT=2`, else `mock-query` (or no matched patterns) → `MOCK_QUERY_WEIGHT=0`.
  - **phaseCount axis**: count `When` + `And`-after-`When` steps. If count ≥ 2, set `phaseCount = (count - 1) * EXTRA_PHASE_WEIGHT`. Otherwise `phaseCount = 0`.
  - `total = surfaceMatch + executionPattern + phaseCount`.
  - Return `{ total, breakdown: { surfaceMatch, executionPattern, phaseCount } }`.
- Implement `adws/promotion/__tests__/promotionScorer.test.ts` covering every branch:
  - Surface match present + subprocess pattern + 1 phase → `total = 3 + 3 + 0 = 6`.
  - Surface match present + subprocess pattern + 3 phases → `total = 3 + 3 + 2 = 8`.
  - Surface match absent (unknown phrase) + subprocess pattern → `surfaceMatch = 0, total = 0 + 3 = 3`.
  - Surface match present + phase-import pattern + 2 phases → `total = 3 + 2 + 1 = 6`.
  - Surface match present + mock-query only + 1 phase → `total = 3 + 0 + 0 = 3`.
  - Surface match absent + mock-query only → `total = 0`.
  - Mixed pattern (subprocess + phase-import in same scenario) → highest weight (subprocess) used.
  - Scenario with zero `When` steps → `executionPattern = 0, phaseCount = 0`.
- Run the test and confirm green.

### Step 6: Implement `promotionThreshold` + unit tests

- Implement `adws/promotion/promotionThreshold.ts` exporting `computeThreshold(stats: PromotionStats): number` plus the named constant `BOOTSTRAP_THRESHOLD = 3`.
- Algorithm (this slice): return `BOOTSTRAP_THRESHOLD` unconditionally. The `stats` parameter is accepted but unused (slice #7 lights it up). Document this as a deliberate placeholder with a `// TODO(slice #7):` comment marker pointing to the parent PRD section.
- Implement `adws/promotion/__tests__/promotionThreshold.test.ts` covering: (a) zero stats → `3`; (b) low ratio → `3`; (c) high ratio → `3` (asserting the interface is locked; slice #7 will replace these expectations with the real formula). Each test exercises the function with a different `PromotionStats` shape so the signature is exercised.
- Run the test and confirm green.

### Step 7: Implement `promotionTagWriter` + unit tests

- Implement `adws/promotion/promotionTagWriter.ts` exporting `applyTagState(content: string, scenarioHeaderLine: number, state: TagState, today: string): string`.
- Algorithm:
  - Guard: if `state !== 'add-suggestion'`, throw `Error('promotionTagWriter: only "add-suggestion" is supported in this slice')`. Slice #5 extends.
  - Split `content` by `\n` into a `string[]`.
  - Locate the scenario header at index `scenarioHeaderLine - 1` (1-based to 0-based).
  - Walk backward from the header looking for a contiguous tag line block (lines starting with `@` after trimming whitespace). If found, append ` @promotion-suggested-<today>` to the last tag line. If no tag line is immediately above the header, insert a new line `  @promotion-suggested-<today>` (preserving header's leading indentation) before the header.
  - Re-join with `\n` and return.
- Implement `adws/promotion/__tests__/promotionTagWriter.test.ts` covering: (a) scenario with existing tag line appends the new tag and preserves the rest of the file byte-for-byte; (b) scenario with no tag line gets a new tag line inserted; (c) scenario at file start with no preceding content; (d) scenario at file end; (e) `today` is interpolated into the tag literal; (f) calling with an unsupported `state` throws.
- Each test asserts via full-content equality (or `expect.toBe(...)`) plus a byte-position spot-check on the post-modification content so byte-exact preservation is verified.
- Run the test and confirm green.

### Step 8: Implement `promotionCommenter` coordination function + unit tests

- Implement `adws/promotion/promotionCommenter.ts` exporting `runPromotionCommenter(prNumber: number, deps?: PromotionCommenterDeps): Promise<PromotionResult>`.
- Define `PromotionCommenterDeps`:
  - `loadVocabulary: () => string` (reads `features/regression/vocabulary.md` per `.adw/scenarios.md`)
  - `fetchChangedFiles: (prNumber: number) => Promise<{ path: string; status: string }[]>`
  - `readFile: (path: string) => string`
  - `writeFile: (path: string, content: string) => void`
  - `postComment: (prNumber: number, body: string) => Promise<void>`
  - `today: () => string` (returns `YYYY-MM-DD`)
  - `log?: (msg: string, level?: string) => void`
- Define `PromotionResult = { suggestedScenarios: { file: string; scenarioHeaderLine: number; score: number }[] }`.
- Algorithm:
  - `const registry = vocabularyParser.parse(deps.loadVocabulary())`.
  - `const threshold = promotionThreshold.computeThreshold({ promotedCount90d: 0, totalPerIssueCount90d: 0 })`.
  - For each changed file with `path` matching `features/per-issue/feature-*.feature` and `status` not deleted:
    - `const content = deps.readFile(file.path)`.
    - `const scenarios = scenarioParser.parse(content, file.path)`.
    - For each scenario: `const score = promotionScorer.score(scenario, registry, registry.surfaceExamples)`.
    - If `score.total >= threshold`: `const updated = promotionTagWriter.applyTagState(content, scenario.headerLine, 'add-suggestion', deps.today())`; `deps.writeFile(file.path, updated)`; collect into `suggestedScenarios`.
  - If `suggestedScenarios.length > 0`: `await deps.postComment(prNumber, formatPromotionComment(suggestedScenarios))`.
  - Return the result.
- The comment body lists each suggested scenario with its score breakdown (helps reviewers understand the suggestion).
- Implement `adws/promotion/__tests__/promotionCommenter.test.ts` with hoisted module mocks for `fs`/`gh-api` style boundaries plus injected `deps`:
  - Happy path: changed file contains one high-score scenario → `writeFile` called once with the tagged content, `postComment` called once with a body referencing the scenario.
  - Below threshold: changed file contains only a mock-query scenario with unknown phrases → `writeFile` not called, `postComment` not called.
  - Multiple files: two changed files each with a high-score scenario → two `writeFile` calls, one consolidated `postComment` call.
  - Non-per-issue file changed (e.g., `adws/foo.ts`) → no parsing attempted, no writes.
  - Deleted file in the diff → skipped silently.
- Run the test and confirm green.

### Step 9: Implement `adwPromotionSweep.tsx` CLI orchestrator

- Implement `adws/adwPromotionSweep.tsx` with shebang `#!/usr/bin/env bunx tsx`.
- Use `parseOrchestratorArguments(args, { scriptName: 'adwPromotionSweep.tsx', usagePattern: '<github-issueNumber> [adw-id]', supportsCwd: false })` from `adws/core/orchestratorCli.ts` to parse `<issueNumber> [adwId]`.
- Build default deps for `runPromotionCommenter`:
  - `loadVocabulary` reads `features/regression/vocabulary.md` (path resolved via `loadProjectConfig().scenarios.vocabularyRegistry` if present, fallback to the literal default).
  - `fetchChangedFiles` calls `gh pr view <prNumber> --json files --jq '.files[] | {path, status}'` (or the equivalent `gh api` call via the existing helpers). The PR number is resolved by `findPRByBranch` using the standard issue→branch convention.
  - `readFile`/`writeFile` use `fs.readFileSync` / `fs.writeFileSync` (Node fs).
  - `postComment` uses `repoContext.codeHost.commentOnPullRequest` (or the equivalent `gh pr comment` wrapper) — pattern matches `adwChore.tsx`'s `commentOnIssue`.
  - `today` returns `new Date().toISOString().slice(0, 10)`.
  - `log` is the structured logger from `adws/core`.
- Log start/end of the sweep, the resolved PR number, and the count of suggested scenarios.
- **Do not** wrap with `runWithOrchestratorLifecycle` (no spawn lock, no heartbeat) — deferred to slice #5 with duplicate-suppression.
- **Do not** create a `CostTracker` or run cost-tracked phases — this is a single-purpose event-driven script, not a multi-phase pipeline.
- Catch the top-level error path: log and `process.exit(1)` on uncaught errors; `process.exit(0)` on success.

### Step 10: Wire the orchestrator into the BDD orchestrator-name map

- Edit `features/regression/step_definitions/whenSteps.ts` (lines 53–65) and add `'promotion-sweep': 'adwPromotionSweep.tsx'` to `ORCHESTRATOR_FILES` so the W1 step `the "X" orchestrator is invoked with adwId {string} and issue {int}` can spawn the new orchestrator. No other step-definition changes are needed; the existing W1 step body already routes through `ORCHESTRATOR_FILES`.

### Step 11: Create smoke scenarios for `promotionCommenter`

- Create `features/regression/smoke/promotion_commenter.feature` tagged `@regression @smoke` with two scenarios:
  - **High score** — Background sets up the worktree, an issue, and a per-issue PR with a scenario meeting the threshold; manifest pre-seeds claude-cli-stub. The W1 step invokes `the "promotion-sweep" orchestrator is invoked with adwId "promotion-smoke-509" and issue 509`. T2 asserts `the mock GitHub API recorded a comment on issue 509` (the comment posts on the PR, which the mock harness records under the issue's mock-server endpoint per the existing convention). T5 asserts `the orchestrator subprocess exited 0`.
  - **Low score** — same Background but the manifest pre-seeds a below-threshold scenario; T7 asserts `the mock harness recorded zero PR-merge calls` (re-used as a "no extra calls" proxy) and T5 asserts exit 0. No comment-recorded assertion (because no comment is posted).
- Follow the existing pending-return pattern in `whenSteps.ts` W1 — the smoke scenarios document the contract until the harness can drive a real subprocess to completion under 30s. This is consistent with the other smoke scenarios in the suite.

### Step 12: Create mock manifest fixtures

- Create `test/fixtures/jsonl/manifests/promotion-sweep-high-score.json` — claude-cli-stub manifest pre-seeding the worktree's seeded per-issue feature file with a high-score scenario (uses subprocess pattern phrases and only registered vocabulary). Manifest recorded API call: POST `/repos/.../issues/<n>/comments`.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-low-score.json` — manifest variant pre-seeding the worktree with a below-threshold scenario (uses mock-query phrases only, or contains unregistered phrases). No recorded comment.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-byte-exact.json` — manifest pre-seeding a multi-scenario feature file used to verify byte-exact preservation of surrounding content after tag insertion.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-mixed-scores.json` — manifest pre-seeding a feature file containing scenarios of mixed scores; only above-threshold scenarios receive tags.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-comment-body.json` — manifest pre-seeding a single-named scenario; the recorded comment identifies the promoted scenario name.
- Follow the manifest shape from `test/fixtures/jsonl/manifests/safe-verdict.json` as a reference.

### Step 13: Create per-issue BDD scenarios for issue #509 (build-agent input)

- Create `features/per-issue/feature-509.feature` tagged `@adw-509 @adw-tdauam-promotion-commenter` with behavioural scenarios describing the acceptance contract:
  - Scenario 1: "A per-issue scenario using the subprocess pattern with all phrases in vocabulary is tagged and commented" — describes the high-score artefact-observable behaviour (the seeded `.feature` file gets a `@promotion-suggested-<today>` tag inserted on the seeded scenario and the mock GitHub API records a comment).
  - Scenario 2: "A per-issue scenario below the threshold receives no tag and no comment" — describes the negative case.
  - Scenario 3: "Tag insertion preserves byte-exact positions of surrounding scenario content" — describes the byte-stability contract (every non-inserted line is byte-identical to pre-invocation contents).
  - Scenario 4: "Only above-threshold scenarios receive tags in a file containing scenarios of mixed scores" — describes per-scenario gating within a single file.
  - Scenario 5: "The PR comment posted by the orchestrator identifies the scenario whose tag was inserted" — describes the comment-body contract.
  - The W1 invocation uses the orchestrator key `"promotion-sweep"` (kebab-case, matching the `ORCHESTRATOR_FILES` convention).
  - Scenarios use vocabulary registry phrases (subprocess pattern) where applicable so they themselves would score above threshold — a deliberate self-referential proof that the rubric works.
- These scenarios are NOT executed by the runner (per `features/per-issue/` convention) — they are input to the build agent.

### Step 14: Update barrel exports and run a full type check

- Populate `adws/promotion/index.ts` to re-export the public surfaces: `parse as parseVocabulary`, `parse as parseScenarios`, `score`, `computeThreshold`, `applyTagState`, `runPromotionCommenter`, plus the type re-exports from `types.ts`.
- Run `bun run lint` to catch any style/import errors.
- Run `bunx tsc --noEmit` to confirm the whole repo type-checks with the new modules and dep additions.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to confirm the adws-scoped type-check passes.

### Step 15: Run all unit tests

- Run `bun run test:unit` (Vitest) to execute all unit tests, including the five new deep-module tests and the orchestrator-coordination test (six new test files total).
- Confirm zero failures and zero regressions in pre-existing tests.

### Step 16: Validation — execute every validation command

Run the full validation command set from the Validation Commands section to confirm zero regressions across lint, type-check, unit tests, build, and BDD smoke scenarios.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`. The five deep modules plus the orchestrator coordination function each get a dedicated unit test file under `adws/promotion/__tests__/`. Tests follow the existing repo patterns (`adws/__tests__/issueDependencies.test.ts`, `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`):

- **Hoisted module mocks** (top of file, before imports) for boundary collaborators (`fs`, `gh-api`).
- **Dep-injection overrides** for the orchestrator coordination test (`deps?: PromotionCommenterDeps`) so the same module can be tested with synthetic vocabularies, file contents, and fake `today` values.
- **Pure-function tests** for the four pure deep modules (`vocabularyParser`, `scenarioParser`, `promotionScorer`, `promotionThreshold`, `promotionTagWriter`) — no mocks needed, just input→output assertions.

Per-module test coverage:

1. `vocabularyParser` — happy path on a valid table; malformed row skip; missing `## Observability Surfaces (Examples)` section; empty content; unknown pattern fallback.
2. `scenarioParser` — multi-scenario parse; multi-line tags; tagless scenario; Background exclusion; byte-accurate line positions; malformed-gherkin propagation.
3. `promotionScorer` — every branch of every axis: surface present/absent, subprocess/phase-import/mock-query patterns, 0/1/2/3+ phase counts, mixed-pattern scenarios, unknown phrase as surface miss.
4. `promotionThreshold` — `3` for every stats shape (interface-stability test for slice #7).
5. `promotionTagWriter` — add to scenario with existing tags; add to scenario with no tags; scenario at file start; scenario at file end; `today` interpolation; unsupported `state` throws.
6. `promotionCommenter` — high-score path applies tag + posts comment; low-score path applies neither; mixed file diff; non-per-issue file skipped; deleted file skipped.

### Edge Cases

- **Vocabulary file missing or empty** — `vocabularyParser.parse('')` returns an empty registry; `promotionScorer` treats every phrase as unknown → `surfaceMatch = 0` for every scenario.
- **Scenario with no `When` steps** (Given-only) — `executionPattern = 0` and `phaseCount = 0`; total can still be ≥ 3 if surface match is present.
- **Multi-line scenario name** (uncommon but valid Gherkin) — `scenarioParser` preserves the header line correctly; `promotionTagWriter` inserts the tag immediately above the header line.
- **Existing `@promotion-suggested-<other-date>` tag** — out of scope in this slice (date-refresh is slice #5). The tag writer in this slice will append a new tag literal, producing two `@promotion-suggested-*` tags on the same line. Documented as a known limitation; slice #5 resolves it.
- **Existing `@promotion` (no date)** — out of scope in this slice (approval-detection is slice #5). The commenter does not check for it; if a human has already approved, the commenter will re-tag — accepted in this slice.
- **PR with no per-issue files changed** — the commenter completes silently with zero suggestions and posts no comment.
- **PR with a deleted per-issue file** — the commenter skips it (no read-then-write on a deleted file).
- **Malformed Gherkin in a changed file** — `scenarioParser` throws; the commenter catches and logs per file, then continues with the remaining files (does not abort the whole sweep).
- **Tag insertion at file boundary** — first scenario in the file with no preceding tag line; last scenario with no trailing content. Both covered by `promotionTagWriter` tests.
- **Mixed-pattern scenario** (subprocess phrase + phase-import phrase in the same `When` block) — the scorer picks the **highest-weight** pattern (subprocess), not the most common.

## Acceptance Criteria

- [ ] `adws/promotion/vocabularyParser.ts` exists, exports `parse(content: string): VocabularyRegistry`, and has unit tests covering happy path + malformed table row + missing examples section + empty content.
- [ ] `adws/promotion/scenarioParser.ts` exists, exports `parse(content: string, fileUri?: string): Scenario[]`, wraps `@cucumber/gherkin`, and has unit tests covering multi-scenario, multi-line tags, tagless, Background exclusion, line positions.
- [ ] `adws/promotion/promotionScorer.ts` exists, exports `score(scenario, registry, examplesBlock): ScoreResult`, applies the published weights, and has unit tests covering **every branch** of every axis (surface present/absent; subprocess/phase-import/mock-query; 0/1/2/3+ phases).
- [ ] `adws/promotion/promotionThreshold.ts` exists, exports `computeThreshold(stats): number`, and returns the hardcoded value `3` for every input. Unit tests document the interface so slice #7 can extend the body without breaking the signature.
- [ ] `adws/promotion/promotionTagWriter.ts` exists, exports `applyTagState(content, scenarioHeaderLine, state, today): string`, supports only `'add-suggestion'` in this slice, and has unit tests asserting **byte-exact preservation** of surrounding scenario content.
- [ ] `adws/promotion/promotionCommenter.ts` exists, exports `runPromotionCommenter(prNumber, deps?): Promise<PromotionResult>`, delegates all decisions to the five deep modules, and has unit tests covering high-score path, low-score path, mixed file diff, non-per-issue file skip.
- [ ] `adws/adwPromotionSweep.tsx` exists, is executable via `bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]`, and wraps `runPromotionCommenter` with default deps wired to `gh pr view`, `fs`, and the GitHub API.
- [ ] `features/regression/smoke/promotion_commenter.feature` exists, is tagged `@regression @smoke`, contains at least one high-score scenario and one low-score scenario, and follows the existing pending-return pattern.
- [ ] `features/per-issue/feature-509.feature` exists, is tagged `@adw-509 @adw-tdauam-promotion-commenter`, and describes the acceptance contract from a target-repo operator's perspective.
- [ ] `test/fixtures/jsonl/manifests/promotion-high-score.json` and `promotion-low-score.json` exist and have the same manifest shape as `safe-verdict.json`.
- [ ] `features/regression/step_definitions/whenSteps.ts` `ORCHESTRATOR_FILES` map contains `'promotion-sweep': 'adwPromotionSweep.tsx'`.
- [ ] A per-issue PR containing a scenario with all phrases in the vocabulary and using the subprocess pattern would cause `runPromotionCommenter` to insert a `@promotion-suggested-<today>` tag and post a comment (verified by the orchestrator unit test).
- [ ] A per-issue PR containing a scenario below the threshold causes `runPromotionCommenter` to insert no tag and post no comment (verified by the orchestrator unit test).
- [ ] Tag insertion preserves byte-exact positions of surrounding scenario content (verified by `promotionTagWriter` unit tests).
- [ ] `package.json` `dependencies` contains `@cucumber/gherkin` and `@cucumber/messages`.
- [ ] `bun run lint` passes with zero errors.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass with zero errors.
- [ ] `bun run test:unit` passes with zero regressions and the six new test files all green.
- [ ] `bun run build` passes with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

Per `.adw/commands.md`:

- `bun install` — Install dependencies (picks up `@cucumber/gherkin` + `@cucumber/messages`).
- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type-check the whole repo.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type-check scoped to `adws/`.
- `bun run test:unit` — Run all Vitest unit tests including the six new test files under `adws/promotion/__tests__/`.
- `bun run build` — Build the application to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"` — Run the regression smoke suite, including the new `promotion_commenter.feature`. Following the existing pending pattern for W1, the new scenarios will report as `pending` rather than failing — this is the documented contract until the harness gains full subprocess support, consistent with the other smoke scenarios in the suite.
- `bunx tsx adws/adwPromotionSweep.tsx --help 2>&1 | head -20` — Smoke-test that the new orchestrator script is executable and prints its usage. (Falls out of `parseOrchestratorArguments` when no args provided.)

## Notes

- **Coding guidelines compliance**: All new modules strictly follow `.adw/coding_guidelines.md`. TypeScript strict mode is on (no `any`), guard clauses keep nesting ≤ 2, declarative `.map`/`.filter`/`.reduce` are used over imperative `for`, and side effects are isolated at the orchestrator boundary (`runPromotionCommenter` is the only function with file I/O and HTTP — the five deep modules are pure).
- **Dependency injection over decorators**: Per the planning instructions ("Don't use decorators. Keep it simple."), the orchestrator coordination is done with a plain `deps?: PromotionCommenterDeps` interface plus a default-factory function, mirroring the existing pattern in `adws/triggers/perIssueScenarioSweep.ts`.
- **Library install command**: `bun add <package>` per `.adw/commands.md`. Two new packages: `@cucumber/gherkin` and `@cucumber/messages`. Both are runtime deps (not devDeps) because they are imported by `adws/promotion/scenarioParser.ts`, which is loaded by the orchestrator at runtime.
- **Out of scope (deferred to later slices)**:
  - **Slice #5**: `hitl` label application, duplicate-suppression (no re-comment same day), date-refresh and tag-removal operations in `promotionTagWriter`, `@promotion` (no date) approval detection, `promotionMover` orchestrator (moves approved scenarios into `features/regression/`).
  - **Slice #6**: Webhook wiring (`pull_request.opened`/`pull_request.synchronize` → spawn `adwPromotionSweep.tsx`), cron wiring (no — per PRD, no cron sweep ever; PR-event only).
  - **Slice #7**: Auto-ramp formula in `promotionThreshold` driven by the 90-day promotion-activity ratio computed from git history.
- **Tracer-bullet shape rationale**: The simplifications listed in the issue body (hardcoded `N=3`, single tag-writer operation, no duplicate suppression, no `hitl`) are deliberate — they keep the surface small enough to land as one PR while still exercising every interface the later slices will extend. The five deep modules' interfaces are the load-bearing contract; their bodies grow in subsequent slices, but consumers (the `promotionCommenter` and `adwPromotionSweep.tsx`) do not need to change to absorb that growth.
- **Idempotency**: `promotionTagWriter.applyTagState(...)` with `'add-suggestion'` is byte-stable for a fixed `(content, scenarioHeaderLine, today)` triple — running the orchestrator twice on the same PR within the same day produces an identical write, which is a no-op against the filesystem. Duplicate comment suppression is **not** in this slice; running twice in one day produces two PR comments. Slice #5 fixes this.
- **State storage**: No external state file. Suggestion state lives entirely in the `.feature` file as the tag literal. Promotion-activity ratio is computed on demand from git history in slice #7. The only required external state is the `hitl` label on PRs, which is GitHub-native and only set by slice #5.
- **Backwards compatibility**: Existing per-issue scenarios that pre-date this slice are unaffected. `promotionCommenter` only operates on PRs whose changed-file list includes `features/per-issue/feature-*.feature`. Repos without the polymorphism flags in `.adw/scenarios.md` simply never invoke this orchestrator.
