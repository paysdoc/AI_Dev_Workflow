# BDD Cutover — Polymorphic Prompts & 14-Day Per-Issue Sweep Cron

**ADW ID:** oobdbg-bdd-rewrite-3-3-cuto
**Date:** 2026-04-28
**Specification:** specs/issue-493-adw-oobdbg-bdd-rewrite-3-3-cuto-sdlc_planner-bdd-cutover-polymorphic-prompts-sweep.md

## Overview

This is the final cutover (3/3) of the BDD rewrite. It deletes the ~121 legacy `features/*.feature` files and ~117 `features/step_definitions/*.ts` files, scopes `cucumber.js` to `features/regression/**` only, adds three optional sections to `.adw/scenarios.md` that make the `scenario_writer` and `generate_step_definitions` prompts polymorphic, and introduces a cron probe that auto-deletes `features/per-issue/feature-{N}.feature` files 14 days after the corresponding issue's PR is merged.

Backward-compatibility guarantee: target repos that do not have the three new `.adw/scenarios.md` sections behave exactly as before — no prompt behaviour changes for them.

## What Was Built

- **Legacy BDD layer deleted** — all top-level `features/*.feature` (~121) and `features/step_definitions/*.ts` (~117) files removed; only `features/regression/` and the new `features/per-issue/` directory remain
- **`cucumber.js` scoped** — `paths` narrowed to `features/regression/**/*.feature`; imports narrowed to `features/regression/step_definitions/**` and `features/regression/support/**`
- **`ScenariosConfig` extended** — three optional fields added: `perIssueScenarioDirectory?`, `regressionScenarioDirectory?`, `vocabularyRegistry?`
- **Per-issue scenario sweep** — new `adws/triggers/perIssueScenarioSweep.ts` module with a pure `isScenarioStale` predicate and an injectable `runPerIssueScenarioSweep` shim
- **Cron wiring** — `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` (≈4 320 cycles = once per day at 20 s polling) added and the sweep called from `trigger_cron.ts`
- **Polymorphic `scenario_writer.md`** — resolves per-issue output directory from `## Per-Issue Scenario Directory`; skips `@regression` auto-promotion when `## Regression Scenario Directory` is set
- **Polymorphic `generate_step_definitions.md`** — validates step phrases against the vocabulary registry when `## Vocabulary Registry` is set; fails loudly with `vocabularyViolations` on any unregistered phrase
- **`.adw/scenarios.md` updated** — three new sections appended with backward-compatibility note
- **`features/per-issue/.gitkeep`** — placeholder so the directory exists in-tree
- **Unit tests** — `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` (predicate truth table + sweep integration) and extended `adws/core/__tests__/projectConfig.test.ts`

## Technical Implementation

### Files Modified

- `adws/core/projectConfig.ts`: added `perIssueScenarioDirectory?`, `regressionScenarioDirectory?`, `vocabularyRegistry?` to `ScenariosConfig`; added their headings to `SCENARIOS_HEADING_TO_KEY`
- `adws/core/__tests__/projectConfig.test.ts`: new describe block covering all-present / all-absent / partial-presence permutations plus an integration case with `mkdtempSync`
- `adws/triggers/perIssueScenarioSweep.ts`: new module — `isScenarioStale` pure predicate, `PerIssueSweepDeps` interface, `runPerIssueScenarioSweep` async shim
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`: new vitest file — predicate truth table (null, 13 d, 14 d, 30 d, clock skew) and sweep integration test (stale deleted, fresh/unmerged skipped, `getMergedAt` rejection handled)
- `adws/triggers/trigger_cron.ts`: added `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` import and cycle-gated `runPerIssueScenarioSweep()` call
- `adws/core/config.ts`: added `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES = 4320` constant
- `adws/core/index.ts`: re-exported the new constant
- `cucumber.js`: `paths` → `features/regression/**/*.feature`; `import` → `features/regression/step_definitions/**/*.ts` + `features/regression/support/**/*.ts`
- `.adw/scenarios.md`: appended `## Per-Issue Scenario Directory`, `## Regression Scenario Directory`, `## Vocabulary Registry` sections
- `.claude/commands/scenario_writer.md`: polymorphic branching on `## Per-Issue Scenario Directory` and `## Regression Scenario Directory`
- `.claude/commands/generate_step_definitions.md`: vocabulary-registry validation step gated on `## Vocabulary Registry`
- `README.md`: updated BDD section to document legacy deletion, `features/per-issue/`, three new `.adw/scenarios.md` sections, and the sweep cron

