# Hermeticity + Resolve App-Code Editing + Goal-Fidelity Guards

**ADW ID:** i64axx-hermeticity-resolve
**Date:** 2026-06-16
**Specification:** specs/issue-582-adw-i64axx-hermeticity-resolve-sdlc_planner-resolve-app-code-goal-fidelity-guards.md

## Overview

This feature closes the final open seam in the Multi-Language Test & BDD PRD: making UI BDD work against non-hermetic target apps without allowing the auto-resolve loop to silently win by weakening the test contract. It authorizes the resolve loop to edit application code to reach hermeticity, freezes Gherkin `.feature` files during resolve, adds a post-resolve fidelity check against the issue body, and replaces the previous silent continue-to-review behaviour on cap exhaustion with a hard failure.

## What Was Built

- **`resolveFreezeGuard` pure decision core** — classifies changed paths as permitted (app code, step defs) or rejected (any `.feature` path), regardless of what else was changed in the same attempt
- **`resolveVerdict` pure decision core** — computes `pass | retry | hard-fail` from `(targetPass, regressionPass, postResolveAligned, budgetRemaining)`, encoding the cap, the `@regression` gate, and the gaming guard
- **`gherkinFreeze` fs enforcement** — snapshots all `.feature` files before resolve, detects modifications/additions/deletions after, and restores the frozen contract before the commit
- **`scenarioTestFixLoop` shared loop helper** — replaces the near-identical inline loops in all 5 orchestrators; hard-fails on exhaustion, runs the post-resolve fidelity check on first green, propagates `ScenarioHermeticityError` / `GoalFidelityError`
- **`scenarioFidelityAgent`** — reuses the `validationAgent` rail re-pointed to compare frozen scenarios against the issue body; returns a `ValidationResult` whose `aligned` boolean feeds `computeResolveVerdict`
- **`/validate_scenario_fidelity` slash command** — the agent-side prompt; emits the same JSON `ValidationResult` contract as `/validate_plan_scenarios`
- **`/resolve_failed_scenario` prompt update** — explicitly authorizes app-code editing for hermeticity, forbids `.feature` edits, states the cap + hard-fail consequence
- **`/implement-tdd` SKILL.md update** — adds a "Hermetic Test Mode" definition-of-done section for UI/browser BDD apps; mirrored by a one-line pointer in `/implement`
- **Orchestrator rewire** — `adwSdlc`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, `adwPrReview` all delegate to `runScenarioTestFixLoop`; no inline loop remains
- **Per-issue BDD scenarios** (`features/per-issue/feature-582.feature` + step definitions) covering the five acceptance criteria

## Technical Implementation

### Files Modified

- `adws/phases/scenarioFixPhase.ts`: Gherkin freeze wired in — snapshot at entry, detect + restore after resolvers run, surface `gherkinFreezeViolations[]` on the return type
- `adws/adwSdlc.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`, `adwChore.tsx`, `adwPrReview.tsx`: inline `for` loops replaced with `runScenarioTestFixLoop`; downstream uses of `scenarioProofPath`/`scenarioRetries` preserved
- `.claude/commands/resolve_failed_scenario.md`: added Hermeticity, Frozen contract, and Budget instruction blocks
- `.claude/skills/implement-tdd/SKILL.md`: added Hermetic Test Mode definition-of-done section
- `.claude/commands/implement.md`: added one-line hermetic-test-mode pointer
- `adws/core/index.ts`, `adws/phases/index.ts`, `adws/agents/index.ts`, `adws/workflowPhases.ts`: barrel exports for all new modules
- `adws/types/issueTypes.ts`: `/validate_scenario_fidelity` added to `SlashCommand` union
- `adws/core/modelRouting.ts`: model + effort entries for `/validate_scenario_fidelity` (mirrors `/validate_plan_scenarios`)
- `.adw/conditional_docs.md`: entry for this document

### New Files

- `adws/core/resolveFreezeGuard.ts`: `evaluateResolveEdit(changedPaths) → { permitted, flaggedFeature? }`
- `adws/core/resolveVerdict.ts`: `computeResolveVerdict(signals) → 'pass' | 'retry' | 'hard-fail'`
- `adws/phases/gherkinFreeze.ts`: `captureGherkinSnapshot`, `collectChangedFeaturePaths`, `restoreGherkinSnapshot`
- `adws/phases/scenarioTestFixLoop.ts`: `runScenarioTestFixLoop` + `ScenarioHermeticityError` + `GoalFidelityError`
- `adws/agents/scenarioFidelityAgent.ts`: `runScenarioFidelityAgent`, `formatFidelityArgs`, `extractFidelityResult`
- `.claude/commands/validate_scenario_fidelity.md`: slash command prompt (`target: false`)
- `adws/core/__tests__/resolveFreezeGuard.test.ts`: exhaustive changed-path table
- `adws/core/__tests__/resolveVerdict.test.ts`: exhaustive verdict table (mirrors `testVerdict.test.ts`)
- `adws/phases/__tests__/gherkinFreeze.test.ts`: temp-dir snapshot/collect/restore tests
- `adws/phases/__tests__/scenarioTestFixLoop.test.ts`: injected-stub loop orchestration tests
- `adws/agents/__tests__/scenarioFidelityAgent.test.ts`: fidelity extractor tests
- `features/per-issue/feature-582.feature` + `step_definitions/feature-582.steps.ts`

