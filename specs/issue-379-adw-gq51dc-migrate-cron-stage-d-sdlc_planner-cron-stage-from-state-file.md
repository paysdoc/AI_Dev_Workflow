# Feature: Migrate cron stage detection from comment parsing to state file

## Metadata
issueNumber: `379`
adwId: `gq51dc-migrate-cron-stage-d`
issueJson: `{"number":379,"title":"Migrate cron stage detection from comment parsing to state file","body":"## Parent PRD\n\n`specs/prd/orchestrator-lifecycle-redesign.md`\n\n## What to build\n\nChange the cron trigger to read workflow stage from the top-level state file instead of parsing issue comments.\n\n**Current flow:**\n- Cron calls `getIssueWorkflowStage()` which parses the latest ADW comment header to extract the stage\n- Filters issues using `ACTIVE_STAGES` and `RETRIABLE_STAGES` sets\n\n**New flow:**\n- Cron extracts adw-id from issue comments via regex (minimal comment dependency — just the ID, not the stage)\n- Reads `workflowStage` from `agents/<adwId>/state.json` using `AgentStateManager`\n- Same `ACTIVE_STAGES` / `RETRIABLE_STAGES` filtering, just sourced from state file\n- Issues with no state file (fresh issues, no adw-id) are treated as candidates (same as today's \"no ADW comment\" path)\n\nSee PRD \"Cron Changes\" section for details.\n\n## Acceptance criteria\n\n- [ ] Cron reads `workflowStage` from state file instead of parsing comments\n- [ ] adw-id extracted from comments via regex (existing `getIssueWorkflowStage` regex, just the ID field)\n- [ ] Issues with no adw-id / no state file treated as fresh candidates\n- [ ] `ACTIVE_STAGES` and `RETRIABLE_STAGES` filtering works with state file source\n- [ ] Grace period check uses state file timestamps\n- [ ] Tests: state file reading, stage filtering, missing state file handling\n\n## Blocked by\n\n- Blocked by #378\n\n## User stories addressed\n\n- User story 17\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:25:52Z","comments":[],"actionableComment":null}`

## Feature Description
Migrate the cron trigger's workflow stage detection from parsing GitHub issue comment headers to reading the top-level state file (`agents/<adwId>/state.json`). Currently, `trigger_cron.ts` calls `getIssueWorkflowStage()` which filters ADW comments and parses the latest comment header to determine the workflow stage. The new approach extracts the adw-id from comments (minimal comment dependency) and reads `workflowStage` from the state file via `AgentStateManager.readTopLevelState()`. This decouples stage detection from comment formatting and makes the state file the single source of truth for workflow status.

## User Story
As an ADW operator
I want the cron trigger to read workflow stage from the state file instead of parsing issue comments
So that stage detection is reliable, decoupled from comment formatting, and consistent with the new state file architecture

## Problem Statement
The cron trigger currently determines workflow stage by parsing the latest ADW comment's header text (e.g., `:hammer_and_wrench: Running Build` → `build_running`). This couples cron filtering to comment formatting, is fragile if headers change, and duplicates stage tracking that now lives canonically in `agents/<adwId>/state.json`. The state file was introduced in #378 as the single source of truth for workflow lifecycle — the cron trigger should read from it.

