# Feature: LLM-drafted observability-surfaces examples block in adwInit

## Metadata
issueNumber: `508`
adwId: `mqwyb7-llm-drafted-observab`
issueJson: `{"number":508,"title":"LLM-drafted observability-surfaces examples block in adwInit","body":"## Parent PRD\n\n`specs/prd/scenario-rot-prevention-and-promotion.md`\n\n## What to build\n\nExtend ```.claude/commands/adw_init.md``` to LLM-draft the repo-specific observability-surfaces examples block in `features/regression/vocabulary.md` based on the detected stack and dependencies.\n\nThe agent should analyse the target repo (manifests, dev dependencies, test directories) and produce an examples block listing the kinds of observable evidence the team actually uses (state files, recorded HTTP requests, git artefacts, DOM snapshots, screenshot artefacts, etc.). Rubber-stamp risk is explicitly accepted per the PRD — no gating workflow on the maintainer's review of this block.\n\n## Acceptance criteria\n\n- [ ] ```adw_init.md``` step 7 includes instructions to analyse the target repo and draft the examples block\n- [ ] The drafted block replaces the placeholder from slice #507 in the generated `features/regression/vocabulary.md`\n- [ ] Running `adwInit` on a repo with `@playwright/test` in devDependencies produces an examples block mentioning DOM/screenshot evidence\n- [ ] Running `adwInit` on a CLI-only repo produces an examples block scoped to state files, recorded requests, and exit codes (no DOM/screenshot entries)\n- [ ] The generated examples block follows the same Markdown structure as the framework's own `features/regression/vocabulary.md` examples\n\n## Blocked by\n\n- Blocked by #507\n\n## User stories addressed\n\n- User story 17 (vocabulary.md in target repo, examples portion)\n- User story 19 (accept rubber-stamp risk on LLM-drafted examples)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-20T22:44:31Z","comments":[{"author":"paysdoc","createdAt":"2026-05-21T13:42:25Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description

This feature is slice #3 of the parent PRD `specs/prd/scenario-rot-prevention-and-promotion.md`. Slice #507 introduced a checked-in framework template (`templates/vocabulary.md.template`) whose middle section (`## Observability Surfaces (Examples)`) is currently a `<!-- TODO -->` placeholder marker copied verbatim into every newly initialised target repo. This feature replaces that placeholder with an LLM-drafted, repo-specific examples block during `adwInit`.

The drafting step extends `.claude/commands/adw_init.md` step 7 (the same step that copies the template) with a stack-detection-driven instruction: the agent reads the target repo's manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, etc.), inspects `devDependencies` for browser-based test runners (`@playwright/test`, `cypress`, `puppeteer`, `@playwright/test`, `playwright`), scans visible test directories, and writes a tailored examples block that enumerates the observability surfaces scenarios in this repo can validly assert against.

Two canonical tailoring decisions follow the PRD acceptance criteria:

- **Browser-test-equipped repo** (e.g. `@playwright/test` present in `devDependencies`): the examples block includes DOM snapshots and screenshot artefacts alongside the universal surfaces (state files, recorded HTTP requests, git artefacts, exit codes).
- **CLI-only repo** (no browser test runner detected): the examples block is scoped to state files, recorded HTTP requests, git artefacts, log streams, and exit codes — no DOM or screenshot entries.

The Markdown structure of the drafted block follows the framework's own `features/regression/vocabulary.md` conventions: a heading (`## Observability Surfaces (Examples)`), a brief one-sentence intro paragraph, and a bulleted list where each bullet names a surface (bold) followed by a short description of what scenarios written in this repo can assert against it.

The rubber-stamp risk on the LLM-drafted content is accepted per PRD user story 19 — there is no maintainer-gating workflow on the init PR for this block. Miscalibration surfaces in the first scenarios produced against the repo.

## User Story

As a target-repo operator running `adwInit`
I want my generated `features/regression/vocabulary.md` examples block to enumerate the observability surfaces specific to my repo's stack (DOM/screenshots for browser-test repos, state files / recorded requests / exit codes for CLI-only repos)
So that the scoring rubric the framework distributes is calibrated to my repo's actual evidence kinds without me having to author the block by hand.

## Problem Statement

After slice #507 lands, every target repo onboarded via `adwInit` ends up with a `features/regression/vocabulary.md` whose `## Observability Surfaces (Examples)` section is a `<!-- TODO (slice #3, issue ??): ... -->` marker. The marker is structurally fine for the rubric and seed-phrase sections to function, but the downstream promotion-scoring logic (slice #4) depends on a populated examples block to compute the "surface match" axis. Without it, two failure modes follow:

