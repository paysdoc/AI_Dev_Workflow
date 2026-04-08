# Scenario Test Phase + Scenario Fix Phase

**ADW ID:** 1bg58c-scenariotestphase-sc
**Date:** 2026-04-08
**Specification:** specs/issue-399-adw-1bg58c-scenariotestphase-sc-sdlc_planner-scenario-test-fix-phases.md

## Overview

Introduces two new workflow phases — `scenarioTestPhase` and `scenarioFixPhase` — and wires them into `adwSdlc.tsx` between step-definition generation and the review phase. Previously, BDD scenario execution lived inside the review retry loop; this change extracts it into a dedicated phase with its own orchestrator-level fix-and-retry loop, ensuring scenario failures are caught and resolved before review begins.

## What Was Built

- `adws/phases/scenarioTestPhase.ts` — new phase that reads the tag-filtered scenario command from project config, optionally wraps execution in `withDevServer`, runs `runScenarioProof`, and returns a structured `ScenarioProofResult`
- `adws/phases/scenarioFixPhase.ts` — new phase that takes failures from a previous `scenarioTestPhase` run, invokes `runResolveScenarioAgent` per failed tag, commits, and pushes
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — unit tests covering dev-server branching, tag filter, graceful skip, pass/fail result shapes
- Retry loop in `adwSdlc.tsx` bounded by `MAX_TEST_RETRY_ATTEMPTS`
- Review phase in SDLC orchestrator now receives empty `scenariosMd` (reads `scenario_proof.md` instead of running scenarios itself)
- Module renames: `testPhase` → `unitTestPhase`, `runResolveE2ETestAgent` → `runResolveScenarioAgent`, `resolve_failed_e2e_test.md` → `resolve_failed_scenario.md`

## Technical Implementation

### Files Modified

- `adws/adwSdlc.tsx`: replaced `executeTestPhase` with `executeUnitTestPhase`; added `executeStepDefPhase`, `executeScenarioTestPhase`, `executeScenarioFixPhase`; implemented scenario test/fix retry loop; patched `scenariosMd` to empty before calling review
- `adws/phases/index.ts`: added exports for `executeScenarioTestPhase`, `executeScenarioFixPhase`, `ScenarioTestPhaseResult`; replaced `executeTestPhase` with `executeUnitTestPhase`
- `adws/workflowPhases.ts` / `adws/index.ts`: updated re-exports for renamed and new phases
- `adws/agents/testAgent.ts`: renamed `runResolveE2ETestAgent` → `runResolveScenarioAgent`, command `/resolve_failed_e2e_test` → `/resolve_failed_scenario`
- `adws/agents/testRetry.ts` / `adws/agents/index.ts`: updated all callers/exports to `runResolveScenarioAgent`
- `adws/core/modelRouting.ts`: updated command key in all model and effort maps
- `adws/types/issueTypes.ts`: renamed slash command literal in `SlashCommand` union
- All orchestrators (`adwChore`, `adwTest`, `adwPlanBuild*`): updated `executeTestPhase` → `executeUnitTestPhase` import (no new phases added to these)
- `README.md`: updated project structure listing

### New Files

- `adws/phases/scenarioTestPhase.ts` — scenario test phase
- `adws/phases/scenarioFixPhase.ts` — scenario fix phase
- `adws/phases/unitTestPhase.ts` — renamed from `testPhase.ts`
- `.claude/commands/resolve_failed_scenario.md` — renamed from `resolve_failed_e2e_test.md`
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — unit tests

### Key Changes

- **Decoupled scenario execution from review**: review in `adwSdlc` no longer runs scenarios; it reads the pre-written `scenario_proof.md`
- **Orchestrator-level retry loop**: `scenarioTest → scenarioFix → scenarioTest` repeats up to `MAX_TEST_RETRY_ATTEMPTS`; on exhaustion the loop exits (does not hard-fail — workflow continues to review)
- **Dev-server conditional**: `scenarioTestPhase` checks `projectConfig.commands.startDevServer`; if non-`N/A`, it wraps `runScenarioProof` in `withDevServer` using the port extracted from `config.applicationUrl`
- **Graceful skip**: if `projectConfig.scenariosMd` is empty or `runScenariosByTag` is `N/A`, the phase returns immediately with a passing result and zero cost
- **Immutable config patching**: review receives a shallow-cloned config with `scenariosMd: ''` — original config is never mutated

## How to Use

The phases are wired automatically into `adwSdlc.tsx`. No manual invocation is required.

**SDLC workflow sequence after this change:**
1. Install
2. Plan + Scenario (parallel)
3. Alignment
4. Build
5. Step Def
6. Unit Test
7. **Scenario Test** [→ **Scenario Fix** → retry, up to `MAX_TEST_RETRY_ATTEMPTS`]
8. Review (reads scenario proof; does not run scenarios)
9. Document
10. KPI
11. PR

For target repos that require a dev server, ensure `.adw/commands.md` has `## Start Dev Server` set to a non-`N/A` command and `## Health Check Path` set appropriately.

## Configuration

| Config key | Location | Purpose |
|---|---|---|
| `## Run Scenarios by Tag` | `.adw/commands.md` | Command template for tag-filtered scenario runs |
| `## Start Dev Server` | `.adw/commands.md` | Dev server start command; `N/A` disables `withDevServer` wrapping |
| `## Health Check Path` | `.adw/commands.md` | Path polled by `withDevServer` to confirm server readiness |
| `MAX_TEST_RETRY_ATTEMPTS` | `adws/core/config.ts` | Maximum scenario test/fix retry cycles |

## Testing

```bash
# Unit tests for scenarioTestPhase
bun run test -- adws/phases/__tests__/scenarioTestPhase.test.ts

# Full test suite
bun run test

# BDD regression scenarios for this issue
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-399 and @regression"
```

## Notes

- Only `adwSdlc.tsx` is rewired in this slice; other orchestrators (`adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, `adwPrReview`) retain the old code path until a later slice
- `scenarioFixPhase` accumulates cost across all failed tags but the subprocess-only `scenarioTestPhase` reports zero Claude Agent cost
- The `ScenarioTestPhaseResult` type exposes the full `ScenarioProofResult` so the fix phase can inspect per-tag failures; only tags where `!passed && !skipped` trigger a resolve agent call
- Proof files are written to `agents/{adwId}/scenario-test/scenario_proof/`; fix agent state goes to `agents/{adwId}/scenario-fix/`
