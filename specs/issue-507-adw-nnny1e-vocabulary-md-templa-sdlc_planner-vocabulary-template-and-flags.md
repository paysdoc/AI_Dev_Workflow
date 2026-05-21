# Feature: vocabulary.md.template + adwInit copies it + writes per-issue/regression dir flags

## Metadata
issueNumber: `507`
adwId: `nnny1e-vocabulary-md-templa`
issueJson: `{"number":507,"title":"vocabulary.md.template + adwInit copies it + writes per-issue/regression dir flags","body":"## Parent PRD\n\n`specs/prd/scenario-rot-prevention-and-promotion.md`\n\n## What to build\n\nCreate a checked-in framework template `vocabulary.md.template` containing:\n\n1. The universal rot-detection rubric (principle section)\n2. A placeholder section for the repo-specific observability-surfaces examples block (to be filled in by slice #3)\n3. A minimal universal phrase seed (repo-agnostic Given/When/Then phrases covering subprocess invocation, recorded mock requests, exit codes)\n\nModify ```.claude/commands/adw_init.md``` (step 7) to:\n\n1. Copy `vocabulary.md.template` verbatim to the target repo at `features/regression/vocabulary.md` on init\n2. Write `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` sections to the generated `.adw/scenarios.md` by default for new target repos\n\nThe examples block remains a placeholder in this slice — slice #3 will add LLM-drafting based on detected stack. Until then, target repos get the universal principle and seed phrases with a clearly-marked TODO examples block.\n\n## Acceptance criteria\n\n- [ ] `vocabulary.md.template` exists in the framework repo with the three sections (principle, examples placeholder, minimal seed)\n- [ ] ```adw_init.md``` step 7 instructs the agent to copy the template to `features/regression/vocabulary.md`\n- [ ] ```adw_init.md``` step 7 instructs the agent to write per-issue and regression directory flags to `.adw/scenarios.md`\n- [ ] Running `adwInit` on a fresh target repo produces `features/regression/vocabulary.md` containing the universal principle and the seed phrases\n- [ ] Running ```adwInit``` on a fresh target repo produces `.adw/scenarios.md` with both polymorphism flags populated\n\n## Blocked by\n\nNone — can start immediately.\n\n## User stories addressed\n\n- User story 17 (vocabulary.md in target repo)\n- User story 18 (polymorphism flags by default)\n- User story 27 (template is a checked-in asset)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-20T22:44:12Z","comments":[{"author":"paysdoc","createdAt":"2026-05-21T10:10:11Z","body":"## Take action"},{"author":"paysdoc","createdAt":"2026-05-21T10:15:26Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description

This feature is slice #2 of the parent PRD `specs/prd/scenario-rot-prevention-and-promotion.md`. It distributes the framework's rot-prevention rubric to every target repo onboarded via `adwInit`, and turns the tiered regression model (per-issue draft scenarios + promoted regression scenarios) into the default layout for new target repos.

Two artefacts ship with this slice:

1. A **checked-in framework template** at `templates/vocabulary.md.template` that contains the universal rot-detection rubric, a TODO placeholder for repo-specific observability-surface examples (filled in by slice #3), and a minimal universal phrase seed covering the three execution patterns (subprocess, function/module import, mock query).

2. An **extended `adw_init.md` step 7** that copies the template verbatim into the target repo at `features/regression/vocabulary.md`, and writes `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` sections to `.adw/scenarios.md` by default.

The "verbatim" requirement means the agent must not paraphrase the template — it copies bytes, not meaning. The orchestrator passes the framework repo root as a fourth positional argument (`$3`) so the agent can `cp` the file by absolute path. The examples block remains a TODO marker in this slice; slice #3 will add LLM-drafting based on detected stack.

## User Story

As a target-repo operator running `adwInit`
I want my repo to be bootstrapped with `features/regression/vocabulary.md` and the per-issue + regression directory polymorphism flags
So that I start with the same rot-prevention rubric and tiered regression layout as the framework repo, without having to manually copy them.

## Problem Statement

Target repos onboarded via `adwInit` get no scenario-quality rubric and no opt-in to the tiered regression model. They receive `.adw/scenarios.md` with the legacy free-form layout, missing the `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` polymorphism flags that activate the per-issue/regression split. Without those flags, every scenario `scenario_writer` produces is free-form, can be auto-promoted to `@regression`, and is not subject to the rot-detection rubric the framework repo enforces internally.

This means:

- New target repos can drift into the same file-existence and substring-match rot patterns issues #491–#493 spent effort removing from the framework repo.
- The promotion workflow planned in slice #4 (confidence-scored suggestions, `hitl` gate) has nothing to lift off the ground in target repos because the per-issue directory does not exist.
- Each new target repo has to manually re-derive what counts as a "behavioural" vs "rotting" scenario, with no shared definition to anchor PR review.

## Solution Statement

Ship a checked-in framework asset (`templates/vocabulary.md.template`) and a minimal extension to the `/adw_init` slash command + orchestrator that distributes the asset and the polymorphism flags to every newly initialised target repo. The template is verbatim-copied (not LLM-generated) so the universal rot principle and seed phrases are byte-stable across repos. The examples block is left as a TODO marker — slice #3 will add LLM-drafting against the detected stack.

The agent receives the framework repo root as a 4th positional argument (`$3`) and uses `cp` to copy the template into the target worktree, eliminating LLM paraphrasing risk on the principle and seed sections.

## Relevant Files

Use these files to implement the feature:

- `.claude/commands/adw_init.md` — Step 7 is the modification point. Adds the `frameworkRepoRoot: $3` arg and instructs the agent to copy the template + write the two polymorphism flag sections to `.adw/scenarios.md` by default.
- `adws/adwInit.tsx` — Resolves the framework repo root from `import.meta.url` (mirrors the pattern in `worktreeSetup.ts`) and passes it as the 4th positional arg to `runClaudeAgentWithCommand('/adw_init', ...)`.
- `adws/agents/claudeAgent.ts` — Reference: shows how `args: readonly string[]` flow through to `$0, $1, $2, $3, ...` in the slash-command prompt (line 53). No change needed; we just use the 4th slot.
- `adws/phases/worktreeSetup.ts` — Reference for `path.resolve(currentDir, '../../')` framework-root resolution pattern (used by `copyTargetSkillsAndCommands`). The new `adwInit.tsx` arg resolution follows the same pattern.
- `features/regression/vocabulary.md` — Source for the universal Rot-Detection Rubric section that gets verbatim-copied into the template's section 1.
- `.adw/scenarios.md` — Reference for what the polymorphism flag sections look like when present (lines 19–25).
- `.claude/commands/scenario_writer.md` — Reference for the upstream consumer of the polymorphism flags and `features/regression/vocabulary.md`. No change in this slice; documented in slice #1 (issue #506).
- `specs/prd/scenario-rot-prevention-and-promotion.md` — Parent PRD. User stories 17, 18, 27 are the acceptance gates for this slice.
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — Adjacent slice (issue #506) that added the rot-prevention block to `scenario_writer.md`. This slice is the target-repo distribution half.
- `app_docs/feature-4jvczx-adw-init-schema-updates.md` — Reference for prior `adw_init.md` schema modifications.
- `app_docs/feature-8w4fep-adw-init-commands-md-scenario-sections.md` — Reference for the prior modification that wired `## Run Scenarios by Tag` / `## Run Regression Scenarios` into step 7's scenario-tool detection.
- `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` — Reference pattern for cross-repo file distribution at `adw_init` time (skills/commands with `target: true` frontmatter). This slice's template-copy uses a different mechanism (agent-driven `cp` via 4th arg) but the precedent is relevant.
- `test/fixtures/jsonl/manifests/` — Existing JSONL manifests directory. New manifest fixtures for this slice land here.
- `features/per-issue/feature-506.feature` — Reference for the BDD scenario style used in adjacent slices (issue #506). New per-issue scenarios for issue #507 follow the same observability-anchored pattern.
- `features/per-issue/step_definitions/feature-506.steps.ts` — Reference for step-definition style.

### New Files

- `templates/vocabulary.md.template` — Checked-in framework template. Three sections: (1) `## Rot-Detection Rubric` (verbatim from the framework's `features/regression/vocabulary.md` `## Rot-Detection Rubric`), (2) `## Observability Surfaces (Examples)` placeholder block with a `<!-- TODO (slice #3): ... -->` comment, (3) `## Three Permitted Execution Patterns` + minimal `Given/When/Then` tables with repo-agnostic phrases for subprocess setup, subprocess invocation, mock-server queries, and exit codes.
- `features/per-issue/feature-507.feature` — BDD scenarios validating the artefact outputs of `/adw_init` step 7 for issue #507. Tagged `@adw-507 @adw-nnny1e-vocabulary-md-templa`.
- `features/per-issue/step_definitions/feature-507.steps.ts` — Step-definition implementations specific to issue #507 (target-repo artefact assertions for `features/regression/vocabulary.md` content and `.adw/scenarios.md` section presence).
- `test/fixtures/jsonl/manifests/adw-init-vocab-and-flags.json` — Manifest sequencing the stubbed `/adw_init` agent: simulates reading the framework template, writing `features/regression/vocabulary.md`, and writing `.adw/scenarios.md` with the polymorphism flag sections.
- `test/fixtures/jsonl/manifests/adw-init-flags-only.json` — Manifest variant: simulates `/adw_init` writing scenarios.md with both flag sections (asserted in isolation from the vocabulary copy).

## Implementation Plan

### Phase 1: Foundation

Create the checked-in template asset (`templates/vocabulary.md.template`) with all three required sections. This is a pure-content change — no logic, no tests of its own beyond a structural smoke check that the file is present and the three section headers parse.

The template content for section 1 (rot rubric) is copied **verbatim** from the framework's `features/regression/vocabulary.md` `## Rot-Detection Rubric` block so the two diverge only via deliberate edits to both. Section 2 is a single placeholder block with a clearly-marked TODO comment for slice #3. Section 3 is a minimal universal seed: a `Background` execution-pattern enumeration plus three small `Given/When/Then` tables with repo-agnostic phrases.

### Phase 2: Core Implementation

Wire `adwInit.tsx` to pass the framework repo root as a 4th positional arg to the `/adw_init` slash command, and modify `.claude/commands/adw_init.md` step 7 to:

1. Document the new `frameworkRepoRoot: $3` variable alongside the existing `issueNumber`, `adwId`, `issueJson` args.
2. Instruct the agent (using Bash `cp`) to copy `$3/templates/vocabulary.md.template` to `features/regression/vocabulary.md` in the target repo worktree.
3. Always include `## Per-Issue Scenario Directory` (value: `features/per-issue/`) and `## Regression Scenario Directory` (value: `features/regression/`) sections in the generated `.adw/scenarios.md`, regardless of which scenario tool is detected.

The polymorphism flag values are fixed (`features/per-issue/`, `features/regression/`) per the PRD's user story 17, which names the canonical path. Non-Cucumber repos (Playwright, Cypress) still receive these flags pointing at `features/per-issue/` and `features/regression/`; the convention is a deliberate framework constant for this slice. Slice #3+ may refine.

### Phase 3: Integration

Add per-issue BDD scenarios under `features/per-issue/feature-507.feature` plus their step definitions and JSONL manifest fixtures. The scenarios validate **observable orchestrator outputs** (files written to the target worktree, content of those files) — not source-file properties of the framework. This is consistent with the rot-prevention rubric the slice itself distributes.

Two scenarios cover the artefact outputs:

1. After `/adw_init` runs against a fresh target repo, `features/regression/vocabulary.md` exists in the target worktree and contains the literal `## Rot-Detection Rubric` heading.
2. After `/adw_init` runs against a fresh target repo, `.adw/scenarios.md` in the target worktree contains both `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` section headers, with the canonical directory values.

The scenarios exercise the slash-command stub via the existing `claude-cli-stub` + JSONL manifest pattern (see `features/per-issue/feature-506.feature` and `test/fixtures/jsonl/manifests/scenario-writer-*.json` for prior art). They do **not** boot the full `adwInit.tsx` orchestrator (depaudit setup, target-repo clone, commit, PR creation) — that surface is out of scope for per-issue scenarios in this slice.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Create `templates/vocabulary.md.template`

- Create the new top-level `templates/` directory in the framework repo.
- Write `templates/vocabulary.md.template` with three sections:
  - `# Regression Vocabulary Registry` (title)
  - `## Rot-Detection Rubric` — **copied verbatim** from `features/regression/vocabulary.md` lines 1–14 (the rubric paragraph). Do not edit the wording; the canonical source is the framework's own vocabulary file.
  - `## Observability Surfaces (Examples)` — a single block with a `<!-- TODO (slice #3, issue ??): Populate this section with repo-specific examples of observability surfaces — state files, mock servers, git artifacts, log streams, exit codes — that scenarios in this repo can validly assert against. The slice #3 LLM-drafting step will fill this block based on the detected project stack and dependencies. -->` comment.
  - `## Three Permitted Execution Patterns` — a numbered list of three patterns: Subprocess, Function/module import, Mock query.
  - `## Given — Subprocess / Mock Setup` (table with two repo-agnostic seed phrases for subprocess fixture loading and mock-server configuration).
  - `## When — Invocation` (table with one repo-agnostic seed phrase for subprocess invocation).
  - `## Then — State / Mock / Exit Assertions` (table with two repo-agnostic seed phrases: subprocess exit code, mock-server request recorded).
- The template is checked in (no `.gitignore` entry needed).

### 2. Update `adws/adwInit.tsx` to resolve and pass the framework repo root

- Add `import * as path from 'path';` and `import { fileURLToPath } from 'node:url';` if not already present.
- Inside `main()`, after computing `config` and before invoking `runClaudeAgentWithCommand`, resolve the framework repo root: `const currentDir = path.dirname(fileURLToPath(import.meta.url)); const frameworkRepoRoot = path.resolve(currentDir, '..');`
  (Mirrors the resolution pattern in `adws/phases/worktreeSetup.ts` lines 116–117, adjusted for `adwInit.tsx` living one directory shallower than `worktreeSetup.ts`.)
- Extend the args array passed to `runClaudeAgentWithCommand`:
  - From: `[String(config.issueNumber), config.adwId, issueJson]`
  - To: `[String(config.issueNumber), config.adwId, issueJson, frameworkRepoRoot]`
- No other orchestrator-side changes required.

### 3. Update `.claude/commands/adw_init.md`

- Under `## Variables`, add a fourth bullet: `frameworkRepoRoot: $3 — Absolute path to the ADW framework repository root. Used by step 7 to locate `templates/vocabulary.md.template`. Default: empty string (skip template copy if empty).`
- Update the `CRITICAL: $0 is ALWAYS the numeric issue number...` paragraph to acknowledge the new $3 arg.
- Extend step 7 (`Create .adw/scenarios.md`) to add three new sub-bullets after the scenario-tool detection rules:
  - **Always include** a `## Per-Issue Scenario Directory` section with value `features/per-issue/` (independent of the detected scenario tool).
  - **Always include** a `## Regression Scenario Directory` section with value `features/regression/` (independent of the detected scenario tool).
  - **Copy the framework vocabulary template**: if `$3` (`frameworkRepoRoot`) is non-empty, run `cp "$3/templates/vocabulary.md.template" features/regression/vocabulary.md` via the Bash tool. Create the `features/regression/` directory first if it does not exist. If `$3` is empty (legacy invocation), skip the copy and log a warning in the step 8 report.
- Update step 8 (`Report`) to mention `features/regression/vocabulary.md` in the list of files created (when copied) and to call out both new polymorphism flag sections in the report.

### 4. Add BDD scenario file `features/per-issue/feature-507.feature`

- Header tags: `@adw-507 @adw-nnny1e-vocabulary-md-templa`
- Feature line: `Feature: adwInit distributes vocabulary.md template and writes polymorphism flags to scenarios.md`
- Background prose explaining the slice context and the observability-only assertion contract.
- Scenario 1 — `adwInit writes features/regression/vocabulary.md in the target repo from the framework template`:
  - Given a fresh target repo "tgt-507-vocab" with no `features/regression/vocabulary.md`
  - And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-vocab-and-flags.json"
  - When the /adw_init agent is invoked in target repo "tgt-507-vocab" with adwId "ai-507-1" for issue 950 and frameworkRepoRoot "{frameworkRepoRoot}"
  - Then the artefact file at "features/regression/vocabulary.md" exists in target repo "tgt-507-vocab"
  - And the artefact file at "features/regression/vocabulary.md" contains the heading "## Rot-Detection Rubric"
  - And the artefact file at "features/regression/vocabulary.md" contains the heading "## Three Permitted Execution Patterns"
- Scenario 2 — `adwInit writes both polymorphism flag sections to .adw/scenarios.md by default`:
  - Given a fresh target repo "tgt-507-flags" with no `.adw/scenarios.md`
  - And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-init-flags-only.json"
  - When the /adw_init agent is invoked in target repo "tgt-507-flags" with adwId "ai-507-2" for issue 951 and frameworkRepoRoot "{frameworkRepoRoot}"
  - Then the artefact file at ".adw/scenarios.md" exists in target repo "tgt-507-flags"
  - And the artefact file at ".adw/scenarios.md" contains the heading "## Per-Issue Scenario Directory"
  - And the artefact file at ".adw/scenarios.md" contains the heading "## Regression Scenario Directory"
  - And the artefact file at ".adw/scenarios.md" Per-Issue Scenario Directory value is "features/per-issue/"
  - And the artefact file at ".adw/scenarios.md" Regression Scenario Directory value is "features/regression/"

### 5. Add JSONL manifest fixtures

- Create `test/fixtures/jsonl/manifests/adw-init-vocab-and-flags.json` modelled on `test/fixtures/jsonl/manifests/scenario-writer-*.json`. The manifest sequences: (a) tool_use `bash` invoking `cp "$3/templates/vocabulary.md.template" features/regression/vocabulary.md`, (b) tool_use `write` writing `.adw/scenarios.md` with both polymorphism flag sections present, (c) result message exiting cleanly.
- Create `test/fixtures/jsonl/manifests/adw-init-flags-only.json`. The manifest sequences: (a) tool_use `write` writing `.adw/scenarios.md` with both polymorphism flag sections present, (b) result message exiting cleanly.

### 6. Add step definitions `features/per-issue/step_definitions/feature-507.steps.ts`

- Implement the new Given/When/Then step phrases:
  - `Given a fresh target repo {string} with no {string}` — initialises a clean temp git worktree at the named path, ensures the named file is absent.
  - `When the /adw_init agent is invoked in target repo {string} with adwId {string} for issue {int} and frameworkRepoRoot {string}` — invokes the `/adw_init` agent through the claude-cli-stub with the manifest already configured in the prior Given, passing the 4 positional args.
  - `Then the artefact file at {string} exists in target repo {string}` — asserts the named file is present in the target worktree.
  - `Then the artefact file at {string} contains the heading {string}` — reads the file, asserts the literal heading string is present as a substring of a line starting with `#`.
  - `Then the artefact file at {string} Per-Issue Scenario Directory value is {string}` — parses the named scenarios.md, asserts the line directly under `## Per-Issue Scenario Directory` equals the expected value (stripping trailing slashes for comparison).
  - `Then the artefact file at {string} Regression Scenario Directory value is {string}` — symmetric assertion.
- Re-use existing helpers from `features/per-issue/step_definitions/feature-506.steps.ts` and `features/regression/step_definitions/world.ts` where applicable.
- All step phrases follow the rot-prevention rubric: they assert on artefacts (files written to the target worktree by the orchestrator), not on source files. The `... contains the heading ...` step reads the target worktree's `features/regression/vocabulary.md` — an artefact written by the orchestrator — not the framework's `templates/vocabulary.md.template` source.

### 7. Update `app_docs/` is **deferred** to the documentation phase

The build phase does not write documentation. Documentation lands in the documentation phase after merge, as a separate `app_docs/feature-nnny1e-vocabulary-template-and-flags.md` entry that summarises the new template asset, the orchestrator arg change, the prompt update, and the BDD coverage.

### 8. Run the validation commands

Run every command in `## Validation Commands` and confirm zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope when they pay for themselves.

This slice's changes are:

- A static template file (`templates/vocabulary.md.template`) — pure content, no logic to unit-test. A structural unit test that asserts the three required section headers parse correctly adds defensive coverage cheaply.
- An orchestrator arg-passing change in `adwInit.tsx` (one new `frameworkRepoRoot` resolution, one new positional arg in the `runClaudeAgentWithCommand` call) — too thin to justify a dedicated unit test; integration coverage via the BDD scenarios is sufficient.
- A prompt change in `.claude/commands/adw_init.md` — not unit-testable directly; covered by BDD scenarios that observe the agent's artefact outputs through the manifest stub.

Concrete unit-test work:

1. **`adws/__tests__/vocabularyTemplate.test.ts`** — assert that `templates/vocabulary.md.template` exists at the framework repo root, that it parses to three top-level section headings (`## Rot-Detection Rubric`, `## Observability Surfaces (Examples)`, `## Three Permitted Execution Patterns`), and that the rubric section contains the literal forbidden-pattern bullets (`File shape`, `File content via substring match`, `Structural source-file assertions`). The test uses `fs.readFileSync` against the template path resolved from the test file's `import.meta.url`. This is a check on the framework's own template artefact (which functions as a checked-in fixture); it is permitted because the template is the **subject under test**, not a source-code property of unrelated production code.
   - Reads the template once via `fs.readFileSync`, asserts on parsed structure.
   - Does **not** assert on the seed-phrase table content beyond presence of the table header — keeps the test resilient to future seed-phrase additions.

### Edge Cases

- **Legacy `/adw_init` invocations without `$3`**: When `frameworkRepoRoot` is empty (e.g. an older harness or a manual run), step 7 logs a warning and skips the template copy. The `.adw/scenarios.md` polymorphism flags are still written (they do not depend on `$3`). BDD scenario `adw-init-flags-only.json` validates this path.
- **`features/regression/` directory already exists in target repo**: The Bash `cp` overwrites `features/regression/vocabulary.md` if present, matching the verbatim-distribution requirement. No backup is created. Target repos with custom vocabulary files lose them on re-init — documented behaviour; re-init is rare.
- **Non-Cucumber target repo (Playwright, Cypress) initialised with these flags**: The polymorphism flag sections point at `features/per-issue/` and `features/regression/` regardless of detected tool. For non-Cucumber repos these directories will not yet exist; that is acceptable — scenario_writer creates them on first invocation per the existing polymorphism contract.
- **`frameworkRepoRoot` contains a space or shell metacharacter**: The `cp` command quotes `$3` (`cp "$3/templates/vocabulary.md.template" ...`) so paths with spaces work. Shell metacharacters in `$3` are theoretically a concern but `import.meta.url` resolution always produces a clean absolute path under normal operation.
- **`templates/vocabulary.md.template` missing from framework repo**: Bash `cp` fails with a non-zero exit; the `/adw_init` agent surfaces the error in its output. This is a regression smoke condition — the framework repo missing its own checked-in template indicates a packaging defect. No special handling required.

## Acceptance Criteria

- [ ] `templates/vocabulary.md.template` exists in the framework repo and contains three top-level sections: `## Rot-Detection Rubric`, `## Observability Surfaces (Examples)` (TODO placeholder), `## Three Permitted Execution Patterns` (with minimal universal seed tables for Given/When/Then).
- [ ] The rubric section is byte-identical to lines 1–14 of `features/regression/vocabulary.md` (the framework's own Rot-Detection Rubric paragraph).
- [ ] `.claude/commands/adw_init.md` step 7 has been extended to instruct the agent to: (a) copy `$3/templates/vocabulary.md.template` to `features/regression/vocabulary.md` in the target repo via Bash `cp`, and (b) always write `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` sections in the generated `.adw/scenarios.md`.
- [ ] `.claude/commands/adw_init.md` declares `frameworkRepoRoot: $3` in the Variables block.
- [ ] `adws/adwInit.tsx` resolves the framework repo root from `import.meta.url` and passes it as the 4th positional argument to `runClaudeAgentWithCommand('/adw_init', ...)`.
- [ ] `features/per-issue/feature-507.feature` exists, is tagged `@adw-507 @adw-nnny1e-vocabulary-md-templa`, and contains the two scenarios described in step 4.
- [ ] `features/per-issue/step_definitions/feature-507.steps.ts` exists and implements all step phrases used by the feature file.
- [ ] `test/fixtures/jsonl/manifests/adw-init-vocab-and-flags.json` and `test/fixtures/jsonl/manifests/adw-init-flags-only.json` exist and produce the agent behaviours described in step 5.
- [ ] `adws/__tests__/vocabularyTemplate.test.ts` exists and passes under `bun run test:unit`.
- [ ] `bunx cucumber-js --tags "@adw-507"` exits 0 with both scenarios passing.
- [ ] `bun run test:unit` exits 0 (no regressions in existing unit suite).
- [ ] `bunx cucumber-js --tags "@regression"` exits 0 (no regressions in regression suite).
- [ ] `bun run lint` exits 0.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` exit 0.
- [ ] `bun run build` exits 0.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint checks pass with no new violations.
- `bunx tsc --noEmit` — Root TypeScript type-checks cleanly.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type-checks cleanly.
- `bun run test:unit` — Unit-test suite passes (including the new `vocabularyTemplate.test.ts`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-507"` — Issue-507 BDD scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Regression scenarios pass with no rot regressions.
- `bun run build` — Project builds cleanly.

## Notes

- This slice is the **target-repo distribution half** of the rot-prevention story whose **framework-prompt half** landed in issue #506 (`app_docs/feature-mzgyjj-rot-prevention-block.md`). After both slices ship, every `scenario_writer` invocation — in the framework repo or any target repo onboarded via `adwInit` — refuses the file-existence / substring-match / structural-parsing patterns and prefers registered vocabulary phrases.

- **The examples block (section 2) is a deliberate TODO placeholder.** Slice #3 will add LLM-drafting of the repo-specific observability-surfaces examples based on the detected project stack and dependencies. Until then, target repos start with the universal principle + seed phrases + a clearly-marked TODO marker that PR reviewers cannot mistake for finished content.

- **The `frameworkRepoRoot` arg is a generic 4th-slot extension** that other slash commands could use in the future. We do not refactor the args interface in this slice — passing one more positional arg is the smallest change that satisfies the requirement.

- **No backwards-compatibility shim**: if a future runner invokes `/adw_init` with only 3 args, the empty `$3` is detected at step 7 and the template copy is skipped with a warning. The polymorphism flags are still written. This keeps the prompt usable from legacy harness invocations during the rollout.

- **Out of scope (deferred to later slices):**
  - LLM-drafting the examples block based on detected stack (slice #3).
  - Writing `## Vocabulary Registry` to `.adw/scenarios.md` so `generate_step_definitions` enforces the registry (slice #3 or #4).
  - Backporting `vocabulary.md.template` to existing target repos that pre-date this slice (deferred per PRD "Out of Scope" section — needs an `adwUpgrade`-style mechanism).
  - The `promotionCommenter` / `promotionMover` / `promotionScorer` modules from the PRD (slices #4–#6).

- **Library install command** (from `.adw/commands.md` `## Library Install Command`): `bun add <package>`. This slice introduces no new dependencies.

- **Coding guidelines** (`.adw/coding_guidelines.md`): TypeScript strict mode, no `any`, guard clauses for early returns, max nesting depth ~2. The orchestrator change in step 2 is a four-line addition to `adwInit.tsx` and fits within guidelines without refactoring.

- **Conditional docs to consult during implementation:**
  - `app_docs/feature-mzgyjj-rot-prevention-block.md` — sibling slice; same per-issue scenario style.
  - `app_docs/feature-4jvczx-adw-init-schema-updates.md` — prior adw_init.md schema modifications.
  - `app_docs/feature-8w4fep-adw-init-commands-md-scenario-sections.md` — step 7 prior modification.
  - `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` — cross-repo file distribution precedent.
