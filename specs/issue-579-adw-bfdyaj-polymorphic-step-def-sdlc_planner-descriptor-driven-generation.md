# Feature: Polymorphic step-def + scenario generation on the descriptor

## Metadata
issueNumber: `579`
adwId: `bfdyaj-polymorphic-step-def`
issueJson: `{"number":579,"title":"Polymorphic step-def + scenario generation on the descriptor","body":"## Parent PRD\n\n`specs/prd/multi-language-test-and-bdd-support.md`\n\n## What to build\n\nMake generation language-agnostic. Parse `bddFramework`/`stepDefDirectory`; ```adw_init``` emits them; rewrite `generate_step_definitions.md` and `scenario_writer.md` to be polymorphic on the descriptor (relying on Claude's knowledge of the named BDD framework — no per-language prompt files, no enum, no code provider). Remove `scenario_writer`'s cucumber-bootstrap-on-N/A behavior. The generated scenarios are run once as the correctness guardrail. See PRD Implementation Decisions → Architecture & Prompts modified.\n\n**Gherkin mandate (see PRD → Implementation Decisions → Scenario format).** The scenario format is fixed to Gherkin `.feature` for every language; only the step-def runtime varies. ```adw_init``` selects a Gherkin-based runner for the detected language (Ruby→cucumber-ruby, Python→behave/pytest-bdd, Rust→cucumber-rs, Go→godog, …) and **never emits a non-Gherkin `bddFramework`**; if it cannot identify a Gherkin runner for the stack it falls back to a Gherkin runner (today's cucumber-js for TS) rather than a native test framework, and flags via the unverified channel. This keeps the Gherkin-coupled promotion/per-issue-sweep/vocabulary subsystems working without per-language parsers.\n\n## Acceptance criteria\n\n- [ ] `bddFramework`/`stepDefDirectory` parsed with backward-compatible defaults\n- [ ] Generation prompts emit step defs in the configured framework + directory (verified against Python/pytest-bdd)\n- [ ] cucumber-bootstrap-on-N/A removed\n- [ ] Adding a new language requires no framework code change (descriptor-driven)\n- [ ] ```adw_init``` only ever emits a Gherkin-based `bddFramework`; falls back to a Gherkin runner (never a native non-Gherkin runner) when the stack is unrecognized, and flags via the unverified channel\n- [ ] Generated scenarios remain Gherkin `.feature` regardless of target language (per-issue-sweep / promotion / vocabulary parsers unaffected)\n\n## Blocked by\n\n- Blocked by #578\n\n## User stories addressed\n\n- User story 6\n- User story 7\n- User story 8\n- User story 30\n- User story 31\n\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-15T11:51:22Z","comments":[{"author":"paysdoc","createdAt":"2026-06-16T19:29:27Z","body":"## "},{"author":"paysdoc","createdAt":"2026-06-16T19:29:45Z","body":"## Continue\n"}],"actionableComment":null}`

## Feature Description

Make ADW's BDD generation step language-agnostic so it produces correct step definitions and scenarios for any Gherkin-based stack (Python, Go, Rust, Ruby, JVM, .NET, … as well as today's TypeScript), with **zero framework code change per language**.

The locus of per-language variation is a **detected descriptor** (`bddFramework` + `stepDefDirectory` in `.adw/scenarios.md`) consumed by **a single polymorphic prompt per generation step**, leaning on Claude's own knowledge of the *named* BDD framework rather than per-language prompt files, a stack enum, or a code provider. The blocker issue (#578) already shipped the parsing seam and the runtime detection that consume the descriptor; this feature delivers the **generation half**:

1. Rewrite `.claude/commands/generate_step_definitions.md` so it reads `## BDD Framework` + `## Step Def Directory` from `.adw/scenarios.md` and emits step definitions in that framework's idiom, written to that directory — instead of being hardcoded to cucumber-js / `@cucumber/cucumber` / `bunx tsc` / Node `assert` / `.ts`.
2. Rewrite `.claude/commands/scenario_writer.md` to remove the "detect or bootstrap a Cucumber setup when E2E is N/A" behavior, and to state the **Gherkin mandate** explicitly: scenarios are always Gherkin `.feature`; runner selection belongs to `adw_init`.
3. Refine `.claude/commands/adw_init.md` so that when it cannot identify a proper Gherkin runner for the detected stack and falls back to cucumber-js, it **flags via the unverified channel** (`adw:unverified` label + issue comment) rather than silently defaulting.
4. Align `adws/README.md` documentation with the descriptor-driven, Gherkin-always model (remove the bootstrap / `## Run E2E Tests` file-format-resolution wording).

