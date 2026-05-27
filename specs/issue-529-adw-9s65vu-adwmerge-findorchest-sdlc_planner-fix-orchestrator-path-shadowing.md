# Bug: `findOrchestratorStatePath` shadows the real orchestrator with a failed `init-orchestrator` on a reused adwId

## Metadata
issueNumber: `529`
adwId: `9s65vu-adwmerge-findorchest`
issueJson: `{"number":529,"title":"adwMerge: findOrchestratorStatePath shadows sdlc-orchestrator with a failed init-orchestrator, reading the wrong branchName","body":"## Summary\n\n`findOrchestratorStatePath` (`adws/core/stateHelpers.ts`) returns the **first** `agents/<adwId>/*/` directory whose state `agentName` ends with `-orchestrator`, in `readdirSync` order. When an adwId is reused across a failed `init-orchestrator` attempt and the real `sdlc-orchestrator` run (adwId reuse on retry — see commit e19eae3), it returns the **failed `init-orchestrator`** dir instead of `sdlc-orchestrator`.\n\n`adwMerge.tsx:102-114` then reads `branchName` from that wrong dir → hits the `no_branch_name` guard → writes `abandoned`. Because `abandoned` ≠ `merge_blocked`, the `## Retry` directive (PR #528) cannot recover it.\n\n## Evidence (issue #508 / PR #526, 2026-05-26)\n\n`agents/kswfvk-llm-drafted-observab/` contained both:\n- `init-orchestrator/state.json` — `agentName: \"init-orchestrator\"`, `execution.status: \"failed\"` (PR create failed: *\"No commits between dev and adwinit-issue-508-…-block\"*), **no branchName**\n- `sdlc-orchestrator/state.json` — the real run, branch `feature-issue-508-llm-draft-observability-examples`, PR #526\n\n`findOrchestratorStatePath('kswfvk-llm-drafted-observab')` returned the **init** dir. #526 sat open+conflicting while #508 was stuck `abandoned`. Manually writing the correct branchName into the resolved file + setting `awaiting_merge` let `adwMerge` find #526 and merge it.\n\n## Proposed fix\n\nPrefer the orchestrator dir matching `orchestratorScript` in the top-level state (`adws/adwSdlc.tsx` → `sdlc-orchestrator`) rather than the first `-orchestrator` dir `readdirSync` yields. Fall back to current behaviour only if no match. Add a unit test with two competing orchestrator dirs.\n\n## Related\n- Bug: `adwMerge` reads branchName from orchestrator state but #524 persists it to top-level state (separate issue)\n- `## Retry` / `merge_blocked` recovery: #527 / #528\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-27T09:28:46Z","comments":[],"actionableComment":null}`

## Bug Description

`findOrchestratorStatePath(adwId)` in `adws/core/stateHelpers.ts` locates the orchestrator state directory for a workflow by scanning `agents/{adwId}/` and returning the **first** subdirectory (in `fs.readdirSync` order) whose `state.json` has an `agentName` ending in `-orchestrator`.

When an `adwId` is reused across two orchestrator runs — a **failed `init-orchestrator`** attempt followed by the **real `sdlc-orchestrator`** run (adwId reuse on retry, introduced in commit `e19eae3`) — the `agents/{adwId}/` directory contains **two** competing `-orchestrator` subdirectories:

- `init-orchestrator/state.json` — `agentName: "init-orchestrator"`, `execution.status: "failed"`, **no `branchName`**
- `sdlc-orchestrator/state.json` — the real run, with the correct `branchName` and a live/complete execution

Because `init-orchestrator` sorts before `sdlc-orchestrator` (and is typically yielded first by `readdirSync`), the function returns the **failed init dir**.

**Expected behavior:** `findOrchestratorStatePath` returns the directory belonging to the orchestrator that actually owns the workflow (the one recorded in the top-level state's `orchestratorScript`, i.e. `sdlc-orchestrator`), so its correct `branchName` is read.

**Actual behavior:** It returns the failed `init-orchestrator` dir, which has no `branchName`.

### Downstream symptom

`adwMerge.tsx` (lines 101–115) reads `branchName` from the resolved orchestrator state. With the wrong (init) dir resolved, `branchName` is `undefined`, so `executeMerge` hits the `no_branch_name` guard and writes `workflowStage: 'abandoned'`. Since `abandoned` is **not** `merge_blocked`, the human-recoverable `## Retry` directive (PR #528) cannot reset it back to `awaiting_merge` — the workflow is permanently stranded even though a valid, mergeable PR exists. This is exactly what happened to issue #508 / PR #526 on 2026-05-26 and required manual state surgery to unblock.

## Problem Statement

`findOrchestratorStatePath` is non-deterministic and incorrect when more than one `*-orchestrator` state directory exists under a single reused `adwId`. It must deterministically resolve to the orchestrator directory that owns the workflow — identified by the top-level state's `orchestratorScript` field — and only fall back to the current first-match behavior when that signal is unavailable or matches nothing.

## Solution Statement

Make `findOrchestratorStatePath` **prefer** the candidate `*-orchestrator` directory whose `agentName` maps to the `orchestratorScript` recorded in the top-level workflow state (`agents/{adwId}/state.json`), falling back to the existing first-match behavior only when there is no top-level `orchestratorScript` or no candidate matches it.

The script→name relationship is the inverse of the existing `deriveOrchestratorScript()` in `adws/core/orchestratorLib.ts`. A new exported helper, `orchestratorNamesForScript(orchestratorScript)`, returns the **explicitly-mapped** orchestrator agentNames for a given script path.

**Critical design point — why a reverse lookup, not a forward comparison:** `deriveOrchestratorScript('init-orchestrator')` returns the **default fallback** `adws/adwSdlc.tsx` (because `init-orchestrator` is not in the name map). So a forward comparison (`deriveOrchestratorScript(candidate.agentName) === topLevel.orchestratorScript`) would *also* match the failed `init-orchestrator` dir against an `adws/adwSdlc.tsx` top-level script — leaving the bug unfixed. The reverse lookup only ever returns names that are **explicit keys** in the map, so `init-orchestrator` is never a candidate. For `adws/adwSdlc.tsx` it returns `['sdlc-orchestrator', 'feature-orchestrator']`; in practice only one of those directories exists per adwId.

The fix is fully internal to `findOrchestratorStatePath` — its signature `(adwId: string) => string | null` is unchanged, so all four call sites (`adwMerge.tsx`, `workflowInit.ts` recovery, `webhookHandlers.ts`, `cancelHandler.ts`) benefit automatically with no ripple changes.

## Steps to Reproduce

1. Create `agents/{adwId}/` for a single reused `adwId` containing:
   - top-level `state.json` with `orchestratorScript: "adws/adwSdlc.tsx"`
   - `init-orchestrator/state.json` → `agentName: "init-orchestrator"`, `execution.status: "failed"`, **no `branchName`**
   - `sdlc-orchestrator/state.json` → `agentName: "sdlc-orchestrator"`, `branchName: "feature-issue-508-…"`
2. Call `findOrchestratorStatePath(adwId)`.
3. **Actual:** returns `…/init-orchestrator` (alphabetically/`readdirSync`-first). Reading `branchName` yields `undefined`.
4. **Expected:** returns `…/sdlc-orchestrator`, whose `branchName` is correct.

Real-world manifestation: with the reused adwId in step 1 and `workflowStage: 'awaiting_merge'`, running `adwMerge` writes `abandoned` (reason `no_branch_name`) instead of merging the open PR, and `## Retry` cannot recover it.

## Root Cause Analysis

`findOrchestratorStatePath` (`adws/core/stateHelpers.ts:92-115`) treats the **first** directory whose `agentName` ends in `-orchestrator` as authoritative:

```ts
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const statePath = path.join(adwDir, entry.name);
  const state = readStateFile(statePath);
  if (state?.agentName && String(state.agentName).endsWith('-orchestrator')) {
    return statePath;   // ← first match wins, order-dependent
  }
}
```

This implicitly assumes exactly one `*-orchestrator` directory per `adwId`. That assumption was broken by adwId reuse on retry (`e19eae3`): a failed `init-orchestrator` and the real `sdlc-orchestrator` now coexist. `readdirSync` order is not a meaningful ranking, and `init-orchestrator` (no `branchName`) is selected over the real run.

The codebase already records the owning orchestrator in the top-level state via `orchestratorScript` (written in `workflowInit.ts:236` using `deriveOrchestratorScript(orchestratorName)`). The bug is simply that `findOrchestratorStatePath` does not consult this disambiguating signal.

## Relevant Files

Use these files to fix the bug:

- `adws/core/stateHelpers.ts` — **primary fix.** Contains `findOrchestratorStatePath` (lines 92-115), the order-dependent first-match scan that is the root cause, and the existing `readStateFile` minimal reader (lines 70-82) which already reads `state.json` under a given directory (calling it with the `agents/{adwId}` dir reads the **top-level** state file — reused to avoid a heavier `AgentStateManager` dependency).
- `adws/core/orchestratorLib.ts` — **secondary fix.** Contains `deriveOrchestratorScript()` (lines 61-79) and its private `nameMap`. Extract the map to a module-level constant and add the inverse helper `orchestratorNamesForScript()`. `deriveOrchestratorScript()`'s behavior (including its `adwSdlc` fallback) must remain byte-for-byte identical.
- `adws/types/agentTypes.ts` — reference. `AgentState.orchestratorScript?` (line 280-281) and `AgentState.branchName?` (line 242-243) confirm the field names and types being read.
- `adws/adwMerge.tsx` — reference (the reporting symptom). Lines 101-115 read `branchName` from the resolved orchestrator state and write `abandoned` on `no_branch_name`. No change needed here, but it is the consumer the fix unblocks.
- `adws/phases/workflowInit.ts` — reference. Lines 226-239 show the orchestrator state dir is created with `agentName === orchestratorName` and the top-level `orchestratorScript` is written via `deriveOrchestratorScript(orchestratorName)`. Line 309-310 is a second `findOrchestratorStatePath` call site (legacy recovery) that benefits from the fix.
- `adws/triggers/webhookHandlers.ts` (line 191) and `adws/triggers/cancelHandler.ts` (line 105) — reference. The two remaining `findOrchestratorStatePath` call sites; both want the *real* orchestrator dir, so both benefit with no code change.
- `adws/core/__tests__/topLevelState.test.ts` — reference/template. Demonstrates the unit-test pattern for exercising code that reads `AGENTS_STATE_DIR`: use the real `AGENTS_STATE_DIR` with a unique timestamped `adwId` and clean up with `afterEach` (`fs.rmSync(..., { recursive: true, force: true })`).
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — reference (conditional doc). Explains the top-level state file, the `orchestratorScript` field, and `deriveOrchestratorScript()`'s move to `orchestratorLib.ts`.
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — reference (conditional doc). Covers `adwMerge.tsx`, the merge handoff, and `deriveOrchestratorScript()` mappings.
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — reference (conditional doc). Context for branch-name persistence; relevant to the related issue #524 (persisting `branchName` to top-level state) noted in the issue.

### New Files

- `adws/core/__tests__/stateHelpers.test.ts` — new Vitest unit test covering `findOrchestratorStatePath`'s disambiguation: the two-competing-dirs regression case plus the fallback cases.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the inverse `orchestratorNamesForScript` helper to `orchestratorLib.ts`

- In `adws/core/orchestratorLib.ts`, lift the private `nameMap` out of `deriveOrchestratorScript` into a module-level `const ORCHESTRATOR_SCRIPT_BY_NAME: Record<string, string>` holding the exact same entries (do not add, remove, or rename any mapping).
- Rewrite `deriveOrchestratorScript` to read from the constant, preserving its current behavior exactly, including the `?? 'adwSdlc'` fallback:
  ```ts
  export function deriveOrchestratorScript(orchestratorName: string): string {
    return `adws/${ORCHESTRATOR_SCRIPT_BY_NAME[orchestratorName] ?? 'adwSdlc'}.tsx`;
  }
  ```
- Add the inverse helper directly below it:
  ```ts
  /**
   * Inverse of deriveOrchestratorScript: returns the orchestrator agentName
   * identifiers whose script equals the given path. Only explicitly-mapped names
   * are returned — the 'adwSdlc' default fallback is NOT applied, so unmapped
   * names (e.g. 'init-orchestrator') never match. Used by findOrchestratorStatePath
   * to disambiguate a reused adwId where a failed init-orchestrator shadows the
   * real orchestrator (#529).
   */
  export function orchestratorNamesForScript(orchestratorScript: string): string[] {
    return Object.entries(ORCHESTRATOR_SCRIPT_BY_NAME)
      .filter(([, script]) => `adws/${script}.tsx` === orchestratorScript)
      .map(([name]) => name);
  }
  ```
- Keep the function pure (no side effects), per the coding guidelines.

### Step 2: Make `findOrchestratorStatePath` prefer the top-level `orchestratorScript` owner

- In `adws/core/stateHelpers.ts`, add the import: `import { orchestratorNamesForScript } from './orchestratorLib';` (runtime-cycle-safe — `orchestratorLib`'s only runtime dependency is `STAGE_ORDER` from `workflowCommentParsing`, whose import of `./index` is type-only).
- Rewrite `findOrchestratorStatePath` so it (a) collects **all** candidate `*-orchestrator` directories (reading each `agentName` once), (b) prefers the candidate owned by the top-level `orchestratorScript`, and (c) falls back to the first candidate. Preserve the existing early returns (missing dir → `null`, `try/catch` → `null`) and keep nesting shallow per the guidelines:
  ```ts
  export function findOrchestratorStatePath(adwId: string): string | null {
    const adwDir = path.join(AGENTS_STATE_DIR, adwId);
    if (!fs.existsSync(adwDir)) return null;

    try {
      const candidates = fs.readdirSync(adwDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const statePath = path.join(adwDir, entry.name);
          const agentName = String(readStateFile(statePath)?.agentName ?? '');
          return { statePath, agentName };
        })
        .filter((c) => c.agentName.endsWith('-orchestrator'));

      if (candidates.length === 0) return null;

      // Disambiguate a reused adwId (e.g. a failed init-orchestrator shadowing the
      // real run): prefer the dir owned by the script recorded in top-level state.
      // Fall back to the first candidate when there is no orchestratorScript or no
      // candidate matches it. (#529)
      const preferred = preferByTopLevelScript(adwDir, candidates);
      return preferred ?? candidates[0].statePath;
    } catch {
      return null;
    }
  }
  ```
- Add the private helper (placed near `findOrchestratorStatePath`):
  ```ts
  /**
   * Returns the candidate state path owned by the top-level state's
   * orchestratorScript, or null when there is no such field or no match.
   */
  function preferByTopLevelScript(
    adwDir: string,
    candidates: ReadonlyArray<{ statePath: string; agentName: string }>,
  ): string | null {
    // readStateFile(adwDir) reads agents/{adwId}/state.json — the top-level state.
    const orchestratorScript = readStateFile(adwDir)?.orchestratorScript;
    if (typeof orchestratorScript !== 'string' || orchestratorScript.length === 0) {
      return null;
    }
    const expectedNames = new Set(orchestratorNamesForScript(orchestratorScript));
    if (expectedNames.size === 0) return null;

    const match = candidates.find((c) => expectedNames.has(c.agentName));
    return match?.statePath ?? null;
  }
  ```
- Confirm `readStateFile` (lines 70-82) is reused unchanged for both the per-candidate reads and the top-level read; do **not** introduce an `AgentStateManager` dependency (keeps the module circular-dependency-free, as the file's header comment intends).

### Step 3: Add the unit test for two competing orchestrator dirs (red → green)

- Create `adws/core/__tests__/stateHelpers.test.ts` following the `topLevelState.test.ts` fixture pattern: import `findOrchestratorStatePath` from `../stateHelpers` and `AGENTS_STATE_DIR` from `../config`; use a unique timestamped `adwId` per test; `afterEach` removes `path.join(AGENTS_STATE_DIR, adwId)` with `fs.rmSync(..., { recursive: true, force: true })`.
- Add a small fixture helper that writes a top-level `state.json` and any number of named orchestrator sub-dirs with their `state.json` files (using `fs.mkdirSync(..., { recursive: true })` and `fs.writeFileSync`).
- Cover these cases:
  1. **Regression (core):** top-level `orchestratorScript: "adws/adwSdlc.tsx"`, plus `init-orchestrator` (`agentName: "init-orchestrator"`, `execution.status: "failed"`, no `branchName`) **and** `sdlc-orchestrator` (`agentName: "sdlc-orchestrator"`, `branchName: "feature-issue-508-x"`). Assert the returned path ends with `sdlc-orchestrator` (not `init-orchestrator`), and that reading `branchName` from the resolved state yields `"feature-issue-508-x"`. (This fails against the unfixed code, which returns `init-orchestrator`.)
  2. **Fallback — no top-level `orchestratorScript`:** only an `init-orchestrator` dir exists and the top-level state omits `orchestratorScript`. Assert it still returns the `init-orchestrator` path (preserves legacy first-match behavior).
  3. **Fallback — script matches nothing:** top-level `orchestratorScript: "adws/adwChore.tsx"` but only a single `sdlc-orchestrator` dir exists. Assert it falls back to returning the `sdlc-orchestrator` path.
  4. **Single orchestrator dir (happy path unchanged):** only `sdlc-orchestrator` exists with `orchestratorScript: "adws/adwSdlc.tsx"`; assert it is returned.
  5. **No orchestrator dirs:** only a non-orchestrator agent dir (e.g. `plan-agent`) exists; assert `null`.
- Keep assertions on the directory basename (e.g. `expect(result?.endsWith('sdlc-orchestrator')).toBe(true)`) so they are filesystem-order independent.

### Step 4: Run the validation commands

- Run every command in the `Validation Commands` section below and confirm all pass with zero errors and zero regressions.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions. Commands are taken from `.adw/commands.md`.

- `bunx vitest run adws/core/__tests__/stateHelpers.test.ts` — **reproduction + fix proof.** Run this against the unfixed code first (case 1 must FAIL, proving the bug), then after Steps 1–2 it must PASS (proving the fix).
- `bunx vitest run adws/__tests__/adwMerge.test.ts` — confirms the merge orchestrator's existing behavior is unaffected (it injects `findOrchestratorStatePath` via `MergeDeps`, so this guards the consumer contract).
- `bun run test:unit` — full unit-test suite; validates zero regressions across all `__tests__`.
- `bunx tsc --noEmit` — root type-check (catches any accidental circular import or type error introduced by the new import in `stateHelpers.ts`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW workspace type-check.
- `bun run lint` — ESLint code-quality gate.
- `bun run build` — verifies the project builds without errors.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`) are followed: single responsibility (the inverse map lives next to `deriveOrchestratorScript` as the single source of truth — no duplicated map), purity (`orchestratorNamesForScript` and `preferByTopLevelScript` are side-effect-free reads), guard clauses / max-depth-2 nesting in the rewritten `findOrchestratorStatePath`, type safety (no `any`; `unknown`-typed `orchestratorScript` is narrowed with `typeof`), and declarative `filter`/`map`/`find` over imperative loops.
- **No new libraries** are required. (`.adw/commands.md` install command, if ever needed: `bun add <package>`.)
- **Signature preserved:** `findOrchestratorStatePath(adwId: string): string | null` is unchanged, so the `adwMerge` `MergeDeps` injection, `webhookHandlers`, `cancelHandler`, and `workflowInit` recovery all keep working without edits, while transparently getting the correct directory.
- **`deriveOrchestratorScript` must not change behavior.** Only its `nameMap` is relocated to a shared constant; the `?? 'adwSdlc'` fallback and every mapping stay identical. This avoids regressing the pause/resume resume-script selection (`pauseQueueScanner`, `scanAuthQueue`, `webhookGatekeeper`) that also depends on it.
- **Many-to-one mapping is harmless:** `orchestratorNamesForScript('adws/adwSdlc.tsx')` returns both `sdlc-orchestrator` and `feature-orchestrator`. Only one of those directories exists for a given adwId, so `candidates.find(...)` resolves unambiguously. Likewise `adwPlanBuild` maps from both `plan-build-orchestrator` and `plan-build-test-orchestrator`.
- **`adwMerge` does not overwrite `orchestratorScript`.** It uses `runWithRawOrchestratorLifecycle` and explicitly skips `initializeWorkflow` (see `adwMerge.tsx` header), so the top-level `orchestratorScript` remains the real run's value (e.g. `adws/adwSdlc.tsx`) when `adwMerge` calls `findOrchestratorStatePath` — exactly the signal the fix relies on.
- **Related but out of scope:** issue #524 (persist `branchName` to top-level state so `adwMerge` need not read the orchestrator sub-dir at all) would make `adwMerge` resilient even if directory resolution were wrong. This plan fixes the resolution itself; #524 is a complementary, separate change and is intentionally not addressed here to keep this fix surgical.