### Key Changes

- **Pure predicate isolation**: `isScenarioStale` accepts an explicit `now: Date` parameter — no `Date.now()` calls inside — making the unit test fully deterministic. The `filePath` parameter is part of the signature for caller logging convenience but is not consulted by the predicate.
- **Dependency injection**: `runPerIssueScenarioSweep` accepts `PerIssueSweepDeps` so all I/O (fs, GitHub, date) can be replaced in tests without hoisting mocks.
- **Error containment**: a `getMergedAt` rejection for one issue logs a warn and continues; it does not abort processing of remaining files and never deletes the file in question.
- **Optional-field absence = legacy path**: `getDefaultScenariosConfig()` intentionally omits the three new fields, so they remain `undefined` when sections are absent. Both polymorphic prompts check for presence before branching.
- **Minimal cron touch**: the only change to `trigger_cron.ts` is one import and one cycle-gated invocation; no surrounding code was refactored.

## How to Use

### Per-issue scenario output (ADW host)

After this cutover the `scenario_writer` agent places new per-issue scenario files at `features/per-issue/feature-{issueNumber}.feature`. These files are agent input — they are never executed by `cucumber-js` directly (they are outside the scoped `paths`).

### Opt-in from a target repo

Add to your target repo's `.adw/scenarios.md`:

```md
## Per-Issue Scenario Directory
features/per-issue/

## Regression Scenario Directory
features/regression/

## Vocabulary Registry
features/regression/vocabulary.md
```

With these sections present:

- `scenario_writer` writes per-issue files to `features/per-issue/` and never auto-promotes to `@regression`
- `generate_step_definitions` validates every step phrase against `features/regression/vocabulary.md` and fails loudly on any unregistered phrase

### Without the sections

All three absent → `scenario_writer` and `generate_step_definitions` behave exactly as before this cutover.

### Running the regression suite

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

This now resolves to `features/regression/**/*.feature` only (via the scoped `cucumber.js`).

## Configuration

| Section in `.adw/scenarios.md` | Consumed by | Effect when absent |
|---|---|---|
| `## Per-Issue Scenario Directory` | `scenario_writer` | Falls back to `## Scenario Directory` |
| `## Regression Scenario Directory` | `scenario_writer` | `@regression` sweep runs as before |
| `## Vocabulary Registry` | `generate_step_definitions` | Free-form step composition, no validation |

**`PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`** (default `4320`): at 20 s poll interval this fires roughly once per day. Tune in `adws/core/config.ts` if you need a different cadence.

## Testing

```sh
# Unit tests (includes predicate truth table + sweep integration)
bun run test:unit

# Type check
bunx tsc --noEmit -p adws/tsconfig.json

# Regression suite (proves cucumber.js scoping is correct)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Confirm no top-level .feature files remain
find features -maxdepth 1 -name '*.feature' | wc -l  # expected: 0
```

## Notes

- **Retention window**: `RETENTION_DAYS = 14`. The sweep uses `now - mergedAt >= 14 * 86_400_000` (inclusive boundary, so "exactly 14 days ago" is stale).
- **`features/support/register-tsx.mjs`** is preserved and still loaded by `cucumber.js` (the top-level `features/support/` directory is not a feature directory — only `features/regression/` and `features/per-issue/` are).
- **Operator follow-ups** (out of scope): toggling `features/regression/` as a required GitHub branch-protection check is a manual UI step after merge.
- **`vocabularyViolations`** in `generate_step_definitions` output defaults to `[]`; a non-empty list means the PR reviewer (human or `/pr_review` skill) must reject the step definitions.
