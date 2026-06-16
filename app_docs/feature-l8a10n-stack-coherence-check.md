# Stack Coherence Check (Warn Loud, Non-Blocking)

**ADW ID:** l8a10n-stack-coherence-chec
**Date:** 2026-06-16
**Specification:** specs/issue-581-adw-l8a10n-stack-coherence-chec-sdlc_planner-stack-coherence-check.md

## Overview

`adw_init` classifies a target repo's stack and writes a detected descriptor into `.adw/commands.md` and `.adw/scenarios.md`. When it cannot identify a Gherkin step-def runner it falls back silently to `cucumber-js`. This feature adds `stackCoherenceCheck` — a pure module that asserts two invariants at runtime (language coherence + Gherkin mandate) and warns loudly through the `adw:unverified` comment + label channel on any mismatch, without ever blocking the workflow.

## What Was Built

- **`adws/core/stackCoherenceCheck.ts`** — pure function `stackCoherenceCheck(input) → { ok, warnings[] }` detecting `language-mismatch` and `non-gherkin-bdd` warning codes
- **`adws/core/stepDefDetection.ts` — `isGherkinFramework(framework)`** — derives from the existing `FRAMEWORK_EXTENSION_MAP` (single source of truth for the Gherkin set; empty ⇒ `true` for the `cucumber-js` default)
- **`adws/phases/stackCoherenceReporter.ts`** — `reportStackCoherence(config)` runs the pure check; on `!ok` applies `adw:unverified` label and posts a `stack_incoherent` comment; wrapped in try/catch so it can never throw
- **`adws/github/workflowCommentsIssue.ts`** — `stack_incoherent` comment stage + `formatStackIncoherentComment` + `coherenceWarnings` field on `WorkflowContext`
- **`adws/types/workflowTypes.ts`** — `'stack_incoherent'` added to `WorkflowStage` union (comment-stage discriminator, never persisted)
- **`adws/phases/unitTestPhase.ts`** — single call to `reportStackCoherence(config)` before the unit-test gate (runs once per workflow, even when unit tests are opted out)
- **Unit tests** — table-driven Vitest suite in `adws/core/__tests__/stackCoherenceCheck.test.ts`; extended `stepDefDetection.test.ts` for `isGherkinFramework`
- **BDD scenarios** — `features/per-issue/feature-581.feature` + step definitions

## Technical Implementation

### Files Modified

- `adws/core/stackCoherenceCheck.ts`: new pure module — language inference via ordered token map, Gherkin mandate check, language coherence check
- `adws/core/stepDefDetection.ts`: added `isGherkinFramework(framework: string): boolean`
- `adws/core/index.ts`: re-exports for `stackCoherenceCheck`, its types, and `isGherkinFramework`
- `adws/core/__tests__/stackCoherenceCheck.test.ts`: new table-driven unit tests (8 cases)
- `adws/core/__tests__/stepDefDetection.test.ts`: extended with `isGherkinFramework` cases
- `adws/phases/stackCoherenceReporter.ts`: new reporter — builds input from config, runs check, applies label + comment on `!ok`, never throws
- `adws/phases/unitTestPhase.ts`: calls `reportStackCoherence(config)` before the `unitTestsEnabled` gate
- `adws/phases/index.ts`: exports `reportStackCoherence`
- `adws/github/workflowCommentsIssue.ts`: `coherenceWarnings?: string[]` on `WorkflowContext`; `formatStackIncoherentComment`; `case 'stack_incoherent'` in `formatWorkflowComment`
- `adws/types/workflowTypes.ts`: `'stack_incoherent'` added to `WorkflowStage`
- `features/per-issue/feature-581.feature`: BDD acceptance scenarios
- `features/per-issue/step_definitions/feature-581.steps.ts`: step definitions

### Key Changes

