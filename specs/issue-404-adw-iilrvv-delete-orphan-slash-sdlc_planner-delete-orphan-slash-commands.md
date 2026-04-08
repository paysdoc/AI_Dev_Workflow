# Chore: Delete orphan slash commands

## Metadata
issueNumber: `404`
adwId: `iilrvv-delete-orphan-slash`
issueJson: `{"number":404,"title":"delete orphan slash commands","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nNow that the review phase has been rewritten (#401) and no longer invokes `prepare_app`, the slash commands that previously started/managed dev servers have no callers in the orchestrated flow. Delete them:\n\n- `.claude/commands/prepare_app.md`\n- `.claude/commands/start.md`\n- `.claude/commands/in_loop_review.md`\n- `.claude/commands/test_e2e.md`\n\nVerify there are no remaining references in any other slash command, agent, or TS code path before deleting.\n\n## Acceptance criteria\n\n- [ ] `prepare_app.md` deleted\n- [ ] `start.md` deleted\n- [ ] `in_loop_review.md` deleted\n- [ ] `test_e2e.md` deleted\n- [ ] No remaining references in any `.claude/commands/*.md` file\n- [ ] No remaining references in any `adws/**/*.ts` file\n- [ ] Existing tests still pass\n\n## Blocked by\n\n- Blocked by #401\n\n## User stories addressed\n\n- User story 33","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:06:03Z","comments":[],"actionableComment":null}`

## Chore Description
The review phase was rewritten in #401 to be a passive judge that no longer starts dev servers or invokes `prepare_app`. Four slash commands that previously supported the old dev-server-based review/test flow are now orphaned with no callers in any orchestrator, agent, or phase. This chore deletes those four commands and scrubs all dangling references from other slash commands and TS code.

The four files to delete:
- `.claude/commands/prepare_app.md` — prepared the target app (install deps, build)
- `.claude/commands/start.md` — started the dev server
- `.claude/commands/in_loop_review.md` — ran an in-loop review with dev server
- `.claude/commands/test_e2e.md` — executed E2E test scripts against the dev server

## Relevant Files
Use these files to resolve the chore:

**Files to delete:**
- `.claude/commands/prepare_app.md` — orphan slash command, no callers
- `.claude/commands/start.md` — orphan slash command, no callers
- `.claude/commands/in_loop_review.md` — orphan slash command, no callers
- `.claude/commands/test_e2e.md` — orphan slash command, no callers

**Files with references to clean up:**
- `.claude/commands/feature.md` — lines 30, 116 reference `test_e2e.md` for E2E test planning guidance
- `.claude/commands/bug.md` — lines 30, 93 reference `test_e2e.md` for E2E test planning guidance
- `.claude/commands/resolve_failed_scenario.md` — lines 20, 26 reference `test_e2e.md` for understanding E2E test execution
- `.claude/commands/resolve_failed_e2e_test.md` — lines 20, 26 reference `test_e2e.md`; this file is gitignored (line 32 of `.gitignore`) and is itself an orphan left over from the rename to `resolve_failed_scenario.md`
- `adws/phases/reviewPhase.ts` — line 7 JSDoc comment mentions `prepare_app` (negative assertion: "Does not … invoke prepare_app"). Leave as-is: it documents what the module intentionally avoids.
- `adws/agents/testAgent.ts` — line 159 stale JSDoc comment says `/resolve_failed_e2e_test` but function is already renamed to `runResolveScenarioAgent`. Update comment.
- `README.md` — project structure listing includes all 4 deleted commands

**Files with non-actionable historical references (no changes needed):**
- `features/passive_judge_review_phase.feature` — BDD scenarios that assert `prepare_app` is NOT referenced (negative test assertions, correct as-is)
- `app_docs/**`, `specs/**` — historical documentation references, not live code

