# Durable Opt-Out Unit-Test Gate in `.github/adw.yml`

**ADW ID:** y6hjbr-durable-opt-out-unit
**Date:** 2026-06-15
**Specification:** specs/issue-576-adw-y6hjbr-durable-opt-out-unit-sdlc_planner-adw-yml-unit-test-gate.md

## Overview

Moves the unit-test phase gate from `.adw/project.md` (overwritten on every `adw_init` regeneration) to the durable `.github/adw.yml` descriptor. The gate defaults to **enabled** (opt-out semantics): if the file is absent, the key is omitted, or the value is malformed, unit tests run. Only an explicit `unitTests: false` disables the gate.

## What Was Built

- `unitTests` boolean key added to `AdwYmlConfig` (default `true`; opt-out)
- `ADW_YML_TEMPLATE` constant: a fully-commented YAML template whose commented-out keys parse to the defaults
- `writeAdwYmlTemplateIfAbsent(worktreePath)` helper: creates `.github/adw.yml` only when absent; never overwrites operator edits
- `parseBooleanScalar` pure helper and `KeySpec`-table refactor of `parseAdwYml` to scan all keys in one pass
- `initializeWorkflow()` reads `.github/adw.yml` and surfaces `adwYmlConfig` on `WorkflowConfig`
- `unitTestPhase.ts` gates on `config.adwYmlConfig.unitTests` instead of `parseUnitTestsEnabled(project.md)`
- `/adw_init` creates `.github/adw.yml` from the template only when the file does not already exist
- Comprehensive unit tests: parser, reader, writer (create-if-absent / non-overwrite), template drift guard, and updated stubs in `adwUpgrade.test.ts`

## Technical Implementation

### Files Modified

- `adws/core/adwYmlConfig.ts`: Added `unitTests` field to `AdwYmlConfig`; refactored `parseAdwYml` from single-key early-return to `KeySpec`-table multi-key accumulation; extracted `parseBooleanScalar`; added `ADW_YML_TEMPLATE` and `writeAdwYmlTemplateIfAbsent`
- `adws/core/__tests__/adwYmlConfig.test.ts`: Updated all existing assertions to include `unitTests` field; added new test groups for `unitTests` parsing, `readAdwYmlConfig`, template constant, and writer create-if-absent/non-overwrite behaviour
- `adws/core/index.ts`: Added `ADW_YML_TEMPLATE` and `writeAdwYmlTemplateIfAbsent` to the barrel export
- `adws/phases/workflowInit.ts`: Imports `readAdwYmlConfig`; adds `adwYmlConfig: AdwYmlConfig` to `WorkflowConfig`; calls `readAdwYmlConfig(worktreePath)` in `initializeWorkflow()` and logs the resolved policy
- `adws/phases/unitTestPhase.ts`: Replaces `parseUnitTestsEnabled(projectConfig.projectMd)` with `config.adwYmlConfig.unitTests`; removes unused `parseUnitTestsEnabled` import and `projectConfig` destructure
- `adws/phases/prReviewPhase.ts`: Minor touch to keep PRReviewWorkflowConfig compatible with the updated `WorkflowConfig`
- `.claude/commands/adw_init.md`: Adds a "Create `.github/adw.yml` (only if absent)" step with a deterministic Bash guard whose heredoc is byte-identical to `ADW_YML_TEMPLATE`
- `adws/__tests__/adwUpgrade.test.ts`: Updates all `readAdwYmlConfig` stubs and parser assertions to include `unitTests: true`
- `.github/adw.yml`: Added to the ADW self-host repo with the fully-commented template (resolves to defaults)
- `test/fixtures/jsonl/manifests/adw-unit-test-fail.json`: New manifest fixture for unit-test-fail scenario coverage

### Key Changes

- **Opt-out default**: Absent file, absent key, or malformed value all resolve to `unitTests: true` (gate enabled). Prior behaviour required opt-in via `project.md`.
- **Multi-key parser**: `parseAdwYml` now iterates all non-comment lines capturing the first occurrence of each `KeySpec` key; malformed values default per-key and mark the key captured (so a malformed `hitl` no longer blocks `unitTests` from parsing).
- **Scope boundary preserved**: `.adw/project.md` `## Unit Tests` and `parseUnitTestsEnabled` are retained for plan generation; only the runtime phase gate moves to `adw.yml`.
- **Template drift guard**: `parseAdwYml(ADW_YML_TEMPLATE)` → `{ hitl: false, unitTests: true }` is enforced by a unit test, preventing silent template/parser divergence.
- **Emit-parse coupling**: Editing `adw_init.md` (framework hash input) raises `.adw-version` and triggers `adwUpgrade` to propagate the create-if-absent step to all registered target repos; the non-overwrite guarantee ensures no operator config is lost on regen.

## How to Use

### Opt out of the unit-test gate

In the target repo's `.github/adw.yml`, uncomment and set:

```yaml
unitTests: false
```

The next workflow run will log `adw.yml unit-test gate: disabled` and skip the unit-test phase.

### Re-enable (or restore default)

Delete the `unitTests` line or set it to `true`. The gate defaults to enabled when the key is absent.

### On `adw_init` (new repos)

`/adw_init` creates `.github/adw.yml` with the fully-commented template if the file does not exist. All keys are commented out, so the file resolves to the defaults. Existing files are never overwritten.

## Configuration

| Location | Key | Default | Effect |
|---|---|---|---|
| `.github/adw.yml` | `unitTests: false` | `true` (enabled) | Disables the unit-test phase gate |
| `.github/adw.yml` | `unitTests: true` or absent | `true` (enabled) | Unit tests run (default) |

Malformed values (e.g. `unitTests: maybe`) emit a `warn` log and default to enabled.

## Testing

```bash
# Run the directly-affected suites
bunx vitest run adws/core/__tests__/adwYmlConfig.test.ts adws/__tests__/adwUpgrade.test.ts

# Full unit suite (zero regressions)
bun run test:unit

# Type-check both tsconfigs
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint (no unused imports)
bun run lint

# Build
bun run build
```

## Notes

- **`.adw/project.md` `## Unit Tests` is retained** for plan generation (controls whether planners emit unit-test tasks). Only the runtime gate moves. See `app_docs/feature-jjxkk9-conditional-unit-tests-plan-template.md`.
- **Migration ripple (intended)**: Target repos that previously had `## Unit Tests: disabled` in `project.md` but no `.github/adw.yml` will default to gate **enabled** after upgrade. To stay opted out, set `unitTests: false` in `adw.yml`.
- **ADW self-host**: ADW's own `.github/adw.yml` was created by this PR with the commented template, so self-host defaults to gate enabled and unit tests continue to run with no regression.
- The `adw_init.md` heredoc body must remain byte-identical to `ADW_YML_TEMPLATE` in `adwYmlConfig.ts`. The `parseAdwYml(ADW_YML_TEMPLATE)` unit test guards parser drift, but not prompt/constant divergence — keep in sync by hand.
