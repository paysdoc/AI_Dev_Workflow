# Chore: Add issue-type-to-orchestrator mappings for triggers

## Metadata
issueNumber: `2`
adwId: `add-mappings-to-trig-411ox1`
issueJson: `{"number":2,"title":"Add mappings to triggers","body":"The trigers currently use default adws, depending on the issue type. This is correct, but the implementation is not very clear.\n\nCreate a mapping that clearly denotes which adw orchetrator to us for which issue type. \n - bug: adwPlanBuildTest\n - chore: adwPlanBuild\n - feature: adwSdlc (currently adwPlanBuildTest)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-24T15:15:01Z","comments":[],"actionableComment":null}`

## Chore Description
The triggers (`trigger_webhook.ts` and `trigger_cron.ts`) use `getWorkflowScript()` from `issueClassifier.ts` to determine which ADW orchestrator to spawn for a given issue type. Currently, this routing is implemented as a `switch` statement with hardcoded values that are not immediately obvious:

- `/feature` and `/chore` both map to `adws/adwPlanBuildTest.tsx`
- `/bug` and `/pr_review` both map to `adws/adwPlanBuild.tsx`

The issue requests:
1. Creating an explicit, declarative mapping object (`issueTypeToOrchestratorMap`) that clearly denotes which orchestrator to use for each issue type.
2. Updating the actual routing to match the desired mappings:
   - **bug** → `adwPlanBuildTest` (was `adwPlanBuild`)
   - **chore** → `adwPlanBuild` (was `adwPlanBuildTest`)
   - **feature** → `adwSdlc` (was `adwPlanBuildTest`)
   - **pr_review** → `adwPlanBuild` (keep as-is)

## Relevant Files
Use these files to resolve the chore:

- `adws/core/issueTypes.ts` — Contains the existing maps (`adwCommandToIssueTypeMap`, `adwCommandToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`). The new `issueTypeToOrchestratorMap` will be added here alongside the existing maps, maintaining consistency.
- `adws/core/issueClassifier.ts` — Contains `getWorkflowScript()` which currently uses a `switch` statement to route issue types to orchestrators. This function will be refactored to use the new mapping.
- `adws/core/index.ts` — Re-exports from core modules. The new map must be exported here.
- `adws/__tests__/issueClassifier.test.ts` — Contains tests for `getWorkflowScript()` that assert the current routing. Tests must be updated to reflect the new mappings and to import/validate the new map.
- `adws/README.md` — Documents trigger workflow selection; the comment about default routing should be updated for accuracy.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `issueTypeToOrchestratorMap` to `adws/core/issueTypes.ts`

- After the existing `adwCommandToOrchestratorMap` constant (around line 62), add a new exported constant:
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

### Step 2: Export `issueTypeToOrchestratorMap` from `adws/core/index.ts`

- Add `issueTypeToOrchestratorMap` to the existing export line at line 40:
  ```typescript
  export { commitPrefixMap, branchPrefixMap, adwCommandToIssueTypeMap, adwCommandToOrchestratorMap, issueTypeToOrchestratorMap } from './dataTypes';
  ```

### Step 3: Refactor `getWorkflowScript()` in `adws/core/issueClassifier.ts`

- Import `issueTypeToOrchestratorMap` from the core index (it's already imported from `.`).
- Replace the `switch` statement with a lookup into the new map:
  ```typescript
  export function getWorkflowScript(issueType: IssueClassSlashCommand, adwCommand?: AdwSlashCommand): string {
    // Route ADW commands to their dedicated orchestrators when mapped
    if (adwCommand) {
      const orchestrator = adwCommandToOrchestratorMap[adwCommand];
      if (orchestrator) return orchestrator;
    }

    return issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx';
  }
  ```
- This replaces the entire `switch` block with a single map lookup and a fallback default.

### Step 4: Update `adws/__tests__/issueClassifier.test.ts`

- Import `issueTypeToOrchestratorMap` alongside the existing imports from `../core/dataTypes`.
- Add `issueTypeToOrchestratorMap` to the `vi.mock('../core', ...)` mock with the new mappings:
  ```typescript
  issueTypeToOrchestratorMap: {
    '/bug': 'adws/adwPlanBuildTest.tsx',
    '/chore': 'adws/adwPlanBuild.tsx',
    '/feature': 'adws/adwSdlc.tsx',
    '/pr_review': 'adws/adwPlanBuild.tsx',
  },
  ```
- Update `getWorkflowScript` test expectations in the "Issue-type-based routing" section:
  - `/feature` → `'adws/adwSdlc.tsx'` (was `adwPlanBuildTest.tsx`)
  - `/chore` → `'adws/adwPlanBuild.tsx'` (was `adwPlanBuildTest.tsx`)
  - `/bug` → `'adws/adwPlanBuildTest.tsx'` (was `adwPlanBuild.tsx`)
  - `/pr_review` → `'adws/adwPlanBuild.tsx'` (unchanged)
- Add a parametric test that validates all entries in `issueTypeToOrchestratorMap`:
  ```typescript
  it.each(Object.entries(issueTypeToOrchestratorMap))(
    'routes issue type %s to %s via issueTypeToOrchestratorMap',
    (issueType, expectedScript) => {
      expect(getWorkflowScript(issueType as IssueClassSlashCommand)).toBe(expectedScript);
    }
  );
  ```

### Step 5: Update `adws/README.md` trigger documentation

- In the "Workflow selection" section under `trigger_cron.ts` (around line 318), update the comment to reflect the new routing:
  ```
  **Workflow selection:**
  - Bug issues → `adwPlanBuildTest.tsx`
  - Chore issues → `adwPlanBuild.tsx`
  - Feature issues → `adwSdlc.tsx`
  - PR review issues → `adwPlanBuild.tsx`
  ```

### Step 6: Run Validation Commands

- Run all validation commands to ensure zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: strictly adhere to the coding guidelines in `/guidelines`. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
- The `adwCommand`-based routing (first priority in `getWorkflowScript`) is unchanged — only the fallback issue-type-based routing is updated.
- The default fallback in the `?? 'adws/adwPlanBuildTest.tsx'` is kept for defensive coding in case a new `IssueClassSlashCommand` is added without updating the map, though TypeScript's `Record` type ensures exhaustive mapping at compile time.
- The error catch blocks in `trigger_webhook.ts` (lines 196 and 264) still fall back to `adwPlanBuildTest.tsx` which aligns with the new mapping for bugs (the most common error-recovery scenario). No changes needed there.
