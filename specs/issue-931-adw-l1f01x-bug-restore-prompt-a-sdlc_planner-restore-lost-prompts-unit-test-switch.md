# Bug: Prompt and `adw_init` content lost to stray commits, two unit-test switches, and no Comments guideline in target repos

## Metadata
issueNumber: `931`
adwId: `l1f01x-bug-restore-prompt-a`
issueJson: `{"number":931,"title":"bug: restore prompt and adw_init content lost to stray commits; one unit-test switch; comment rule for target repos","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision records\n\nADR-0043 (items 1, 2 and 3), ADR-0054 (items 1 and 2).\n\n## What to build\n\n- **Polymorphic generation prompts (ADR-0043, item 1).** `generate_step_definitions.md` and `scenario_writer.md` must read the target's test descriptor (`## BDD Framework`, `## Step Def Directory`) and not hardcode Cucumber and TypeScript. Commit d45d708e holds the intended text; commit ca72a4a7 overwrote it.\n- **`adw_init` descriptor (ADR-0043, item 2).** `adw_init.md` must again emit `## Test Directory` and `## Test Framework`, and create `.github/adw.yml` when absent. Commit 1ab26649 removed these. The template function for the file exists and has no caller.\n- **One unit-test switch (ADR-0043, item 3).** `unitTests` in `.github/adw.yml`, default enabled, is the only switch. The `/feature` prompt and the `implement-tdd` skill must follow it. The `## Unit Tests` section of `.adw/project.md` is retired: no prompt reads it and nothing writes it.\n- **Feature-file rule (ADR-0054, item 1).** Restore in `scenario_writer.md` the rule added by bebda8dd and removed by c3606f9e: \"Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.\"\n- **Comment guideline for target repos (ADR-0054, item 2).** `adw_init` writes the Comments entry into the target repo's coding guidelines. Existing repos get it at their next upgrade.\n\n`adw_init.md` and the prompts are hash inputs, so this change starts an upgrade on every target repo. That is intended.\n\n## Acceptance criteria\n\n- [ ] Neither generation prompt names a BDD framework or a type-check command literally.\n- [ ] A fresh `adw_init` run produces both descriptor fields, `.github/adw.yml`, and the Comments entry.\n- [ ] No file reads `## Unit Tests` from `.adw/project.md`.\n- [ ] `scenario_writer.md` contains the feature-file rule.\n- [ ] The Divergence sections of ADR-0043 and ADR-0054 are removed in the same pull request.\n\n## Blocked by\n\n#930\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:19:59Z","comments":[],"actionableComment":null}`

## Bug Description
Five decisions recorded in ADR-0043 and ADR-0054 are not in force, because content that implemented them was lost to stray commits or never shipped.

1. **The generation prompts hardcode Cucumber and TypeScript (ADR-0043, item 1).** `.claude/commands/generate_step_definitions.md` says "Import `Given`, `When`, `Then` from `@cucumber/cucumber`", uses Cucumber `Before`/`After` hooks, and verifies each file with `bunx tsc --noEmit <path>`. `.claude/commands/scenario_writer.md` step 2 bootstraps Cucumber (installs `@cucumber/cucumber`, writes a `cucumber.js`, rewrites `.adw/commands.md`) whenever `## Run E2E Tests` is absent or `n/a`. `adw_init` stopped emitting `## Run E2E Tests` long ago, so in target repos that branch fires on every run. Neither prompt reads `## BDD Framework` or `## Step Def Directory`.
   - Expected: both prompts follow the descriptor in `.adw/scenarios.md`. The step-definition prompt writes step definitions in the named framework's idiom and runs that language's static check. The scenario writer never installs or configures a runner (Gherkin mandate).
   - Actual: a Python target gets TypeScript step definitions, and its scenario writer tries to install cucumber-js into it.
2. **`adw_init` lost part of the descriptor (ADR-0043, item 2).** `.claude/commands/adw_init.md` no longer emits `## Test Directory` or `## Test Framework` into `.adw/commands.md`, and it no longer creates `.github/adw.yml`. `writeAdwYmlTemplateIfAbsent` in `adws/core/adwYmlConfig.ts` has no caller outside its test.
   - Effect: `testDirectory` falls back to `src` and `testFramework` is empty, so the stack-coherence check (`adws/core/stackCoherenceCheck.ts`) cannot see the unit-test framework. Target repos never receive the self-documenting `.github/adw.yml`, so their operators cannot discover the `unitTests`, `hitl` and `guardrails` switches.
3. **Two unit-test switches with opposite defaults (ADR-0043, item 3).** The unit-test phase reads `unitTests` from `.github/adw.yml`, where an absent file or key means enabled (`adws/phases/unitTestPhase.ts`). The `/feature` prompt (`.claude/commands/feature.md` lines 90 and 97–99) and the `implement-tdd` skill (`.claude/skills/implement-tdd/SKILL.md` lines 63–67 and 77) read `## Unit Tests` from `.adw/project.md`, where an absent section means disabled. `adw_init.md` does not write that section.
   - Effect: in a target initialised by today's `adw_init`, planners leave unit tests out and the build agent skips them, while the unit-test phase still runs the suite. `parseUnitTestsEnabled` in `adws/core/projectConfig.ts` is exported but has no caller.
4. **The feature-file rule is missing from `scenario_writer.md` (ADR-0054, item 1).** bebda8dd added "Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident." to the scenario-writer rules. c3606f9e removed it 19 minutes later.
5. **The Comments guideline never reaches target repositories (ADR-0054, item 2).** The Comments entry exists only in ADW's own `.adw/coding_guidelines.md` (line 62). `adw_init.md` has no step that touches a target repo's coding guidelines.