### Key Changes

- **Hard-fail on cap exhaustion** — the loop now throws `ScenarioHermeticityError` when blocker scenarios (including `@regression`) remain failing after `MAX_TEST_RETRY_ATTEMPTS`; previously the workflow silently continued to review
- **Gherkin freeze** — any `.feature` edit made by the resolve agent is detected via content-compare snapshot and reverted by `restoreGherkinSnapshot` before the commit; the committed diff never contains `.feature` changes
- **App-code editing authorized** — `evaluateResolveEdit` permits app/implementation code paths and step-def paths; the path classifier decides purely on the file extension/suffix of each changed path
- **Post-resolve fidelity gate** — when `scenarioRetries > 0` and scenarios are green, `runScenarioFidelityAgent` compares the frozen scenarios against the issue body; `aligned: false` triggers `GoalFidelityError` regardless of remaining budget
- **`@regression` as hard gate** — `computeResolveVerdict` treats a `@regression` failure as not-green, so a persistent regression failure drives the same hard-fail path as a target scenario failure

## How to Use

### As an ADW operator (no configuration needed)

The guards are automatic. When the resolve loop runs:

1. `.feature` files are snapshotted at the start of each fix phase
2. The resolve agent may edit app code and step definitions freely
3. After the agent runs, any `.feature` edits are detected and reverted before commit
4. On each re-test, `@regression` + target scenarios are evaluated by `computeResolveVerdict`
5. If all scenarios go green, the fidelity re-check runs once against the issue body
6. A misaligned fidelity result or cap exhaustion with persistent failures throws a hard error that surfaces as a failed workflow (no silent green)

### As a resolve agent receiving the updated prompt

The updated `/resolve_failed_scenario` prompt now tells you:

- You MAY edit app/implementation code to make the app hermetic (test-mode switch, stubbed externals, seeded data, deterministic clock)
- You MUST NOT edit, add, or delete any `.feature` file — any such edit will be auto-reverted
- Attempts are capped; do not stub assertions to force a pass (the hard-fail will surface it)

### As a build agent using `/implement-tdd`

The updated SKILL.md adds a "Hermetic Test Mode (Definition of Done)" section: for apps exercised by UI/browser BDD, the deliverable includes a test-mode switch, stubbed externals, seeded/deterministic data, and a deterministic clock. This is part of "done", not an afterthought.

## Configuration

No new `.adw/` descriptor fields. The framework-version hash does not move; no `adwUpgrade` is required. All changes take effect on merge.

Relevant constants (unchanged):

- `MAX_TEST_RETRY_ATTEMPTS` (`adws/core/config.ts` line 57) — the cap reused by `runScenarioTestFixLoop`
- `MAX_VALIDATION_RETRY_ATTEMPTS` (`adws/core/config.ts` line 63) — fidelity-agent output-retry context

## Testing

```bash
bun run lint                          # ESLint clean
bunx tsc --noEmit                     # root type-check
bunx tsc --noEmit -p adws/tsconfig.json  # ADW type-check
bun run test:unit                     # full Vitest suite (includes 5 new test files)
bun run build                         # build succeeds
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-582"    # per-issue scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"  # regression suite
```

New unit test files:

| File | What it covers |
|---|---|
| `adws/core/__tests__/resolveFreezeGuard.test.ts` | Exhaustive changed-path → permit/reject table |
| `adws/core/__tests__/resolveVerdict.test.ts` | Exhaustive `(targetPass, regressionPass, postResolveAligned, budgetRemaining)` → verdict table |
| `adws/phases/__tests__/gherkinFreeze.test.ts` | Snapshot/collect/restore over temp-dir fixtures |
| `adws/phases/__tests__/scenarioTestFixLoop.test.ts` | Loop orchestration with injected phase stubs |
| `adws/agents/__tests__/scenarioFidelityAgent.test.ts` | Fidelity extractor over valid/invalid JSON |

## Notes

- **Repos with no scenarios are unaffected.** When `scenarioProof` is `undefined` or has no blocker tags, `runScenarioTestFixLoop` returns cleanly without throwing.
- **`adwPlanBuildReview.tsx` is out of scope.** It runs `executeScenarioTestPhase` but resolves via the review-patch cycle (no `executeScenarioFixPhase`); it intentionally does not use `runScenarioTestFixLoop`.
- **Fidelity parse failure degrades gracefully.** An `OutputValidationError` from the fidelity agent logs a warning and treats the result as aligned — it does not hard-fail (mirrors `planValidationPhase`'s graceful path).
- **`hitl` label is already on issue #582.** Because resolve now edits implementation code, the human merge gate must stay closed until reviewed. No code change is needed for gating.
- **Silent green eliminated.** `app_docs/feature-1bg58c-scenario-test-fix-phases.md` documented that the loop "exits (does not hard-fail)" on exhaustion. That behaviour is replaced by `ScenarioHermeticityError`. The old documentation note is now outdated.
- **Related docs:** `app_docs/feature-1bg58c-scenario-test-fix-phases.md` (base scenario test/fix design), `app_docs/feature-sinbtg-plan-scenario-validation-resolution.md` (validation agent rail this feature reuses).
