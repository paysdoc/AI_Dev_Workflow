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
- Keep `/generate_step_definitions` and `/scenario_writer` descriptor-driven: both read `## BDD Framework` and `## Step Def Directory` from `.adw/scenarios.md`, name no framework or type-check command, and never install or configure a runner (Gherkin mandate). `/scenario_writer` carries the rule that feature files hold no commentary. In `descriptor` mode, `/generate_step_definitions` adds a framework-free device note only when `.adw/scenarios.md` has `## Scenario Run Contract`: drive the devices named by `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`, never create, boot, shut down or delete one, and write screenshots under `$ADW_PROOF_DIR/android/` or `$ADW_PROOF_DIR/ios/`.
- Follow the single unit-test switch: `/feature` and the `implement-tdd` skill read `unitTests` in `.github/adw.yml` (absent file or key means enabled). Nothing reads or writes a `## Unit Tests` section in `.adw/project.md`.
- Define per-phase agent commands (`/implement`, `/implement-tdd`, `/test`, `/review` (includes a Step 4 step-definition independence check that reports each violating file as a `blocker` with `remediationStrategy: "patch"`), `/patch`, `/document`, `/scenario_writer`, `/generate_step_definitions`).
- Define utility commands (`/commit`, `/pull_request`, `/classify_issue`, `/generate_branch_name`, `/find_issue_dependencies`, `/extract_dependencies`).
- Define validation commands (`/validate_plan_scenarios`, `/resolve_plan_scenarios`, `/align_plan_scenarios`, `/validate_scenario_fidelity`, `/diff_evaluator`, `/resolve_failed_test`, `/resolve_failed_scenario`).
- Define the `conditional_docs` guide, which maps task types to additional documentation files the agent should read before planning or building.
- Track hash inputs for commands whose content feeds the `adwUpgrade` hash gate (declared in YAML frontmatter `hashInputs:` on each command file that affects `.adw/` regen).

## Contracts & Invariants

- Command files with `target: true` in frontmatter are deployed to target repos via `adw_init`; files with `target: false` (or no frontmatter) remain ADW-framework-only.
- The `$0`, `$1`, `$2`, `$3` positional parameters map to `issueNumber`, `adwId`, `issueJson`, and `frameworkRepoRoot` respectively; these positions are fixed and must not be swapped.
- Planning commands (other than `/patch`) produce a plan document in `specs/`; they do not modify source code. `/patch` writes no file.
- The `prime` command is a lightweight read-only orientation step; it does not make any changes.
- Commands that reference `conditional_docs.md` first check `.adw/conditional_docs.md` in the target repo, falling back to `.claude/commands/conditional_docs.md` in the ADW framework.

## Configuration

Commands are stored as markdown files in `.claude/commands/`. Claude Code automatically makes them available as `/command-name` slash commands. No explicit registration is required. The `hashInputs:` frontmatter field on `adw_init.md` lists the files that feed the upgrade hash gate — changes to listed files increment the hash and trigger a framework upgrade in target repos.

- `adws/__tests__/adwInitPrompt.test.ts` fails if `adw_init.md`'s `.github/adw.yml` heredoc drifts from `ADW_YML_TEMPLATE`, or its Comments entry drifts from ADW's own `.adw/coding_guidelines.md`.
- `adws/__tests__/adwInitPrompt.test.ts` pins steps 1 and 3 and the hash input; `adwInitPrompt.mobile.test.ts` pins the `mobile:kotlincm` descriptors and checks them against the mapping, stack-coherence check, step-definition registry, JUnit parser, section parser and `runShellCommand`; `adwInitPrompt.helpers.ts` holds their shared helpers; `generateStepDefinitionsPrompt.test.ts` pins the descriptor-mode device note.

## Gotchas

- `adw_init.md` is a hash input: editing it starts an upgrade on every target repo. The generation prompts and `feature.md` are `target: false` and are not.
- The scenario run contract block holds no line starting with `## `, because `.adw/scenarios.md` is parsed on those lines.
- The `generate_step_definitions.md` descriptor note must not contain a backticked lowercase `adw_…` token (the runner-mode test would read it as a mode) or name a framework.
- Prompt files are overwritten in worktrees by the runner's older copies if the runner is behind `dev`; check a PR diff for stray `.claude/` changes.

- The `adw_init` command accepts `frameworkRepoRoot` as `$3`; when empty (default), the vocabulary template copy step is skipped.
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