## Problem Statement
- Restore the descriptor-driven generation prompts so that neither prompt names a BDD framework or a type-check command, and put the feature-file rule back in `scenario_writer.md`.
- Make a fresh `/adw_init` run emit `## Test Directory`, `## Test Framework`, `.github/adw.yml` (only when absent) and the Comments entry.
- Make the framework upgrade create `.github/adw.yml` deterministically, by giving `writeAdwYmlTemplateIfAbsent` its caller. The `@adw-931` scenarios require this: the stubbed `/adw_init` agent never runs the prompt's heredoc.
- Leave exactly one unit-test switch, `unitTests` in `.github/adw.yml` with absent meaning enabled. The `/feature` prompt and `implement-tdd` follow it, and nothing reads or writes `## Unit Tests` in `.adw/project.md`.
- Remove the `## Divergence` sections of ADR-0043 and ADR-0054 in the same pull request.
- Do not carry this worktree's stale prompt copies into the pull request. Carrying them would repeat the failure this issue repairs (see Root Cause Analysis).

## Solution Statement
- **Generation prompts.** Take `generate_step_definitions.md` and `scenario_writer.md` from d45d708e, the intended text.
  - d45d708e's `generate_step_definitions.md` still lists frameworks and check commands as examples (`@cucumber/cucumber`, `behave`, `pytest_bdd`, `godog`, `bunx tsc --noEmit`, `python -m py_compile`, `gofmt`). The acceptance criterion forbids those, so they are replaced with framework-neutral wording. The agent relies on its own knowledge of the framework named in `## BDD Framework`, which is the decision in ADR-0043.
  - Add the bebda8dd rule to `scenario_writer.md`.
- **`adw_init.md`.**
  - Restore the pre-1ab26649 `## Test Directory` and `## Test Framework` bullets.
  - Restore the `.github/adw.yml` create-if-absent step. Its heredoc must be byte-identical to today's `ADW_YML_TEMPLATE`, which now includes the `guardrails` block.
  - Add a step that writes the Comments entry into the target's coding guidelines.
  - Tell the regeneration not to write a unit-test section into `.adw/project.md`.
  - Update the report and the step-number cross-references.
- **Upgrade orchestrator.** Add a `writeAdwYmlTemplate` dependency to `UpgradeDeps`, wired to `writeAdwYmlTemplateIfAbsent`. Call it in `executeUpgrade` after the regeneration is verified and before the regen commit, as `copyStarterSettings` already is. The file rides into the regen commit, and an existing file is never touched.
- **One switch.**
  - Point the `/feature` prompt and the `implement-tdd` skill at `unitTests` in `.github/adw.yml`.
  - Delete `parseUnitTestsEnabled` and its barrel export.
  - Remove `## Unit Tests: enabled` from ADW's own `.adw/project.md`.
- **Tests.**
  - `adws/__tests__/adwUpgrade.test.ts` covers the new dependency.
  - A new `adws/__tests__/adwInitPrompt.test.ts` fails if `adw_init.md`'s heredoc drifts from `ADW_YML_TEMPLATE`, or its Comments entry drifts from ADW's own guideline.
  - Step definitions cover `features/per-issue/feature-931.feature`.
- **ADRs.** Delete the two `## Divergence` sections and nothing else.
- **First task.** Return `.claude/` and `README.md` to the branch point before editing anything.

## Steps to Reproduce
All commands are read-only and run from the worktree root.

1. The generation prompts name frameworks and a type-check command:
   `git show HEAD:.claude/commands/generate_step_definitions.md HEAD:.claude/commands/scenario_writer.md | grep -n -i -w -E 'cucumber|cucumber-js|behave|pytest-bdd|pytest_bdd|godog|tsc|py_compile|gofmt|mypy|pyright'`
   This prints `@cucumber/cucumber`, `bunx tsc --noEmit <path>`, "Bootstrap a Cucumber setup" and more.
2. Neither generation prompt reads the descriptor:
   `git show HEAD:.claude/commands/generate_step_definitions.md | grep -c "BDD Framework"` prints `0`, and the same for `scenario_writer.md`.
3. The overwrite is the exact inverse of #579's rewrite:
   - `git rev-parse HEAD:.claude/commands/generate_step_definitions.md HEAD:.claude/commands/scenario_writer.md` prints `72837d9f…` and `923cbe33…`, the pre-d45d708e blobs.
   - `git show ca72a4a7 -- .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md` reverses d45d708e line for line.
4. `adw_init` lost the descriptor fields and the `.github/adw.yml` step:
   - `git show HEAD:.claude/commands/adw_init.md | grep -n -i "test directory\|test framework\|adw.yml"` prints nothing.
   - `git show 1ab26649 -- .claude/commands/adw_init.md` shows the removal.
5. The template writer has no caller: `git grep -n writeAdwYmlTemplateIfAbsent -- adws ':!adws/**/__tests__/**'` lists only its definition and the barrel export.
6. Two switches:
   - `git grep -n -E '(^|[^#])## Unit Tests' HEAD -- .claude adws .adw` lists `feature.md`, `implement-tdd/SKILL.md`, `projectConfig.ts` and `.adw/project.md`.
   - `git grep -n parseUnitTestsEnabled HEAD -- adws` lists only the definition and the barrel export.
7. The feature-file rule is missing: `git show HEAD:.claude/commands/scenario_writer.md | grep -c "Feature files carry no commentary"` prints `0`.
8. No Comments entry for targets: `git show HEAD:.claude/commands/adw_init.md | grep -c -i "coding_guidelines\|\*\*Comments\*\*"` prints `0`.
9. Upgrade behaviour: `features/per-issue/feature-931.feature` drives `executeUpgrade` against a target with no `.github/adw.yml` and a stubbed `/adw_init`. Before the fix, the regen commit does not add `.github/adw.yml`, and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-931"` fails once its step definitions exist. The plan only lists this command; the build agent runs it.