The **value**: pointing ADW at a non-TypeScript target (the motivating case is a flat-layout Python/Flask repo) yields correctly-wired step definitions in the target's BDD framework, run once by the existing scenario-test phase as the correctness guardrail — instead of silently emitting unusable `.ts` step defs or bootstrapping cucumber-js into a Python project.

## User Story

As an **ADW operator targeting a non-TypeScript repository (Python first; Go/Rust/Ruby without a framework change)**
I want to **have step definitions generated in my target language's BDD framework and have generated scenarios run once as a guardrail**
So that **scenarios are wired correctly for pytest-bdd / godog / cucumber-rs / cucumber-js alike, and incorrect generation surfaces as a failing run rather than silently shipping — while my existing TypeScript repos keep behaving exactly as before.**

## Problem Statement

ADW's BDD generation prompts are hardcoded to a Bun / TypeScript / cucumber-js stack:

- `generate_step_definitions.md` instructs the agent to import `Given/When/Then` from `@cucumber/cucumber`, write `.ts` files under `features/step_definitions/`, assert with Node.js `assert`, and type-check with `bunx tsc --noEmit`. Pointed at a Python target it would emit unusable TypeScript step defs (or nothing the Python runner can load) — a silent-green class of failure.
- `scenario_writer.md` (Step 2) "detects or bootstraps a Cucumber setup" whenever `## Run E2E Tests` is absent or `n/a`. Because `adw_init` no longer emits `## Run E2E Tests` at all (the field was removed from `CommandsConfig` in prior cleanup), that section is now **always absent**, so this branch would attempt to install `@cucumber/cucumber` into *every* target — including non-JS repos where that is wrong.
- `adw_init.md` already emits a Gherkin `bddFramework` and falls back to cucumber-js on non-recognition, but does so **silently** — there is no loud signal when the fallback is a poor fit for the detected stack, so a mis-detection ships unnoticed.

The descriptor parsing (`bddFramework` / `stepDefDirectory`), the framework→extension detection (`stepDefDetection.ts`), and the runtime consumption in `scenarioTestPhase` / `scenarioProof` already exist (delivered by blocker #578). What is missing is making the **generation prompts** honor that descriptor, removing the bootstrap behavior, and making the `adw_init` fallback loud.

## Solution Statement

Adopt the PRD's **detected-descriptor + one-polymorphic-prompt** seam for the two generation prompts, with no new per-language code, no enum, and no `BddProvider` registry (all explicitly rejected by the PRD):

- `generate_step_definitions.md` becomes polymorphic: it reads `## BDD Framework` and `## Step Def Directory` from `.adw/scenarios.md` (defaulting to `cucumber-js` + `features/step_definitions` for backward compatibility), then relies on Claude's knowledge of that *named* framework to emit idiomatic step definitions (correct import/registration mechanism, file extension, and assertion style) into the configured directory. Verification is made framework-appropriate, and the existing scenario-test phase remains the real correctness guardrail (it already detects step defs by the descriptor's extension).
- `scenario_writer.md` drops the cucumber-bootstrap-on-N/A behavior entirely and states the **Gherkin mandate**: every scenario is written as Gherkin `.feature` regardless of target language; the step-def runtime is chosen by `adw_init` and recorded in `## BDD Framework`; `scenario_writer` never installs or configures a runner.
- `adw_init.md` keeps its existing "only ever emit a Gherkin `bddFramework`, fall back to cucumber-js" logic and **adds the unverified flag**: when it falls back to cucumber-js because it could not identify a Gherkin runner for a recognized non-JS/TS stack (or an unrecognized stack), it applies the `adw:unverified` label and posts an issue comment, and records the fallback in its report.
- `adws/README.md` is updated to describe the descriptor-driven, Gherkin-always model and remove the now-obsolete bootstrap / `## Run E2E Tests` file-format-resolution text.