## Solution Statement
Extract the adw-id from issue comments using the existing `extractAdwIdFromComment()` regex, then read `workflowStage` from the top-level state file. Create a new testable module `cronStageResolver.ts` (following the pattern of `cronRepoResolver.ts`) that encapsulates stage resolution logic with dependency injection for testability. Update `ACTIVE_STAGES` and `RETRIABLE_STAGES` to use pattern-based matching against state file stage names (`*_running`, `*_completed`, `abandoned`, etc.) instead of comment-derived stage names. Use state file phase timestamps for grace period checks, falling back to `issue.updatedAt` for issues without a state file.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_cron.ts` — Main file to modify. Contains `getIssueWorkflowStage()`, `evaluateIssue()`, `isWithinGracePeriod()`, and the `ACTIVE_STAGES`/`RETRIABLE_STAGES` sets that need updating.
- `adws/core/agentState.ts` — Provides `AgentStateManager.readTopLevelState(adwId)` for reading the state file. Already has the methods needed; no modification required.
- `adws/core/workflowCommentParsing.ts` — Contains `extractAdwIdFromComment()` which extracts the adw-id from comment bodies. Already exists; no modification required.
- `adws/types/agentTypes.ts` — Defines `AgentState` with `workflowStage` and `phases` (with `PhaseExecutionState` timestamps). Read-only reference.
- `adws/core/config.ts` / `adws/core/environment.ts` — `AGENTS_STATE_DIR` and `GRACE_PERIOD_MS` constants. Read-only reference.
- `adws/triggers/cronRepoResolver.ts` — Existing pattern of extracting testable logic from `trigger_cron.ts` into a dedicated module. Follow this pattern.
- `adws/triggers/__tests__/cronRepoResolver.test.ts` — Existing test pattern to follow for the new test file.
- `adws/core/__tests__/topLevelState.test.ts` — Reference for how state file tests are structured.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Documentation for the state file feature introduced in #378. Reference for state file format and `workflowStage` values.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

### New Files
- `adws/triggers/cronStageResolver.ts` — Extracted testable module for resolving workflow stage from state file (follows `cronRepoResolver.ts` pattern).
- `adws/triggers/__tests__/cronStageResolver.test.ts` — Unit tests for the new stage resolution module.

## Implementation Plan
### Phase 1: Foundation
Create the `cronStageResolver.ts` module with pure, testable functions for:
1. Extracting the latest adw-id from issue comments (delegates to `extractAdwIdFromComment`)
2. Computing last activity timestamp from state file phase data
3. Classifying a state file `workflowStage` as active, retriable, completed, or unknown
4. A top-level `resolveIssueWorkflowStage()` function that composes these steps

The module accepts a `readState` dependency (defaulting to `AgentStateManager.readTopLevelState`) for testability without touching the filesystem.

### Phase 2: Core Implementation
Update `trigger_cron.ts` to:
1. Import `resolveIssueWorkflowStage` and the stage classification helper from `cronStageResolver.ts`
2. Replace `getIssueWorkflowStage()` with `resolveIssueWorkflowStage()` in `evaluateIssue()`
3. Replace explicit `ACTIVE_STAGES` and `RETRIABLE_STAGES` sets with pattern-based classification that matches state file stage names:
   - Active: `starting`, any `*_running`, any `*_completed` (intermediate phases, not the terminal `completed`)
   - Retriable: `abandoned` (state file equivalent of the old `error`/`review_failed`/`build_failed`)
   - Excluded: `paused` (handled by pause queue scanner), `completed` (terminal)
4. Update grace period check to prefer state file phase timestamps when available, falling back to `issue.updatedAt`
5. Remove the now-unused `parseWorkflowStageFromComment` import

### Phase 3: Integration
- Remove the `getIssueWorkflowStage()` function from `trigger_cron.ts` (replaced by the extracted module)
- Remove the `ACTIVE_STAGES` and `RETRIABLE_STAGES` `Set` constants from `trigger_cron.ts` (stage classification now lives in `cronStageResolver.ts`)
- Ensure `filterEligibleIssues()` and `evaluateIssue()` continue to produce the same `FilterResult` interface for downstream logging
- Verify that the `isAdwComment` import is no longer needed in `trigger_cron.ts` (it was only used by `getIssueWorkflowStage`), and remove it if so

## Step by Step Tasks

### Step 1: Read reference files
- Read `adws/triggers/cronRepoResolver.ts` to understand the extraction pattern
- Read `adws/core/workflowCommentParsing.ts` to confirm `extractAdwIdFromComment` signature
- Read `adws/core/agentState.ts` to confirm `readTopLevelState` signature
- Read `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` for state file format reference
- Read `guidelines/coding_guidelines.md` to ensure compliance

### Step 2: Create `cronStageResolver.ts`
- Create `adws/triggers/cronStageResolver.ts` with the following exports:
  - `extractLatestAdwId(comments: { body: string }[]): string | null` — scans comments newest-to-oldest, returns first adw-id found via `extractAdwIdFromComment()`
  - `getLastActivityFromState(state: AgentState): number | null` — computes the most recent `startedAt`/`completedAt` timestamp across all phases in the state file
  - `isActiveStage(stage: string): boolean` — returns true for `starting` and any stage matching `*_running` or `*_completed` (but not the terminal `completed`)
  - `isRetriableStage(stage: string): boolean` — returns true for `abandoned`
  - `StageResolution` interface: `{ stage: string | null; adwId: string | null; lastActivityMs: number | null }`
  - `resolveIssueWorkflowStage(comments, readState?): StageResolution` — composes adw-id extraction + state file reading + last activity computation. Accepts an injectable `readState` function defaulting to `AgentStateManager.readTopLevelState`
- Follow the `cronRepoResolver.ts` pattern: pure functions, dependency injection, no side effects

### Step 3: Create `cronStageResolver.test.ts`
- Create `adws/triggers/__tests__/cronStageResolver.test.ts` with tests for:
  - `extractLatestAdwId`: returns adw-id from latest comment, returns null for no ADW comments, handles multiple comments
  - `getLastActivityFromState`: computes correct timestamp from phases map, handles empty/missing phases, handles single phase
  - `isActiveStage`: correctly identifies `starting`, `*_running`, `*_completed` patterns as active; rejects `completed`, `paused`, `abandoned`
  - `isRetriableStage`: correctly identifies `abandoned` as retriable; rejects active and completed stages
  - `resolveIssueWorkflowStage`: returns null stage for no comments, returns null stage when state file missing, returns correct stage from state file, returns lastActivityMs from phases
- Use injected `readState` mock for filesystem isolation
- Follow the `cronRepoResolver.test.ts` pattern for test structure

### Step 4: Update `trigger_cron.ts` — imports and stage resolution
- Add import for `resolveIssueWorkflowStage`, `isActiveStage`, `isRetriableStage` from `./cronStageResolver`
- Remove import of `parseWorkflowStageFromComment` from `../core/workflowCommentParsing`
- Remove import of `isAdwComment` from `../github` (if no longer used elsewhere in the file)
- Remove the `RETRIABLE_STAGES` and `ACTIVE_STAGES` `Set` constants
- Remove the `getIssueWorkflowStage()` function

### Step 5: Update `trigger_cron.ts` — `evaluateIssue()` function
- Replace the `getIssueWorkflowStage(issue)` call with `resolveIssueWorkflowStage(issue.comments)`
- Update grace period check: use `resolution.lastActivityMs` when available (state file has timestamps), fall back to `new Date(issue.updatedAt).getTime()` for issues without state files
- Move the grace period check after stage resolution so timestamps from the state file are available
- Replace `ACTIVE_STAGES.has(stage)` with `isActiveStage(stage)`
- Replace `RETRIABLE_STAGES.has(stage)` with `isRetriableStage(stage)`
- Keep the `paused` exclusion comment explaining pause queue scanner handles it
- Ensure `FilterResult` interface and returned reasons remain compatible with downstream logging in `filterEligibleIssues()`

### Step 6: Run validation commands
- Run `bun run lint` to check for lint errors
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` to verify type checking
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for adws-specific type checking
- Run `bun run test` to verify all existing tests pass
- Run `bun vitest run adws/triggers/__tests__/cronStageResolver.test.ts` to verify new tests pass

