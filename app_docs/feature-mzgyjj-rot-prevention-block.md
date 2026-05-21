# Rot Prevention Block in `scenario_writer.md` Prompt

**ADW ID:** mzgyjj-rot-prevention-block
**Date:** 2026-05-21
**Specification:** specs/issue-506-adw-mzgyjj-rot-prevention-block-sdlc_planner-scenario-writer-rot-prevention-prompt.md

## Overview

Adds a `## Rot Prevention` section to `.claude/commands/scenario_writer.md` that explicitly prohibits the Scenario Writer Agent from generating BDD scenarios that assert against file existence, file contents, or source-file structure. The block also instructs the agent to read `features/regression/vocabulary.md` (when present) and prefer registered phrases before inventing novel Gherkin phrasing. This closes the regression vector from issues #491–#493 framework-wide, with no per-repo configuration required.

## What Was Built

- `## Rot Prevention` section inserted in `.claude/commands/scenario_writer.md` between `## Polymorphism on .adw/scenarios.md` and `## Instructions`
- Three explicit prohibitions: file-existence checks, substring matches against file contents, structural source-file parsing
- Permitted-alternative statement directing the agent toward observable output assertions (state files, recorded API calls, git artifacts)
- Vocabulary-preference instruction: read `features/regression/vocabulary.md` at run start if present; graceful no-op when absent
- Universality declaration: rule is framework-owned, not overridable via `.adw/scenarios.md` or per-repo config
- BDD feature file `features/per-issue/feature-506.feature` with 6 scenarios covering vocab read, no-vocab fallback, per-issue routing, regression sweep skip, fallback directory, and rot-pattern absence
- Step definitions `features/per-issue/step_definitions/feature-506.steps.ts`
- Six JSONL manifest fixtures in `test/fixtures/jsonl/manifests/` backing each scenario

## Technical Implementation

### Files Modified

- `.claude/commands/scenario_writer.md`: inserted `## Rot Prevention` section (14 lines) between the polymorphism block and the Instructions section
- `adws/triggers/trigger_cron.ts`: resolved merge conflict between `resolveClaudeCodePath` (upstream) and `REPO_ROOT`/`assertCwdIsRepoRoot` (stash); combined both imports into a single import statement
- `README.md`: minor update (4 lines net)

### Files Added

- `features/per-issue/feature-506.feature`: 6 BDD scenarios validating rot-prevention behaviour through agent output observation, not prompt-file assertions
- `features/per-issue/step_definitions/feature-506.steps.ts`: step implementations
- `test/fixtures/jsonl/manifests/scenario-writer-reads-vocab.json`
- `test/fixtures/jsonl/manifests/scenario-writer-no-vocab.json`
- `test/fixtures/jsonl/manifests/scenario-writer-per-issue-routing.json`
- `test/fixtures/jsonl/manifests/scenario-writer-skip-sweep.json`
- `test/fixtures/jsonl/manifests/scenario-writer-fallback-dir.json`
- `test/fixtures/jsonl/manifests/scenario-writer-behavioural-output.json`

### Key Changes

- The rot prevention rule is stated at the **framework-prompt level**, not in per-repo `.adw/scenarios.md`, so every `scenario_writer` invocation across all target repos obeys it automatically
- Prohibitions are phrased with concrete examples (`readFileSync(...).includes(...)`, `JSON.parse(readFileSync("config.ts"))`) so the agent cannot rationalise around them
- Vocabulary-preference instruction references the exact path `features/regression/vocabulary.md` and explicitly handles the absent-file case as a no-op
- `trigger_cron.ts` merge conflict resolution unified `resolveClaudeCodePath` with `REPO_ROOT`/`assertCwdIsRepoRoot` into one import line
- BDD scenarios validate observable behaviour (files written, reads recorded, byte-identical outputs) — deliberately avoid asserting against `scenario_writer.md` source content, which would itself be a rot pattern

## How to Use

The rot prevention rule is transparent to users: it is automatically applied on every `scenario_writer` invocation. No configuration is required.

1. Invoke `/scenario_writer` as normal (or let ADW trigger it via cron/webhook).
2. If `features/regression/vocabulary.md` exists in the target repo, the agent reads it and prefers registered phrases.
3. If the agent encounters a scenario request that would require a file-existence, file-content, or structural assertion, it refuses and instead surfaces an observable-output equivalent (or logs the gap in the Output section).
4. Per-issue routing and regression sweep skip behaviour via `.adw/scenarios.md` are unchanged.

## Configuration

None required. The rule is framework-owned. The only optional dependency is `features/regression/vocabulary.md` in the target repo — when absent, the prohibitions still apply.

## Testing

Run the issue-506 BDD suite:

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-506"
```

Full regression gate (all smoke scenarios must pass):

```bash
bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json && bun run test:unit && NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" && bun run build
```

## Notes

- This is the **upstream half** of the parent PRD (`specs/prd/scenario-rot-prevention-and-promotion.md`). The downstream half (confidence-scored promotion suggestions, `hitl` gate, `promotionMover`, `vocabulary.md.template` distribution) is out of scope for this slice.
- The `trigger_cron.ts` change is a merge-conflict resolution only; no behavioural logic was altered.
- Model routing for `scenario_writer` (opus/sonnet via `SLASH_COMMAND_MODEL_MAP`) is unchanged — see `app_docs/feature-tepq39-scenario-writer-opus-model.md`.