Because the generation prompts carry `target: false` frontmatter they are framework-resident and take effect immediately on merge (they are **not** hash inputs). `adw_init.md` **is** a `hashInputs:` file, so editing it raises `.adw-version` and triggers `adwUpgrade` to regenerate `.adw/` across registered targets — the intended emit-parse propagation. No new parsed `.adw/` fields are introduced, so the emit-parse coupling rule is already satisfied by `adw_init`'s existing emission of `## BDD Framework` / `## Step Def Directory`.

## Relevant Files

Use these files to implement the feature:

- `.claude/commands/generate_step_definitions.md` — **Primary rewrite.** Currently fully cucumber-js/TS-hardcoded (title "Cucumber step definitions", `@cucumber/cucumber` imports, `.ts` files, `bunx tsc --noEmit` verification, Node `assert`). Must become polymorphic on `## BDD Framework` + `## Step Def Directory`.
- `.claude/commands/scenario_writer.md` — **Primary rewrite.** Remove Step 2 ("Detect or bootstrap E2E tool") and the Step 1 line that reads `## Run E2E Tests`; add an explicit Gherkin-mandate statement. Keep per-issue directory resolution, rot-prevention, vocabulary preference, and the `@regression` sweep gating.
- `.claude/commands/adw_init.md` — **Edit (hash input).** Step 7 already emits `## BDD Framework` / `## Step Def Directory` and falls back to cucumber-js; add the "flag via the unverified channel" behavior on fallback, plus a step-8 report note. Editing this file raises `.adw-version`.
- `adws/core/projectConfig.ts` — **Reference (no change expected).** Already parses `bddFramework` (default `''`) and `stepDefDirectory` (default `features/step_definitions`) with backward-compatible defaults via `parseScenariosMd` / `getDefaultScenariosConfig`. Confirms AC1 is satisfied at the parser layer.
- `adws/core/stepDefDetection.ts` — **Reference + small test gap.** `stepDefExtensionsFor` maps Gherkin frameworks → extensions (cucumber-js/cucumber→.ts/.js, behave/pytest-bdd→.py, godog→.go, cucumber-rs→.rs, cucumber-ruby→.rb; unknown→`.ts`). `hasStepDefinitions` recurses a directory for matching extensions. Underpins AC4/AC6 detection; covers all languages named in the issue.
- `adws/phases/scenarioTestPhase.ts` — **Reference (no change).** Already calls `stepDefExtensionsFor(bddFramework)` and passes `stepDefDirectory` into `runScenarioProof`. This is the "generated scenarios run once as the correctness guardrail" — already wired to the descriptor.
- `adws/phases/scenarioProof.ts` — **Reference (no change).** Uses `hasStepDefinitions(stepDefDirectory, stepDefExtensions, cwd)` so the `.ts`-only gate is already gone.
- `adws/agents/stepDefAgent.ts` / `adws/phases/stepDefPhase.ts` — **Reference (no change).** Thin wrappers that invoke `/generate_step_definitions` with `[issueNumber, adwId]`; all polymorphism lives in the prompt, so no TS change is required here.
- `adws/github/labelManager.ts` — **Reference.** `ADW_UNVERIFIED_LABEL = 'adw:unverified'` is the label the AC5 fallback flag must apply. Confirms the unverified channel exists.
- `adws/github/workflowCommentsIssue.ts` — **Reference.** `formatUnverifiedComment` + `postIssueStageComment(..., 'unverified', ...)` is the existing precedent for the unverified comment; the `adw_init` flag mirrors its intent (loud PR/issue signal).
- `.adw/scenarios.md` — **Reference.** This repo's own descriptor already declares `## BDD Framework: cucumber-js` and `## Step Def Directory: features/step_definitions`; used to verify the polymorphic prompt's default/backward-compatible path on the ADW-self suite.
- `adws/README.md` (≈ lines 766, 859–865) — **Edit (docs).** Remove `## Run E2E Tests` from the `commands.md` list and replace the "Scenario file format resolution" / bootstrap wording with the Gherkin-always + `## BDD Framework` / `## Step Def Directory` description.
- `adws/core/__tests__/stepDefDetection.test.ts` — **Edit (tests).** Add the `cucumber-ruby → ['.rb']` case (named in the issue) and a backward-compat default assertion if not already present.
- `adws/core/__tests__/projectConfig.test.ts` — **Reference.** Already covers `stepDefDirectory`/`bddFramework` parsing + defaults (AC1).
- `specs/prd/multi-language-test-and-bdd-support.md` — **Reference.** Implementation Decisions → Architecture, Scenario format (Gherkin mandate), Prompts modified, and the "hash propagation / emit-parse coupling rule".
- `cucumber.js` — **Reference.** `paths` includes `features/per-issue/**/*.feature` and imports `features/per-issue/step_definitions/**/*.ts`, so a `@adw-579` per-issue scenario is runnable by tag for validation.

