# Feature: Add explicit issue-type-to-orchestrator mappings for triggers

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
The ADW triggers (`trigger_webhook.ts` and `trigger_cron.ts`) dispatch ADW orchestrator workflows based on issue type. Currently (at the time this issue was raised) the routing used implicit, unclear defaults. This feature introduces an explicit, declarative `issueTypeToOrchestratorMap` constant that serves as the canonical single source of truth for which orchestrator runs for each issue type:

- **bug** → `adwPlanBuildTest.tsx` (plan + build + test)
- **chore** → `adwPlanBuild.tsx` (plan + build only)
- **feature** → `adwSdlc.tsx` (full SDLC: plan + build + test + review + document)
- **pr_review** → `adwPlanBuild.tsx` (plan + build only)

## User Story
As a developer maintaining the ADW system,
I want an explicit mapping from issue type to orchestrator script,
So that the routing logic is immediately readable and easy to update when new orchestrators are added.

## Problem Statement
The `getWorkflowScript()` function previously used a `switch` statement or implicit fallbacks with hardcoded paths scattered across the codebase, making it difficult to audit which orchestrator handles which issue type. The desired mapping was:
- bug → `adwPlanBuildTest`
- chore → `adwPlanBuild`
- feature → `adwSdlc` (was previously `adwPlanBuildTest`)

## Solution Statement
Introduce a single exported constant `issueTypeToOrchestratorMap: Record<IssueClassSlashCommand, string>` in `adws/core/issueTypes.ts`, export it via `adws/core/index.ts`, and refactor `getWorkflowScript()` in `adws/core/issueClassifier.ts` to use the map as the authoritative fallback for issue-type-based routing. Update tests to import and validate the new map, and update the `adws/README.md` trigger documentation.

## Relevant Files
Use these files to implement the feature:

- **`adws/core/issueTypes.ts`** — Canonical home for all issue-type and ADW-command maps. The new `issueTypeToOrchestratorMap` belongs here alongside `adwCommandToIssueTypeMap` and `adwCommandToOrchestratorMap`.
- **`adws/core/issueClassifier.ts`** — Contains `getWorkflowScript()` which must use `issueTypeToOrchestratorMap` as the fallback lookup instead of any hardcoded `switch`.
- **`adws/core/index.ts`** (via `adws/core/`) — Re-exports from core; `issueTypeToOrchestratorMap` must be exported here so downstream imports via `'.'` or `'../core'` work.
- **`adws/__tests__/issueClassifier.test.ts`** — Must import and validate `issueTypeToOrchestratorMap`, and include parametric tests over every map entry.
- **`adws/README.md`** — Trigger documentation should list the correct orchestrator per issue type.
- **`adws/triggers/trigger_webhook.ts`** — Uses `getWorkflowScript()` for routing; catch-block fallbacks should be reviewed for consistency.
- **`adws/triggers/trigger_cron.ts`** — Uses `getWorkflowScript()` for routing; reviewed for consistency.

### New Files
None required.

## Implementation Plan
### Phase 1: Foundation
Add `issueTypeToOrchestratorMap` as an exported constant in `adws/core/issueTypes.ts` and re-export it via the core barrel (`index.ts`).

### Phase 2: Core Implementation
Refactor `getWorkflowScript()` in `adws/core/issueClassifier.ts` to use `issueTypeToOrchestratorMap` for issue-type-based routing, replacing any `switch` or inline defaults. Update unit tests to import the new map and add parametric coverage.

### Phase 3: Integration
Review trigger files for any hardcoded orchestrator references in catch/fallback paths. Update `adws/README.md` trigger-routing documentation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify or add `issueTypeToOrchestratorMap` in `adws/core/issueTypes.ts`
- Read `adws/core/issueTypes.ts` and check whether `issueTypeToOrchestratorMap` exists with the correct entries.
- If missing or incorrect, add/update the constant after `adwCommandToOrchestratorMap`:
  ```typescript
  /**
   * Maps issue classification types to their default orchestrator scripts.
   * Used by triggers to determine which ADW workflow to spawn when no
   * explicit ADW command is provided.
   */
  export const issueTypeToOrchestratorMap: Record<IssueClassSlashCommand, string> = {
    '/bug': 'adws/adwPlanBuildTest.tsx',
    '/chore': 'adws/adwPlanBuild.tsx',
    '/feature': 'adws/adwSdlc.tsx',
    '/pr_review': 'adws/adwPlanBuild.tsx',
  };
  ```

