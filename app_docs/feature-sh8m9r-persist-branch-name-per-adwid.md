# Persist Branch Name per `adwId` — Prevent Branch-Name Agent Re-fire

**ADW ID:** sh8m9r-branchname-agent-re
**Date:** 2026-05-26
**Specification:** specs/issue-524-adw-sh8m9r-branchname-agent-re-sdlc_planner-persist-branch-name-per-adwid.md

## Overview

Before this change, `runGenerateBranchNameAgent` (an LLM-backed slug generator) could be invoked multiple times for the same `adwId` during phase re-entries. Because the LLM offers no determinism guarantee across calls, a second invocation could return a different slug, causing the orchestrator to create a new branch and worktree while all phase-1 artifacts (plan, scenarios, alignment) remained stranded on the original branch. This feature makes the chosen branch name a **persisted, authoritative property of the `adwId`**: written to `agents/{adwId}/state.json` the first time it is resolved and reused on every subsequent `initializeWorkflow` call — the agent fires at most once per workflow.

## What Was Built

- New module `adws/phases/branchNameResolution.ts` encapsulating the full branch-name resolution cascade with persistence
- `readPersistedBranchName(adwId)` — reads `branchName` from top-level state
- `persistBranchName(adwId, branchName)` — merges `branchName` into top-level state (atomic write)
- `resolveWorkflowBranchName(args)` — priority cascade: persisted → recovery comment → LLM generation, with a mismatch abort guard
- Both `runGenerateBranchNameAgent` call sites in `workflowInit.ts` replaced with `resolveWorkflowBranchName`
- `findWorktreeForIssue` pattern discovery gated behind "no persisted branch name" so a persisted name is always authoritative over sibling worktree adoption
- `branchName` conditionally included in the canonical top-level-state init write (conditional spread to avoid clobbering a persisted name on the `options.cwd` path)
- Unit tests: `adws/phases/__tests__/branchNameResolution.test.ts` (resolver-level) and `adws/phases/__tests__/workflowInit.test.ts` (determinism regression at `initializeWorkflow` level)

## Technical Implementation

### Files Modified

- `adws/phases/branchNameResolution.ts` (**new**): single-responsibility resolver module with `readPersistedBranchName`, `persistBranchName`, `resolveWorkflowBranchName`, and `_resolveWorkflowBranchNameForTest` (test-injection seam)
- `adws/phases/workflowInit.ts`: replaced two inline `recovery-or-generate` blocks with `resolveWorkflowBranchName`; gated `findWorktreeForIssue` behind persisted-name check; added conditional `branchName` spread to canonical state init write
- `adws/phases/__tests__/branchNameResolution.test.ts` (**new**): Vitest unit tests for the resolver
- `adws/phases/__tests__/workflowInit.test.ts` (**new**): Vitest regression test driving two `initializeWorkflow` calls with divergent agent slugs

### Key Changes

- **Resolution priority** enforced as code: `persisted state (agents/{adwId}/state.json) → recoveryState.branchName → LLM generation`. The persisted state wins unconditionally; the LLM is never reached on a re-entry.
- **Defense-in-depth mismatch guard**: after the LLM call completes, the state file is re-read; if a concurrent writer persisted a different name during the LLM roundtrip, the resolver throws with an operator-legible error naming both branch names and the `adwId`, refusing to fork into an orphan worktree.
- **`findWorktreeForIssue` gated**: `persistedBranchName ? null : findWorktreeForIssue(...)` — a persisted name takes precedence over directory-pattern-matched sibling worktrees, closing the "lookup adopts wrong sibling" gap.
- **Conditional spread in state init**: `...(branchName ? { branchName } : {})` ensures the `options.cwd` code path (where `branchName` is `''`) never overwrites a previously persisted name.
- **Module extraction**: branch-name logic is extracted from `workflowInit.ts` into a focused, unit-testable module, bringing `workflowInit.ts` back under the 300-line guideline.

## How to Use

This feature is transparent to operators and agents — no API or configuration changes are required. The effect is observed behaviorally:

1. On the first `initializeWorkflow` call for an `adwId`, the branch name is resolved (from persisted state, recovery comments, or the LLM) and written to `agents/{adwId}/state.json`.
2. On all subsequent calls for that `adwId` (phase re-entries, retries, cron re-fires), the resolver reads the persisted name and returns it immediately — the LLM is not invoked.
3. If a mismatch is detected (concurrent write scenario), the workflow aborts with a clear error rather than silently forking.

To inspect the persisted branch name for a workflow:

```sh
cat agents/<adwId>/state.json | jq .branchName
```

## Configuration

No new configuration options. The feature uses the existing `AgentStateManager.readTopLevelState` / `writeTopLevelState` primitives and the existing `AgentState.branchName` field (no schema migration required).

## Testing

```sh
# Unit tests (resolver + workflowInit regression)
bun run test:unit

# Run only the new resolver tests
bunx vitest adws/phases/__tests__/branchNameResolution.test.ts
bunx vitest adws/phases/__tests__/workflowInit.test.ts

# Full regression BDD suite (zero regressions)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Per-issue BDD scenarios for this feature
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-sh8m9r-branchname-agent-re"
```

Key test cases:
- Persisted name present → resolver returns it, agent mock is never called (criterion 1)
- Two sequential `resolveWorkflowBranchName` calls with divergent agent slugs → first call wins, agent invoked exactly once (resolver-level criterion 3)
- Two `initializeWorkflow` calls, same `adwId`, divergent agent slugs → exactly one branch and one worktree created (integration-level criterion 3)
- Mismatch guard → `resolveWorkflowBranchName` rejects with "Refusing to fork" error (criterion 2)
- Recovery path → resolver persists recovery name without calling the agent

## Notes

- **Predecessor**: builds directly on issue #455 / adwId `7dp24s` (Deterministic Branch-Name Assembly), which narrowed intra-call drift by making the LLM emit only a slug. This feature closes the remaining cross-call drift by persisting and reusing that slug.
- **Production incident motivation**: workflow `cv2hai-rfc-split-worker-api` / issue #95 produced two branches (`...-scrape-deck` and `...-scrape-deck-ports`), orphaning plan artifacts and wedging the build phase with `Cannot read plan file at <new-worktree>/specs/issue-N-plan.md`.
- **Criterion 4 (optional follow-up, not implemented)**: `findPlanFile` sibling-worktree fallback and enriched "Cannot read plan file" error messages. Deferred — the primary fix prevents orphan creation, making criterion 4 a defensive net rather than load-bearing.
- **Out of scope**: populating `ctx.branchName` for downstream phases in the non-recovery path, and pruning pre-existing orphan worktrees from past incidents.
- The `_resolveWorkflowBranchNameForTest` export is intentionally `@internal` — production callers must use `resolveWorkflowBranchName` only.