### New Files

- `features/per-issue/feature-579.feature` — Per-issue BDD scenario(s) tagged `@adw-579` asserting the **descriptor-driven detection contract** through public interfaces: (a) a configured non-TS `bddFramework` (e.g. `pytest-bdd` + `features/steps`) flows into extension-based step-def detection, and (b) an absent descriptor defaults to cucumber-js/`.ts`/`features/step_definitions` (backward compatibility). Asserts loader/detector **return values** on fixture **inputs** — permitted under the rot-prevention rule (no source-file-content assertions).
- `features/per-issue/step_definitions/feature-579.steps.ts` — Step definitions for the above, driving `loadProjectConfig` / `parseScenariosMd` / `stepDefExtensionsFor` / `hasStepDefinitions` against temp-dir fixtures (mirrors the pattern in `stepDefDetection.test.ts`).

## Implementation Plan

### Phase 1: Foundation
Confirm and lock in the descriptor seam that #578 delivered, so the generation rewrite has a verified base:
- Verify `parseScenariosMd` / `getDefaultScenariosConfig` expose `bddFramework` (default `''`) and `stepDefDirectory` (default `features/step_definitions`) with backward-compatible defaults (AC1 — already implemented and tested).
- Verify `stepDefExtensionsFor` covers every framework named in the issue (cucumber-js, behave, pytest-bdd, godog, cucumber-rs, cucumber-ruby) and that unknown/empty falls back to `.ts` (AC4/AC6 detection). Close the one test gap (`cucumber-ruby`).
- Confirm `scenarioTestPhase` / `scenarioProof` already consume `bddFramework` + `stepDefDirectory` (the "run once as guardrail" runtime) — no change needed.

### Phase 2: Core Implementation
Rewrite the two generation prompts to be polymorphic on the descriptor:
- `generate_step_definitions.md`: read the descriptor, generate idiomatic step defs in the named framework, write to the configured directory, verify framework-appropriately, keep the JSON output contract, vocabulary-registry validation, and the (now framework-agnostic) duplicate-step guard.
- `scenario_writer.md`: remove the cucumber-bootstrap-on-N/A path, state the Gherkin mandate, keep everything else (per-issue routing, rot-prevention, vocabulary preference, `@regression` sweep gating).