- The promotion-scorer produces uniformly low scores for every scenario in the repo (no surfaces match an empty block), suppressing promotion suggestions entirely.
- Target-repo maintainers see the placeholder, do not know what to fill in, and either leave it blank (silent rot drift in `scenario_writer` outputs) or copy the framework's own block verbatim (wrong calibration for non-framework stacks).

Both outcomes defeat the rubric-distribution goal of the PRD. The slice that fills the placeholder must be automated at init time, calibrated to the target stack, and explicitly free of a maintainer-approval gate (per the PRD's accepted rubber-stamp trade-off).

## Solution Statement

Extend `.claude/commands/adw_init.md` step 7 with a new sub-step that runs **after** the template copy and **before** the step 8 report. The sub-step instructs the agent to:

1. Re-use the project analysis already performed in step 1 (manifests, dev dependencies, test directories detected) — no duplicate file reads.
2. Classify the target repo as either **browser-test-equipped** (one or more of `@playwright/test`, `playwright`, `cypress`, `puppeteer`, `@testing-library/*` with jsdom, `webdriverio`, `nightwatch` is declared in `devDependencies` or equivalent) or **CLI-only** (none detected).
3. Draft a Markdown block at `features/regression/vocabulary.md` that replaces the `<!-- TODO (slice #3, issue ??): ... -->` placeholder (between `## Observability Surfaces (Examples)` and `## Three Permitted Execution Patterns`) with the tailored content.
4. The drafted content follows a small, repo-agnostic template structure: a one-sentence intro paragraph naming the categories present in the repo, followed by a bulleted list of surfaces with one-line descriptions.

The agent uses the Edit or Write tool to replace the placeholder block in the target repo's `features/regression/vocabulary.md`. The surrounding sections (`## Rot-Detection Rubric`, `## Three Permitted Execution Patterns`, seed-phrase tables) are unchanged — the operation is a byte-targeted replacement of the placeholder comment between two stable headings.

If the analysis cannot determine the stack (empty repo, unrecognised manifest), the agent writes a minimal "fallback" examples block listing the universal surfaces (state files, recorded HTTP requests, exit codes, git artefacts) without DOM/screenshot entries, and flags the fallback in the step 8 report so the maintainer can refine the block manually.

## Relevant Files

Use these files to implement the feature:

- `.claude/commands/adw_init.md` — **Primary modification point.** Step 7 is extended with the new sub-step (post-template-copy) that detects the stack class and instructs the agent to draft the examples block. The current step 7 (lines 98–123) already houses the template copy from slice #507; the new instructions follow the existing `## Per-Issue Scenario Directory` / `## Regression Scenario Directory` sub-bullets and the template-copy block. Step 8 (Report) gains a one-line bullet acknowledging the examples-block drafting outcome.
- `templates/vocabulary.md.template` — **Reference, not modified.** The placeholder comment (`<!-- TODO (slice #3, issue ??): ... -->`) is the byte-range the new step replaces in the target repo's materialised copy. The template itself remains the canonical seed for the static sections (rubric, execution patterns, seed phrases).
- `features/regression/vocabulary.md` — **Reference for Markdown structure.** The drafted examples block follows the framework vocabulary's structural conventions (heading level, intro paragraph style, bullet formatting, code-tick usage for surface category names). The framework's own `features/regression/vocabulary.md` does not have an `## Observability Surfaces (Examples)` section, so the structural template comes from the framework's broader vocabulary patterns (introductory paragraph + tables/lists with brief descriptions).
- `adws/adwInit.tsx` — **Reference, not modified.** Confirms `frameworkRepoRoot` is already passed as the 4th positional arg (lines 70–82) from slice #507; no orchestrator-side change required for this slice.
- `specs/prd/scenario-rot-prevention-and-promotion.md` — Parent PRD. User stories 17 (vocabulary.md in target repo, examples portion) and 19 (rubber-stamp acceptance) are the acceptance gates for this slice.
- `specs/issue-507-adw-nnny1e-vocabulary-md-templa-sdlc_planner-vocabulary-template-and-flags.md` — Spec for the blocking slice (#507). The template structure, the `frameworkRepoRoot: $3` arg, and the existing step-7 modifications all originate there.
- `app_docs/feature-nnny1e-vocabulary-template-and-flags.md` — **Conditional doc** (per `.adw/conditional_docs.md`) for slice #507. Read when modifying step 7 vocabulary-template behaviour.
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — **Conditional doc** for slice #506. Describes the framework `scenario_writer.md` rot-prevention block that consumes the drafted examples block downstream.
- `app_docs/feature-4jvczx-adw-init-schema-updates.md` — **Conditional doc** for prior `adw_init.md` schema modifications. Reference for the patterns used when extending step 7.
- `app_docs/feature-8w4fep-adw-init-commands-md-scenario-sections.md` — **Conditional doc** for the prior step-7 modification that introduced scenario-tool detection. Reference for the conditional-instruction style step 7 already uses.
- `features/per-issue/feature-507.feature` — Reference for the BDD scenario pattern (manifest-driven simulation of the `adwInit` agent against a fresh target repo, artefact assertions only).
- `features/per-issue/step_definitions/feature-507.steps.ts` — Reference for the step-definition pattern. Re-uses `targetRepos`, `applyManifest`, and the `MOCK_MANIFEST_PATH` env var. The `ensureTargetRepo`/`readArtefactFile` helpers are re-usable.
- `features/per-issue/step_definitions/feature-506.steps.ts` — Source of `targetRepos` export and helper functions re-used by feature-507 and to be re-used by feature-508.
- `test/fixtures/jsonl/manifests/adw-init-writes-vocab.json` — Reference manifest from slice #507 showing how the template's verbatim content is simulated by the manifest stub. The slice #508 manifests will simulate the post-LLM-draft content (with placeholder replaced).
- `test/mocks/manifestInterpreter.ts` — Reference for the manifest schema (full-contents writes only). No change required.
- `.adw/commands.md` — Project-specific validation commands (`bun run lint`, `bunx tsc --noEmit`, `bun run test:unit`, BDD tag runs, `bun run build`).
- `.adw/conditional_docs.md` — Source for the conditional-doc list above.
- `.adw/coding_guidelines.md` — Coding guidelines (TypeScript strict mode, max nesting depth ~2, no `any`).

### New Files

- `features/per-issue/feature-508.feature` — BDD scenarios validating the artefact outputs of `/adw_init` step 7's new examples-block drafting sub-step for issue #508. Tagged `@adw-508 @adw-mqwyb7-llm-drafted-observab`.
- `features/per-issue/step_definitions/feature-508.steps.ts` — Step-definition implementations specific to issue #508 (target-repo artefact assertions for the materialised `features/regression/vocabulary.md` examples block content). Re-uses `targetRepos` and shared helpers from `feature-506.steps.ts` and `feature-507.steps.ts`.
- `test/fixtures/jsonl/manifests/adw-init-drafts-examples-playwright.json` — Manifest sequencing the stubbed `/adw_init` agent for a target repo with `@playwright/test` in `devDependencies`. Simulates the agent writing `features/regression/vocabulary.md` with an examples block that contains DOM and screenshot surface bullets.
- `test/fixtures/jsonl/manifests/adw-init-drafts-examples-cli.json` — Manifest variant for a CLI-only target repo. Simulates the agent writing `features/regression/vocabulary.md` with an examples block scoped to state files, recorded requests, exit codes, and git artefacts — explicitly without DOM or screenshot bullets.
- `test/fixtures/jsonl/manifests/adw-init-drafts-examples-fallback.json` — Manifest variant for a repo where the stack cannot be classified (empty manifests, unrecognised structure). Simulates the agent writing a minimal universal examples block and noting the fallback in step-8 output.

## Implementation Plan

### Phase 1: Foundation

Confirm the contract surface for the new sub-step:

1. Where in step 7 the drafting instruction is inserted — chosen anchor: directly after the existing `**Copy the framework vocabulary template**` Bash block and before step 8 begins. This places the drafting after the template materialisation so the agent edits a file that already exists.
2. What input the agent uses to classify the stack — chosen surface: **re-use the analysis from step 1** (manifests, dev dependencies, test directories). The agent does not re-read files; it consults its existing analysis.
3. What output structure the drafted block follows — chosen format: a Markdown heading-anchored block between `## Observability Surfaces (Examples)` and `## Three Permitted Execution Patterns`, structured as a one-sentence intro paragraph + bulleted list of surfaces with one-line descriptions per bullet. The bullet style matches the framework `features/regression/vocabulary.md` rubric bullets (`- **Surface** — description`).
4. What classification axis is used — chosen detection: presence/absence of any **browser-based test runner** in `devDependencies` (`@playwright/test`, `playwright`, `cypress`, `puppeteer`, `webdriverio`, `nightwatch`, `@testing-library/jest-dom`-with-jsdom). Presence → include DOM and screenshot surface bullets. Absence → CLI-only fallback.

No code is written in this phase; the choices above are documented in step 7's new sub-step so the implementing agent reads them as instructions, not as decisions to make on its own.

### Phase 2: Core Implementation

Modify `.claude/commands/adw_init.md` step 7 to add the new sub-step. The instruction text instructs the running `/adw_init` agent to:

1. Determine the stack class:
   - If any of `@playwright/test`, `playwright`, `cypress`, `puppeteer`, `webdriverio`, `nightwatch` (or analogous browser-test runners) appear in `devDependencies` of the target repo's `package.json`, set the class to **browser-test-equipped**.
   - For non-Node ecosystems, detect equivalent browser test runners (Python: `playwright`/`pytest-playwright`/`selenium`; Ruby: `capybara`/`selenium-webdriver`; Java: `selenium-java`/`playwright-java`; .NET: `Microsoft.Playwright`/`Selenium.WebDriver`). Presence → **browser-test-equipped**.
   - If no manifests or test runners can be detected, set the class to **fallback**.
   - Otherwise, set the class to **CLI-only**.

2. Locate the `<!-- TODO (slice #3, issue ??): ... -->` placeholder in the target repo's `features/regression/vocabulary.md` (the file copied verbatim by the preceding template-copy bullet). The placeholder sits between `## Observability Surfaces (Examples)` and `## Three Permitted Execution Patterns`.

3. Replace the placeholder with a drafted block matching the chosen class:

   **Browser-test-equipped block**:
   ```markdown
   Scenarios in this repo can assert against the following observable surfaces:

   - **State files** — JSON or other structured output files written by orchestrators, CLI tools, or test fixtures (e.g. `agents/<adwId>/state.json`).
   - **Recorded HTTP requests** — request logs captured by a mock HTTP server fronting the system under test.
   - **Git artefacts** — branches, commits, pushes, and worktree state produced by the system under test.
   - **DOM snapshots** — serialised page DOM extracted by the browser test runner during scenario execution.
   - **Screenshot artefacts** — image files captured by the browser test runner at known assertion points.
   - **Exit codes** — termination status of subprocesses spawned by the test harness.
   - **Log streams** — stdout/stderr captured from spawned processes and asserted against by substring or regex.
   ```

   **CLI-only block**:
   ```markdown
   Scenarios in this repo can assert against the following observable surfaces:

   - **State files** — JSON or other structured output files written by orchestrators, CLI tools, or test fixtures.
   - **Recorded HTTP requests** — request logs captured by a mock HTTP server fronting the system under test.
   - **Git artefacts** — branches, commits, pushes, and worktree state produced by the system under test.
   - **Exit codes** — termination status of subprocesses spawned by the test harness.
   - **Log streams** — stdout/stderr captured from spawned processes and asserted against by substring or regex.
   ```

   **Fallback block**:
   ```markdown
   Scenarios in this repo can assert against the following observable surfaces:

   - **State files** — JSON or other structured output files written by the system under test.
   - **Recorded HTTP requests** — request logs captured by a mock HTTP server (if one is present in the repo).
   - **Exit codes** — termination status of subprocesses.
   - **Log streams** — stdout/stderr captured from spawned processes.

   Note: the stack could not be classified automatically; refine this list as your test surfaces solidify.
   ```

4. Use the Edit tool to replace the literal placeholder comment with the chosen block. If the placeholder is not present (e.g. the file was not produced by slice #507's template copy, or the operator pre-edited it), skip the drafting and log a warning that lands in the step 8 report.

5. Update step 8 (Report) to add a single bullet summarising which class was selected and whether the drafting succeeded or fell back. No other step-8 sections change.

The framework-side change is **prompt-only** — no TypeScript, no orchestrator wiring change, no new modules. `adwInit.tsx` already passes `frameworkRepoRoot` (slice #507); no new args required.

### Phase 3: Integration

Add per-issue BDD scenarios under `features/per-issue/feature-508.feature` plus their step definitions and JSONL manifest fixtures. The scenarios validate **observable artefact content** in the target repo (the materialised `features/regression/vocabulary.md` file) — not source-file properties of the framework prompt.

Three scenarios cover the three classification branches:

§1 — Browser-test-equipped target repo:

1. `adwInit on a target repo with @playwright/test in devDependencies produces an examples block mentioning DOM/screenshot evidence`:
   - Given a fresh target repo "tgt-508-playwright" with package.json declaring "@playwright/test" in devDependencies
   - And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-examples-playwright.json"
   - When the adwInit agent is invoked in target repo "tgt-508-playwright" with adwId "init-508-1" for issue 1201
   - Then the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-playwright" mentions a "DOM" surface in its observability examples block
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-playwright" mentions a "screenshot" surface in its observability examples block
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-playwright" no longer contains the slice-#507 placeholder comment

§2 — CLI-only target repo:

2. `adwInit on a CLI-only target repo produces an examples block scoped to state files, recorded requests, and exit codes (no DOM/screenshot)`:
   - Given a fresh target repo "tgt-508-cli" with package.json declaring no browser test runners
   - And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-examples-cli.json"
   - When the adwInit agent is invoked in target repo "tgt-508-cli" with adwId "init-508-2" for issue 1202
   - Then the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-cli" mentions a "State files" surface in its observability examples block
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-cli" mentions a "Recorded HTTP requests" surface in its observability examples block
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-cli" mentions an "Exit codes" surface in its observability examples block
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-cli" does not mention a "DOM" surface in its observability examples block
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-cli" does not mention a "screenshot" surface in its observability examples block
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-cli" no longer contains the slice-#507 placeholder comment

§3 — Structural conformance:

3. `The drafted examples block follows the same Markdown structure as the framework's own vocabulary.md examples`:
   - Given a fresh target repo "tgt-508-struct" with package.json declaring no browser test runners
   - And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-drafts-examples-cli.json"
   - When the adwInit agent is invoked in target repo "tgt-508-struct" with adwId "init-508-3" for issue 1203
   - Then the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-struct" contains a "## Observability Surfaces (Examples)" section heading
   - And the observability examples block in target repo "tgt-508-struct" contains at least one Markdown bullet item
   - And every bullet in the observability examples block in target repo "tgt-508-struct" matches the framework bullet pattern "- **Name** — description"
   - And the artefact file at "features/regression/vocabulary.md" in target repo "tgt-508-struct" contains the universal "## Rot-Detection Rubric" heading after the examples block

The scenarios use the existing `claude-cli-stub` + JSONL manifest harness (same pattern as feature-507). They do **not** boot the full `adwInit.tsx` orchestrator (depaudit setup, target-repo clone, commit, PR creation) — that surface is out of scope for per-issue scenarios in this slice.

The three manifest fixtures simulate the agent's complete `vocabulary.md` output for each class (placeholder already replaced). The CLI-only and fallback manifests share scenarios §2 and §3's coverage — §3 deliberately uses the CLI-only manifest to keep the structural assertion repo-agnostic.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Update `.claude/commands/adw_init.md` step 7

- Open `.claude/commands/adw_init.md`.
- Locate the existing step 7 sub-bullet `**Copy the framework vocabulary template**` (currently the last bullet before step 8).
- Add a new sub-bullet directly after the template-copy block (and still inside step 7), titled `**Draft the observability-surfaces examples block**`.
- Body of the new sub-bullet (rendered as nested Markdown inside step 7):
  - Use the project analysis from step 1 (manifests + devDependencies + visible test directories) to classify the target repo into one of three classes:
    - **browser-test-equipped** — at least one of `@playwright/test`, `playwright`, `cypress`, `puppeteer`, `webdriverio`, `nightwatch` (or non-Node equivalents) appears in the dependency manifest.
    - **CLI-only** — no browser test runner is detected and at least one manifest was parseable.
    - **fallback** — no manifest could be parsed (empty repo, unrecognised stack).
  - In the materialised `features/regression/vocabulary.md` (already written by the preceding template-copy bullet), locate the placeholder block `<!-- TODO (slice #3, issue ??): ... -->` between the `## Observability Surfaces (Examples)` heading and the `## Three Permitted Execution Patterns` heading.
  - Replace the placeholder with the class-specific drafted block (verbatim text supplied in `## Implementation Plan / Phase 2 / step 3` of this spec — the three block bodies for browser/CLI/fallback).
  - The replacement uses the Edit tool with `old_string` set to the literal placeholder comment and `new_string` set to the chosen block body.
  - If the placeholder cannot be found (the file was not produced by the template copy, or was hand-edited), skip the drafting silently and log a warning in step 8.
- Add the three drafted block bodies (browser-test-equipped, CLI-only, fallback) inline in the prompt so the agent has the exact text to write — no LLM paraphrasing of the surface descriptions, only the choice of which block to apply.
- Extend step 8 (Report) to include one new bullet: `Examples-block class chosen: <browser-test-equipped | CLI-only | fallback>; placeholder replacement: <succeeded | skipped: <reason>>.`

### 2. Add manifest fixture `test/fixtures/jsonl/manifests/adw-init-drafts-examples-playwright.json`

- Model on `test/fixtures/jsonl/manifests/adw-init-writes-vocab.json` (the slice-#507 reference).
- The manifest's single `edits` entry writes `features/regression/vocabulary.md` with content that:
  - Includes the framework's `## Rot-Detection Rubric` paragraph (verbatim from the template).
  - Replaces the slice-#507 `<!-- TODO ... -->` placeholder with the browser-test-equipped block from Phase 2 step 3 (with DOM and screenshot bullets present).
  - Retains the seed-phrase tables and the `## Three Permitted Execution Patterns` heading.
- `jsonlPath` follows the existing convention (`.adw-stub-payload.json`).

### 3. Add manifest fixture `test/fixtures/jsonl/manifests/adw-init-drafts-examples-cli.json`

- Same structure as the playwright manifest, but with the CLI-only block (no DOM, no screenshot bullets).

### 4. Add manifest fixture `test/fixtures/jsonl/manifests/adw-init-drafts-examples-fallback.json`

- Same structure as the playwright manifest, but with the fallback block (universal surfaces + the "stack could not be classified" note).

### 5. Add BDD scenario file `features/per-issue/feature-508.feature`

- Header tags: `@adw-508 @adw-mqwyb7-llm-drafted-observab`.
- Feature line: `Feature: LLM-drafted observability-surfaces examples block in adwInit`.
- Background: `Given the ADW framework codebase is checked out` (re-used from feature-507).
- Background prose: one paragraph explaining the slice context (slice #3 of the rot-prevention PRD), the observability-only assertion contract, and that the agent invocation is simulated through the claude-cli-stub manifest harness.

Implement the three scenarios from `## Implementation Plan / Phase 3`:

§1 (browser-test-equipped):
- Scenario 1: `adwInit on a target repo with @playwright/test in devDependencies produces an examples block mentioning DOM/screenshot evidence`.

§2 (CLI-only):
- Scenario 2: `adwInit on a CLI-only target repo produces an examples block scoped to state files, recorded requests, and exit codes (no DOM/screenshot)`.

§3 (structural conformance):
- Scenario 3: `The drafted examples block follows the same Markdown structure as the framework's own vocabulary.md examples`.

Each scenario carries its own `@adw-508 @adw-mqwyb7-llm-drafted-observab` tag block (matching the per-scenario tagging style used in feature-507).

### 6. Add step definitions `features/per-issue/step_definitions/feature-508.steps.ts`

Implement the new Given/When/Then step phrases (matching the literal phrasing in `features/per-issue/feature-508.feature`):

- `Given a fresh target repo {string} with package.json declaring "@playwright/test" in devDependencies` — initialises a clean temp directory at the named path, writes a minimal `package.json` containing `"devDependencies": { "@playwright/test": "^1.0.0" }`. Uses the regex pattern (escape `@` and `.`) for cucumber-expressions safety.
- `Given a fresh target repo {string} with package.json declaring no browser test runners` — initialises a clean temp directory, writes a minimal `package.json` with `"devDependencies": {}` (or omitted).
- `Then the artefact file at {string} in target repo {string} mentions a {string} surface in its observability examples block` — reads the file, slices the section between `## Observability Surfaces (Examples)` and `## Three Permitted Execution Patterns`, asserts the surface name string appears within the block (case-insensitive substring).
- `Then the artefact file at {string} in target repo {string} does not mention a {string} surface in its observability examples block` — symmetric negative assertion.
- `Then the artefact file at {string} in target repo {string} no longer contains the slice-#507 placeholder comment` — asserts the literal placeholder string `<!-- TODO (slice #3, issue ??): ` is absent from the materialised file.
- `Then the observability examples block in target repo {string} contains at least one Markdown bullet item` — slices the same section, asserts at least one line in the block matches the bullet pattern `^- `.
- `Then every bullet in the observability examples block in target repo {string} matches the framework bullet pattern "- **Name** — description"` — slices the same section, parses every line beginning with `- `, asserts each matches the regex `^- \*\*[^*]+\*\* — .+$` (em-dash, bold-wrapped surface name, description after the em-dash).

Re-use the following existing helpers and exports:
- `targetRepos` from `feature-506.steps.ts`.
- `ensureTargetRepo507` style helper pattern (renamed `ensureTargetRepo508` and adapted to write a `package.json` instead of an empty dir).
- `readArtefactFile507` style helper pattern (renamed `readArtefactFile508`).
- `applyManifest` from `test/mocks/manifestInterpreter.ts`.
- `MOCK_MANIFEST_PATH` env-var convention from `RegressionWorld.harnessEnv`.
- The Before/After hooks scoped to `@adw-508` clear `targetRepos` and `adwInitRunData` to keep scenario isolation symmetric with feature-507.

All step phrases follow the rot-prevention rubric: they assert on artefacts (files written to the target worktree by the simulated agent), not on the framework's source files. The structural-conformance scenario reads the **target repo's** materialised `vocabulary.md`, not the framework's `templates/vocabulary.md.template` source.

### 7. Sanity-check that the new step 7 sub-bullet preserves slice #507's behaviour

- Manually re-read `.claude/commands/adw_init.md` after editing.
- Confirm the template-copy bullet still runs first and the new drafting bullet runs second, so the file the drafting bullet edits is guaranteed to exist.
- Confirm step 8's existing bullets (the `frameworkRepoRoot` warning, the polymorphism-flag callout) remain present; the new examples-class bullet is added, not substituted.
- Confirm the `## Variables` block still names `frameworkRepoRoot: $3`. (No new variables introduced; the drafting bullet does not need an additional positional arg.)

### 8. Add unit test `adws/__tests__/vocabularyTemplate.test.ts` augmentation (optional, deferred)

- The existing unit test created in slice #507 asserts on the template's three top-level headings and the literal forbidden-pattern bullets in the rubric. No augmentation is required for slice #508 because the template file itself is unchanged — only the agent's behaviour at init time changes, and that is covered by the BDD scenarios in step 5.
- Skip this step unless a regression in step 1 is later detected.

### 9. Run the validation commands

Run every command in `## Validation Commands` and confirm zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope when they pay for themselves.

This slice's changes are:

- A prompt change in `.claude/commands/adw_init.md` step 7 (new sub-bullet for examples-block drafting and a new step-8 report bullet) — not unit-testable directly; covered by BDD scenarios that observe the agent's artefact outputs through the manifest stub.
- No TypeScript source code changes — `adwInit.tsx` and the agent-runner machinery are untouched.

There is no new module to unit-test. The slice-#507 `adws/__tests__/vocabularyTemplate.test.ts` continues to cover the template's structural properties (which this slice does not modify) and serves as the regression guard for the unmodified seed sections.

No new unit-test files are created in this slice.

### Edge Cases

- **Placeholder missing in materialised `vocabulary.md`**: If the template-copy bullet failed silently (e.g. legacy invocation without `$3`), the drafting bullet finds no placeholder to replace and skips with a warning in step 8. The empty `vocabulary.md` is left as-is. Covered by the prompt instruction "If the placeholder cannot be found, skip the drafting silently and log a warning in step 8."
- **`package.json` malformed or absent**: For Node ecosystems where `package.json` cannot be parsed, the agent treats the repo as "fallback" class and writes the universal block with the "stack could not be classified" note. Covered by the third manifest fixture and the prompt's classification rules.
- **Multiple browser test runners declared**: A repo with both `@playwright/test` and `cypress` in `devDependencies` still maps to a single "browser-test-equipped" class — the chosen block lists DOM and screenshot surfaces once. The drafting bullet is not required to mention specific runner names in the surface descriptions.
- **Non-Node ecosystems with browser test runners**: Python (`playwright`, `pytest-playwright`), Ruby (`capybara`), and other ecosystems with browser-based test runners declared in their respective manifest formats are recognised as "browser-test-equipped". The prompt enumerates the cross-ecosystem detection rules.
- **Target repo already has a custom examples block**: If a maintainer pre-edited the materialised `vocabulary.md` before re-running `/adw_init`, the template-copy bullet from slice #507 overwrites the file verbatim first, restoring the placeholder; the drafting bullet then proceeds normally. Re-init is documented as overwriting custom content (slice-#507 edge-case behaviour, unchanged).
- **Bullet style drift**: The structural-conformance scenario (§3) asserts every drafted bullet matches the `- **Name** — description` pattern. If the agent paraphrases a bullet (e.g. uses `*Name*` italics or omits the em-dash), the scenario fails — protecting against silent Markdown-structure drift across future framework iterations.
- **Empty repo (no manifests at all)**: The agent classifies as "fallback" and writes the minimal universal block with the note. The flow does not crash on missing manifests.

## Acceptance Criteria

- [ ] `.claude/commands/adw_init.md` step 7 contains a new sub-bullet titled `**Draft the observability-surfaces examples block**` that runs after the template-copy bullet and before step 8.
- [ ] The new sub-bullet specifies three classification classes (browser-test-equipped, CLI-only, fallback) and the detection rules for each.
- [ ] The new sub-bullet provides the literal block body for each class so the agent does not paraphrase the surface descriptions.
- [ ] Step 8 (Report) includes a new bullet acknowledging the class chosen and whether the placeholder replacement succeeded.
- [ ] `features/per-issue/feature-508.feature` exists, is tagged `@adw-508 @adw-mqwyb7-llm-drafted-observab` (both at the feature level and per scenario), and contains the three scenarios described in step 5.
- [ ] `features/per-issue/step_definitions/feature-508.steps.ts` exists and implements all step phrases used by the feature file, re-using `targetRepos` and shared helpers from feature-506 and feature-507.
- [ ] `test/fixtures/jsonl/manifests/adw-init-drafts-examples-playwright.json`, `test/fixtures/jsonl/manifests/adw-init-drafts-examples-cli.json`, and `test/fixtures/jsonl/manifests/adw-init-drafts-examples-fallback.json` exist and produce the agent behaviours described in steps 2–4.
- [ ] Running the playwright manifest produces a `features/regression/vocabulary.md` that mentions DOM and screenshot surfaces inside the observability examples block.
- [ ] Running the CLI manifest produces a `features/regression/vocabulary.md` whose observability examples block mentions state files, recorded HTTP requests, and exit codes but does not mention DOM or screenshot surfaces.
- [ ] The drafted block in any class replaces the slice-#507 placeholder comment (the literal `<!-- TODO (slice #3, issue ??): ` substring is absent from the materialised file).
- [ ] Every bullet in the drafted block matches the framework bullet pattern `- **Name** — description`.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-508"` exits 0 with all three scenarios passing.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` exits 0 (no regressions in regression suite).
- [ ] `bun run lint` exits 0.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` exit 0.
- [ ] `bun run test:unit` exits 0 (no regressions in the existing unit suite, including the slice-#507 `vocabularyTemplate.test.ts`).
- [ ] `bun run build` exits 0.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint checks pass with no new violations.
- `bunx tsc --noEmit` — Root TypeScript type-checks cleanly.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type-checks cleanly.
- `bun run test:unit` — Unit-test suite passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-508"` — Issue-508 BDD scenarios all pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Regression scenarios pass with no rot regressions.
- `bun run build` — Project builds cleanly.

## Notes

- `.adw/coding_guidelines.md` is present in the target repository and is strictly adhered to: TypeScript strict mode, no `any`, max nesting depth ~2, guard clauses for early returns, declarative over imperative. The only TypeScript change in this slice is the new step-definitions file (`feature-508.steps.ts`), which mirrors the patterns already established in `feature-506.steps.ts` and `feature-507.steps.ts` (regex Given patterns for paths containing `/`, helpers extracted at the bottom of the file, `Before/After` hooks scoped by tag).

- **This slice is prompt-only on the framework side.** No TypeScript source changes in `adws/`. The orchestrator wiring required to pass `frameworkRepoRoot` was already landed by slice #507. The runtime contract of `adwInit.tsx` is unchanged.

- **The drafted block bodies are inlined in the prompt verbatim.** Per the PRD's rubber-stamp acceptance (user story 19), the agent does not paraphrase or invent surface descriptions — it picks one of three checked-in blocks based on the classification result. This bounds the variance of the drafted output and keeps the structural-conformance BDD assertion stable.

- **Library install command** (from `.adw/commands.md` `## Library Install Command`): `bun add <package>`. This slice introduces no new dependencies.

- **Conditional docs to consult during implementation** (per `.adw/conditional_docs.md`):
  - `app_docs/feature-nnny1e-vocabulary-template-and-flags.md` — slice #507; the blocking slice. Read for the template structure and the `frameworkRepoRoot: $3` arg.
  - `app_docs/feature-mzgyjj-rot-prevention-block.md` — slice #506; the framework `scenario_writer.md` rot-prevention block (downstream consumer of the drafted examples block).
  - `app_docs/feature-4jvczx-adw-init-schema-updates.md` — prior `adw_init.md` schema modifications. Reference for the style of step-7 sub-bullet additions.
  - `app_docs/feature-8w4fep-adw-init-commands-md-scenario-sections.md` — prior step-7 modification (scenario-tool detection). Same pattern: classification → conditional generation.

- **Out of scope (deferred to later slices)**:
  - Promotion scoring against the drafted examples block (slice #4 — the `promotionScorer` consumes this block but is built separately).
  - Backporting the drafted block to existing target repos that pre-date this slice (deferred per PRD "Out of Scope" section — needs an `adwUpgrade`-style mechanism).
  - More fine-grained stack detection (e.g. distinguishing API-only Node repos from full-stack Next.js repos) — current classification is binary (browser-test-equipped vs CLI-only) plus a fallback. Refinement is deferred until field experience shows the binary split is too coarse.
  - Per-repo override of the drafted block via `.adw/scenarios.md` knobs — the PRD's "Out of Scope" section explicitly forbids per-repo overrides; the framework owns the formula.
  - LLM-drafted seed-phrase tables — only the examples block is LLM-drafted in this slice; the seed phrases remain verbatim from `templates/vocabulary.md.template`.

- **Rubber-stamp risk acceptance** (user story 19): the slice does not gate the `adwInit` PR with a verification step on the drafted block. Maintainer review surfaces miscalibration in the first scenarios produced against the repo, not in the init PR diff. This is a deliberate trade-off documented in the PRD.

- **Failure mode if slice #507 has not landed**: this slice depends on the template-copy bullet being present in step 7 and the placeholder being written into the target repo. If slice #507 has not landed, the drafting bullet finds no placeholder and skips silently with a step-8 warning. The acceptance criteria for this slice are not satisfiable in that state. The issue is correctly marked "Blocked by #507" in the issue tracker.
