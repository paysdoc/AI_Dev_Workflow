---
status: accepted
date: 2026-03-06
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-3-adw-update-slash-command-9b8zpp-sdlc_planner-update-slash-command-model-map.md (issue #3, 2026-02-24)
  - kind: contemporaneous
    source: specs/issue-80-adw-add-resoning-effort-4wna6z-sdlc_planner-add-reasoning-effort-to-slash-commands.md (issue #80, merged as PR #81 on 2026-03-06)
  - kind: contemporaneous
    source: specs/issue-156-*, issue-157-*, issue-158-* (2026-03-13) and issue-231-* (2026-03-18)
supersedes: []
superseded-by: []
---

# Model and reasoning effort are routed per slash command from central tables

## Context and Problem Statement

ADW runs many kinds of agent, from naming a branch to planning a feature. Running all of them on the strongest model at the highest effort is wasteful, and running all of them on a cheap model gives poor plans and reviews. The founding commit already had a table from slash command to model. Issue #80 found the gap: the table "does not cover reasoning effort which should be set for each claude call", so every call ran at the default effort "regardless of task complexity". The decision covers how the model and the effort for an agent are chosen.

## Decision Drivers

* Cost and latency of simple, templated tasks.
* Quality of planning, implementation and review.
* A cheaper mode the issue author can ask for.

## Considered Options

None recorded.

## Decision Outcome

The model tier and the reasoning effort of an agent are looked up by its slash command in central tables. There are four: model and effort, each in a default and a fast variant. The fast variant is used when the issue body contains `/fast` or `/cheap`, matched with a word boundary. An effort of `undefined` means no effort flag is passed; the file's comment says this is required for commands routed to Haiku.

The reasons recorded for how values are assigned:

* Issue #80: commands "have different complexity levels and should use appropriate reasoning effort to balance quality vs. cost/speed."
* Issue #156: high effort "is wasted on operations where the model is essentially filling in a template or following a mechanical procedure."
* Issue #157: `/implement` moved from Opus to Sonnet because the planner "already did all architectural reasoning", the build agent's job "is execution — not research", and the review phase "provides a safety net".
* Issue #158: fast mode did not reach planning, which stayed at the top tier; the fast tables were extended.

This ADR records the mechanism. The values in the tables are tuning and change by ordinary commits.

### Consequences

* Good, because the cost profile of the whole pipeline is visible and editable in one file.
* Good, because a new command cannot be added without routing; see Confirmation.
* Bad, because the effort table must be kept consistent with the model table by hand. Commit b4995b69 (2026-04-17) had to realign efforts with what each model accepts.
* Bad, because fast mode is triggered by text in the issue body, so the words `/fast` or `/cheap` in prose switch it on.

### Confirmation

Checked against the code on 2026-09-29:

* `adws/core/modelRouting.ts` holds `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP` and `SLASH_COMMAND_EFFORT_MAP_FAST`, with `getModelForCommand`, `getEffortForCommand` and `isFastMode`.
* All four tables are typed `Record<SlashCommand, ...>`. A command added to the `SlashCommand` union without an entry in each table fails the type check, which `bun run test` (`bunx tsc --noEmit`) runs.
* `adws/agents/commandAgent.ts` (`runCommandAgent`) reads both values for every agent built on it. `adws/agents/claudeAgent.ts` passes them to the CLI as `--model` and `--effort`.
* No unit test covers the tables. The test file the specs name, `slashCommandModelMap.test.ts`, was deleted on 2026-03-13 (commit 3231e576, [ADR-0014](0014-bdd-as-validation-contract-unit-tests-removed.md)) and has not been restored.

## More Information

* Unresolved: three call sites pass a literal model instead of reading the tables. `adws/adwUpgrade.tsx` runs `/adw_init` with `'sonnet'` and no effort, while the table gives `sonnet` and `medium`. `adws/triggers/autoMergeHandler.ts` runs `/resolve_conflict` with `'sonnet'`; that command is not in the `SlashCommand` union and has no table entry. The output-validation retry in `adws/agents/commandAgent.ts` uses `'haiku'`. No source says whether these are deliberate.
* Unresolved: a script comparing the tables (run 2026-09-29) found one entry that breaks the rule stated in the file's own comment, that Haiku takes no effort: in the fast tables `/promote_regression_vocabulary` is routed to `haiku` with effort `medium`. All four tables have 30 entries.
* Value changes without an issue or spec: commit 01d4f64f (2026-08-14, "route planning/review commands to fable") and commit e894fe74 (2026-09-25, "avoid fable for now"). The reasons are not recorded.
* The specs name the CLI flag `--reasoning-effort`; the code passes `--effort`.
* The tables moved from `adws/core/config.ts` to `modelRouting.ts` on 2026-03-22: [ADR-0020](0020-shared-phase-runner-and-core-decomposition.md).
* The spawn path that consumes these values: [ADR-0015](0015-slash-commands-as-single-spawn-path.md).