- **Language inference** uses an ordered `LANGUAGE_TOKENS` list (specific tokens before generic — `cucumber-js`→js before `cucumber`→js, `pytest-bdd`→python before `pytest`→python) to avoid prefix conflicts. Unknown tokens infer `null` and never trigger a false mismatch.
- **Gherkin mandate**: a non-empty `bddFramework` not in `FRAMEWORK_EXTENSION_MAP` keys triggers `non-gherkin-bdd`. Empty `bddFramework` (the `cucumber-js` default) is explicitly safe.
- **Never blocks**: `reportStackCoherence` has no `process.exit` and all GitHub I/O is wrapped in `try/catch`; a failed warning is logged but the workflow continues.
- **Runs exactly once per workflow**: wired into `executeUnitTestPhase` (called once per orchestrator), not the scenario-test phase (which runs in retry loops and would post duplicate comments).
- **No hash propagation**: this is framework-resident consumer code — `adw_init.md` and `.adw-version` are untouched; the check takes effect immediately on merge.

## How to Use

The check runs automatically on every workflow that invokes `executeUnitTestPhase`. No configuration is required.

1. When `adw_init` initializes a target repo, it writes `## Test Framework`, `## Run Tests`, `## BDD Framework`, and `## Run Scenarios by Tag` to `.adw/commands.md` and `.adw/scenarios.md`.
2. On the next ADW workflow run, `reportStackCoherence` reads those four fields and passes them to `stackCoherenceCheck`.
3. If all recognized language signals agree and `bddFramework` is Gherkin-based (or empty), the check returns `ok: true` and is silent.
4. If a mismatch is detected (e.g. `testFramework: pytest` with `bddFramework: cucumber-js`), the `adw:unverified` label is applied to the issue and a `## :warning: ADW Unverified — Stack Coherence` comment is posted listing the incoherences.
5. To resolve: open `.adw/commands.md` and `.adw/scenarios.md` in the target repo and correct `## Test Framework`, `## BDD Framework`, and the run commands to match the actual stack.

## Configuration

No new configuration fields. The check consumes fields already emitted by `adw_init`:

| File | Field | Used as |
|------|-------|---------|
| `.adw/commands.md` | `## Test Framework` | `testFramework` signal |
| `.adw/commands.md` | `## Run Tests` | `runTests` signal |
| `.adw/commands.md` | `## Run Scenarios by Tag` | `runScenariosByTag` signal |
| `.adw/scenarios.md` | `## BDD Framework` | `bddFramework` signal |

## Testing

```bash
# Full unit test suite
bun run test:unit

# Focused: coherence check + isGherkinFramework predicate
bunx vitest run adws/core/__tests__/stackCoherenceCheck.test.ts adws/core/__tests__/stepDefDetection.test.ts

# Type-check ADW scripts (catches new module, WorkflowStage, WorkflowContext field)
bunx tsc --noEmit -p adws/tsconfig.json
```

Key unit test cases:
- **ADW-self regression guard** — `vitest` + `cucumber-js`, all JavaScript → `ok: true`
- **Coherent Python** — `pytest` + `behave` → `ok: true`
- **US22 incoherence** — `pytest` + `cucumber-js` → `language-mismatch` warning
- **Non-Gherkin BDD** — `bddFramework: 'jest'` → `non-gherkin-bdd` warning
- **Both warnings** — `pytest` + `mocha` → both `non-gherkin-bdd` + `language-mismatch`
- **Empty bddFramework** — treated as `cucumber-js` default → `ok: true`
- **Unknown signals** — `make test` + `cucumber-js` → no false positive

## Notes

- **Defense-in-depth, not replacement.** `adw_init.md` already applies `adw:unverified` at init time when it falls back to `cucumber-js` for a recognized non-JS/TS stack. This feature adds a runtime check that catches configs `adw_init` mis-detected confidently or that drifted after bootstrap, and adds the Gherkin-mandate assertion that nothing checked at runtime previously.
- **Why the unit-test phase.** `executeScenarioTestPhase` runs inside the scenario-fix and review-patch retry loops in `adwSdlc.tsx`, which would produce duplicate comments. `executeUnitTestPhase` is called exactly once per orchestrator and already hosts the `adw:unverified` channel.
- **Both unverified signals may fire independently.** Zero-testcase (`unverified`) and stack-coherence (`stack_incoherent`) each post distinct comments but share the single idempotent `adw:unverified` label.
- **Plan-only orchestrators** (`adwPlan`) do not run `executeUnitTestPhase`, so the runtime check does not fire there; `adw_init`'s init-time fallback flag remains the signal for those paths.
