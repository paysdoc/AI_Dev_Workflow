# Feature: Stack-Coherence Check (warn loud, non-blocking)

## Metadata
issueNumber: `581`
adwId: `l8a10n-stack-coherence-chec`
issueJson: `{"number":581,"title":"Stack-coherence check (warn loud, non-blocking)","body":"## Parent PRD\n\n`specs/prd/multi-language-test-and-bdd-support.md`\n\n## What to build\n\nDefense-in-depth against `adw_init`'s own mis-detection (it defaults the scenario tool to Cucumber on non-recognition). `stackCoherenceCheck` asserts the detected framework matches the run-command language; on mismatch it warns **loudly via the `adw:unverified` comment + label channel** and does **not** block. It additionally asserts the detected `bddFramework` is **Gherkin-based** (per the PRD Gherkin mandate); a non-Gherkin framework warns through the same channel. See PRD Implementation Decisions → Proof layer (coherence check) and Scenario format.\n\n## Acceptance criteria\n\n- [ ] `stackCoherenceCheck` returns ok/warning for coherent vs incoherent detected configs (unit-tested)\n- [ ] A non-Gherkin `bddFramework` is flagged as a warning (Gherkin-mandate check)\n- [ ] Mismatch emits `adw:unverified` comment + label\n- [ ] Check never blocks the workflow\n\n## Blocked by\n\n- Blocked by #579\n\n## User stories addressed\n\n- User story 22\n- User story 31","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-15T11:51:42Z","comments":[],"actionableComment":null}`

## Feature Description

`adw_init` classifies a target repo's stack and writes a **detected descriptor** into `.adw/commands.md` (`## Test Framework`, `## Run Tests`, `## Run Scenarios by Tag`) and `.adw/scenarios.md` (`## BDD Framework`, `## Step Def Directory`). When it cannot confidently identify a Gherkin step-def runner it **falls back to `cucumber-js`** — a silent default that can leave, for example, a Python/pytest repo wired to a JavaScript/TypeScript BDD runner. ADW then proceeds as if the configuration were verified.

This feature adds **`stackCoherenceCheck`** — a small **pure module** that reads the already-detected descriptor and asserts two invariants:

1. **Run-command/language coherence** — the detected frameworks and the run commands all imply the **same language** (e.g. `testFramework: pytest` is incoherent with `bddFramework: cucumber-js` / a `cucumber-js` scenario run command — the User Story 22 case).
2. **Gherkin mandate** (PRD Scenario format) — the detected `bddFramework` is one of the recognized **Gherkin-based** runners (`cucumber-js`, `behave`, `pytest-bdd`, `godog`, `cucumber-rs`, `cucumber-ruby`). A non-Gherkin framework is flagged.

On any incoherence the check **warns loudly through the existing `adw:unverified` channel** — it applies the `adw:unverified` label and posts a self-explanatory issue comment — and then **continues the workflow without blocking**. It is defense-in-depth: a second, runtime safety net behind `adw_init`'s own init-time fallback flagging, catching mis-detections that survive into a running workflow.