### Step 2: Export `issueTypeToOrchestratorMap` from the core barrel
- Read `adws/core/index.ts` (or wherever the core barrel export lives).
- Ensure `issueTypeToOrchestratorMap` is included in the re-export of `issueTypes.ts` / `dataTypes.ts`.
- Example: `export { ..., issueTypeToOrchestratorMap } from './issueTypes';`

### Step 3: Refactor `getWorkflowScript()` in `adws/core/issueClassifier.ts`
- Confirm that `issueTypeToOrchestratorMap` is imported (it will be available via the `'.'` barrel import).
- Replace any `switch` statement or hardcoded path with a map lookup:
  ```typescript
  export function getWorkflowScript(issueType: IssueClassSlashCommand, adwCommand?: AdwSlashCommand): string {
    if (adwCommand) {
      const orchestrator = adwCommandToOrchestratorMap[adwCommand];
      if (orchestrator) return orchestrator;
    }
    return issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx';
  }
  ```

### Step 4: Update `adws/__tests__/issueClassifier.test.ts`
- Import `issueTypeToOrchestratorMap` from `'../core/dataTypes'` (or wherever core exports it).
- Ensure the `getWorkflowScript` test suite has:
  - Individual tests for each issue type asserting the correct orchestrator.
  - A parametric `it.each(Object.entries(issueTypeToOrchestratorMap))` test to cover all entries automatically.

### Step 5: Review trigger fallbacks in `adws/triggers/trigger_webhook.ts`
- Search for any hardcoded `adwPlanBuildTest.tsx` in catch blocks.
- Note: catch-block fallbacks to `adwPlanBuildTest.tsx` are acceptable as a defensive default (aligns with the bug mapping), so no change is required unless alignment dictates otherwise.
- Document the decision in the Notes section below.

### Step 6: Update `adws/README.md` trigger documentation
- Find the section describing trigger workflow selection.
- Update it to clearly state:
  - Bug issues → `adwPlanBuildTest.tsx`
  - Chore issues → `adwPlanBuild.tsx`
  - Feature issues → `adwSdlc.tsx`
  - PR review issues → `adwPlanBuild.tsx`

### Step 7: Run Validation Commands
- Execute all validation commands listed below to confirm zero regressions.

## Testing Strategy
### Unit Tests
- `getWorkflowScript('/bug')` → `'adws/adwPlanBuildTest.tsx'`
- `getWorkflowScript('/chore')` → `'adws/adwPlanBuild.tsx'`
- `getWorkflowScript('/feature')` → `'adws/adwSdlc.tsx'`
- `getWorkflowScript('/pr_review')` → `'adws/adwPlanBuild.tsx'`
- Parametric test over all `issueTypeToOrchestratorMap` entries.
- Parametric test over all `adwCommandToOrchestratorMap` entries (existing, ensure not regressed).

### Edge Cases
- Unknown issue type falls back to `adwPlanBuildTest.tsx` (defensive `??` fallback).
- `adwCommand` takes priority over `issueType` when both are provided.
- All `AdwSlashCommand` values remain covered by `adwCommandToOrchestratorMap`.

## Acceptance Criteria
- `issueTypeToOrchestratorMap` is exported from `adws/core/issueTypes.ts` with four entries matching the required mapping.
- `getWorkflowScript()` uses `issueTypeToOrchestratorMap` for issue-type-based routing (no hardcoded orchestrator paths in the function body).
- All existing tests pass without modification to their assertions (except where routing expectations change per this feature).
- New parametric test validates every entry in `issueTypeToOrchestratorMap`.
- `adws/README.md` documents the correct per-type orchestrator selection.
- `npm run lint`, `npm run build`, and `npm test` all pass with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the feature works with zero regressions

## Notes
- The `adwCommand`-based routing (first priority in `getWorkflowScript`) is unchanged — only the fallback issue-type-based routing changes.
- Catch-block fallbacks in `trigger_webhook.ts` that hardcode `adwPlanBuildTest.tsx` are acceptable: they cover the error/unknown case and align with the bug mapping (the most defensive default).
- TypeScript's `Record<IssueClassSlashCommand, string>` type ensures exhaustive coverage at compile time — if a new `IssueClassSlashCommand` is added, TypeScript will error until the map is updated.
- The `?? 'adws/adwPlanBuildTest.tsx'` defensive fallback in `getWorkflowScript` is belt-and-suspenders for runtime safety; the TypeScript type already prevents gaps.
- At the time of planning, the implementation in `adws/core/issueTypes.ts` already contains `issueTypeToOrchestratorMap` with the correct entries. Verify each step is in place before writing new code to avoid duplicating existing work.
