# Commands and Skills System

## Overview

The `.claude/commands/` directory contains the slash command definitions that Claude Code executes as agent prompts. Each file is a markdown document that defines a specific workflow step — planning, building, reviewing, testing, documenting, and so on. The skills system (Claude Code's slash command dispatch) reads these files and expands them as system prompts when the corresponding `/command` is invoked.

## Responsibilities

- Define the `prime` command: instructs the agent to read `git ls-files`, `README.md`, `adws/README.md`, and the `conditional_docs.md` guide to orient itself to the codebase before any task.
- Define workflow planning commands (`/feature`, `/bug`, `/chore`, `/patch`, `/pr_review`): generate implementation plan documents in `specs/` following the canonical plan format, parameterised with issue number (`$0`), ADW ID (`$1`), and issue JSON (`$2`).
- Define `adw_init`: analyzes a target repo's codebase and generates the `.adw/` configuration directory (commands, project config, providers, vocabulary template, coding guidelines, review proof config, and depaudit setup).
- Define per-phase agent commands (`/implement`, `/implement-tdd`, `/test`, `/review`, `/patch`, `/document`, `/scenario_writer`, `/generate_step_definitions`).
- Define utility commands (`/commit`, `/pull_request`, `/classify_issue`, `/generate_branch_name`, `/find_issue_dependencies`, `/extract_dependencies`).
- Define validation commands (`/validate_plan_scenarios`, `/resolve_plan_scenarios`, `/align_plan_scenarios`, `/validate_scenario_fidelity`, `/diff_evaluator`, `/resolve_failed_test`, `/resolve_failed_scenario`).
- Define the `conditional_docs` guide, which maps task types to additional documentation files the agent should read before planning or building.
- Track hash inputs for commands whose content feeds the `adwUpgrade` hash gate (declared in YAML frontmatter `hashInputs:` on each command file that affects `.adw/` regen).

## Contracts & Invariants

- Command files with `target: true` in frontmatter are deployed to target repos via `adw_init`; files with `target: false` (or no frontmatter) remain ADW-framework-only.
- The `$0`, `$1`, `$2`, `$3` positional parameters map to `issueNumber`, `adwId`, `issueJson`, and `frameworkRepoRoot` respectively; these positions are fixed and must not be swapped.
- Planning commands produce a plan document in `specs/` — they do not modify source code.
- The `prime` command is a lightweight read-only orientation step; it does not make any changes.
- Commands that reference `conditional_docs.md` first check `.adw/conditional_docs.md` in the target repo, falling back to `.claude/commands/conditional_docs.md` in the ADW framework.

## Configuration

Commands are stored as markdown files in `.claude/commands/`. Claude Code automatically makes them available as `/command-name` slash commands. No explicit registration is required. The `hashInputs:` frontmatter field on `adw_init.md` lists the files that feed the upgrade hash gate — changes to listed files increment the hash and trigger a framework upgrade in target repos.

## Gotchas

- The `adw_init` command accepts `frameworkRepoRoot` as `$3`; when empty (default), the vocabulary template copy step is skipped.
- Plan commands (`/feature`, `/bug`, etc.) require the agent to research the codebase before writing the plan — they are not fill-in-the-blank templates.
- `conditional_docs.md` is a meta-document read by the agent to decide which other docs to read; it is not a slash command itself.
- The `install.md` command handles dependency installation in target repos and is distinct from the framework's own `npm install`.