The value: a flat-layout Python (or Go/Rust/Ruby) target whose BDD wiring was mis-detected gets a **loud, visible signal on every workflow** instead of silently running its scenarios through the wrong runner — making fix-forward (the PRD's chosen mechanism for languages beyond Python) safe.

## User Story

As an ADW maintainer (PRD User Story 22) and operator targeting a non-TypeScript language (PRD User Story 31),
I want a coherence check that flags an incoherent detected config — e.g. a Python stack wired to a `cucumber-js` run command, or a non-Gherkin `bddFramework` — by warning loudly through the `adw:unverified` comment + label channel without blocking the run,
So that `adw_init`'s own mis-detection (its `cucumber-js` fallback on non-recognition) is surfaced as a real signal rather than a silent green, while the Gherkin `.feature` mandate that the promotion / per-issue-sweep / vocabulary subsystems depend on stays enforced.

## Problem Statement

`adw_init` emits a detected descriptor but has exactly one safety mechanism for mis-detection: the **init-time** fallback flagging inside `adw_init.md` (raise `adw:unverified` when it falls back to `cucumber-js` for a recognized non-JS/TS stack). That signal fires **once, at bootstrap**, and only when `adw_init` itself recognizes the ambiguity. It does **not** cover:

- A descriptor that became incoherent through manual edits, a partial regeneration, or a stack `adw_init` mis-classified confidently (no ambiguity detected → no flag).
- The **Gherkin mandate**: nothing at runtime asserts that `bddFramework` is actually Gherkin-based. The promotion subsystem (`promotionScorer`, `promotionMover`, `vocabularyParser`, `scenarioParser`), `perIssueScenarioSweep` (`feature-{N}.feature`), and `@adw-{N}` / `@regression` tag discovery all hardwire Gherkin `.feature` parsing; a non-Gherkin `bddFramework` would silently break them (PRD "Gherkin coupling is load-bearing").

There is no **runtime** assertion that the detected framework matches the run-command language, and no runtime Gherkin-mandate check. Both are needed as defense-in-depth so that a misconfigured workflow advertises itself loudly instead of reporting a verified PR on work routed through the wrong runner.

## Solution Statement

Add a **pure-function coherence check** consumed at a single, once-per-workflow phase boundary, mirroring the established `computeTestVerdict` (pure module) + `executeUnitTestPhase` (warn-channel wiring) seam from slice 1 (#577):

1. **New pure module `adws/core/stackCoherenceCheck.ts`** — `stackCoherenceCheck(input) → { ok: boolean; warnings: StackCoherenceWarning[] }`. Inputs are the four already-parsed descriptor signals (`testFramework`, `bddFramework`, `runTests`, `runScenariosByTag`). No I/O — directly unit-testable, following the `testVerdict.ts` / `stepDefDetection.ts` pure-helper convention.
   - **Language coherence**: infer a language for each signal from a curated, ordered token map; collect the set of *distinct, **known*** languages; more than one ⇒ a `language-mismatch` warning. Unknown/empty signals infer no language, so they never produce a false mismatch.
   - **Gherkin mandate**: a non-empty `bddFramework` that is not a recognized Gherkin runner ⇒ a `non-gherkin-bdd` warning. Empty ⇒ the `cucumber-js` default ⇒ Gherkin ⇒ no warning.
2. **Add `isGherkinFramework(framework)` to `adws/core/stepDefDetection.ts`** — derived from the existing `FRAMEWORK_EXTENSION_MAP` (the single source of truth for the Gherkin framework set), so the Gherkin set never drifts from the step-def extension map. Empty ⇒ `true` (default `cucumber-js`).
3. **New reporter `adws/phases/stackCoherenceReporter.ts`** — `reportStackCoherence(config)` runs the pure check, and on `!ok` applies the `adw:unverified` label and posts a coherence-specific `stack_incoherent` comment. It **never throws and never exits** (wrapped so a GitHub failure cannot break the run), satisfying "never blocks."
4. **One integration point: `executeUnitTestPhase`** — call `reportStackCoherence(config)` near the top, **before** the unit-test gate, so it runs **exactly once per workflow** across every test-bearing orchestrator, regardless of the `unitTests` opt-out. (The scenario-test phase is deliberately **not** used: it runs inside the scenario-fix and review-patch retry loops in `adwSdlc.tsx`, which would post duplicate comments.)
5. **New `stack_incoherent` workflow-comment stage** — a self-explanatory comment (distinct copy from the zero-testcase `unverified` comment) listing the detected incoherences, posted through the shared `adw:unverified` **label** channel.

This is **framework-resident** code that consumes fields `adw_init` already emits, so — unlike #577 — it requires **no `adw_init.md` change, no `.adw-version` bump, and no `adwUpgrade` propagation**; it takes effect immediately on merge (PRD "Further Notes → Hash propagation": framework code is not a hash input).

## Relevant Files

Use these files to implement the feature:

### New Files

- `adws/core/stackCoherenceCheck.ts` — **create.** The pure coherence module. Exports `stackCoherenceCheck(input: StackCoherenceInput): StackCoherenceResult`, the `StackCoherenceInput` / `StackCoherenceResult` / `StackCoherenceWarning` types, and the `StackCoherenceWarningCode` union (`'language-mismatch' | 'non-gherkin-bdd'`). Internal-only language inference (ordered token map). No `fs`, no `gh`, no logging — a pure deep module like `testVerdict.ts`.
- `adws/core/__tests__/stackCoherenceCheck.test.ts` — **create.** Table-driven Vitest unit tests over coherent and incoherent configs and the Gherkin-mandate branch (see Testing Strategy). Mirrors `adws/core/__tests__/testVerdict.test.ts`.
- `adws/phases/stackCoherenceReporter.ts` — **create.** `reportStackCoherence(config: WorkflowConfig): void`. Builds the four-signal input from `config.projectConfig.commands` + `config.projectConfig.scenarios`, runs `stackCoherenceCheck`, and on `!ok` performs the I/O (label + comment) at the phase boundary, swallowing/logging any error so it can never block. Models its label/comment wiring on the warn path already in `unitTestPhase.ts`.

### Files to Edit

- `adws/core/stepDefDetection.ts` — **edit.** Add `export function isGherkinFramework(framework: string): boolean` keyed off the existing `FRAMEWORK_EXTENSION_MAP` (normalized-empty ⇒ `true`; known key ⇒ `true`; unknown non-empty ⇒ `false`). Single source of truth for the Gherkin set — do not duplicate the framework list in `stackCoherenceCheck.ts`.
- `adws/core/index.ts` — **edit.** Re-export `stackCoherenceCheck` + its types (after the existing `testVerdict` re-export) and add `isGherkinFramework` to the existing `stepDefDetection` re-export line, following the established re-export pattern.
- `adws/types/workflowTypes.ts` — **edit.** Add `'stack_incoherent'` to the `WorkflowStage` union (near the `'unverified'` test stage). This is the comment-stage discriminator; it is **not** a persisted workflow state (the check never changes `workflowStage`).
- `adws/github/workflowCommentsIssue.ts` — **edit.** Add an optional `coherenceWarnings?: string[]` field to `WorkflowContext`; add `formatStackIncoherentComment(ctx)`; wire `case 'stack_incoherent':` into `formatWorkflowComment`. Reuse `ADW_SIGNATURE` / `formatRunningTokenFooter` like the sibling formatters. Keep the copy self-explanatory and distinct from `formatUnverifiedComment` (zero-testcase).
- `adws/phases/unitTestPhase.ts` — **edit.** Import `reportStackCoherence` and call it once near the top of `executeUnitTestPhase`, **before** the `unitTestsEnabled` gate, so the coherence check runs regardless of the unit-test opt-out. This is the only orchestrator-reachable wiring change (every test-bearing orchestrator already calls this phase exactly once).
- `adws/phases/index.ts` — **edit.** Export `reportStackCoherence` from `./stackCoherenceReporter` (consistency/discoverability; the phase imports it directly via relative path).
- `README.md` — **edit (after Step 0).** Add the new `adws/core/stackCoherenceCheck.ts` (and its test) and `adws/phases/stackCoherenceReporter.ts` to the Project Structure listing, alongside the existing `testVerdict.ts` / `stepDefDetection.ts` entries.

### Reference (read-only)

- `adws/phases/unitTestPhase.ts` — the warn-path template: `applyLabel(issueNumber, ADW_UNVERIFIED_LABEL, repoInfo)` with `repoInfo = config.targetRepo ? { owner, repo } : getRepoInfo()`, then `postIssueStageComment(repoContext, issueNumber, '<stage>', ctx)`, no `process.exit`.
- `adws/github/labelManager.ts` — `ADW_UNVERIFIED_LABEL` and `applyLabel` (lazy-creates the label on not-found) **already exist** from #577; **no change needed**. The label is informational, not in `ADW_CLASSIFICATION_LABELS`.
- `adws/phases/phaseCommentHelpers.ts` — `postIssueStageComment(repoContext, issueNumber, stage, ctx)` (already swallows GitHub errors and logs).
- `adws/core/projectConfig.ts` — `CommandsConfig` (`testFramework`, `runTests`, `runScenariosByTag`) and `ScenariosConfig` (`bddFramework`) — the input fields, already parsed with backward-compatible defaults. **No change needed.**
- `adws/phases/workflowInit.ts` — confirms `WorkflowConfig` already carries `projectConfig`, `repoContext?`, `targetRepo?`, `ctx`, `issueNumber`, `orchestratorStatePath` — no new plumbing into the phase is required.
- `adws/adwSdlc.tsx` — confirms `executeUnitTestPhase` is called **once** (line ~83) while `executeScenarioTestPhase` is called inside **retry loops** (lines ~88–98 and ~117) — the reason the check is wired into the unit-test phase, not the scenario phase.
- `.adw/commands.md` + `.adw/scenarios.md` (this repo) — ADW-self's own descriptor: `testFramework: vitest`, `runTests: bun run test:unit`, `bddFramework: cucumber-js`, `runScenariosByTag: cucumber-js …` — all JavaScript, `cucumber-js` is Gherkin ⇒ the check must return `ok: true` for ADW-self (a regression guard, asserted in the unit tests).

### Relevant conditional documentation (read before implementing)

- `app_docs/feature-zyaojl-configurable-test-directory.md` — slice 1: the `adw:unverified` comment + label channel, `computeTestVerdict` pure-module pattern, and the `frameworkDetected = Boolean(commands.testFramework?.trim())` convention. The warn-path wiring here is the direct template.
- `app_docs/feature-u3l5q0-junit-report-rail-migration.md` — slice A1: `stepDefDetection` (`FRAMEWORK_EXTENSION_MAP`, `stepDefExtensionsFor`) and the `bddFramework` / `stepDefDirectory` `ScenariosConfig` fields and their supported values — the Gherkin framework set this check reuses. Note its "Out of scope" line explicitly defers `stackCoherenceCheck` to this issue.

## Implementation Plan

### Phase 1: Foundation — pure check + Gherkin predicate
Add `isGherkinFramework` to `stepDefDetection.ts` (single source of truth for the Gherkin set) and the pure `stackCoherenceCheck` module with its table-driven unit tests. Re-export both from `adws/core/index.ts`. These are leaf, side-effect-free changes provable in isolation before any phase wiring.

### Phase 2: Core Implementation — reporter + comment stage
Add the `stack_incoherent` `WorkflowStage`, the `coherenceWarnings` context field, and `formatStackIncoherentComment`. Build `reportStackCoherence` (the phase-boundary I/O: pure check → label + comment, never blocking).

### Phase 3: Integration — wire into the unit-test phase
Call `reportStackCoherence(config)` once at the top of `executeUnitTestPhase` (before the gate), export the reporter from `phases/index.ts`, update the README structure listing, and run the full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 0: Restore the contaminated worktree baseline
- This worktree starts with **stray uncommitted changes unrelated to #581** that actively **revert merged work from #579** (polymorphic step-def descriptor generation): `git status` shows `M .claude/commands/adw_init.md`, `M .claude/commands/generate_step_definitions.md`, `M .claude/commands/scenario_writer.md`, `M README.md`.
- Inspect them (`git diff`): the working-tree `scenario_writer.md` **deletes** the "Scenario format — Gherkin mandate" section and re-introduces the "Detect or bootstrap E2E tool" behavior the PRD explicitly removed; `adw_init.md` strips its init-time `adw:unverified` fallback flagging; `generate_step_definitions.md` is de-polymorphized. These contradict the merged #579 + parent PRD direction and are **not** part of #581.
- Restore the committed baseline before doing anything else:
  `git checkout -- .claude/commands/adw_init.md .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md README.md`
- Verify `git status` is clean and `adw_init.md` still contains its init-time `adw:unverified` fallback-flagging block (the complementary init-time defense this runtime check backs up — do **not** remove it).

### Step 1: Add `isGherkinFramework` to `stepDefDetection.ts`
- In `adws/core/stepDefDetection.ts`, add:
  ```ts
  export function isGherkinFramework(framework: string): boolean {
    const normalized = framework.trim().toLowerCase();
    if (normalized === '') return true; // empty ⇒ default cucumber-js ⇒ Gherkin
    return normalized in FRAMEWORK_EXTENSION_MAP;
  }
  ```
- Reuse the existing `FRAMEWORK_EXTENSION_MAP` (keys: `cucumber-js`, `cucumber`, `behave`, `pytest-bdd`, `godog`, `cucumber-rs`, `cucumber-ruby`) — do **not** introduce a second framework list. This keeps the Gherkin set and the extension map in lockstep.

### Step 2: Create the pure `stackCoherenceCheck` module
- Create `adws/core/stackCoherenceCheck.ts`. Public surface:
  ```ts
  export interface StackCoherenceInput {
    testFramework: string;        // commands.testFramework, e.g. 'vitest', 'pytest', ''
    bddFramework: string;         // scenarios.bddFramework, e.g. 'cucumber-js', 'behave', ''
    runTests: string;             // commands.runTests, e.g. 'bun run test:unit', 'pytest tests'
    runScenariosByTag: string;    // commands.runScenariosByTag, e.g. 'cucumber-js --tags "@{tag}"'
  }
  export type StackCoherenceWarningCode = 'language-mismatch' | 'non-gherkin-bdd';
  export interface StackCoherenceWarning { code: StackCoherenceWarningCode; message: string; }
  export interface StackCoherenceResult { ok: boolean; warnings: StackCoherenceWarning[]; }
  export function stackCoherenceCheck(input: StackCoherenceInput): StackCoherenceResult;
  ```
- **Language inference** (internal, not exported): a single `inferLanguage(text: string): StackLanguage | null` where `StackLanguage = 'javascript' | 'python' | 'go' | 'rust' | 'ruby'`. Lowercase the input and scan an **ordered** list of `[token, language]` pairs, returning the first contained token's language, else `null`. Order **specific tokens before generic** so hyphenated names resolve correctly:
  - `cucumber-js`→js, `cucumber-ruby`→ruby, `cucumber-rs`→rust, `pytest-bdd`→python (specific first)
  - then `pytest`→python, `behave`→python, `tox`→python, `python`→python
  - `godog`→go, `go test`→go
  - `cargo`→rust
  - `rspec`→ruby, `bundle`→ruby, `rake`→ruby
  - `vitest`/`jest`/`mocha`/`jasmine`→js, `bun`/`bunx`/`npm`/`npx`/`pnpm`/`yarn`/`node`/`tsx`→js
  - `cucumber`→js (generic, **last**)
  - Anything unrecognized ⇒ `null` (critically: prevents false positives from unknown frameworks/commands).
- **Gherkin-mandate check**: `if (input.bddFramework.trim() !== '' && !isGherkinFramework(input.bddFramework))` push a `non-gherkin-bdd` warning, e.g.: `BDD framework 'jest' is not a recognized Gherkin-based runner. ADW mandates Gherkin .feature scenarios; a non-Gherkin runner breaks the promotion / per-issue-sweep / vocabulary subsystems.`
- **Language-coherence check**: compute `inferLanguage` for each of the four signals; collect the **distinct non-null** languages into a set. If `size > 1`, push a `language-mismatch` warning whose message names each contributing signal and its inferred language, e.g.: `Detected stack spans multiple languages — testFramework 'pytest'→python, bddFramework 'cucumber-js'→javascript, runScenariosByTag 'cucumber-js --tags …'→javascript. adw_init likely mis-detected the BDD runner (it defaults to cucumber-js on non-recognition); confirm .adw/commands.md and .adw/scenarios.md.`
- Return `{ ok: warnings.length === 0, warnings }`.
- Keep it guard-clause / declarative (coding guidelines: max nesting depth ~2, pure, explicit types, file well under 300 lines). Import `isGherkinFramework` from `./stepDefDetection`.

### Step 3: Re-export from `adws/core/index.ts`
- Add, mirroring the existing `testVerdict` block:
  ```ts
  // Stack coherence check
  export type { StackCoherenceInput, StackCoherenceResult, StackCoherenceWarning, StackCoherenceWarningCode } from './stackCoherenceCheck';
  export { stackCoherenceCheck } from './stackCoherenceCheck';
  ```
- Add `isGherkinFramework` to the existing step-def detection re-export line:
  `export { stepDefExtensionsFor, hasStepDefinitions, isGherkinFramework } from './stepDefDetection';`

### Step 4: Add `stackCoherenceCheck` unit tests (all branches)
- Create `adws/core/__tests__/stackCoherenceCheck.test.ts` (Vitest, `describe`/`it`, no mocks). Cover at minimum:
  - **Coherent JS/TS (ADW-self regression guard)** — `{ testFramework:'vitest', runTests:'bun run test:unit', bddFramework:'cucumber-js', runScenariosByTag:'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"' }` ⇒ `ok:true`, `warnings:[]`.
  - **Coherent Python** — `{ testFramework:'pytest', runTests:'pytest tests', bddFramework:'behave', runScenariosByTag:'behave --tags @{tag}' }` ⇒ `ok:true`.
  - **Incoherent (US22)** — `{ testFramework:'pytest', runTests:'pytest tests', bddFramework:'cucumber-js', runScenariosByTag:'cucumber-js --tags "@{tag}"' }` ⇒ `ok:false`, exactly one `language-mismatch` warning (python vs javascript).
  - **Non-Gherkin bddFramework** — `{ ..., bddFramework:'playwright' }` (or `'jest'`) ⇒ `ok:false`, a `non-gherkin-bdd` warning.
  - **Both warnings at once** — `{ testFramework:'pytest', runTests:'pytest', bddFramework:'mocha', runScenariosByTag:'mocha' }` ⇒ `ok:false`, **both** `non-gherkin-bdd` (mocha ∉ Gherkin set) **and** `language-mismatch` (python vs javascript).
  - **Empty bddFramework is the Gherkin default** — `{ testFramework:'vitest', runTests:'bun test', bddFramework:'', runScenariosByTag:'cucumber-js --tags …' }` ⇒ `ok:true` (empty ⇒ no non-gherkin warning; all known langs are javascript).
  - **No false positive from unknown signals** — `{ testFramework:'someframework', runTests:'make test', bddFramework:'cucumber-js', runScenariosByTag:'cucumber-js …' }` ⇒ `ok:true` (only known language is javascript; unknown tokens infer `null`).
  - **All-default/empty** — `{ testFramework:'', runTests:'', bddFramework:'', runScenariosByTag:'' }` ⇒ `ok:true`.
- Assert on `result.ok`, `result.warnings.length`, and `warnings[].code` (public surface only — no private-helper assertions).

### Step 5: Extend `stepDefDetection` tests for `isGherkinFramework`
- In `adws/core/__tests__/stepDefDetection.test.ts`, add cases: every `FRAMEWORK_EXTENSION_MAP` key ⇒ `true`; `''` ⇒ `true`; whitespace-only ⇒ `true`; case/whitespace-insensitive known key (e.g. `' Cucumber-JS '`) ⇒ `true`; an unknown non-empty value (e.g. `'jest'`, `'playwright'`) ⇒ `false`.

### Step 6: Add the `stack_incoherent` workflow stage + comment
- In `adws/types/workflowTypes.ts`, add `| 'stack_incoherent'` to the `WorkflowStage` union (near `'unverified'`), with a comment noting it is a comment-stage discriminator only (never persisted as `workflowStage`).
- In `adws/github/workflowCommentsIssue.ts`:
  - Add `coherenceWarnings?: string[];` to `WorkflowContext` (the human-readable warning messages to render).
  - Add `formatStackIncoherentComment(ctx)`: a `## :warning: ADW Unverified — Stack Coherence` heading; a one-line explanation that the detected test/BDD configuration appears incoherent and `adw_init` may have mis-detected the stack (it falls back to `cucumber-js` on non-recognition); a bulleted list of `ctx.coherenceWarnings`; a "**Non-blocking** — the workflow continued and the PR is marked `adw:unverified`" note; a "**Next steps:** confirm `## Test Framework` / `## Run Tests` in `.adw/commands.md` and `## BDD Framework` in `.adw/scenarios.md`" line; then `**ADW ID:** ...`, `formatRunningTokenFooter(ctx.runningTokenTotal)`, `ADW_SIGNATURE` exactly like the sibling formatters. Keep the copy distinct from `formatUnverifiedComment` (which is specifically about zero testcases).
  - Add `case 'stack_incoherent': return formatStackIncoherentComment(ctx);` to `formatWorkflowComment`.

### Step 7: Create the `reportStackCoherence` reporter
- Create `adws/phases/stackCoherenceReporter.ts` exporting `reportStackCoherence(config: WorkflowConfig): void`. Behavior:
  - Build the input from config: `{ testFramework: commands.testFramework, bddFramework: scenarios.bddFramework, runTests: commands.runTests, runScenariosByTag: commands.runScenariosByTag }` (where `commands = config.projectConfig.commands`, `scenarios = config.projectConfig.scenarios`).
  - `const result = stackCoherenceCheck(input);` — **guard clause:** `if (result.ok) return;` (coherent ⇒ silent, no label, no comment).
  - `const messages = result.warnings.map(w => w.message);` `log(...)` a one-line `warn` and `AgentStateManager.appendLog(config.orchestratorStatePath, ...)`.
  - Wrap the I/O in `try { ... } catch (e) { log(...) }` so it can **never** throw out of the phase:
    - `const repoInfo = config.targetRepo ? { owner: config.targetRepo.owner, repo: config.targetRepo.repo } : getRepoInfo();`
    - `applyLabel(config.issueNumber, ADW_UNVERIFIED_LABEL, repoInfo);`
    - `config.ctx.coherenceWarnings = messages;`
    - `if (config.repoContext) postIssueStageComment(config.repoContext, config.issueNumber, 'stack_incoherent', config.ctx);`
  - **No `process.exit`, no re-throw** — this is the structural guarantee of "never blocks."
  - Imports: `stackCoherenceCheck` + `log` + `AgentStateManager` from `../core`; `applyLabel, ADW_UNVERIFIED_LABEL` from `../github/labelManager`; `getRepoInfo` from `../github/githubApi`; `postIssueStageComment` from `./phaseCommentHelpers`; `WorkflowConfig` from `./workflowInit` (type-only).

### Step 8: Wire the reporter into `executeUnitTestPhase`
- In `adws/phases/unitTestPhase.ts`, import `reportStackCoherence` from `./stackCoherenceReporter`.
- Call `reportStackCoherence(config);` near the **top** of `executeUnitTestPhase`, **before** the `const unitTestsEnabled = adwYmlConfig.unitTests;` gate (so the coherence check runs once per workflow even when unit tests are opted out). Place it after the existing `moveToStatus` block to keep board status first.
- Make no other change to the phase; the existing zero-testcase `unverified` path is untouched (the two unverified signals are independent and may both fire — both apply the idempotent `adw:unverified` label and each posts its own distinct comment).

### Step 9: Export the reporter + update the README
- In `adws/phases/index.ts`, add `export { reportStackCoherence } from './stackCoherenceReporter';`.
- In `README.md`, add to the Project Structure listing (under `adws/core/`): `stackCoherenceCheck.ts` (pure stack-coherence check — language coherence + Gherkin mandate) and its `__tests__/stackCoherenceCheck.test.ts`; and under `adws/phases/`: `stackCoherenceReporter.ts` (warns via the `adw:unverified` channel on an incoherent detected config). Match the surrounding annotation style.

### Step 10: Run the Validation Commands
- Run every command in the **Validation Commands** section below and confirm zero errors and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope and are an explicit acceptance criterion ("`stackCoherenceCheck` … unit-tested"). Follow the existing pure-function conventions (Vitest, `describe`/`it`, public-interface assertions only) seen in `testVerdict.test.ts` and `stepDefDetection.test.ts`.

- **`stackCoherenceCheck` (`adws/core/__tests__/stackCoherenceCheck.test.ts`)** — table-driven over coherent and incoherent inputs (Step 4): coherent JS/TS (ADW-self guard), coherent Python, incoherent Python+cucumber-js (US22) ⇒ one `language-mismatch`, non-Gherkin `bddFramework` ⇒ `non-gherkin-bdd`, combined (both warnings), empty `bddFramework` ⇒ Gherkin default ⇒ ok, unknown signals ⇒ no false positive, all-empty ⇒ ok. Assert `result.ok`, `warnings.length`, and `warnings[].code`.
- **`isGherkinFramework` (`adws/core/__tests__/stepDefDetection.test.ts`)** — every Gherkin key ⇒ `true`; empty/whitespace ⇒ `true`; case-insensitive known key ⇒ `true`; unknown non-empty ⇒ `false` (Step 5).

The reporter (`reportStackCoherence`) and the comment formatter are I/O / formatting at the phase boundary; per the project's testing guidelines (BDD is the validation surface for wired behavior; unit tests target pure deep modules), they are exercised by the SDLC's own scenario phase and the standard validation run rather than by bespoke unit tests with GitHub mocks. The pure decision (`stackCoherenceCheck`) carries the unit-test burden.

### Edge Cases
- **Coherent config (JS/TS or Python)** — `ok:true`; no label, no comment, no log noise beyond the silent return.
- **Incoherent (Python stack + cucumber-js run command, US22)** — `language-mismatch`; `adw:unverified` label applied + `stack_incoherent` comment posted; **workflow continues** (no exit).
- **Non-Gherkin `bddFramework`** (e.g. `jest`, `playwright`) — `non-gherkin-bdd` warning through the same channel.
- **Empty `bddFramework`** — treated as the `cucumber-js` Gherkin default: **no** `non-gherkin-bdd` warning, and it contributes **no** language to the coherence set (no false mismatch).
- **Unknown / unrecognized `testFramework` or run command** — infers `null` language and is excluded from the distinct-language set, so it never fabricates a mismatch.
- **Whitespace-only fields** — `.trim()` guards treat them as empty/unknown.
- **`adw:unverified` label not yet on the repo** — `applyLabel` lazy-creates it (existing not-found fallback); the warn path never crashes.
- **GitHub comment/label failure** — the reporter's `try/catch` (and `postIssueStageComment`'s own swallow) ensure the workflow continues; a failed warning is logged, never fatal.
- **Runs exactly once per workflow** — wired into `executeUnitTestPhase` (single call per orchestrator), **not** the scenario-test phase (which runs in retry loops) — so no duplicate comments within a run.
- **`unitTests: false` opt-out** — the coherence check still runs (placed before the gate); defense-in-depth must not depend on the unit-test opt-out.
- **Plan-only orchestrators (`adwPlan`)** — do not run the unit-test phase, so the runtime check does not fire there; `adw_init`'s init-time fallback flag remains the bootstrap-time signal for those paths (acceptable: the check is a test-layer safety net, per the PRD "Proof layer").

## Acceptance Criteria
- `stackCoherenceCheck` returns `{ ok: true, warnings: [] }` for coherent detected configs and `{ ok: false, warnings: [...] }` for incoherent ones, covered by table-driven unit tests over both new checks.
- A non-Gherkin `bddFramework` (non-empty, not in the recognized Gherkin set) is flagged as a `non-gherkin-bdd` warning; an empty `bddFramework` (the `cucumber-js` default) is **not** flagged.
- An incoherent detected config (e.g. a Python `testFramework`/`runTests` with a `cucumber-js` `bddFramework`/scenario run command) produces a `language-mismatch` warning.
- On any warning, the workflow applies the `adw:unverified` label and posts a self-explanatory `stack_incoherent` issue comment listing the incoherences.
- The check **never blocks**: `reportStackCoherence` performs no `process.exit` and cannot throw out of the phase; the workflow proceeds to the next phase in all warning cases.
- The check runs **exactly once per workflow**, wired into `executeUnitTestPhase` (not the retry-looped scenario phase), and runs even when the unit-test gate is opted out.
- ADW-self's own descriptor (`vitest` + `cucumber-js`, all JavaScript, Gherkin) returns `ok: true` (no self-warning) — asserted in the unit tests.
- No `adw_init.md` change, no `.adw-version` bump (this is framework-resident consumer code); the Step 0 contamination is not reintroduced.
- All validation commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint over application + ADW code (code quality, unused imports).
- `bunx tsc --noEmit` — type-check the application (root tsconfig).
- `bunx tsc --noEmit -p adws/tsconfig.json` — type-check the ADW scripts (catches the new module, the `WorkflowStage` addition, the `WorkflowContext` field, and the reporter wiring types).
- `bun run build` — verify the build compiles with no errors.
- `bun run test:unit` — run the full Vitest suite (must pass with zero regressions, including the new `stackCoherenceCheck.test.ts` and the extended `stepDefDetection.test.ts`).
- `bunx vitest run adws/core/__tests__/stackCoherenceCheck.test.ts adws/core/__tests__/stepDefDetection.test.ts` — focused run proving the coherence branches and the `isGherkinFramework` predicate all pass.
- `git diff --stat` — confirm only intended files changed and the Step 0 contamination (`adw_init.md` / `generate_step_definitions.md` / `scenario_writer.md` reverts) is **not** reintroduced.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply: keep `stackCoherenceCheck` a pure deep module (no I/O, explicit types, guard-clause flattening, max nesting depth ~2, file well under 300 lines); isolate the label/comment side effects at the `reportStackCoherence` phase boundary; reuse `FRAMEWORK_EXTENSION_MAP` via `isGherkinFramework` rather than duplicating the Gherkin set.
- **No new libraries required** — all changes use existing modules (`gh` via `applyLabel`/`execWithRetry`, the comment helpers, Vitest). Library install command for reference (`.adw/commands.md`): `bun add <package>`.
- **No hash propagation — this is the key contrast with #577.** This feature is a **consumer** of descriptor fields `adw_init` already emits (`## Test Framework`, `## BDD Framework`, run commands). It changes **framework-resident code only** (`adws/core`, `adws/phases`, `adws/github`, `adws/types`), which is **not** a `hashInputs:` file, so it must **not** edit `.claude/commands/adw_init.md` and does **not** raise `.adw-version` or trigger `adwUpgrade`. It takes effect immediately on merge (PRD "Further Notes → Hash propagation": "Framework code (`projectConfig`, `scenarioProof`) … take effect immediately on merge because they are framework-resident").
- **Defense-in-depth, not replacement.** `adw_init.md` already raises `adw:unverified` at **init time** when it falls back to `cucumber-js` for a recognized non-JS/TS stack. This issue adds a **runtime** check that also catches configs `adw_init` mis-detected confidently or that drifted after bootstrap, and adds the **Gherkin-mandate** assertion that nothing checks at runtime today. Step 0 preserves the init-time block; do not remove it.
- **Why the unit-test phase, not the scenario phase.** `adwSdlc.tsx` calls `executeScenarioTestPhase` inside the scenario-fix loop and again inside the review-patch loop (up to `MAX_TEST_RETRY_ATTEMPTS` + `MAX_REVIEW_RETRY_ATTEMPTS` times); wiring the comment there would post duplicates. `executeUnitTestPhase` is called once per orchestrator and already hosts the `adw:unverified` channel, so it is the correct once-per-workflow home. On pause/resume a completed unit-test phase is skipped, so the comment is not re-posted; an interrupted-then-resumed run could re-post — acceptable for a warn channel and not worth a dedup guard.
- **New comment stage vs. reusing `unverified`.** A dedicated `stack_incoherent` stage is used (not the existing zero-testcase `unverified` comment) so the message is accurate and self-explanatory ("warn loud"). Both share the single `adw:unverified` **label**, satisfying "Mismatch emits `adw:unverified` comment + label."
- **Language inference is intentionally conservative.** Unknown tokens infer `null` and never contribute to the distinct-language set, so the check biases toward **no false positives** — it only warns when at least two *recognized, conflicting* languages appear. This keeps the loud signal trustworthy (fix-forward depends on it, per PRD "Out of Scope").
- **Future consideration.** When PR 2's proof publisher / screenshot harvest (#580) lands, the `language-mismatch` and `non-gherkin-bdd` warnings could additionally surface in the PR proof comment; the pure `stackCoherenceCheck` result shape is stable and reusable for that without change.
