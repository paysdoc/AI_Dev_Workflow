# Remote Reconcile Module

**ADW ID:** djtyv4-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-458-adw-djtyv4-orchestrator-resilie-sdlc_planner-remote-reconcile-module.md

## Overview

Introduces `adws/core/remoteReconcile.ts`, a deep module that derives the authoritative `WorkflowStage` of an ADW run from remote GitHub artifacts (branch existence and PR state) rather than trusting a potentially-stale local state file. A mandatory re-verification read guards against GitHub's read-your-write lag by requiring two consecutive agreeing reads before returning; persistent divergence falls back to the state-file value. All I/O is injected via `ReconcileDeps` so every code path is unit-testable without touching real GitHub or the file system.

## What Was Built

- `adws/core/remoteReconcile.ts` — new deep module exporting `deriveStageFromRemote`, `mapArtifactsToStage`, `ReconcileDeps`, `buildDefaultReconcileDeps`, and `MAX_RECONCILE_VERIFICATION_RETRIES`
- `adws/core/__tests__/remoteReconcile.test.ts` — comprehensive unit test suite (233 lines) covering all mapping branches, re-verification retry paths, and state-file edge cases
- `RawPR` interface and `defaultFindPRByBranch` lifted from `adws/adwMerge.tsx` into `adws/github/prApi.ts` for shared reuse
- `'discarded'` added to the `WorkflowStage` union in `adws/types/workflowTypes.ts`
- `adws/core/index.ts` updated with barrel exports for the new module
- `adws/github/index.ts` updated to re-export `RawPR` and `defaultFindPRByBranch`
- BDD feature file and step definitions for the remote reconcile module

## Technical Implementation

### Files Modified

- `adws/core/remoteReconcile.ts`: New deep module — 108 lines implementing stage derivation with re-verification retry loop
- `adws/core/__tests__/remoteReconcile.test.ts`: New unit test suite — 233 lines, vitest, DI-based fakes
- `adws/github/prApi.ts`: Added `RawPR` interface and `defaultFindPRByBranch` (lifted from `adwMerge.tsx`)
- `adws/github/index.ts`: Re-exports `RawPR` and `defaultFindPRByBranch`
- `adws/adwMerge.tsx`: Replaced local `RawPR`/`defaultFindPRByBranch` definitions with imports from `./github`
- `adws/types/workflowTypes.ts`: Added `'discarded'` to the `WorkflowStage` union
- `adws/core/index.ts`: Added barrel exports for the new module
- `features/remote_reconcile_module.feature`: BDD scenarios for the module
- `features/step_definitions/remoteReconcileModuleSteps.ts`: Step definitions (487 lines)

### Key Changes

- **`mapArtifactsToStage(branchExists, pr)`** — pure function mapping remote artifacts to `WorkflowStage | null`. Returns `null` when no branch exists (caller falls back to state file), `'branch_created'` for branch-only, `'awaiting_merge'` for open PR, `'completed'` for merged PR, `'discarded'` for closed-unmerged PR.
- **Re-verification loop** — `deriveStageFromRemote` performs an initial read then loops up to `MAX_RECONCILE_VERIFICATION_RETRIES` (3) times until two consecutive reads agree. Prevents API read-your-write lag from producing flapping results.
- **Fallback chain** — when the branch is absent from remote, state file is missing, or reads never stabilize, the function falls back to `state?.workflowStage ?? 'starting'` and never throws.
- **`ReconcileDeps` DI interface** — three injectable fields (`readTopLevelState`, `branchExistsOnRemote`, `findPRByBranch`) allow exhaustive unit testing without real I/O. Production wiring in `buildDefaultReconcileDeps()`.
- **`defaultBranchExistsOnRemote`** — wraps `git ls-remote --exit-code origin <branch>`; exit code 2 means "not found" → `false`; any other error is logged as warn and also returns `false`.

## How to Use

```ts
import { deriveStageFromRemote } from '../core';

// Production use (default deps wired automatically)
const stage = deriveStageFromRemote(issueNumber, adwId, repoInfo);

// Test use (inject fakes)
const stage = deriveStageFromRemote(issueNumber, adwId, repoInfo, {
  readTopLevelState: vi.fn().mockReturnValue(fakeState),
  branchExistsOnRemote: vi.fn().mockReturnValue(true),
  findPRByBranch: vi.fn().mockReturnValue({ state: 'OPEN', ... }),
});
```

**Stage mapping:**

| Remote state | Returned stage |
|---|---|
| No branch on remote | `state.workflowStage` or `'starting'` |
| Branch exists, no PR | `'branch_created'` |
| Branch + open PR | `'awaiting_merge'` |
| Branch + merged PR | `'completed'` |
| Branch + closed PR (unmerged) | `'discarded'` |
| Reads never stabilize | `state.workflowStage` or `'starting'` |

## Configuration

No configuration required. The constant `MAX_RECONCILE_VERIFICATION_RETRIES = 3` controls the retry bound and is exported for use in tests.

## Testing

```bash
bun run test:unit -- --run adws/core/__tests__/remoteReconcile.test.ts
```

The suite is organized into four describe blocks:
1. `mapArtifactsToStage` — pure mapping tests, one `it` per branch
2. `deriveStageFromRemote — happy path` — all four stage mappings with stable deps
3. `deriveStageFromRemote — re-verification` — flap-then-converge, flap-forever (fallback), flap-forever with no state stage
4. `deriveStageFromRemote — state-file edges` — missing state file, missing `branchName`, remote branch absent

## Notes

- **Not wired into `takeoverHandler` yet** — this slice ships the module standalone. Integration into `takeoverHandler` (slice #11 per the parent PRD) is a follow-up.
- **`issueNumber` parameter is reserved** — currently unused but retained in the signature for future commits-ahead checks described in the parent PRD; removing it later would require a signature migration.
- **`'discarded'` union widening is backward-compatible** — no existing call sites switch exhaustively on `WorkflowStage`, so widening the union does not require case additions anywhere.
- **`RawPR`/`defaultFindPRByBranch` lift is behavior-neutral** — the logic is identical to what was in `adwMerge.tsx`; only the module location changed. `adwMerge.test.ts` regression confirms no behavioral change.
- Parent PRD: `specs/prd/orchestrator-coordination-resilience.md`
