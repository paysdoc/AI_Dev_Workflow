# Fix: `findOrchestratorStatePath` Orchestrator Path Shadowing

**ADW ID:** 9s65vu-adwmerge-findorchest
**Date:** 2026-05-27
**Specification:** specs/issue-529-adw-9s65vu-adwmerge-findorchest-sdlc_planner-fix-orchestrator-path-shadowing.md

## Overview

`findOrchestratorStatePath` previously returned the **first** `*-orchestrator` directory in `readdirSync` order, which meant a failed `init-orchestrator` sub-dir could shadow the real `sdlc-orchestrator` when an `adwId` was reused across a retry. This caused `adwMerge` to read no `branchName`, write `abandoned`, and permanently strand the workflow even though a valid, open PR existed. The fix makes the function prefer the orchestrator dir that matches the `orchestratorScript` recorded in the top-level workflow state.

## What Was Built

- `orchestratorNamesForScript(orchestratorScript)` — new exported inverse-lookup helper in `orchestratorLib.ts` that maps a script path back to its explicitly-registered orchestrator `agentName`s (never including unmapped fallback names like `init-orchestrator`)
- `ORCHESTRATOR_SCRIPT_BY_NAME` — module-level constant extracted from `deriveOrchestratorScript`'s formerly-inlined `nameMap`, shared by both the forward and inverse lookups
- `preferByTopLevelScript(adwDir, candidates)` — private helper in `stateHelpers.ts` that reads the top-level `agents/{adwId}/state.json` and returns the candidate path whose `agentName` is in the expected set, or `null` if unavailable
- Rewritten `findOrchestratorStatePath` — collects all `*-orchestrator` candidates, tries `preferByTopLevelScript`, falls back to first-match if no signal is available
- New unit-test suite `adws/core/__tests__/stateHelpers.test.ts` covering the regression case and all fallback paths

## Technical Implementation

### Files Modified

- `adws/core/orchestratorLib.ts`: extracted `ORCHESTRATOR_SCRIPT_BY_NAME` constant from `deriveOrchestratorScript`'s inline map; added `orchestratorNamesForScript` inverse helper
- `adws/core/stateHelpers.ts`: added `preferByTopLevelScript` private helper and rewrote `findOrchestratorStatePath` to use it; added `import { orchestratorNamesForScript } from './orchestratorLib'`
- `adws/core/__tests__/stateHelpers.test.ts`: new unit test file (5 test cases covering the regression, two fallback paths, single-dir happy path, and no-orchestrator case)
- `features/per-issue/feature-529.feature` + `features/per-issue/step_definitions/feature-529.steps.ts`: BDD scenario and step definitions for issue #529

### Key Changes

- **Inverse lookup, not forward comparison:** `deriveOrchestratorScript('init-orchestrator')` returns the default `adws/adwSdlc.tsx` fallback, so a forward comparison would erroneously match the failed `init-orchestrator` dir. The inverse lookup only returns names with *explicit* entries in the map, making `init-orchestrator` invisible to the preferred-set.
- **Signature preserved:** `findOrchestratorStatePath(adwId: string): string | null` is unchanged — all four call sites (`adwMerge.tsx`, `workflowInit.ts`, `webhookHandlers.ts`, `cancelHandler.ts`) benefit automatically.
- **`deriveOrchestratorScript` behavior unchanged:** only the private `nameMap` was relocated; the `?? 'adwSdlc'` fallback and all mappings are byte-for-byte identical.
- **Top-level state read reuses `readStateFile`:** calling `readStateFile(adwDir)` (with the `agents/{adwId}` dir rather than a subdir) reads `agents/{adwId}/state.json` — no new `AgentStateManager` dependency, keeping the module circular-dependency-free.
- **Many-to-one mapping is safe:** `orchestratorNamesForScript('adws/adwSdlc.tsx')` returns `['sdlc-orchestrator', 'feature-orchestrator']`, but only one of those directories exists per `adwId`, so `candidates.find(...)` resolves unambiguously.

## How to Use

This fix is transparent — no call-site changes are required.

1. When `adwMerge` calls `findOrchestratorStatePath(adwId)`, the function now reads the top-level `agents/{adwId}/state.json`.
2. If `orchestratorScript` is set (e.g. `"adws/adwSdlc.tsx"`), it resolves the expected orchestrator names via `orchestratorNamesForScript`.
3. It returns the candidate directory whose `agentName` is in that set (e.g. `sdlc-orchestrator`), skipping any failed `init-orchestrator` dir.
4. `adwMerge` reads the correct `branchName` and proceeds to merge rather than writing `abandoned`.

## Configuration

No configuration changes required. The mapping of orchestrator names to scripts lives in `ORCHESTRATOR_SCRIPT_BY_NAME` in `adws/core/orchestratorLib.ts`. Add entries there when new orchestrator types are introduced.

## Testing

```bash
# Regression proof: case 1 must PASS after the fix (failed before)
bunx vitest run adws/core/__tests__/stateHelpers.test.ts

# Confirm adwMerge consumer contract is unaffected
bunx vitest run adws/__tests__/adwMerge.test.ts

# Full unit suite — zero regressions
bun run test:unit

# Type checks
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint + build
bun run lint
bun run build
```

## Notes

- **Root cause:** `adwId` reuse on retry (introduced in commit `e19eae3`) means `agents/{adwId}/` can contain both an `init-orchestrator` and an `sdlc-orchestrator` subdirectory. The old first-match scan had no way to choose the correct one.
- **Real-world incident:** issue #508 / PR #526 (2026-05-26) was permanently stranded (`abandoned`) because the failed `init-orchestrator` dir shadowed `sdlc-orchestrator`. Manual state surgery was required to unblock it.
- **Related but out of scope:** issue #524 (persist `branchName` to top-level state) would make `adwMerge` resilient even if directory resolution were wrong. This fix repairs the resolution itself; #524 remains a complementary, separate change.
- **`## Retry` recovery:** this fix prevents the `abandoned` write, so the `## Retry` directive (PR #528) does not need to handle this class of stranding.