## Root Cause Analysis
- **Items 1 and 4: stray plan commits.**
  - ca72a4a7 is the #583 plan commit, made 54 minutes after d45d708e. c3606f9e is the plan commit for comment-sweep batch 16/16, made 19 minutes after bebda8dd.
  - Both staged the whole worktree through `/commit`, which runs `git add -A`. Before that, `copyClaudeAssetsToWorktree` had overwritten the worktree's tracked `.claude/commands/` files with the runner checkout's older copies; the runner is on `main`, behind `dev` (ADR-0019).
  - Evidence: ca72a4a7 wrote back blobs 72837d9f and 923cbe33, the exact pre-change files. It also reverted the `adw:unverified` flag block that d45d708e had added to `adw_init.md`.
  - #930 (ADR-0056, merged to `dev` in 21e7e16f) fixes the mechanism. The plan commit carries only the plan, and the copy step leaves the framework's own tracked assets alone.
- **Item 2: a regeneration commit staged the runner's `adw_init.md`.**
  - `copyAdwInitCommandToWorktree` copies the runner's `adw_init.md` over the worktree's file. Until 7b3bc5ae (2026-06-23) added `excludePaths: ['.claude/commands/adw_init.md']`, the regen commit staged it with everything else.
  - The tracked file flip-flopped: e799faa4 wrote blob 841c97d9 (with the `.github/adw.yml` step and the test fields), and 1ab26649 wrote c87ea0eb (without them). 1ab26649 is the last flip on the mainline.
  - `writeAdwYmlTemplateIfAbsent` was always meant to back that step (spec for #576). It never got a caller of its own, so nothing re-created the file once the prompt step was gone.
- **Item 3: a deliberate half-move.** The #576 spec moved only the runtime gate to `.github/adw.yml` and kept `## Unit Tests` in `.adw/project.md` "to drive plan generation". That left two switches with opposite defaults. `adw_init` never writes that section, so in current targets the planners see "absent → disabled".
- **Item 5: scoped out.** The comment-debloat PRD excluded target repos ("propagation is a separate decision"), and `adw_init.md` has never had a coding-guidelines step.
- **Why nothing caught it.**
  - No test compares `adw_init.md` with `ADW_YML_TEMPLATE`. The comment in `adwYmlConfig.ts` claims one exists, but the existing test only parses the constant.
  - The unit-test gate kept working because an absent file means enabled.
  - Nothing reads the prompts' text.
- **Live hazard on this branch.**
  - The runner executing this workflow is at `origin/main` 3d43b81a. It has neither `planCommitGuard.ts` nor the tracked-asset check in `copyClaudeAssetsToWorktree`, and its plan phase commits through `runCommitAgent` → `/commit` → `git add -A`.
  - When planning started, the worktree already held uncommitted older copies of `.claude/commands/{adw_init,bug,chore,clean_local_repo,document,feature,resolve_conflict,resolve_failed_test,review}.md`, `.claude/skills/depaudit-triage/SKILL.md` and `README.md`. Most match `origin/main` byte for byte.
  - The plan commit will very likely carry them. Task 1 undoes that.

## Relevant Files
Use these files to fix the bug:

- `README.md` — project overview. Line 11 already documents `unitTests` in `.github/adw.yml`, and lines 240–252 document `/adw_init`. No edit is planned. It is in task 1's restore list because the worktree holds an unrelated modification.
- `.adw/coding_guidelines.md` — coding guidelines to follow. Line 62 holds the canonical Comments entry, which `adw_init.md` must copy verbatim. Read only.
- `specs/adr/0043-multi-language-test-seam.md` — the specification for items 1–3 (its `## Divergence` section). The section is deleted in this PR.
- `specs/adr/0054-comment-discipline.md` — the specification for items 4–5. Its `## Divergence` section is deleted in this PR.
- `.claude/commands/generate_step_definitions.md` — to be made descriptor-driven, starting from `git show d45d708e:.claude/commands/generate_step_definitions.md`.
- `.claude/commands/scenario_writer.md` — to be made descriptor-driven (from d45d708e) and to regain the feature-file rule from bebda8dd.
- `.claude/commands/adw_init.md` — the framework hash input. Gets the restored descriptor fields, the restored `.github/adw.yml` step, a new Comments-entry step, the unit-test-section exclusion, and report updates. Editing it changes `computeFrameworkHash` and starts the upgrade on every target, as intended.
- `.claude/commands/feature.md` — lines 90 and 97–99 switch from `## Unit Tests` in `.adw/project.md` to `unitTests` in `.github/adw.yml`.
- `.claude/skills/implement-tdd/SKILL.md` — lines 63–67 and 77 switch the same way. It has `target: true`, so target repos receive the new text on their next run.
- `adws/core/adwYmlConfig.ts` — `ADW_YML_TEMPLATE` (lines 51–67), the text the heredoc must reproduce, and `writeAdwYmlTemplateIfAbsent` (lines 162–168), which gets its caller. No edit is expected.
- `adws/adwUpgrade.tsx` — `UpgradeDeps` (lines 75–109), `executeUpgrade` (the starter-settings copy at lines 330–333 is the precedent) and `buildDefaultUpgradeDeps` (lines 429–464) gain the `writeAdwYmlTemplate` dependency.
- `adws/__tests__/adwUpgrade.test.ts` — `makeDeps` (lines 21–45) needs the new dependency, and new tests cover the call and its order.
- `adws/core/projectConfig.ts` — delete `parseUnitTestsEnabled` and its JSDoc (lines 215–238).
- `adws/core/index.ts` — line 82 drops `parseUnitTestsEnabled` from the barrel export.
- `.adw/project.md` — line 34 `## Unit Tests: enabled` is removed. The section is retired, and the acceptance criterion 3 check in Validation Commands expects it gone. The type-check scenario in `feature-931.feature` does not check this file.
- `features/per-issue/feature-931.feature` — the issue's scenarios: the upgrade adds `.github/adw.yml` with unit tests enabled, keeps an existing `unitTests: false` file, and the type check passes once `parseUnitTestsEnabled`, the last TypeScript reader of the section, is deleted (task 7).
- `features/per-issue/step_definitions/feature-796.steps.ts` — the pattern to copy for driving `executeUpgrade` (`buildDefaultUpgradeDeps` plus `stubRegenDeps`). It needs no change: its temp worktree simply receives a `.github/adw.yml` from the production dependency.
- `features/step_definitions/ensureCronOnEveryEventSteps.ts` (step "the ADW codebase is checked out") and `features/regression/step_definitions/thenSteps.ts` (step "the ADW TypeScript type-check passes", line 417) — existing steps that `feature-931.feature` reuses.
- `adws/phases/worktreeSetup.ts` — reference only. `copyStarterSettingsToWorktree` is the create-if-absent precedent, `verifyAdwRegen` lists what the stubbed regen must produce, and `copyClaudeAssetsToWorktree` is the copy behind the stray commits.
- `adws/phases/scenarioProof.ts` (line 185) and `adws/core/stepDefDetection.ts` — reference only. The proof gate looks for step definitions in `## Step Def Directory`, which is why the step-definition prompt keeps writing there.
- `adws/triggers/perIssueScenarioSweep.ts` — reference only. It deletes `features/per-issue/step_definitions/feature-<N>.*`; see Notes.
- `adws/phases/unitTestPhase.ts` — reference only. It already reads `config.adwYmlConfig.unitTests`.

Conditional documentation (from `.adw/conditional_docs.md`):
- `app_docs/feature-9gjajh-commands-and-skills.md` — owns `.claude/commands/**` and `.claude/skills/**`; decisions 0043 and 0054.
- `app_docs/feature-9gjajh-state-and-config.md` — owns `projectConfig.ts` and `adwYmlConfig.ts`; decision 0043.
- `app_docs/feature-9gjajh-feature-orchestrators.md` — owns `adws/adwUpgrade.tsx`.
- `app_docs/feature-9gjajh-hash-and-versioning.md` — the `adwUpgrade` self-upgrade loop and the framework hash.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — scenario writing and step-definition phases; decision 0043.
- `app_docs/feature-9gjajh-root-config.md` — owns `README.md` and the `.adw/` metadata files.
- `app_docs/feature-9gjajh-specs-and-prd.md` — owns `specs/**`, including the ADRs.

### New Files
- `adws/__tests__/adwInitPrompt.test.ts` — guards against drift between `adw_init.md` and the two texts it must reproduce.
- `features/per-issue/step_definitions/feature-931.steps.ts` — step definitions for `feature-931.feature`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Return `.claude/` and `README.md` to the branch point
- Run `BASE=$(git merge-base HEAD origin/dev)`, then `git diff --name-status "$BASE" -- .claude README.md`. This lists both committed and uncommitted differences.
- Expect the older runner copies listed under Root Cause Analysis, possibly already committed by the plan commit. None of them is part of this fix.
- Run `git checkout "$BASE" -- .claude README.md`. If the listing showed files added under `.claude/` (status `A`), remove them with `git rm`.
- Re-run the `git diff` and confirm it prints nothing.
- From here on, every `.claude/` edit starts from the branch's own text. Never start from the runner's copy. This task is also why the last task checks the branch diff.

### 2. Make `generate_step_definitions.md` descriptor-driven, without naming a framework
- Write `git show d45d708e:.claude/commands/generate_step_definitions.md` over `.claude/commands/generate_step_definitions.md`. The edits below use that version's line numbers.
- Line 15: replace "When sections are absent, the prompt behaves exactly as before this change was introduced." with "An absent section falls back as stated below."
- Line 17: change "(Step 1, Step 6)" to "(Steps 1, 5, 6 and 7)". Line 18: change "(import mechanism, file extension, assertion style)" to "(registration mechanism, file extension, assertion style, hooks)".
- Line 19: replace the bullet with "- If absent → use the framework that the repository's existing step definitions and test dependencies already use."
- Lines 31–36: replace with:
  - "This prompt is polymorphic on `## BDD Framework`. Rely on your own knowledge of the named framework to choose:"
  - "- **Registration mechanism**: how the framework imports or registers Given/When/Then steps and per-scenario hooks"
  - "- **File extension**: the framework's conventional extension for step definition files"
  - "- **Assertion idiom**: how a step written for that framework fails"
  - "- **Pattern syntax**: the framework's native step-pattern syntax"
  - then a blank line, then "Do **not** assume a language or framework other than the configured one. The scenario contract is always Gherkin `.feature`; only the step-def runtime varies."
- Line 44: replace with "- `## BDD Framework` — the named Gherkin step-def runtime. When absent, use the runtime that the existing step definitions and the project's test dependencies already use."
- After line 46, add "If `.adw/scenarios.md` does not exist, use the defaults above." This keeps the missing-file fallback of today's text.
- Line 56: replace with "Read every existing step definition file the runner loads, whatever its extension: those in `## Step Def Directory` and those in any other step definition directory under the scenario directory, such as the ones beside the per-issue and regression scenarios. This is critical: a step pattern registered twice makes the runner throw an error."
- Line 107: replace with "When generating step definitions for scenarios that require runtime infrastructure, use the framework's per-scenario setup and teardown hooks to call `setupMockInfrastructure()` / `teardownMockInfrastructure()` and `setupFixtureRepo()` / `teardownFixtureRepo()` as needed."
- Line 119: replace with "- Never duplicate a step pattern that any step definition file read in Step 3 already registers".
- Lines 124–130: replace with "After writing, run the static syntax or type check that is conventional for the configured framework's language on each generated file, if that language has one. Run only that language's check; never run another language's compiler or checker."
- Line 132: replace with "Do NOT execute step definition files at runtime. Step definition files register their steps when they load, and the runner throws a registration error outside a running session. Never import, load or run a step definition file as a verification method; use a static syntax or type check only. This caution applies to every framework."
- Line 134: replace with "Forbidden: any verification method that imports, loads or executes step files (the language's interpreter or runtime, a dynamic import, a heredoc or a pipeline). These trip the runner's top-level registration and can leave heredoc/pipeline children alive after the loaded module errors out."
- Line 136: replace with "Confirm step patterns are unique across every step definition file read in Step 3."
- Keep everything else from d45d708e as it is: the `target: false` front matter, the vocabulary-registry branch and Step 4a, the conditional Step 5 with its `test/mocks/` subsections, Step 6's "into `## Step Def Directory`", and the Step 8 output contract.
- Check: `grep -n -i -w -E 'cucumber|cucumber-js|cucumber-rs|cucumber-ruby|behave|pytest-bdd|pytest_bdd|godog|reqnroll|specflow|behat|tsc|mypy|pyright|py_compile|gofmt|go vet' .claude/commands/generate_step_definitions.md` prints nothing.

### 3. Make `scenario_writer.md` descriptor-driven and restore the feature-file rule
- Write `git show d45d708e:.claude/commands/scenario_writer.md` over `.claude/commands/scenario_writer.md`. This adds the "Scenario format — Gherkin mandate" section, deletes the "Detect or bootstrap E2E tool" step and the `## Run E2E Tests` read, and renumbers the steps to 1–6.
- Step 1 ("Read configuration"): after the `## Scenario Directory` bullet, add "- `## BDD Framework` and `## Step Def Directory` — the runner that executes the scenarios and where its step definitions live. Write only Gherkin that this runner supports. Never install, configure or bootstrap a runner (see the Gherkin mandate)."
- Step 4 ("Write scenarios for this issue"), `Rules:` list: after "- Scenario names should be specific and descriptive", add exactly:
  "- Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident."
- Check: the framework-name grep from task 2 prints nothing for this file. `grep -c "BDD Framework" .claude/commands/scenario_writer.md` is at least 1.

### 4. Restore the descriptor, `.github/adw.yml` and the Comments entry in `adw_init.md`
Start from the branch's `adw_init.md` (task 1). The line numbers are `HEAD`'s. Do not change the front matter or `hashInputs:`.

- **Step 2, descriptor fields.** After the `## Run Regression Scenarios` bullet (line 65) and before the "Note:" line, insert the bullets 1ab26649 removed. Drop the stale clause "used by the `/test` command to scope the test run", because `/test` no longer reads the field. Insert this, at the same indentation as the other bullets:
  ~~~md
       - `## Test Directory` — Root directory where the project's unit tests live. Detection rules:
         - If `tests/` exists at the repo root → `tests`
         - If `test/` exists at the repo root → `test`
         - If `src/` exists at the repo root → `src` (TypeScript / Bun convention)
         - Otherwise → `.` (run from repo root)
       - `## Test Framework` — Test framework detected in the dependency manifest (e.g., `pytest`, `vitest`, `jest`). Set to the detected framework name; leave empty when none detected. Examples:
         - `pytest` or `pytest-asyncio` in `pyproject.toml` / `requirements*.txt` → `pytest`
         - `vitest` in `package.json` devDependencies → `vitest`
         - `jest` in `package.json` devDependencies → `jest`
         - No test framework detected → leave empty
  ~~~
- **Step 3, `project.md`.** Add a bullet after the section list: "- Do not add a section that enables or disables unit tests. The only unit-test switch is `unitTests` in `.github/adw.yml` (step 9). If the existing `.adw/project.md` has such a section, leave it out." Do not write the literal heading here, so that the "no reader" check in Validation Commands stays meaningful.
- **New step 9, after step 8 and before Report.** Its body is the pre-1ab26649 step, updated to today's template. The heredoc body and the closing `EOF` must start at column 0, as 01e5f8f1 established, so no indentation reaches the file. The heredoc must equal `ADW_YML_TEMPLATE` byte for byte, including the `guardrails` block and the trailing newline:
  ~~~md
  9. **Create `.github/adw.yml` (only if absent)**
     - Create `.github/adw.yml` only when it does not already exist. Never overwrite an existing file — it carries durable operator policy that survives regeneration, including the `unitTests` switch.
     - Run the following via the Bash tool:
       ```bash
       if [ ! -f .github/adw.yml ]; then
         mkdir -p .github
         cat > .github/adw.yml <<'EOF'
  # ADW configuration for this repository.
  # This file lives outside `.adw/`, so `/adw_init` regeneration never overwrites it.
  # Uncomment a key and set its value to change policy; absent keys use the defaults below.

  # Unit-test gate (opt-out). When enabled, the unit-test phase runs your test
  # command and fails the workflow on unit-test failure. Default: enabled.
  # unitTests: true

  # Human-in-the-loop gate for framework-upgrade PRs (opt-in). When true, ADW opens
  # the upgrade PR but leaves it for human review instead of auto-merging. Default: false.
  # hitl: false

  # Guardrails canary (opt-in). When true, ADW injects its own deny rules and hooks
  # into every agent spawn in this repo via --settings, even if this repo ships no
  # .claude/settings.json of its own. Default: false.
  # guardrails: false
  EOF
         echo "created .github/adw.yml"
       else
         echo ".github/adw.yml already exists — left untouched"
       fi
       ```
     - IMPORTANT: the heredoc content above MUST stay byte-identical to `ADW_YML_TEMPLATE` in `adws/core/adwYmlConfig.ts`; `adws/__tests__/adwInitPrompt.test.ts` compares them.
  ~~~
  In the real file, the lines from `# ADW configuration…` through `EOF` start at column 0, as above. The lines around them keep the list indentation.
- **New step 10, Comments entry.**
  ~~~md
  10. **Add the Comments entry to the coding guidelines**
     - Use `.adw/coding_guidelines.md` if it exists; otherwise `guidelines/coding_guidelines.md` if it exists; otherwise create `.adw/coding_guidelines.md` containing a `# Coding Guidelines` heading.
     - The entry, verbatim:
       ```md
       - **Comments** — Comment only what the code cannot say: invariants, ordering constraints, and the reason a non-obvious choice was made. Never restate what the next line does, never add section banners, never cite issue numbers (git blame carries history). Do not JSDoc a field or function whose name already says what it is.
       ```
     - If the file already has a bullet starting with `- **Comments**`, replace that whole bullet with the entry. Otherwise add the entry as the last line of the file, after a blank line.
     - Where the file asks for comments or JSDoc to explain non-obvious logic (the instruction this entry replaces), remove that clause and keep the rest of its line.
     - Change nothing else in the file.
  ~~~
  The entry line must equal `.adw/coding_guidelines.md` line 62 once surrounding whitespace is trimmed. The new test compares them.
- **Report, renumbered from 9 to 11.**
  - Add `.github/adw.yml` (when created) and the coding guidelines file (when created) to the "List all files created" bullet.
  - Add: "- Note the `## Test Directory` and `## Test Framework` values written to `commands.md`."
  - Add: "- `.github/adw.yml` status: `created` or `already present — left untouched`."
  - Add: "- Comments entry: the guidelines file used, and `added`, `replaced` or `already present`."
- **Cross-references.** Change the three "step 9" mentions to "step 11": line 134 ("log a warning in the step 9 report"), line 165 (same) and line 173 ("log a warning in step 9"). The step 7 and step 8 references at lines 16 and 64–66 stay as they are.

### 5. Give `writeAdwYmlTemplateIfAbsent` its caller in the upgrade orchestrator
- In `adws/adwUpgrade.tsx`:
  - Add `writeAdwYmlTemplateIfAbsent` to the `./core` import.
  - Add `readonly writeAdwYmlTemplate: (worktreePath: string) => { created: boolean };` to `UpgradeDeps`, next to `copyStarterSettings`.
  - In `executeUpgrade`, directly after the starter-settings copy and its log line, and before `deps.writeAdwVersion`, add:
    ~~~ts
    const adwYml = deps.writeAdwYmlTemplate(worktreePath);
    deps.log(`adwUpgrade: .github/adw.yml ${adwYml.created ? 'created' : 'already present, left untouched'}`, 'info');
    ~~~
  - This order lets the file ride into the regen commit. The `hitl` read at the end of `executeUpgrade` then sees the committed file, which parses to the defaults, so no behaviour changes there.
  - Do not call it on any failure path: `llm_failed`, `regen_incomplete`, or anything earlier.
  - In `buildDefaultUpgradeDeps`, add `writeAdwYmlTemplate: writeAdwYmlTemplateIfAbsent,`.
- No other caller is needed. `adws/core/index.ts` already exports the function.

### 6. Make `.github/adw.yml` the only unit-test switch in the prompts
- `.claude/commands/feature.md` line 90: replace with "IMPORTANT: Read `.github/adw.yml` from the current working directory. Unit tests are disabled only when that file sets `unitTests` to `false` on an uncommented line; then do NOT include any tasks for creating, writing, or running unit tests. Otherwise (no file, no `unitTests` key, a commented-out key, or `unitTests: true`) unit tests are enabled: include unit test tasks."
- `.claude/commands/feature.md` lines 98–99: replace with "Read `.github/adw.yml` from the current working directory. If it sets `unitTests` to `false` on an uncommented line, OMIT this entire `### Unit Tests` subsection from the plan. Do not plan any unit test tasks or unit test file creation." and "Otherwise unit tests are enabled (a missing file or key means enabled): describe the unit tests needed for the feature here."
- `.claude/skills/implement-tdd/SKILL.md` lines 65–67: replace with:
  - "Read `.github/adw.yml`. Unit tests are disabled only when it sets `unitTests` to `false` on an uncommented line; a missing file, a missing or commented-out key, or `unitTests: true` means enabled."
  - "- If unit tests are **disabled**: skip unit tests entirely — only BDD scenarios drive the TDD loop."
  - "- If unit tests are **enabled**: integrate unit tests as a first-class part of the red-green-refactor loop for each scenario."
- `.claude/skills/implement-tdd/SKILL.md` line 77: change "**When unit tests are disabled or absent:**" to "**When unit tests are disabled:**".
- These rules match `parseAdwYml`: the first uncommented `unitTests:` line wins, only `false` (case-insensitive, quotes allowed) disables it, and anything else, including a malformed value, means enabled.

### 7. Retire the `## Unit Tests` section of `.adw/project.md`
- `adws/core/projectConfig.ts`: delete `parseUnitTestsEnabled` and its JSDoc block. Nothing calls it (`git grep parseUnitTestsEnabled` finds only the definition and the barrel export).
- `adws/core/index.ts` line 82: remove `parseUnitTestsEnabled` from the export list.
- `.adw/project.md`: delete line 34 `## Unit Tests: enabled` and the blank line after it. Change nothing else in the file.
- Leave the test fixtures (`test/fixtures/{cli-tool,python-app,python-flat}/.adw/project.md` and `test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json`) as they are. They model older target repos, and nothing reads the section.

### 8. Unit tests
- `adws/__tests__/adwUpgrade.test.ts`:
  - In `makeDeps`, add `writeAdwYmlTemplate: vi.fn().mockReturnValue({ created: true })`.
  - Add tests in the style of the existing `copyStarterSettings` tests:
    - after a successful regen, `writeAdwYmlTemplate` is called once with the worktree path;
    - it is called before `commitChanges` (compare `mock.invocationCallOrder`);
    - it is not called when `runInitCommand` fails or `verifyAdwRegen` reports missing files;
    - the outcome is logged for `{ created: true }` and for `{ created: false }`.
- New `adws/__tests__/adwInitPrompt.test.ts`. `adws/__tests__/prTemplateMarker.test.ts` is the precedent: it reads `.claude/commands/pull_request.md` the same way.
  - Resolve the repo root with `path.resolve(__dirname, '../..')`.
  - Test 1: in `.claude/commands/adw_init.md`, take the lines after the line ending with `cat > .github/adw.yml <<'EOF'` up to the first line that is exactly `EOF`, join them with `\n` and add a trailing `\n`. Expect the result to equal `ADW_YML_TEMPLATE` from `../core/adwYmlConfig`.
  - Test 2: find the first line in `adw_init.md` whose trimmed text starts with `- **Comments** —`, and the same line in `.adw/coding_guidelines.md`. Expect both to exist and their trimmed text to be equal.
- `adws/core/__tests__/adwYmlConfig.test.ts` needs no change. Its writer tests already cover create-if-absent and non-overwrite.

### 9. Step definitions for `features/per-issue/feature-931.feature`
- Write `features/per-issue/step_definitions/feature-931.steps.ts`. Reuse "the ADW codebase is checked out" and "the ADW TypeScript type-check passes"; do not register them again. Keep every other phrase unique across all loaded step files.
- **Target repository fixture.** A real temp git repo on `main`. Clean it up in an `After` hook.
  - "never initialised by ADW": a manifest and a README only.
  - "initialised by an older framework version": also the six `.adw/` files and an `.adw-version` holding an old hash.
  - "has no `.github/adw.yml`": the file is absent.
  - "has this `.github/adw.yml`": commit the doc string as the file on `main`.
- **Driving the upgrade.** Follow `feature-796.steps.ts`:
  - Start from `buildDefaultUpgradeDeps(stubProviders, stubGitContext)`, so `writeAdwYmlTemplate`, `verifyAdwRegen`, `writeAdwVersion` and `readAdwYmlConfig` are the production defaults.
  - Override only the boundary dependencies:
    - `ensureWorktree` returns the temp repo, and `reconcileWorktreeToRemote` does nothing.
    - `copyInitCommandToWorktree` does nothing.
    - `runInitCommand` writes the six `.adw/` files and `features/regression/vocabulary.md` and never touches `.github/adw.yml`. This is "the `/adw_init` agent writes a complete ADW configuration and does not touch `.github/adw.yml`".
    - `commitChanges` really stages and commits in the temp repo with `git add -A` and honours `excludePaths`.
    - `pushBranch` does nothing.
    - `findPRByBranch` returns `null`; `fetchIssueLabels` and `fetchIssueComments` return `[]`.
    - `createPullRequest` returns a fixed PR, and `mergePR` succeeds.
    - `ensureLogsDirectory` returns a temp directory.
  - Call `executeUpgrade` with `FRAMEWORK_REPO_ROOT`.
- **Assertions.** Assert on git artefacts and ADW's own reading of them, not on source text:
  - "the upgrade commits the regenerated configuration": the result is `completed` and `HEAD` is a new commit.
  - "the regen commit adds `.github/adw.yml`": `git show --name-status --format= HEAD` lists `A	.github/adw.yml`.
  - "does not change `.github/adw.yml`": the file is absent from that listing, and `git show HEAD:.github/adw.yml` equals the doc string.
  - "ADW reads the unit-test switch … as enabled/disabled": `parseAdwYml(git show HEAD:.github/adw.yml).unitTests` is `true` or `false`.
- Before `executeStepDefPhase` runs, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-931"` and get it green.

### 10. Remove the Divergence sections of ADR-0043 and ADR-0054
- In `specs/adr/0043-multi-language-test-seam.md` and `specs/adr/0054-comment-discipline.md`, delete the whole `## Divergence` section: the heading and its numbered items, up to but not including `## More Information`.
- Change nothing else. `write-an-adr` allows only `status`, `superseded-by`, `## Divergence` and the supersession note to change after acceptance. That includes ADR-0054's dated Confirmation bullet "see Divergence, item 1"; see Notes.
- Leave `specs/adr/README.md` untouched. Its index has no divergence column.

### 11. Run the Validation Commands
- Run every command in `Validation Commands` and fix any failure before finishing.
- Last, run `git diff --stat "$(git merge-base HEAD origin/dev)"`. It must list only:
  - this plan and `features/per-issue/feature-931.feature`;
  - `features/per-issue/step_definitions/feature-931.steps.ts`;
  - the files named in tasks 2–10, namely `.claude/commands/{generate_step_definitions,scenario_writer,adw_init,feature}.md`, `.claude/skills/implement-tdd/SKILL.md`, `adws/adwUpgrade.tsx`, `adws/__tests__/adwUpgrade.test.ts`, `adws/__tests__/adwInitPrompt.test.ts`, `adws/core/projectConfig.ts`, `adws/core/index.ts`, `.adw/project.md` and the two ADRs.
- If any other `.claude/` file or `README.md` shows up, repeat task 1 for it.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install` — prepare dependencies.
- `bun run lint` — ESLint. Catches the unused export left behind and anything unused in `adwUpgrade.tsx`.
- `bunx tsc --noEmit` — type check. It catches any remaining `parseUnitTestsEnabled` user and any `UpgradeDeps` literal missing `writeAdwYmlTemplate`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional ADW type check.
- `bun run build` — build.
- `bun run lint:docs-index` — the living-docs index must stay healthy. If it flags `adws/__tests__/adwInitPrompt.test.ts` as unowned, add it to the `Owns:` list of the entry that owns `adws/__tests__/adwUpgrade.test.ts` in `.adw/conditional_docs.md`.
- `bun run lint:git-guard` — the git/gh guard must report no violations.
- `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/adwUpgrade.test.ts adws/core/__tests__/adwYmlConfig.test.ts adws/core/__tests__/projectConfig.test.ts` — targeted unit tests.
- `bun run test:unit` — the full unit suite.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-931"` — the issue's scenarios. Before the fix the "regen commit adds `.github/adw.yml`" step fails; after it, all pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite.
- Acceptance criterion 1: `! grep -n -i -w -E 'cucumber|cucumber-js|cucumber-rs|cucumber-ruby|behave|pytest-bdd|pytest_bdd|godog|reqnroll|specflow|behat|tsc|mypy|pyright|py_compile|gofmt|go vet' .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md`. Before the fix, Steps to Reproduce 1 prints matches.
- Descriptor read: `grep -c "## BDD Framework" .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md` and `grep -c "## Step Def Directory" .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md` print a non-zero count for each file.
- Acceptance criterion 2 (prompt side): `grep -n -E "## Test Directory|## Test Framework|cat > \.github/adw\.yml|^[[:space:]]*- \*\*Comments\*\* —" .claude/commands/adw_init.md` prints all four. `adwInitPrompt.test.ts` proves the heredoc and the entry are exact.
- Acceptance criterion 3: `! git grep -n -E '(^|[^#])## Unit Tests|parseUnitTestsEnabled' -- .claude adws .adw`.
- Acceptance criterion 4: `grep -c -F 'Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.' .claude/commands/scenario_writer.md` prints `1`.
- Acceptance criterion 5: `! grep -n '^## Divergence' specs/adr/0043-multi-language-test-seam.md specs/adr/0054-comment-discipline.md`.
- `git diff --stat "$(git merge-base HEAD origin/dev)"` — only the files listed in task 11.

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug. In particular, follow the Comments entry: no comments that restate code, no issue numbers.
- No new library is needed.
- **Hash inputs.** Only `adw_init.md` among the edited files is a hash input. Its `hashInputs:` are `adw_init.md`, `document.md` and `templates/vocabulary.md.template`. Editing it changes the framework hash and starts the upgrade on every target, as the issue intends.
  - Do not add the generation prompts or `feature.md` to `hashInputs:`. They have `target: false` and are read from the framework at run time, so they take effect on merge.
  - `implement-tdd` has `target: true` and reaches targets through the per-run asset copy.
- **Why not d45d708e verbatim.**
  - d45d708e's `generate_step_definitions.md` lists frameworks and commands as examples, which acceptance criterion 1 forbids. The neutral wording keeps its decision: one polymorphic prompt, and the agent relies on its knowledge of the named framework.
  - The absent-`## BDD Framework` fallback says "the framework the repo already uses" instead of naming one. The runtime still defaults to `.ts` step files for an empty value (`stepDefExtensionsFor`), and `adw_init` emits the field on its Cucumber and default branches.
- **Where step definitions go.**
  - The prompt keeps d45d708e's rule: write into `## Step Def Directory`. The scenario proof gate (`scenarioProof.ts`) looks only there, so writing elsewhere could make a target's proof step skip silently.
  - Reading was widened to every step-definition directory the runner loads, because ADW's own per-issue and regression step definitions sit outside `## Step Def Directory` and a duplicate pattern anywhere fails the run.
  - The per-issue retention sweep only deletes `features/per-issue/step_definitions/feature-<N>.*`. Step definitions generated into `## Step Def Directory` are therefore not swept, the same as today. This is a known gap, not changed here.
- **Not restored here.** ca72a4a7 also removed the `adw:unverified` "flag determination" block that d45d708e added to `adw_init.md` step 7, now step 8. ADR-0043's Divergence does not list it, so this plan leaves it out. Flag it to the owner.
- **Side effect.** The scenario writer no longer bootstraps Cucumber or rewrites `.adw/commands.md`. This also closes the plan-phase overlap the #930 plan flagged: the scenario agent rewriting `.adw/commands.md` while the plan commit guard is watching.
- **ADR-0054 Confirmation.** Its dated bullet "`.claude/commands/scenario_writer.md` does not contain the feature-file rule; see Divergence, item 1" stays. It records the 2026-09-29 check, and `write-an-adr` forbids edits outside `status`, `superseded-by`, `## Divergence` and the supersession note.
- **Existing targets.** A target that still has a `## Unit Tests` section keeps it until its next upgrade drops it (task 4, step 3). Nothing reads it meanwhile.
  - The target gets `.github/adw.yml` from the same upgrade, through `executeUpgrade` (task 5) or the prompt step. All keys in it are commented out, so `unitTests` stays enabled.
  - ADW's own `.github/adw.yml` predates the `guardrails` block. It is never overwritten.
- **Runner hazard (for the owner and the PR reviewer).** The runner on `main` (3d43b81a) predates #930. Its plan commit runs `/commit` (`git add -A`), and its copy step overwrites tracked prompts in this repository's worktrees.
  - Task 1 undoes this before the build. If this workflow is resumed in a new process, the copy step runs again, and a later `git add -A` commit (review patch, document) could re-introduce older prompt text.
  - Check the final PR diff for any `.claude/` or `README.md` change outside the list in task 11. Promoting #930 to `main` removes the hazard.
- **PR description.** For each item, give the cause from Root Cause Analysis and the evidence commits: d45d708e/ca72a4a7 for item 1, 1ab26649 and 7b3bc5ae for item 2, the #576 spec for item 3, bebda8dd/c3606f9e for item 4, and the PRD scope for item 5. State that only `adw_init.md` changes the framework hash.
