# Chore: Delete orphan slash commands

## Metadata
issueNumber: `404`
adwId: `7uiv31-delete-orphan-slash`
issueJson: `{"number":404,"title":"delete orphan slash commands","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nNow that the review phase has been rewritten (#401) and no longer invokes `prepare_app`, the slash commands that previously started/managed dev servers have no callers in the orchestrated flow. Delete them:\n\n- `.claude/commands/prepare_app.md`\n- `.claude/commands/start.md`\n- `.claude/commands/in_loop_review.md`\n- `.claude/commands/test_e2e.md`\n\nVerify there are no remaining references in any other slash command, agent, or TS code path before deleting.\n\n## Acceptance criteria\n\n- [ ] `prepare_app.md` deleted\n- [ ] `start.md` deleted\n- [ ] `in_loop_review.md` deleted\n- [ ] `test_e2e.md` deleted\n- [ ] No remaining references in any `.claude/commands/*.md` file\n- [ ] No remaining references in any `adws/**/*.ts` file\n- [ ] Existing tests still pass\n\n## Blocked by\n\n- Blocked by #401\n\n## User stories addressed\n\n- User story 33","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:06:03Z","comments":[],"actionableComment":null}`

## Chore Description
The review phase was rewritten in #401 to a passive judge model that no longer invokes `prepare_app`, starts dev servers, or navigates the application UI. Four slash commands that previously supported this dev-server-based review/test flow are now orphaned with zero callers in the orchestrated pipeline. This chore deletes them and scrubs all remaining references from other slash commands and TypeScript source files.

## Relevant Files
Use these files to resolve the chore:

**Files to delete:**
- `.claude/commands/prepare_app.md` — orphan slash command (dev server preparation)
- `.claude/commands/start.md` — orphan slash command (dev server startup)
- `.claude/commands/in_loop_review.md` — orphan slash command (in-loop review with dev server)
- `.claude/commands/test_e2e.md` — orphan slash command (E2E test runner with dev server)

**Slash commands with references to clean up:**
- `.claude/commands/bug.md` — references `test_e2e.md` at lines ~30, ~93 (plan template and E2E test step)
- `.claude/commands/feature.md` — references `test_e2e.md` at lines ~30, ~116 (plan template and E2E test step)
- `.claude/commands/resolve_failed_scenario.md` — references `test_e2e.md` at lines ~20, ~26 (E2E test execution pattern)
- `.claude/commands/resolve_failed_e2e_test.md` — references `test_e2e.md` at lines ~20, ~26 (E2E test execution pattern)

**TypeScript source with references to clean up:**
- `adws/phases/reviewPhase.ts` — comment at line ~7 mentioning `prepare_app`

**Documentation to update:**
- `README.md` — directory listing includes all four deleted files (lines ~147-162)

**Files that reference the deleted commands but should NOT be changed** (they assert the commands are NOT used — keeping them validates the deletion):
- `features/passive_judge_review_phase.feature` — BDD scenarios asserting review does not use `prepare_app`
- `features/step_definitions/passiveJudgeReviewPhaseSteps.ts` — step definitions checking absence of `prepare_app`
- `app_docs/*`, `specs/*` — historical documentation, read-only context

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete the four orphan slash commands

- Delete `.claude/commands/prepare_app.md`
- Delete `.claude/commands/start.md`
- Delete `.claude/commands/in_loop_review.md`
- Delete `.claude/commands/test_e2e.md`

### Step 2: Remove `test_e2e.md` references from `bug.md`

- Read `.claude/commands/bug.md`
- Remove the instruction that tells planners to add `test_e2e.md` to the plan's Relevant Files section (around line 30)
- Remove or replace the E2E test step that says to read `test_e2e.md` and execute E2E tests (around line 93). Replace with an instruction to run the project's E2E test command from `.adw/commands.md` (`## Run E2E Tests`) directly, since the `test_e2e.md` intermediary no longer exists.

### Step 3: Remove `test_e2e.md` references from `feature.md`

- Read `.claude/commands/feature.md`
- Remove the instruction that tells planners to add `test_e2e.md` to the plan's Relevant Files section (around line 30)
- Remove or replace the E2E test step that says to read `test_e2e.md` and execute E2E tests (around line 116). Replace with an instruction to run the project's E2E test command from `.adw/commands.md` (`## Run E2E Tests`) directly.

### Step 4: Remove `test_e2e.md` references from `resolve_failed_scenario.md`

- Read `.claude/commands/resolve_failed_scenario.md`
- Remove the reference to reading `test_e2e.md` to understand E2E test execution (around line 20)
- Remove the reference to following the execution pattern from `test_e2e.md` (around line 26)
- Replace with direct instructions to use the E2E test command from `.adw/commands.md` (`## Run E2E Tests` / `## Run Scenarios by Tag`)

### Step 5: Remove `test_e2e.md` references from `resolve_failed_e2e_test.md`

- Read `.claude/commands/resolve_failed_e2e_test.md`
- Remove the reference to reading `test_e2e.md` to understand E2E test execution (around line 20)
- Remove the reference to following the execution pattern from `test_e2e.md` (around line 26)
- Replace with direct instructions to use the E2E test command from `.adw/commands.md` (`## Run E2E Tests`)

### Step 6: Remove `prepare_app` reference from `adws/phases/reviewPhase.ts`

- Read `adws/phases/reviewPhase.ts`
- Remove or update the comment at line ~7 that mentions `prepare_app`. The comment should reflect the current passive judge model without referencing the deleted command.

### Step 7: Update `README.md` directory listing

- Read `README.md`
- Remove the four lines from the `.claude/commands/` directory listing:
  - `├── in_loop_review.md`
  - `├── prepare_app.md`
  - `├── start.md`
  - `├── test_e2e.md`

### Step 8: Verify no remaining references in `.claude/commands/*.md`

- Run: `grep -rl 'prepare_app\|in_loop_review\|test_e2e' .claude/commands/`
- Also check for `start.md` specifically: `grep -rl 'start\.md' .claude/commands/`
- If any references remain, clean them up before proceeding.

### Step 9: Verify no remaining references in `adws/**/*.ts`

- Run: `grep -rl 'prepare_app\|in_loop_review\|test_e2e' adws/`
- Also check for `start.md` specifically: `grep -rl 'commands/start\.md\|commands/start' adws/`
- If any references remain, clean them up before proceeding.

### Step 10: Run validation commands

- Execute every validation command listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws sub-project
- `bun run test` — Run all unit tests
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run BDD regression scenarios (includes passive judge review phase tests that validate `prepare_app` is not referenced)

## Notes
- The `features/passive_judge_review_phase.feature` BDD scenarios explicitly assert that the review phase does NOT reference `prepare_app` or start dev servers. These tests should continue to pass after deletion and serve as a regression guard.
- Historical references in `specs/` and `app_docs/` are intentionally left untouched — they document what existed at the time of writing and remain accurate as historical records.
- When replacing `test_e2e.md` references in slash commands, prefer pointing to `.adw/commands.md` sections (`## Run E2E Tests`, `## Run Scenarios by Tag`) rather than hardcoding test commands, to maintain the project-config-driven approach.