## Testing Strategy
### Unit Tests
Tests for `cronStageResolver.ts` covering:
- **`extractLatestAdwId`**: extracts adw-id from newest comment first; returns null when no ADW comments exist; handles mixed ADW/non-ADW comments
- **`getLastActivityFromState`**: returns most recent timestamp across all phases; returns null for state with no phases; handles phases with only startedAt (no completedAt)
- **`isActiveStage`**: recognizes `starting` as active; recognizes `install_running`, `build_running` etc. as active; recognizes `install_completed`, `plan_completed` as active; rejects terminal `completed`, `paused`, `abandoned`
- **`isRetriableStage`**: recognizes `abandoned` as retriable; rejects all other stages
- **`resolveIssueWorkflowStage`**: integration of all components: returns null stage for no comments; returns null stage when adw-id found but state file missing; returns correct stage and lastActivityMs when state file exists

### Edge Cases
- Issue with ADW comments but no adw-id in any of them (malformed comments)
- Issue with adw-id but state file deleted/corrupted (readTopLevelState returns null)
- State file exists but has no `workflowStage` field (should return null stage)
- State file with empty `phases` map (lastActivityMs returns null, falls back to issue.updatedAt)
- Multiple ADW comments with different adw-ids (should use the latest/newest)
- State file `workflowStage` set to an unrecognized value (falls through to unknown/excluded)

## Acceptance Criteria
- [ ] Cron reads `workflowStage` from `agents/<adwId>/state.json` via `AgentStateManager.readTopLevelState()` instead of parsing comment headers
- [ ] adw-id extracted from comments via `extractAdwIdFromComment()` regex (no comment header parsing for stage)
- [ ] Issues with no adw-id in comments or no state file on disk are treated as fresh candidates (eligible)
- [ ] `isActiveStage()` correctly identifies state-file stages (`starting`, `*_running`, `*_completed`) as active
- [ ] `isRetriableStage()` correctly identifies `abandoned` as retriable
- [ ] `paused` stage excluded from cron processing (handled by pause queue scanner)
- [ ] Grace period check uses state file phase timestamps (`lastActivityMs`) when available, falls back to `issue.updatedAt`
- [ ] All new unit tests pass in `cronStageResolver.test.ts`
- [ ] All existing tests pass with zero regressions
- [ ] Code passes lint, type check, and build validation

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root-level TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
- `bun run test` — Run all tests to validate zero regressions
- `bun vitest run adws/triggers/__tests__/cronStageResolver.test.ts` — Run new unit tests specifically

## Notes
- Follow `guidelines/coding_guidelines.md` strictly — pure functions, declarative style, meaningful types.
- The `cronStageResolver.ts` module follows the established extraction pattern from `cronRepoResolver.ts`: testable pure functions with dependency injection, used by `trigger_cron.ts`.
- State file `workflowStage` values (`starting`, `<phase>_running`, `<phase>_completed`, `completed`, `paused`, `abandoned`) differ from comment-based stage names. Using pattern-based classification (`*_running`, `*_completed`) is more maintainable than listing every possible phase name explicitly.
- The `paused` stage is intentionally excluded from both active and retriable sets — paused workflows are handled by the pause queue scanner (`pauseQueueScanner.ts`), as documented in the existing `RETRIABLE_STAGES` comment.
- Reference `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` for state file format, merge semantics, and the full set of `workflowStage` values.
