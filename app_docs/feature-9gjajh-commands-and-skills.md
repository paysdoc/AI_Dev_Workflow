# Commands and Skills System

## Overview

The `.claude/commands/` directory contains the slash command definitions that Claude Code executes as agent prompts. Each file is a markdown document that defines a specific workflow step — planning, building, reviewing, testing, documenting, and so on. The skills system (Claude Code's slash command dispatch) reads these files and expands them as system prompts when the corresponding `/command` is invoked.

## Responsibilities

- Define the `prime` command: instructs the agent to read `git ls-files`, `README.md`, `adws/README.md`, and the `conditional_docs.md` guide to orient itself to the codebase before any task.
- Define workflow planning commands (`/feature`, `/bug`, `/chore`, `/pr_review`): generate implementation plan documents in `specs/` following the canonical plan format, parameterised with issue number (`$0`), ADW ID (`$1`), and issue JSON (`$2`).
- Define `/patch`: returns the complete patch plan (`# Patch: …`, in the plan format) as its response and writes no file. The patch phase forwards the response text to the build agent.
- Keep `/pull_request` and `/resolve_conflict` off committed `specs/` paths: the PR body never links or names `plan_file` (it is read-only context, and stays `$2` so later positional args keep their indices), and the conflict prompt's incoming-branch intent falls back local plan, then PR body, then `git log`/`git diff --stat`, with no `git show` of the incoming branch's `specs/`.
- Define `adw_init`: analyzes a target repo's codebase and generates the `.adw/` configuration directory (commands including the `## Test Directory` and `## Test Framework` descriptor fields, project config, providers, vocabulary template, coding guidelines, review proof config, and depaudit setup). It also creates `.github/adw.yml` only when absent (heredoc byte-identical to `ADW_YML_TEMPLATE`) and writes the Comments entry into the target's coding guidelines.
- Keep `adw_init` from ever detecting `mobile:kotlincm`: step 1 detects only `cli` and `web`, and a mobile app (one that runs on Android or iOS) is undecided, never `cli`. Step 3 preserves a hand-set type verbatim. When the preserved type is `mobile:kotlincm`, `adw_init` writes, even with no manifest:
  - `commands.md`: a Gradle unit-test command (every module's `test` except `:scenarios:test`, JUnit reports merged into `$ADW_UNIT_TEST_REPORT_PATH`; replaces a `## Run Tests` that holds only `N/A`, keeps any other custom command), a Gradle build command that passes while no Gradle wrapper or settings file exists (so the bootstrap issue's baseline is green), and `N/A` for the dev server (keyed on the type step 3 writes).
  - `project.md`: the four device-source sections (`## Android System Image`, `## Android Device Profile`, `## iOS Device Type`, `## iOS Runtime`) with defaults when absent and the owner's value preserved when set; none for other types. `## Relevant Files` points the planner at `.adw/scenarios.md`.
  - `scenarios.md`: `cucumber-jvm`, `scenarios/src/test/kotlin`, `:scenarios` run-by-tag (`--rerun`, cucumber tag filter) and regression commands, and a verbatim `## Scenario Run Contract` (device variables `ADW_JUNIT_REPORT_PATH`, `ADW_PROOF_DIR`, `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID`; JUnit `[[ATTACHMENT|<path>]]` lines and the identical-title rule; `android/` and `ios/` proof directories).
- Keep `/scenario_writer` and `implement-tdd`'s `step-definitions.md` descriptor-driven: both read `## BDD Framework` and `## Step Def Directory` from `.adw/scenarios.md`, name no framework or type-check command, and never install or configure a runner (Gherkin mandate). `/scenario_writer` carries the rule that feature files hold no commentary. `step-definitions.md` picks the runner from `## Application Type` in `.adw/project.md` (`web` → ADW's Playwright project under `features/steps/` with `createBdd()` and the guarded `bddgen` check; anything else → the runner `.adw/scenarios.md` names), and when `.adw/scenarios.md` has `## Scenario Run Contract` adds the device rules: drive the devices named by `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`, never create, boot, shut down or delete one, and write screenshots under `$ADW_PROOF_DIR/android/` or `$ADW_PROOF_DIR/ios/`.
- The builder (`/implement-tdd`) is the only agent that writes step definitions; no step-definition command or phase exists.
- Keep `/feature`, `/bug` and `/chore` telling the planner the same thing about work that ports, rewrites, migrates, re-bundles or restructures existing code while what it does stays the same: each carries a `## Behavioural Equivalence` section requiring a task of its own in `## Step by Step Tasks`, before the last task, that keeps a runnable copy of the old implementation, writes a comparison of old and new on the same inputs (public API, odd inputs, fixed seed for random inputs), and lists the comparison command in `## Validation Commands`. A byte-for-byte artefact check or the existing tests still passing does not count. Without the step (old code cannot run, or behaviour is meant to change) `## Notes` says why and names intended differences; issues that restructure nothing need no note.
- Carry the layer rule (ADR-0067) in every prompt that writes, plans around, builds against or judges scenarios. A scenario proves only behaviour observable through a Real Boundary of the target (its real runtime, a real browser, the built artifact or a real command-line invocation); in ADW's own repository that boundary is the subprocess pattern (a real ADW process started through the hermetic subprocess harness). Behaviour provable inside the test process, and the variants, edge cases and error cases of every behaviour, belong to unit tests alone. The Real Boundary is judged from the prompt's description; there is no declared list or boundary tag yet.
  - `/scenario_writer` has a `## Layer Rule` section: one scenario per acceptance criterion observable at a Real Boundary, no scenario per variant and no `Examples` table of inputs, limits or error cases, and zero scenarios as a valid outcome (no file, no tag, the reason under `### No scenarios` in its output). Its output also lists, per scenario, the acceptance criterion and the Real Boundary it drives. Existing scenarios are not migrated.
  - `/scenario_writer` prefers no vocabulary phrase for Per-Issue Scenarios (steps are phrased in the issue's terms) and never adds or removes `@regression` nor writes into the regression scenario directory (ADR-0068: the Regression Suite changes only by a human-decided Promotion). It has five steps, the last the output, and branches on `.adw/scenarios.md` only for `## Per-Issue Scenario Directory`.
  - `/scenario_writer` has a `## Nomination` section: nominating nothing is the default; it may nominate at most one scenario it creates in `<perIssueDir>/feature-$0.feature`, only when the scenario guards a behaviour whose breakage would be expensive and that no Regression Suite scenario already guards, by `@nominated` on the scenario's own tag line. A scenario carrying `@nomination-declined` is never nominated again, and the agent never adds or removes that tag. Without `## Per-Issue Scenario Directory` it nominates nothing. `scenarioWriterPrompt.test.ts` pins the text against `NOMINATION_TAG` and `NOMINATION_DECLINED_TAG` from `adws/promotion/nominationCollector.ts`.
  - `/feature` and `/bug` carry an identical `## Scenarios and Unit Tests` section that states the rule and sends the variants, edge cases and error cases, plus behaviour no Real Boundary shows, to the plan's named `### Unit Tests`. `/bug`'s `Plan Format` has the same unit-test switch line and `## Testing Strategy` block (`### Unit Tests`, `### Edge Cases`) as `/feature`'s.
  - `implement-tdd` §5 writes the unit tests the plan names and no others, test-first in the vertical slice of the plan step they cover, whether or not the issue has scenarios. A scenario gets its step definitions and no paired unit test. §3 proceeds to the plan, unit tests included, when no `@adw-{N}` scenario exists.
  - `/review` Step 4 treats the proof's `no per-issue scenarios` as a zero-scenario claim: for a `feature` or `bug` it judges from the issue and the diff whether the change alters behaviour at a Real Boundary, and raises a `blocker` (add one scenario per acceptance criterion at that boundary) only if it does; `chore`, `promotion` and `pr_review` get no finding. With scenarios present, it requires one for every acceptance criterion observable at a Real Boundary, not for every behaviour. Its `### CLI applications` guidance asks for a scenario per acceptance criterion about commands, output, exit codes or written state, and none for their variants.
- Follow the single unit-test switch: `/feature`, `/bug` and the `implement-tdd` skill read `unitTests` in `.github/adw.yml` (absent file, absent or commented-out key, or `true` means enabled). Nothing reads or writes a `## Unit Tests` section in `.adw/project.md`.
- Define per-phase agent commands (`/implement`, `/implement-tdd`, `/test`, `/review`, `/patch`, `/document`, `/scenario_writer`).
- Define utility commands (`/commit`, `/pull_request`, `/classify_issue`, `/generate_branch_name`, `/find_issue_dependencies`, `/extract_dependencies`).
- Define validation commands (`/validate_plan_scenarios`, `/resolve_plan_scenarios`, `/align_plan_scenarios`, `/validate_scenario_fidelity`, `/diff_evaluator`, `/resolve_failed_test`, `/resolve_failed_scenario`).
- Define the `conditional_docs` guide, which maps task types to additional documentation files the agent should read before planning or building.
- Track hash inputs for commands whose content feeds the `adwUpgrade` hash gate (declared in YAML frontmatter `hashInputs:` on each command file that affects `.adw/` regen).

## Contracts & Invariants

- Command files with `target: true` in frontmatter are deployed to target repos via `adw_init`; files with `target: false` (or no frontmatter) remain ADW-framework-only.
- The `$0`, `$1`, `$2`, `$3` positional parameters map to `issueNumber`, `adwId`, `issueJson`, and `frameworkRepoRoot` respectively; these positions are fixed and must not be swapped.
- Planning commands (other than `/patch`) produce a plan document in `specs/`; they do not modify source code. `/patch` writes no file.
- The `prime` command is a lightweight read-only orientation step; it does not make any changes.
- `implement-tdd`'s §2 `Scope` and §6 `Verification` blocks match `/implement`'s ADR-0066 blocks byte for byte; the layer-rule edits leave them untouched.
- A workflow whose scenario agent writes no scenario passes build (the build agent runs `/implement` when no `.feature` carries `@adw-{N}`), the scenario test phase (the per-issue tag is reported skipped and is not a blocker failure) and review (Step 4 judges the zero-scenario claim).
- Commands that reference `conditional_docs.md` first check `.adw/conditional_docs.md` in the target repo, falling back to `.claude/commands/conditional_docs.md` in the ADW framework.

## Configuration

Commands are stored as markdown files in `.claude/commands/`. Claude Code automatically makes them available as `/command-name` slash commands. No explicit registration is required. The `hashInputs:` frontmatter field on `adw_init.md` lists the files that feed the upgrade hash gate — changes to listed files increment the hash and trigger a framework upgrade in target repos.

- `adws/__tests__/adwInitPrompt.test.ts` fails if `adw_init.md`'s `.github/adw.yml` heredoc drifts from `ADW_YML_TEMPLATE`, or its Comments entry drifts from ADW's own `.adw/coding_guidelines.md`.
- `adws/__tests__/adwInitPrompt.test.ts` pins steps 1 and 3 and the hash input; `adwInitPrompt.mobile.test.ts` pins the `mobile:kotlincm` descriptors and checks them against the mapping, stack-coherence check, step-definition registry, JUnit parser, section parser and `runShellCommand`; `adwInitPrompt.helpers.ts` holds their shared helpers; `generateStepDefinitionsPrompt.test.ts` pins the descriptor-mode device note; `planningCommandsPrompt.test.ts` compares `feature.md`, `bug.md` and `chore.md` with each other and pins the Behavioural Equivalence section and its two placeholders, the shared `## Scenarios and Unit Tests` section of `feature.md` and `bug.md`, their unit-test switch lines and `bug.md`'s `## Testing Strategy`.
- `scenarioWriterPrompt.test.ts` pins the layer rule, the zero-scenario output and the absence of the vocabulary preference and the `@regression` sweep; `implementTddPrompt.test.ts` pins plan-sourced unit tests and the unchanged switch; `reviewPrompt.test.ts` pins the boundary-only blocker and the zero-scenario judgement. `buildPromptsScope.test.ts` pins the ADR-0066 blocks.

## Gotchas

- `adw_init.md` is a hash input: editing it starts an upgrade on every target repo. The generation prompts and `feature.md` are `target: false` and are not.
- The scenario run contract block holds no line starting with `## `, because `.adw/scenarios.md` is parsed on those lines.
- Prompt files are overwritten in worktrees by the runner's older copies if the runner is behind `dev`; check a PR diff for stray `.claude/` changes.

- The `adw_init` command accepts `frameworkRepoRoot` as `$3`; when empty (default), the vocabulary template copy step is skipped.
- The `## Scenarios and Unit Tests` section and `## Testing Strategy` of `feature.md` and `bug.md` must stay word for word identical, or `planningCommandsPrompt.test.ts` fails.
- Removed phrases are pinned by absence: reintroducing "unit test alongside" a step definition, "independent proof layer", the vocabulary preference or a `@regression` promote/demote step in these prompts fails the pinning tests.
- The Behavioural Equivalence text cannot be shared between `feature.md`, `bug.md` and `chore.md`; edit all three together or `planningCommandsPrompt.test.ts` fails.
- Plan commands (`/feature`, `/bug`, etc.) require the agent to research the codebase before writing the plan — they are not fill-in-the-blank templates.
- `conditional_docs.md` is a meta-document read by the agent to decide which other docs to read; it is not a slash command itself.
- The `install.md` command handles dependency installation in target repos and is distinct from the framework's own `npm install`.

## Decisions

- [ADR-0005](../docs/adr/0005-adw-directory-config-per-target-repo.md) — Each target repository describes itself in a `.adw/` directory of Markdown files
- [ADR-0014](../docs/adr/0014-bdd-as-validation-contract-unit-tests-removed.md) — BDD scenarios as the validation contract, ADW unit tests removed
- [ADR-0015](../docs/adr/0015-slash-commands-as-single-spawn-path.md) — Agents are spawned through one function, and their prompt is a slash command
- [ADR-0018](../docs/adr/0018-unit-tests-restored-alongside-bdd.md) — Unit tests restored alongside BDD scenarios
- [ADR-0024](../docs/adr/0024-tdd-in-build-phase-single-pass-alignment.md) — TDD in the build phase and single-pass plan-scenario alignment
- [ADR-0027](../docs/adr/0027-llm-diff-gate-for-chores.md) — LLM diff gate for chores
- [ADR-0031](../docs/adr/0031-active-test-phase-passive-review-judge.md) — Active test phase, passive review judge
- [ADR-0033](../docs/adr/0033-depaudit-as-dependency-gate.md) — depaudit as the dependency gate for ADW-managed repositories
- [ADR-0037](../docs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md) — Tiered regression suite with a fixed vocabulary
- [ADR-0042](../docs/adr/0042-hash-versioned-self-upgrade.md) — Target repos upgrade themselves when the framework hash changes
- [ADR-0043](../docs/adr/0043-multi-language-test-seam.md) — Multi-language test seam: detected descriptor, Gherkin mandate, JUnit report rail
- [ADR-0050](../docs/adr/0050-target-repo-guardrails.md) — ADW injects its own guardrails into agent runs on target repositories
- [ADR-0054](../docs/adr/0054-comment-discipline.md) — Comments say only what the code cannot
- [ADR-0064](../docs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md) — `mobile:kotlincm` type: descriptor runner, devices booted by ADW
- [ADR-0066](../docs/adr/0066-build-agents-implement-the-plan-and-nothing-else.md) — Build agents implement the plan and nothing else: no refactor phase, bounded verification, declared gaps only
- [ADR-0067](../docs/adr/0067-scenarios-prove-only-behaviour-at-a-declared-real-boundary.md) — Scenarios prove only behaviour at a declared real boundary, one per acceptance criterion; unit tests are not paired with them
- [ADR-0068](../docs/adr/0068-promotion-by-nomination-and-human-decided-proposal.md) — Promotion by nomination and a human-decided proposal; the scorer and the promotion sweep are removed
