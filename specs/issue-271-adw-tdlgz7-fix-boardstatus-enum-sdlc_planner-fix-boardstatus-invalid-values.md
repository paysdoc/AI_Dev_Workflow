# Bug: BoardStatus enum contains non-existent project board statuses

## Metadata
issueNumber: `271`
adwId: `tdlgz7-fix-boardstatus-enum`
issueJson: `{"number":271,"title":"Fix: BoardStatus enum contains non-existent project board statuses","body":"## Problem\n\nThe `BoardStatus` enum in `adws/providers/types.ts` contains two statuses (`Building`, `Testing`) that don't exist on the GitHub project board. The only valid statuses are: **Todo**, **In progress**, **Review**, and **Done**.\n\nWhen ADW enters the build or test phase, it calls `moveToStatus()` with `BoardStatus.Building` or `BoardStatus.Testing`. The fuzzy matcher in `projectBoardApi.ts` finds no match, logs a warning, and silently returns `false` — so the issue status never updates during these phases.\n\n## Current behavior\n\n```typescript\nexport enum BoardStatus {\n  InProgress = 'In Progress',  // ✅ matches board\n  Building = 'Building',       // ❌ doesn't exist on board\n  Testing = 'Testing',         // ❌ doesn't exist on board\n  Review = 'Review',           // ✅ matches board\n}\n```\n\n- `buildPhase.ts` calls `moveToStatus(issueNumber, BoardStatus.Building)` — silently fails\n- `testPhase.ts` calls `moveToStatus(issueNumber, BoardStatus.Testing)` — silently fails\n\n## Expected behavior\n\nIssues should stay in \"In Progress\" during both build and test phases. The only valid transitions are:\n- Plan phase → **In Progress**\n- Build phase → **In Progress** (no change)\n- Test phase → **In Progress** (no change)\n- PR review completion → **Review**\n- Workflow failure → **In Progress** (no change)\n- Issue closed → **Done** (handled by GitHub auto-move)\n- **Todo** is never set programmatically\n\n## Fix\n\n1. **`adws/providers/types.ts`** — Remove `Building` and `Testing` from the `BoardStatus` enum\n2. **`adws/phases/buildPhase.ts`** — Change `BoardStatus.Building` → `BoardStatus.InProgress`\n3. **`adws/phases/testPhase.ts`** — Change `BoardStatus.Testing` → `BoardStatus.InProgress`\n\nSame rules apply to the Jira provider.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-23T09:24:25Z","comments":[],"actionableComment":null}`

## Bug Description
The `BoardStatus` enum in `adws/providers/types.ts` defines four values: `InProgress`, `Building`, `Testing`, and `Review`. However, the GitHub project board only has four columns: **Todo**, **In progress**, **Review**, and **Done**. The `Building` and `Testing` values do not correspond to any project board column.

When `buildPhase.ts` calls `moveToStatus(issueNumber, BoardStatus.Building)` and `testPhase.ts` calls `moveToStatus(issueNumber, BoardStatus.Testing)`, the fuzzy matcher in `projectBoardApi.ts` finds no matching column, logs a warning, and silently returns `false`. The issue's board status never updates during these phases.

The same problem applies to the Jira provider path — `JiraIssueTracker.moveToStatus` attempts to find a Jira transition matching "Building" or "Testing", which likely doesn't exist.

## Problem Statement
The `BoardStatus` enum contains two invalid values (`Building`, `Testing`) that don't exist on any project board, causing `moveToStatus()` calls in the build and test phases to silently fail. These invalid enum members should be removed and the phase callers should use `BoardStatus.InProgress` instead. The existing BDD scenarios that assert these values exist must also be updated.

## Solution Statement
1. Remove `Building` and `Testing` from the `BoardStatus` enum in `adws/providers/types.ts`
2. Change `BoardStatus.Building` to `BoardStatus.InProgress` in `adws/phases/buildPhase.ts`
3. Change `BoardStatus.Testing` to `BoardStatus.InProgress` in `adws/phases/testPhase.ts`
4. Update BDD scenarios in `features/harden_project_board_status.feature` to reflect the new valid enum values and the updated phase calls

No Jira-specific code changes are needed — the Jira provider accepts `BoardStatus` as a parameter type, so removing enum members and updating callers is sufficient.

## Steps to Reproduce
1. Run any ADW orchestrator (e.g., `bunx tsx adws/adwPlanBuildTest.tsx 123`)
2. Observe that when the build phase starts, `moveToStatus(issueNumber, BoardStatus.Building)` is called
3. The fuzzy matcher in `projectBoardApi.ts` finds no "Building" column on the project board
4. A warning is logged and the function returns `false` — the issue stays at its previous board status
5. Same behavior repeats when the test phase calls `moveToStatus(issueNumber, BoardStatus.Testing)`

## Root Cause Analysis
The `BoardStatus` enum was introduced in issue #229 (harden project board status) with the intent to add intermediate status transitions for build and test phases. However, the corresponding "Building" and "Testing" columns were never created on the GitHub project board. The enum values are aspirational but don't match the actual board configuration. The fuzzy matcher in `projectBoardApi.ts` correctly returns `false` when no match is found, but the callers don't act on the failure — the transitions are silently skipped.

The correct behavior is for issues to remain "In Progress" during both build and test phases, since there are no dedicated board columns for these states.

## Relevant Files
Use these files to fix the bug:

- `adws/providers/types.ts` — Contains the `BoardStatus` enum with the invalid `Building` and `Testing` values that must be removed (lines 68–73).
- `adws/phases/buildPhase.ts` — Calls `moveToStatus(issueNumber, BoardStatus.Building)` on line 42; must change to `BoardStatus.InProgress`.
- `adws/phases/testPhase.ts` — Calls `moveToStatus(issueNumber, BoardStatus.Testing)` on line 52; must change to `BoardStatus.InProgress`.
- `features/harden_project_board_status.feature` — BDD scenarios that assert `Building` and `Testing` exist in the enum and are used by the phases. Six scenarios need updating (lines 67–69, 72–74, 88–94, 97–109).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Remove invalid enum values from BoardStatus
- Open `adws/providers/types.ts`
- Remove the `Building = 'Building'` line (line 70) from the `BoardStatus` enum
- Remove the `Testing = 'Testing'` line (line 71) from the `BoardStatus` enum
- The enum should only contain `InProgress` and `Review` after this change

### 2. Update buildPhase.ts to use BoardStatus.InProgress
- Open `adws/phases/buildPhase.ts`
- On line 42, change `BoardStatus.Building` to `BoardStatus.InProgress`:
  - Before: `await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Building);`
  - After: `await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress);`

### 3. Update testPhase.ts to use BoardStatus.InProgress
- Open `adws/phases/testPhase.ts`
- On line 52, change `BoardStatus.Testing` to `BoardStatus.InProgress`:
  - Before: `await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Testing);`
  - After: `await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress);`

### 4. Update BDD scenarios in harden_project_board_status.feature
- Open `features/harden_project_board_status.feature`
- **Scenario "buildPhase.ts calls moveToStatus with Building at phase entry"** (line 67–69): Change the assertion from `Then the file contains "Building"` to `Then the file contains "InProgress"`. Update the scenario title to reflect "InProgress" instead of "Building".
- **Scenario "testPhase.ts calls moveToStatus with Testing at phase entry"** (line 72–74): Change the assertion from `Then the file contains "Testing"` to `Then the file contains "InProgress"`. Update the scenario title to reflect "InProgress" instead of "Testing".
- **Scenario "BoardStatus enum contains the expected values"** (lines 88–94): Remove the two assertion lines `And the file contains "Building"` and `And the file contains "Testing"`. Keep `In Progress` and `Review` assertions.
- **Scenario "buildPhase.ts uses BoardStatus enum reference"** (lines 101–104): Change `Then the file contains "BoardStatus.Building"` to `Then the file contains "BoardStatus.InProgress"`. Update the scenario title accordingly.
- **Scenario "testPhase.ts uses BoardStatus enum reference"** (lines 106–109): Change `Then the file contains "BoardStatus.Testing"` to `Then the file contains "BoardStatus.InProgress"`. Update the scenario title accordingly.

### 5. Run validation commands
- Run all validation commands listed below to verify the fix is correct with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Run root TypeScript type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run ADW-specific TypeScript type-check
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-wrzj5j-harden-project-board"` — Run the harden project board BDD scenarios to verify updated scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions

## Notes
- The `guidelines/coding_guidelines.md` file must be followed. Key guidelines: use enums for named constant sets, remove unused code (code hygiene), and ensure TypeScript strict mode passes.
- The Jira provider (`adws/providers/jira/jiraIssueTracker.ts`) does not need code changes — it accepts `BoardStatus` as a parameter type, so removing enum members and updating the callers is sufficient. The Jira `matchTransition` call will now receive `'In Progress'` instead of `'Building'`/`'Testing'`, which correctly matches Jira's "In Progress" transition.
- The `moveToStatus` calls in buildPhase.ts and testPhase.ts are technically redundant since the plan phase already sets the status to "In Progress". However, keeping them makes the intent explicit and ensures correctness if the plan phase is skipped or the status changes between phases.
- No new libraries are required.
