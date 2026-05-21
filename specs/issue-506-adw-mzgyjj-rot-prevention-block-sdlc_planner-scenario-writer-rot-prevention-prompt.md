# Feature: Rot Prevention Instruction Block in `scenario_writer.md` Prompt

## Metadata
issueNumber: `506`
adwId: `mzgyjj-rot-prevention-block`
issueJson: `{"number":506,"title":"Rot prevention block in scenario_writer.md prompt","body":"## Parent PRD\n\n`specs/prd/scenario-rot-prevention-and-promotion.md`\n\n## What to build\n\nAdd a \"Rot Prevention\" instruction block to the framework `.claude/commands/scenario_writer.md` prompt. The block must explicitly prohibit scenarios that:\n\n- Check whether a file exists\n- Match substrings in file contents\n- Parse and assert against the structure of source files\n\nThe block also instructs the agent to read `features/regression/vocabulary.md` from the target repo and prefer phrases already registered there before introducing novel phrasing.\n\nThis is the upstream half of the design — it changes `scenario_writer`'s behaviour across all target repos via the single framework prompt, with no per-repo configuration required.\n\n## Acceptance criteria\n\n- [ ] `.claude/commands/scenario_writer.md` contains a \"Rot Prevention\" instruction section listing the three explicit prohibitions\n- [ ] The instruction tells the agent to read `features/regression/vocabulary.md` if it exists in the target repo\n- [ ] Existing `scenario_writer.md` polymorphism on `.adw/scenarios.md` is preserved\n- [ ] Existing regression smoke tests in `features/regression/` still pass\n\n## Blocked by\n\nNone — can start immediately.\n\n## User stories addressed\n\n- User story 1 (refuse rot scenarios)\n- User story 2 (rule in framework prompt, not per-repo config)\n- User story 3 (vocabulary.md remains canonical reference)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-20T22:44:04Z","comments":[{"author":"paysdoc","createdAt":"2026-05-21T09:27:54Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description

Add a "Rot Prevention" instruction block to the framework prompt at `.claude/commands/scenario_writer.md`. The block must explicitly prohibit the Scenario Writer Agent from generating BDD scenarios that:

1. Check whether a file exists,
2. Match substrings against file contents,
3. Parse and assert against the structure of source files.

The block must also instruct the agent to read `features/regression/vocabulary.md` from the target repository (when present) and prefer phrases already registered there before inventing novel Gherkin phrasing.

This is the **upstream half** of the parent PRD (`specs/prd/scenario-rot-prevention-and-promotion.md`). Because the change lives in the single framework prompt rather than in `.adw/scenarios.md` or any target-repo configuration, it applies uniformly to every `scenario_writer` invocation across every target repository with no per-repo onboarding work. The downstream half (confidence-scored promotion suggestions, `hitl` gate, `promotionMover`, `vocabulary.md.template` distribution via `adwInit`) is intentionally **out of scope** for this issue — those modules are tracked separately under the same PRD.

The value to users: it closes the regression vector identified by issues #491–#493, where scenarios asserting on file shape and source-file content drifted into `features/regression/` and had to be retroactively removed. Once this prompt change ships, `scenario_writer` itself refuses to produce that shape of scenario, eliminating the need for retroactive cleanup.

## User Story

As an ADW developer
I want `scenario_writer` to refuse to write scenarios that assert against file existence, file contents, or source-file structure — and to prefer phrases already in `features/regression/vocabulary.md` when present — so that the rot pattern removed in #491–#493 cannot silently re-enter the codebase, and so target repos benefit from the rule without any per-repo configuration burden.

## Problem Statement

The `scenario_writer` agent (driven by `.claude/commands/scenario_writer.md`) currently has no explicit guidance about what makes a scenario *behavioural* versus *structural*. It will happily produce Gherkin like `Then the file "src/foo.ts" contains "bar"` or `Then config.ts exists`, which:

- Assert against source-code shape rather than observable system behaviour,
- Are brittle across refactors that preserve behaviour but rename or relocate files,
- Were exactly the rot pattern that issues #491–#493 spent effort removing from `features/regression/`.

`features/regression/vocabulary.md` already encodes a "Rot-Detection Rubric" and a registry of approved phrases keyed to observable assertion targets (state files, recorded API calls, git artifacts). However, the agent is not told to consult it, nor is it told what the rubric prohibits. The result: the agent re-derives scenario style from scratch every run, with no enforcement of the rubric. The rubric exists; the agent does not look at it.

Target repos onboarded via `adwInit` do not yet receive a `vocabulary.md` of their own (that ships in a separate slice of the PRD), so the prompt must degrade gracefully when the file is absent — but in the framework repo and in any target repo that has been seeded with a vocabulary, the agent must read it and prefer its phrases.

## Solution Statement

Edit `.claude/commands/scenario_writer.md` to add a new "Rot Prevention" section between the existing "Polymorphism on `.adw/scenarios.md`" section and the "Instructions" section (or as the first numbered instruction inside "Instructions" — placement decided during implementation, see Notes). The new section:

1. **Lists the three explicit prohibitions** verbatim and in identifying detail: no file-existence checks, no substring matches against file contents, no structural source-file parsing.
2. **Defines the permitted alternative**: phrases must assert against observable system *outputs* — state files written by orchestrators, recorded calls on a mock server, git artifacts produced by phases — i.e. *artefacts*, not source files. This wording mirrors the rubric already in `features/regression/vocabulary.md` so that the prompt and the rubric reinforce one another rather than drifting.
3. **Instructs the agent to read `features/regression/vocabulary.md`** at the start of each run *if the file exists in the target repo*. When present, the agent must prefer registered phrases and treat novel phrasing as a last resort that needs justification.
4. **Degrades gracefully** when `features/regression/vocabulary.md` is absent: the prohibitions still apply, the vocabulary-preference instruction is a no-op.

No code changes are required: this is a prompt-only edit. The existing polymorphism on `.adw/scenarios.md` (per-issue directory, regression directory, vocabulary registry path detection) is left untouched. No new files are created. No dependencies are added.

The regression smoke tests in `features/regression/smoke/` do not exercise `scenario_writer` directly (they cover `adwSdlc`, `adwChore`, cron probe, cancel directive, and pause/resume), so they must continue to pass unchanged after the prompt edit. Validation is therefore: lint, type-check, unit-test suite, and the existing `@regression` cucumber sweep.

## Relevant Files

Use these files to implement the feature:

- `.claude/commands/scenario_writer.md` — **Primary edit target.** The framework prompt for the Scenario Writer Agent. The "Rot Prevention" section is added here. Existing structure (front-matter `target: false`, Arguments, Polymorphism, Instructions steps 1–7, Output) must be preserved verbatim except for the new section insertion.
- `specs/prd/scenario-rot-prevention-and-promotion.md` — Parent PRD. Provides the design rationale, the wording of the rot rubric, the relationship between the prompt change and the (out-of-scope) downstream promotion mechanism, and the user-story map. Read this to confirm wording before editing the prompt.
- `features/regression/vocabulary.md` — Existing canonical vocabulary registry in the framework repo. The "Rot-Detection Rubric" (lines 3–14) and "Three Permitted Execution Patterns" (lines 16–28) sections supply the wording to mirror in the prompt's new section so the two documents agree.
- `.adw/scenarios.md` — Existing polymorphism config. Already references `## Vocabulary Registry → features/regression/vocabulary.md`. The prompt edit must not change how this file is consumed; it only adds a new instruction telling the agent to *read* the registry path.
- `.adw/project.md` — Project config; declares `## Unit Tests: enabled` and lists relevant files. Unit-tests are enabled at the project level, but this change is prompt-only and has no TypeScript surface to unit-test (see Testing Strategy and Notes).
- `.adw/commands.md` — Project commands; supplies the validation commands (`bun run lint`, `bunx tsc --noEmit`, `bun run test:unit`, `bun run build`, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`) referenced in Validation Commands below.
- `features/regression/smoke/adw_sdlc_happy_path.feature` — Existing regression smoke scenario; must continue to pass after the prompt edit. Representative of the suite that validates the prompt change does not regress upstream orchestrators.
- `features/regression/smoke/adw_chore_diff_verdicts.feature`, `features/regression/smoke/cron_trigger_spawn.feature`, `features/regression/smoke/cancel_directive.feature`, `features/regression/smoke/pause_resume_rate_limit.feature` — Remaining regression smoke scenarios. Same role: continued passing is the validation gate.
- `app_docs/feature-tepq39-scenario-writer-opus-model.md` — Conditional-docs match: relevant when modifying the `/scenario_writer` slash command. Provides context that `/scenario_writer` runs on `opus` (standard) / `sonnet` (fast) and that the routing happens through `SLASH_COMMAND_MODEL_MAP` in `adws/core/config.ts`. No code change needed in this slice — model routing is unchanged — but worth a quick read to confirm the prompt edit has no downstream model-tier implications.

## Implementation Plan

### Phase 1: Foundation

Confirm the canonical wording. Read `features/regression/vocabulary.md` lines 3–28 (Rot-Detection Rubric and Three Permitted Execution Patterns) and the parent PRD's "Solution" paragraph for the rot-prevention rule. The new prompt section must use language consistent with both — the goal is one rule, expressed identically in the rubric document and in the framework prompt, so they cannot drift apart.

Confirm the prompt's existing structure. The current `.claude/commands/scenario_writer.md` is organised as:

- Front-matter (`target: false`)
- `# Scenario Writer Agent` title and one-line role description
- `## Arguments` (issue number, ADW workflow ID, issue JSON)
- `## Polymorphism on `.adw/scenarios.md`` (branches on three optional sections)
- `## Instructions` with numbered steps 1–7 (Read configuration, Detect or bootstrap E2E tool, Parse the issue, Read existing scenario files, Write scenarios for this issue, `@regression` tag maintenance sweep, Output)

The new `## Rot Prevention` section is inserted **after `## Polymorphism on `.adw/scenarios.md`` and before `## Instructions`**. Rationale: polymorphism describes routing decisions (where to write); rot prevention describes content decisions (what to write); instructions describe the procedure. Content rules logically sit between routing and procedure. (This placement is reviewed in Phase 2 — if reading flows better with the rot block as the first numbered instruction inside `## Instructions`, that alternative is acceptable; see Notes.)

### Phase 2: Core Implementation

Insert the `## Rot Prevention` section. The section contains four parts:

1. **The three explicit prohibitions** (a short bulleted list, prefixed by a one-sentence rule). Wording aligns with `features/regression/vocabulary.md` lines 6–10. Concretely the section names the three prohibited shapes — file-existence checks, file-content substring matches, structural source-file parsing — and explicitly identifies each with the kind of read/parse call it corresponds to so the agent cannot rationalise around the rule.

2. **The permitted alternative**, stating that scenarios *may* assert on the system's observable *outputs* (state files written by orchestrators, recorded API calls captured by mock servers, git artifacts produced by phases) because those are artefacts, not source files. This mirrors `features/regression/vocabulary.md` lines 11–14.

3. **The vocabulary-preference instruction**: at the start of the run, the agent reads `features/regression/vocabulary.md` *if it exists in the target repo*. When present, the agent must prefer phrases already registered there. Novel phrasing is allowed only when no registered phrase fits, and the agent should note the gap (so a downstream curator can extend the registry). When the file is absent (e.g. a freshly onboarded target repo whose `adwInit` slice has not yet seeded a vocabulary), the prohibitions still apply but the preference step is a no-op.

4. **A note that the rule applies universally** — every scenario written by the agent, in every target repo, on every invocation — and is not overridable by `.adw/scenarios.md` or any per-repo configuration. This makes it unambiguous that the rule is framework-owned.

The section is written in the same imperative voice and Markdown style as the existing prompt (numbered list / bulleted sub-points, no front-matter changes, no new headings beyond the one new H2).

### Phase 3: Integration

Verify zero regression in the rest of the prompt. The polymorphism branches in step 5 (per-issue directory routing) and step 6 (`@regression` sweep skip-when-regression-directory-configured) must continue to read exactly as before. The Arguments section and the Output template must be unchanged.

Verify that the prompt remains internally consistent. Step 1 currently tells the agent to read `.adw/scenarios.md`. The new section adds a sibling instruction to read `features/regression/vocabulary.md`. The two reads are independent; they should both happen during the agent's setup phase. If the rot-prevention section is placed as a new numbered step *inside* `## Instructions` (the alternative placement noted in Phase 1), it would be Step 1.5 / new Step 2 — both reads completed before scenario authoring begins. Either way, the agent must have read the vocabulary before writing scenarios.

Run the full validation gate. Lint, type-check, unit tests, build, and `@regression` cucumber sweep. None of these directly exercises the prompt text, but the prompt edit must not introduce ambient regressions (e.g. accidentally deleting a section). Cucumber `@regression` sweep is the load-bearing check: the existing smoke scenarios exercise the orchestrator pipeline end-to-end against a programmable Claude CLI stub, and any breakage of the scenario-writer phase wiring would surface there.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Read the PRD and the existing prompt
- Read `specs/prd/scenario-rot-prevention-and-promotion.md` Solution paragraph (lines 16–28) and User Stories 1–3 (lines 32–34) to confirm intended wording.
- Read `.claude/commands/scenario_writer.md` end-to-end to confirm current section layout and to identify the exact insertion point.
- Read `features/regression/vocabulary.md` lines 1–28 to capture the canonical wording of the Rot-Detection Rubric and the Three Permitted Execution Patterns.

### Draft the new `## Rot Prevention` section
- Open `.claude/commands/scenario_writer.md` for editing.
- Insert a new `## Rot Prevention` section between `## Polymorphism on `.adw/scenarios.md`` and `## Instructions`. (Alternative placement: as a new first numbered item inside `## Instructions`, e.g. "1. Read configuration and rot-prevention vocabulary" with the existing Step 1 content folded under it. See Notes for the decision rule.)
- Open the section with a one-sentence rule: scenarios must assert observable system behaviour, not source-code properties.
- List the three explicit prohibitions as bullets:
  - Checking whether a file exists.
  - Matching substrings against file contents (e.g. `readFileSync(...).includes(...)`).
  - Parsing and asserting against the structure of source files (e.g. `JSON.parse(readFileSync(config.ts))`).
- Add the permitted-alternative paragraph: scenarios *may* assert against the *outputs* of the system under test — state files written by orchestrators, recorded calls on a mock server, git artifacts produced by phases — because those are artefacts, not source files.
- Add the vocabulary-preference instruction: at the start of each run, the agent reads `features/regression/vocabulary.md` from the target repo if it exists. When present, prefer phrases already registered there; introduce novel phrasing only when no registered phrase fits, and surface the gap in the agent's Output section so it is visible to the maintainer.
- Add the universality note: the rule applies to every scenario written, in every target repo, on every invocation. It is framework-owned and not overridable via `.adw/scenarios.md` or any per-repo configuration.

### Preserve existing prompt structure
- Re-read the file end-to-end to confirm:
  - Front-matter `target: false` is unchanged.
  - The `## Arguments` block is unchanged.
  - The `## Polymorphism on `.adw/scenarios.md`` section is unchanged (per-issue dir, regression dir, fallback rules all intact).
  - The `## Instructions` steps 1–7 are unchanged in numbering, in heading, and in body content. (If the alternative placement was chosen — new step inside Instructions — confirm the original Step 1 body is folded correctly and the remaining steps renumber consistently.)
  - The `## Output` template at step 7 is unchanged.
- If any unintended deletions are spotted, restore them.

### Lint and type-check
- Run `bun run lint`.
- Run `bunx tsc --noEmit`.
- Run `bunx tsc --noEmit -p adws/tsconfig.json`.
- These are sanity checks for the repository as a whole — the prompt edit is a Markdown change and should not affect either pass, but a green lint/type-check confirms no inadvertent code touches.

### Run unit tests
- Run `bun run test:unit`.
- Expectation: all existing unit tests pass unchanged. No new unit tests are added — the prompt is not a unit-testable surface; see Testing Strategy.

### Run the regression smoke suite
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`.
- Expectation: all existing smoke scenarios (`adw_sdlc_happy_path`, `adw_chore_diff_verdicts`, `cron_trigger_spawn`, `cancel_directive`, `pause_resume_rate_limit`) pass without modification. The prompt edit is invisible to these scenarios because they exercise the orchestrators against a programmable Claude CLI stub — they do not depend on the actual content of `scenario_writer.md`.

### Build
- Run `bun run build`.
- Expectation: green build.

### Final review of the prompt
- Re-read `.claude/commands/scenario_writer.md` one final time, end-to-end, in its final form. Confirm:
  - The `## Rot Prevention` section is present and clearly worded.
  - The three prohibitions are explicit, identified by example call patterns, and not paraphrasable into permitting structural assertions.
  - The vocabulary-read instruction names the exact path `features/regression/vocabulary.md` and explicitly handles the absent-file case.
  - All four acceptance criteria from the issue body are satisfied.

### Run the full validation gate
- Execute every command listed in `## Validation Commands` below in order. Every command must exit zero.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit-test surfaces are in scope at the project level. However, **this change is prompt-only**: the only edit is to a Markdown file (`.claude/commands/scenario_writer.md`) that is consumed by the Claude CLI at agent-run time. There is no TypeScript module, no exported function, and no parseable structure to assert against. The PRD itself observes this (line 119): "Prompt changes are not unit-testable directly. Their effects are observed via the regression suite — if a prompt regresses, smoke scenarios in `features/regression/` will fail."

Concretely: no new unit-test files are written, no new unit-test code is added. The existing unit-test suite (`bun run test:unit`) must continue to pass unchanged — that is the only unit-test guarantee this slice provides, and it is the appropriate one for a prompt-only edit. Any attempt to "unit-test" the prompt by string-matching the new section would be a tautology (we just inserted that string) and would add maintenance friction without catching real regressions.

### Edge Cases

- **Target repo has no `features/regression/vocabulary.md`.** The vocabulary-read instruction must degrade to a no-op. The three prohibitions still apply. (Verified by reading the prompt: the read is conditional on file existence; absence does not block scenario authoring.)
- **Target repo has a `features/regression/vocabulary.md` but with malformed Markdown.** Out of scope for this slice. The downstream `vocabularyParser` module (PRD section "Modules") owns malformed-input handling and is tracked separately. For this slice, the agent reads the file as a reference document; it is not required to parse a structured registry.
- **`.adw/scenarios.md` points its `## Vocabulary Registry` section to a non-default path.** The prompt edit instructs the agent to read `features/regression/vocabulary.md` — the framework canonical path. The `.adw/scenarios.md` `## Vocabulary Registry` polymorphism is consumed by `generate_step_definitions` (per the PRD, line 64), not by `scenario_writer`. This slice does not change that contract. The agent reads the framework canonical path; downstream step-definition validation reads the configured registry path.
- **The agent runs against a target repo where `features/per-issue/` does not yet exist** (e.g. first scenario for a freshly onboarded repo whose `.adw/scenarios.md` includes `## Per-Issue Scenario Directory`). The existing polymorphism handling already covers this (Step 5 creates the directory implicitly when writing the file). This slice does not alter that behaviour.
- **The agent is invoked on an issue whose body explicitly requests a file-existence check** (e.g. user issue says "scenario should check that foo.ts exists"). The prompt's Rot Prevention section overrides any such instruction. The agent must refuse the structural check and instead express the intent as an observable-output assertion (or, if no such observable exists, surface that gap in the Output section rather than emit a rot scenario). This is the load-bearing behavioural change of the slice.
- **The agent's existing polymorphism on `.adw/scenarios.md` interacts with the new rot rule.** The new section is content-level; the polymorphism is routing-level. They are independent: scenarios written under any routing decision (per-issue dir, default dir, free-form) must obey the rot rule. The prompt makes this clear by stating the rule applies to "every scenario written".
- **Step 6 `@regression` sweep encounters legacy rot scenarios already in the regression directory.** The sweep step is unchanged by this slice and continues to make promote/demote decisions on existing scenarios. The new rule applies only to scenarios *written or modified* by this agent run; legacy scenarios are not retroactively rewritten. (Retroactive cleanup of legacy rot is the work that issues #491–#493 already completed.)

## Acceptance Criteria

The criteria below mirror and elaborate the issue body:

- [ ] `.claude/commands/scenario_writer.md` contains a new `## Rot Prevention` section that lists, as three explicit bullets, the prohibition on (a) file-existence checks, (b) substring matches against file contents, and (c) structural parsing of source files.
- [ ] The new section instructs the agent to read `features/regression/vocabulary.md` from the target repo at the start of each run, prefer phrases already registered there, and gracefully no-op when the file does not exist.
- [ ] The new section identifies the rule as universally applicable across all target repos and not overridable via `.adw/scenarios.md` or per-repo configuration.
- [ ] The new section names the permitted alternative (assertions on system *outputs*: state files, recorded API calls, git artifacts) so the prohibitions are paired with constructive guidance.
- [ ] The existing `## Polymorphism on `.adw/scenarios.md`` section is preserved verbatim (per-issue directory, regression directory, fallback rules unchanged).
- [ ] The existing `## Arguments`, `## Instructions` steps 1–7, and `## Output` template are preserved (modulo the alternative-placement decision noted in Notes; if the rot section is folded into `## Instructions` as a new first step, the original Step 1 body must be preserved inside it without semantic change).
- [ ] `bun run lint` exits zero.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` exit zero.
- [ ] `bun run test:unit` exits zero with no test additions, modifications, or removals attributable to this slice.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` passes — all existing smoke scenarios (`adw_sdlc_happy_path`, `adw_chore_diff_verdicts`, `cron_trigger_spawn`, `cancel_directive`, `pause_resume_rate_limit`) continue to pass.
- [ ] `bun run build` exits zero.
- [ ] No new files are created, no dependencies are added, and no TypeScript code is modified by this slice.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run ESLint across the repo; confirms no inadvertent code touches.
- `bunx tsc --noEmit` — Type-check the top-level TypeScript; confirms no inadvertent code touches.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` orchestrator code; confirms no inadvertent code touches.
- `bun run test:unit` — Run the unit-test suite; existing tests must continue to pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the regression smoke suite; all existing smoke scenarios must continue to pass. This is the load-bearing validation: the prompt edit must not regress the orchestrator pipeline as exercised by the smoke scenarios.
- `bun run build` — Build the project; confirms no inadvertent code touches.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` exists and applies. The edit is to a Markdown prompt file rather than TypeScript code, so most guidelines (strict mode, immutability, type narrowing, etc.) are not directly relevant. The "Clarity over cleverness" principle does apply: the new section is written in plain imperative voice, with explicit examples of prohibited shapes, so the agent cannot rationalise around the rule. Section nesting depth stays shallow (one H2, a couple of bullet lists).
- **No new libraries.** No `bun add <package>` calls. No dependency additions. The library install command per `.adw/commands.md` is `bun add <package>`; it is not needed for this slice.
- **Placement decision (insertion point of `## Rot Prevention`).** Two acceptable placements:
  1. **Between `## Polymorphism on `.adw/scenarios.md`` and `## Instructions`** as a new top-level H2 section. Pros: keeps `## Instructions` as a clean numbered procedure; the rot rule is visible at top level alongside polymorphism. Cons: a top-level section that is itself a rule (rather than a procedure step) is structurally distinct from the rest of the prompt.
  2. **Inside `## Instructions` as a new numbered step**, folded into the existing Step 1 ("Read configuration") so the configuration read and the vocabulary read happen together. Pros: keeps all procedural reads in one place; the agent reads `.adw/scenarios.md` and `features/regression/vocabulary.md` as paired setup. Cons: the three prohibitions and the universality note do not naturally fit inside a procedural step labelled "Read configuration".
  Recommendation: option (1). The rot prevention block is a *rule*, not a *step*, and lives at the same conceptual level as the polymorphism description. Option (2) remains acceptable if option (1)'s top-level placement reads as visually disruptive during implementation review.
- **Out of scope, deferred to subsequent slices of the parent PRD.**
  - `vocabularyParser`, `scenarioParser`, `promotionScorer`, `promotionThreshold`, `promotionTagWriter`, `promotionCommenter`, `promotionMover`, `adwPromotionSweep.tsx` (deep modules + orchestrators for the downstream promotion mechanism).
  - `vocabulary.md.template` checked-in framework asset.
  - `adw_init.md` step 7 extension (LLM-draft examples block, copy template into target repo, populate `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` flags by default).
  - `@promotion-suggested-<date>` tag, `hitl` label auto-application on promotion-comment PRs, separate-PR promotion-mover.
  - Auto-ramping threshold N based on 90-day promotion-activity ratio.
- **Why this slice is independently shippable.** The acceptance criteria are entirely local to `.claude/commands/scenario_writer.md` and the existing regression smoke suite. Shipping it before the downstream slices delivers immediate value (every future scenario_writer run obeys the rot rule) without coupling to the larger PRD's module work, which is significantly more involved.
- **Why the rule lives in the framework prompt rather than in `.adw/scenarios.md`.** User Story 2 of the parent PRD: target repos benefit from one source of truth and updates to the rule propagate via framework releases. If the rule were duplicated in per-repo config, each onboarded repo would need to keep its copy in sync, and a stale per-repo copy would silently re-permit rot. Framework prompt ownership is the explicit decision.
- **Why the rubric document (`features/regression/vocabulary.md`) is kept separate from the prompt.** User Story 3 of the parent PRD: `vocabulary.md` is the canonical reference for humans (PR reviewers checking scenario quality) and for downstream phrase lookup. The framework prompt encodes the agent's operative behaviour; the vocabulary document encodes the human-readable rubric and phrase registry. The prompt edit references the vocabulary document so the two stay aligned — but they remain separable so a target repo can extend its vocabulary registry without modifying its (potentially read-only-from-framework) prompt.
- **No model-tier or routing changes.** Per `app_docs/feature-tepq39-scenario-writer-opus-model.md`, `/scenario_writer` runs on `opus` (standard) / `sonnet` (fast). The prompt edit does not alter that routing or any `SLASH_COMMAND_*` map in `adws/core/config.ts`.
- **Reviewer guidance for the resulting PR.** The diff should be small (a single Markdown insertion in `.claude/commands/scenario_writer.md`). Reviewers should verify the prohibitions are stated explicitly enough that no agent could plausibly rationalise around them, and that the absence of `features/regression/vocabulary.md` in a freshly onboarded target repo is handled by the prompt wording itself (not by reliance on a downstream module that has not yet shipped).