### Phase 3: Integration
Wire the loud-fallback signal and align docs + acceptance guards:
- `adw_init.md`: add the unverified-channel flag on cucumber-js fallback (AC5); add the step-8 report note. (Raises `.adw-version` → regen propagation.)
- `adws/README.md`: replace bootstrap / `## Run E2E Tests` wording with the descriptor-driven Gherkin-always model.
- Add the `@adw-579` per-issue scenario + step defs and the `cucumber-ruby` unit-test case as regression guards for the descriptor seam.
- Run the full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Verify the descriptor parsing + detection base (no code change expected)
- Read `adws/core/projectConfig.ts` and confirm `ScenariosConfig` includes `bddFramework` and `stepDefDirectory`, that `SCENARIOS_HEADING_TO_KEY` maps `'bdd framework'` and `'step def directory'`, and that `getDefaultScenariosConfig()` returns `bddFramework: ''` and `stepDefDirectory: 'features/step_definitions'`.
- Read `adws/core/stepDefDetection.ts` and confirm the framework→extension map and the `.ts` default.
- If any of the above is missing (e.g. a divergence from #578), stop and reconcile before proceeding — the prompts depend on these.

### 2. Rewrite `.claude/commands/generate_step_definitions.md` to be polymorphic
- Keep the `---\ntarget: false\n---` frontmatter (framework-resident, not hash-gated, not copied into targets).
- Generalize the agent's identity: "Step Definition Generator Agent … generate step definitions in the **configured BDD framework**" (drop "Cucumber" from the title/intro).
- In **Step 1 (Read configuration)**: in addition to the scenario directory and `## Vocabulary Registry`, read:
  - `## BDD Framework` from `.adw/scenarios.md` — the named Gherkin step-def runtime (e.g. `cucumber-js`, `behave`, `pytest-bdd`, `godog`, `cucumber-rs`, `cucumber-ruby`). **Default to `cucumber-js`** when absent (backward compatible).
  - `## Step Def Directory` from `.adw/scenarios.md` — where step-def files are written. **Default to `features/step_definitions`** when absent. This **replaces** the hardcoded `<scenario-directory>/step_definitions/` derivation.
- Add a short **"Polymorphism on the BDD framework"** subsection stating: the prompt is polymorphic on `## BDD Framework`; rely on your own knowledge of that named framework to choose the correct import/registration mechanism, file extension, and assertion idiom; do **not** assume cucumber-js / TypeScript unless that is the configured framework. The scenario contract is always Gherkin `.feature`; only the step-def runtime varies.
- In **Step 3 (Read existing step definitions)** and **Step 6 (Generate)**: make framework-agnostic.
  - Read existing step-def files in `## Step Def Directory` regardless of extension; extract existing step phrases to avoid duplicate-pattern registration (still important across frameworks).
  - Generation guidance keyed on the configured framework instead of cucumber-js specifics: import/register Given/When/Then via the framework's mechanism (e.g. `@cucumber/cucumber` for cucumber-js, `behave`'s `@given/@when/@then` for behave, `pytest_bdd`'s `@scenario`/`@given` for pytest-bdd, `godog` step funcs for Go, `cucumber-rs` for Rust, etc.); write files with the framework's conventional extension into `## Step Def Directory`; use the framework's idiomatic assertion mechanism. Keep "one file per feature area preferred" and "never duplicate a step pattern".
- In **Step 5 (Test harness infrastructure)**: keep, but scope it as **conditional**: "When the target repo provides a mock-infrastructure layer (e.g. ADW's own `test/mocks/`), use it for scenarios that need runtime dependencies." Do not imply every target has TS mocks.
- In **Step 7 (Verify)**: make framework-appropriate.
  - Replace the hardcoded `bunx tsc --noEmit` step with: "Run a syntax/type sanity check appropriate to the configured framework's language (e.g. `bunx tsc --noEmit <file>` for cucumber-js/TS, `python -m py_compile <file>` for behave/pytest-bdd, `gofmt -l`/`go vet` for godog, etc.) **if such a check is available**; otherwise skip."
  - Generalize the "do not execute step files" caution: keep the cucumber-js-specific reason (top-level `Before/Given/When/Then` registration trips `checkInstall`) as an example, but state the general rule — never import/run step-def modules as a verification method; use a static syntax/type check only.
- Keep **Step 4 (Read implementation code)**, **Step 4a (Vocabulary registry validation)**, and **Step 8 (Output JSON contract)** intact — they are already framework-agnostic. The JSON output shape (`generatedFiles`, `removedScenarios: []`, `vocabularyViolations`) is unchanged.

### 3. Rewrite `.claude/commands/scenario_writer.md` to remove the bootstrap and state the Gherkin mandate
- Keep the `target: false` frontmatter.
- In **Step 1 (Read configuration)**: remove the line "Read `.adw/commands.md` and locate the `## Run E2E Tests` section." Keep `## Scenario Directory` / `## Per-Issue Scenario Directory` / `## Regression Scenario Directory` resolution exactly as is.
- **Delete Step 2 ("Detect or bootstrap E2E tool")** entirely (the install-cucumber-on-N/A behavior). Renumber subsequent steps (Parse the issue, Read existing scenarios, Write scenarios, `@regression` sweep, Output).
- Add a **"Scenario format — Gherkin mandate"** subsection near the top stating: every scenario is written as a Gherkin `.feature` file regardless of the target language; the step-def runtime is selected by `adw_init` and recorded in `## BDD Framework` in `.adw/scenarios.md`; `scenario_writer` **never** installs, configures, or bootstraps a runner. This is framework-owned and not overridable per repo (consistent with the existing "Universality" rule).
- Update the "Polymorphism on `.adw/scenarios.md`" preamble to reflect that the prompt no longer branches on E2E-tool detection (only the per-issue directory + `@regression` sweep branches remain).
- Leave Rot Prevention, Vocabulary preference, per-issue routing, `@adw-$0` tagging rules, the `@regression` sweep gating, and the Output section unchanged.

### 4. Add the unverified-channel flag to `.claude/commands/adw_init.md` (hash input)
- In **Step 7**, where E2E is `N/A`/absent/unrecognized and it falls back to cucumber-js: split the fallback into two cases.
  - **TS/JS target (or genuinely Gherkin-via-cucumber-js):** emit `## BDD Framework: cucumber-js` as today — this is the normal, expected default; **do not** flag.
  - **Recognized non-JS/TS stack for which no Gherkin runner could be confidently identified, OR an unrecognized stack:** still emit `## BDD Framework: cucumber-js` (never a native non-Gherkin runner), **and flag via the unverified channel** — apply the `adw:unverified` label and post an issue comment explaining that ADW could not identify a Gherkin runner for the detected stack and fell back to cucumber-js, so the BDD wiring is unverified and should be confirmed/fixed forward. Use the Bash tool with `gh` (label + `gh issue comment`), guarding on a valid numeric `$0` and tolerating failure (warn-not-fail), consistent with `adw_init`'s other `gh`/`depaudit` side-effects.
  - Reinforce explicitly: **never emit a non-Gherkin `bddFramework`** under any branch.
- In **Step 8 (Report)**: add a line recording the BDD-framework decision and whether the unverified flag was raised (`bddFramework: <value>`; unverified-fallback: `<raised | not raised>`; reason when raised).
- Note in the plan/PR that this edit raises `.adw-version` (it is a `hashInputs:` file) and therefore triggers `adwUpgrade` to regenerate `.adw/` across registered targets — the intended propagation; no new parsed field is added, so the emit-parse coupling rule is already satisfied.

### 5. Align `adws/README.md` with the descriptor-driven, Gherkin-always model
- Remove the `## Run E2E Tests` bullet from the `.adw/commands.md` section list (the field is no longer emitted or parsed).
- Replace the "Scenario file format resolution" subsection (the `## Run E2E Tests` real-command-vs-N/A bootstrap wording) with: scenarios are always Gherkin `.feature`; the step-def runtime is configured per repo via `## BDD Framework` (Gherkin runners only) and step-def files live in `## Step Def Directory`; `adw_init` selects the runner and falls back to cucumber-js (flagging via `adw:unverified`) when it cannot identify one — it never bootstraps a runner from `scenario_writer`.
- Add `## BDD Framework` and `## Step Def Directory` to the `.adw/scenarios.md` documentation with brief descriptions and the cucumber-js / `features/step_definitions` defaults.

### 6. Close the unit-test gap in `adws/core/__tests__/stepDefDetection.test.ts`
- Add a `cucumber-ruby → ['.rb']` case to the `stepDefExtensionsFor` describe block (Ruby is named explicitly in the issue's Gherkin-mandate examples).
- Confirm (and add if missing) an explicit backward-compat assertion that empty/unknown framework → `['.ts']` (already present) and that a `.ts` file under `features/step_definitions` is detected with the default extensions (already present) — these lock AC1/AC6 backward compatibility.

### 7. Author the `@adw-579` per-issue BDD scenario as the descriptor-seam regression guard
- Create `features/per-issue/feature-579.feature` tagged `@adw-579` with scenarios that assert the descriptor-driven detection contract through public interfaces (permitted surfaces — loader/detector return values on fixture inputs, never source-file-content assertions):
  - **Backward compatibility (AC1/AC6):** Given a target repo whose `.adw/scenarios.md` omits `## BDD Framework` and `## Step Def Directory`, When the project config is loaded, Then `bddFramework` is empty and `stepDefDirectory` is `features/step_definitions`, And step-def detection recognizes a `.ts` file in that directory.
  - **Non-TS descriptor flow (AC2-seam/AC4/AC6):** Given a target repo whose `.adw/scenarios.md` declares `## BDD Framework` = `pytest-bdd` and `## Step Def Directory` = `features/steps`, When the project config is loaded, Then `bddFramework` is `pytest-bdd` and `stepDefDirectory` is `features/steps`, And step-def detection recognizes a `.py` file under `features/steps` but not under the legacy `.ts` directory.
- Create `features/per-issue/step_definitions/feature-579.steps.ts` implementing the steps by building temp-dir fixtures and driving `loadProjectConfig` / `parseScenariosMd` / `stepDefExtensionsFor` / `hasStepDefinitions` (mirror the temp-dir pattern already used in `stepDefDetection.test.ts`), asserting with Node `assert`.
- Ensure the new step phrases do not collide with existing registered step patterns (the runner errors on duplicates). Prefer phrasing already present in `features/regression/vocabulary.md` where it fits; surface any novel phrasing.

### 8. Run the Validation Commands
- Run every command in the **Validation Commands** section and ensure each passes with zero regressions (lint, type checks, unit tests, build, `@adw-579` by tag, and the `@regression` suite). Fix any failures before considering the feature complete.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope. Per the PRD's Testing Decisions, the **polymorphic prompts themselves are explicitly not unit-tested** (verified via the Python fixture e2e and live fix-forward); unit tests cover the pure detection/parsing seam the prompts depend on:

- **`stepDefDetection.ts` (`adws/core/__tests__/stepDefDetection.test.ts`)** — extend the existing table: add `cucumber-ruby → ['.rb']`; confirm coverage of every framework named in the issue (cucumber-js, behave, pytest-bdd, godog, cucumber-rs, cucumber-ruby) plus the empty/unknown → `['.ts']` default; confirm `hasStepDefinitions` recognizes the right extension under the configured directory and rejects a mismatched extension (locks AC4/AC6 detection and backward compatibility).
- **`projectConfig.ts` (`adws/core/__tests__/projectConfig.test.ts`)** — already covers `parseScenariosMd` reading `## BDD Framework` / `## Step Def Directory` and the defaults (`features/step_definitions`, `''`); confirm these remain green (AC1). Add cases only if a gap is found.

Tests must assert external behavior through each module's public interface (inputs → outputs/verdicts), consistent with the project's existing pure-helper unit tests. Do not assert on private helpers or call sequencing.

### Edge Cases
- `.adw/scenarios.md` absent entirely → `getDefaultScenariosConfig()` (cucumber-js extensions via empty `bddFramework`, `features/step_definitions`) — existing TS behavior preserved.
- `## BDD Framework` present but value unknown to `stepDefExtensionsFor` (e.g. an emerging language's runner) → extension detection defaults to `['.ts']`; step-def proof would skip (no `.ts` files) rather than false-pass — acceptable per the fix-forward strategy; note the residual detection-map touch-point in Notes.
- `## Step Def Directory` set to a non-default path (e.g. `features/steps`) → detection scans that path; generation writes there.
- Mixed-case / whitespace framework value (`"  Behave  "`) → normalized (already covered).
- `adw_init` fallback: recognized non-JS/TS stack with no identifiable Gherkin runner, and unrecognized/empty repo → cucumber-js emitted + `adw:unverified` flag raised; TS-only project defaulting to cucumber-js → no flag (avoid false-positive noise).
- Duplicate step-pattern across existing step-def files (any extension) → generation must skip the duplicate (runner-agnostic guard).

## Acceptance Criteria

- **`bddFramework`/`stepDefDirectory` parsed with backward-compatible defaults** — satisfied at the parser layer (`projectConfig.ts`, delivered by #578); confirmed by `projectConfig.test.ts` and re-guarded by the `@adw-579` backward-compat scenario (empty `bddFramework` → cucumber-js/`.ts`, `stepDefDirectory` → `features/step_definitions`).
- **Generation prompts emit step defs in the configured framework + directory (verified against Python/pytest-bdd)** — `generate_step_definitions.md` reads `## BDD Framework` + `## Step Def Directory` and generates idiomatically into the configured directory. The "verified against Python/pytest-bdd" half is a prompt-level behavior that, per the PRD, is verified by operator/e2e/fix-forward (and the future Python fixture e2e), not by an automated assertion in this PR; the descriptor→detection seam it relies on is regression-guarded by the `@adw-579` `pytest-bdd` scenario.
- **cucumber-bootstrap-on-N/A removed** — `scenario_writer.md` Step 2 and the `## Run E2E Tests` read are deleted; the prompt no longer installs or configures any runner.
- **Adding a new language requires no framework code change (descriptor-driven)** — the generation path keys entirely on the `bddFramework` string + Claude's knowledge (no enum, no per-language prompt file, no code provider). For the languages named in the issue, detection is already covered; for an entirely new language the only residual touch-point is `stepDefExtensionsFor`'s extension map (documented in Notes; generation itself needs no change).
- **`adw_init` only ever emits a Gherkin-based `bddFramework`; falls back to a Gherkin runner (never a native non-Gherkin runner) when the stack is unrecognized, and flags via the unverified channel** — `adw_init.md` retains the Gherkin-only emission + cucumber-js fallback and now applies `adw:unverified` + an issue comment on the fallback path, with a step-8 report note.
- **Generated scenarios remain Gherkin `.feature` regardless of target language** — `scenario_writer.md` states and enforces the Gherkin mandate; the promotion / per-issue-sweep / vocabulary parsers (`scenarioParser`, `FEATURE_FILENAME_RE`, `vocabularyParser`, `promotion*`) are untouched and keep parsing `.feature`.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint across the repo (no lint errors).
- `bunx tsc --noEmit` — root type check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes (additional type checks).
- `bun run test:unit` — Vitest unit suite passes, including the extended `stepDefDetection.test.ts` and `projectConfig.test.ts`.
- `bun run build` — `tsc` build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-579"` — the new per-issue descriptor-seam scenario passes (per-issue features are in `cucumber.js` `paths`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full regression suite passes (no regression from the prompt/docs/test changes).

Manual / fix-forward verification (not automatable in this PR; documented for the operator and the future Python fixture e2e): point `/adw_init` at a small Python/pytest-bdd repo and confirm `.adw/scenarios.md` gets `## BDD Framework: pytest-bdd` (no unverified flag when the runner is identified), then confirm `/scenario_writer` writes Gherkin `.feature` and `/generate_step_definitions` emits `.py` step defs under the configured directory.

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` applies. Most changes are prompt/markdown; for the TypeScript step-def file and any test code, follow the guidelines (guard clauses, max ~2 nesting depth, immutability, pure functions, no `any`, no decorators in ADW's own TS). Note that *generated* pytest-bdd step defs legitimately use Python decorators — that is target code emitted by the prompt, not ADW's own code, and is outside the guideline's scope.
- **No new libraries required.** If one were needed, `.adw/commands.md` specifies `bun add <package>`.
- **Hash propagation / emit-parse coupling (PRD "Further Notes").** Editing `adw_init.md` raises `.adw-version` (it is a `hashInputs:` file) → `adwUpgrade` regenerates `.adw/` across registered targets and ADW-self on next workflow — intended propagation for the unverified-flag refinement. The two generation prompts carry `target: false` and are **not** hash inputs, so they take effect immediately on merge. No new parsed `.adw/` field is introduced (the parser + `adw_init` emission for `## BDD Framework` / `## Step Def Directory` already shipped in #578), so the "add a field ⇒ also emit it in `adw_init`" rule is already satisfied.
- **Gherkin coupling is load-bearing.** The promotion / per-issue-sweep / vocabulary pipeline is hardwired to Gherkin `.feature`. This feature varies only the step-def runtime, never the scenario format — that is why `scenario_writer` must keep writing `.feature` for every language and `adw_init` must never emit a non-Gherkin `bddFramework`.
- **Residual per-language touch-point (scope honesty for AC4).** The *generation* path is truly zero-code-per-language. The one remaining per-language code site is `stepDefExtensionsFor`'s extension map used for *detection* of step-def files in `scenarioProof` — it already covers every language the issue names (Ruby/Python/Go/Rust/JS-TS). A brand-new, unlisted language would default to `.ts` detection (proof skips rather than false-passes). Making the extension itself descriptor-driven (e.g. a `## Step Def Extensions` field) would close this fully but adds a parsed field + `adw_init` emission and is **out of scope** here; flagged as a possible follow-up.
- **Out of scope for this issue (deferred to the PRD's later PRs / future work):** `stackCoherenceCheck` (the detected-config coherence warning), the JUnit structured-report migration of ADW's own suite, the proof/screenshot artifact harvester and PR proof publisher, the hermeticity/resolve-loop changes, and the Python fixture e2e. This issue is the generation-prompt + `adw_init`-emission slice of the parent PRD.
- **Why the `adw_init` flag is conservative.** Flagging `adw:unverified` only on the *non-recognition* fallback (not on the normal TS→cucumber-js default) keeps the loud signal meaningful and avoids labelling every ordinary TypeScript repo as unverified.