**Validation reference:**
- `.adw/commands.md` — validation commands for lint, build, test

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete the four orphan slash commands
- Delete `.claude/commands/prepare_app.md`
- Delete `.claude/commands/start.md`
- Delete `.claude/commands/in_loop_review.md`
- Delete `.claude/commands/test_e2e.md`

### Step 2: Delete the gitignored orphan `resolve_failed_e2e_test.md`
- Delete `.claude/commands/resolve_failed_e2e_test.md` — this file was supposed to be renamed to `resolve_failed_scenario.md` in #399 but the original was kept and gitignored instead of deleted
- Remove line 32 from `.gitignore` (the `.claude/commands/resolve_failed_e2e_test.md` entry)

### Step 3: Clean up `test_e2e.md` references in `feature.md`
- In `.claude/commands/feature.md`, line 30: remove the instruction to read `.claude/commands/test_e2e.md` and `.claude/commands/e2e-examples/test_basic_query.md` from the E2E test guidance. Replace with guidance to read the BDD scenario configuration from `.adw/scenarios.md` instead, since E2E tests have been replaced by BDD scenarios.
- In `.claude/commands/feature.md`, line 116: remove the validation step that references `test_e2e.md`. Replace with guidance to run BDD scenarios for validation.

### Step 4: Clean up `test_e2e.md` references in `bug.md`
- In `.claude/commands/bug.md`, line 30: same change as feature.md — remove `test_e2e.md` reference, replace with BDD scenario guidance.
- In `.claude/commands/bug.md`, line 93: same change as feature.md — remove `test_e2e.md` validation reference, replace with BDD scenario validation.

### Step 5: Clean up `test_e2e.md` references in `resolve_failed_scenario.md`
- In `.claude/commands/resolve_failed_scenario.md`, line 20: replace `Read .claude/commands/test_e2e.md to understand how E2E tests are executed` with guidance to read `.adw/scenarios.md` for BDD scenario execution context.
- In `.claude/commands/resolve_failed_scenario.md`, line 26: replace `Follow the execution pattern from .claude/commands/test_e2e.md` with guidance to follow the BDD scenario execution pattern from `.adw/scenarios.md`.

### Step 6: Update stale JSDoc in `testAgent.ts`
- In `adws/agents/testAgent.ts`, line 159: update the JSDoc comment from `Runs the /resolve_failed_e2e_test command` to `Runs the /resolve_failed_scenario command` to match the actual function name `runResolveScenarioAgent`.

### Step 7: Update README.md project structure
- Remove `prepare_app.md`, `start.md`, `in_loop_review.md`, and `test_e2e.md` from the `.claude/commands/` listing in the project structure tree.

### Step 8: Run validation commands
- Execute the validation commands below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run unit tests to validate zero regressions
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run BDD regression scenarios to validate no broken references
- Verify no remaining references: `grep -r "prepare_app\|in_loop_review\|test_e2e" .claude/commands/*.md` should only match this plan file and negative assertions (if any). Specifically, no `.claude/commands/*.md` file should contain a reference that directs the reader to read or execute any of the deleted files.
- Verify no remaining TS references: `grep -r "prepare_app\|in_loop_review\|test_e2e\|commands/start" adws/**/*.ts` should only return the `reviewPhase.ts` negative-assertion comment (line 7).

## Notes
- If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines.
- The `reviewPhase.ts` JSDoc comment on line 7 ("Does not … invoke prepare_app") is a negative assertion documenting intentional behavior. It should NOT be removed — it is valuable documentation about the passive judge design.
- The `features/passive_judge_review_phase.feature` BDD scenarios assert that `prepare_app` is NOT referenced in the review module — these are correct negative test assertions and must not be changed.
- Historical references in `app_docs/` and `specs/` are documentation of past decisions and should NOT be modified.
- The `.claude/commands/resolve_failed_e2e_test.md` deletion (Step 2) goes slightly beyond the issue's four listed files, but it is a directly related orphan that was gitignored rather than deleted during the #399 rename. Cleaning it up here avoids a separate follow-up chore.
