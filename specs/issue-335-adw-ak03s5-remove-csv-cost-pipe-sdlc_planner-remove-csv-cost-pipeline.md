# Chore: Remove CSV cost pipeline

## Metadata
issueNumber: `335`
adwId: `ak03s5-remove-csv-cost-pipe`
issueJson: `{"number":335,"title":"Remove CSV cost pipeline","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nRemove the entire CSV cost pipeline now that D1 is the sole persistence layer. This is the final cleanup slice — only execute after migration is confirmed and dual-write is verified in production.\n\n### What to delete:\n\n- `adws/cost/reporting/csvWriter.ts` (or the CSV-specific functions within it)\n- `adws/cost/commitQueue.ts` and `adws/core/costCommitQueue.ts`\n- `.claude/commands/commit_cost.md` slash command\n- `projects/` directory (all CSV files for all 3 projects)\n- All call sites that invoke CSV write/rebuild/commit functions\n- Related exports from `adws/cost/index.ts`\n\n### What to keep:\n\n- `parseIssueCostCsv()` may still be needed by the migration script — verify before deleting\n- `formatCostCommentSection()` and other GitHub comment formatters (these read from PhaseCostRecord, not CSV)\n\n## Acceptance criteria\n\n- [ ] No CSV files remain in `projects/` directory\n- [ ] `projects/` directory removed from git\n- [ ] CSV write/rebuild/commit code deleted\n- [ ] `/commit_cost` slash command deleted\n- [ ] All imports of deleted modules updated or removed\n- [ ] Cost tracking still works end-to-end via D1 (no regressions)\n- [ ] GitHub cost comments still render correctly (they use PhaseCostRecord, not CSV)\n- [ ] `bun run test` passes (if applicable)\n\n## Blocked by\n\n- Blocked by #331, #333, #334\n\n## User stories addressed\n\n- User story 16","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:08:35Z","comments":[],"actionableComment":null}`

## Chore Description

Remove the entire CSV cost pipeline from ADW now that D1 (Cloudflare) is the sole cost persistence layer. The CSV pipeline was the original cost tracking mechanism — per-issue CSV files stored under `projects/`, committed and pushed to git via a serialized queue. With D1 dual-write verified in production (#334), this pipeline is dead code.

The removal spans: CSV writing/parsing functions, the CostCommitQueue serialization layer, git commit/push helpers for cost files, the `/commit_cost` slash command, the `projects/` data directory, the one-time migration script, the merged-PR tracking used solely for CSV coordination, and all BDD scenarios that validate CSV-specific behavior. The comment formatter (`commentFormatter.ts`) and D1 client (`d1Client.ts`) must be preserved — they work with `PhaseCostRecord`, not CSV.

Key dependency: `commentFormatter.ts` imports `collectAllTokenTypes` from `csvWriter.ts`. This function (and its `FIXED_TOKEN_COLUMNS` constant) must be relocated to `commentFormatter.ts` before `csvWriter.ts` is deleted.

## Relevant Files
Use these files to resolve the chore:

### Files to DELETE
- `adws/cost/reporting/csvWriter.ts` — Core CSV writing/parsing functions. All consumers must be removed/updated before deletion.
- `adws/cost/commitQueue.ts` — `CostCommitQueue` class and singleton. Only used for serializing CSV git commits.
- `adws/core/costCommitQueue.ts` — Backward-compatible re-export barrel for `CostCommitQueue`.
- `adws/phases/phaseCostCommit.ts` — Wrapper combining CSV writes + commit queue + D1 writes. The D1 write will be inlined into `phaseRunner.ts`.
- `.claude/commands/commit_cost.md` — Slash command for staging/committing CSV cost files.
- `workers/cost-api/migrate.ts` — One-time CSV-to-D1 migration script. Migration is complete; `parseIssueCostCsv` was its only external dependency.
- `projects/` directory — All CSV cost data files across 3 projects (~175 files). Historical data is already in D1.
- `features/phase_cost_record_csv.feature` — BDD scenarios validating CSV output format, `csvWriter.ts` structure, and `costCommitQueue` integration.
- `features/step_definitions/phaseCostRecordCsvSteps.ts` — Step definitions for the above CSV feature.
- `features/csv_migration_d1_upload.feature` — BDD scenarios for the CSV migration script.

### Files to MODIFY
- `adws/cost/reporting/commentFormatter.ts` — Relocate `collectAllTokenTypes()` and `FIXED_TOKEN_COLUMNS` from `csvWriter.ts` into this file. Update import to remove `csvWriter.ts` dependency.
- `adws/cost/reporting/index.ts` — Remove all `csvWriter.ts` re-exports. Keep `commentFormatter.ts` exports.
- `adws/cost/index.ts` — Remove CSV function exports (`writeIssueCostCsv`, `appendIssueCostCsv`, `rebuildProjectTotalCsv`, `formatIssueCostCsv`, `formatProjectTotalCsv`, `parseIssueCostCsv`, `parseIssueCostTotal`, `FIXED_TOKEN_COLUMNS`, `ProjectTotalRow`). Remove `CostCommitQueue`/`costCommitQueue` exports. Keep comment formatter exports and D1 client export.
- `adws/core/index.ts` — Remove CSV re-exports (lines 135-157): `costCommitQueue`, `CostCommitQueue`, `ProjectTotalRow`, and all CSV function re-exports. Keep `formatCostTable`, `formatDivergenceWarning`, `formatEstimateVsActual`, `formatCurrencyTotals`, `formatCostCommentSection` (comment formatter functions), and `PhaseCostRecord`/`PhaseCostStatus`/`createPhaseCostRecords` (D1/comment dependencies).
- `adws/core/phaseRunner.ts` — Replace `commitPhasesCostData` import with direct `postCostRecordsToD1` call. Simplify `CostTracker.commit()` to fire-and-forget D1 write only (no CSV, no queue). Update JSDoc to remove CSV references.
- `adws/phases/prReviewCompletion.ts` — In `buildPRReviewCostSection()`: remove `appendIssueCostCsv` and `rebuildProjectTotalCsv` calls and their imports. Add `postCostRecordsToD1` fire-and-forget call. Remove `fetchExchangeRates` import (only used for CSV rebuild). Keep `formatCostCommentSection` and `createPhaseCostRecords`.
- `adws/triggers/webhookHandlers.ts` — Remove the entire cost CSV handling block (lines 121-140: `costCommitQueue.enqueue`, `pullLatestCostBranch`, `rebuildProjectTotalCsv`, `commitAndPushCostFiles`, `recordMergedPrIssue`). Remove `mergedPrIssues` Set and `recordMergedPrIssue`/`wasMergedViaPR` functions. Remove imports: `rebuildProjectTotalCsv`, `fetchExchangeRates`, `costCommitQueue`, `commitAndPushCostFiles`, `pullLatestCostBranch`.
- `adws/triggers/trigger_webhook.ts` — Delete entire `handleIssueCostRevert()` function. Remove its call site on line 210. Remove imports: `rebuildProjectTotalCsv`, `fetchExchangeRates`, `costCommitQueue`, `commitAndPushCostFiles`, `pullLatestCostBranch`, `wasMergedViaPR`.
- `adws/core/modelRouting.ts` — Remove `'/commit_cost'` entry from all 4 maps: `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`.
- `adws/types/issueTypes.ts` — Remove `| '/commit_cost'` from the `SlashCommand` type union (line 65).
- `adws/vcs/commitOperations.ts` — Delete `commitAndPushCostFiles()` function and `CommitCostFilesOptions` interface. Delete `pullLatestCostBranch()` function. Keep `commitChanges()`, `pushBranch()`, `commitAndPushKpiFile()`.
- `adws/vcs/index.ts` — Remove exports: `pullLatestCostBranch`, `commitAndPushCostFiles`, `CommitCostFilesOptions`.
- `adws/phases/index.ts` — No changes needed (does not export `phaseCostCommit`).
- `README.md` — Remove `commit_cost.md` from the project structure listing. Remove `projects/` directory entry. Remove `phaseCostCommit.ts` entry. Remove `costCommitQueue.ts` entry from core listing. Remove `commitQueue.ts` entry from cost listing.
- `features/step_definitions/costCommentFormatterSteps.ts` — Remove `formatIssueCostCsv` import from `csvWriter.ts`. Remove/update scenarios that reference `csvWriter.ts` source code assertions.
- `features/cost_orchestrator_migration_cleanup.feature` — Remove scenarios about `costCommitQueue.ts` (scenarios at lines 205-212). Remove scenario about `rebuildProjectTotalCsv` import (line 280).
- `features/step_definitions/costOrchestratorMigrationCleanupSteps.ts` — Remove `costCommitQueue` assertion step definitions.
- `features/fix_pr_review_issue_number.feature` — Remove/update scenarios that reference `adws/cost/reporting/csvWriter.ts` (lines 65-75).
- `features/step_definitions/fixPrReviewIssueNumberSteps.ts` — Remove/update steps that reference `csvWriter.ts` and `rebuildProjectTotalCsv`.
- `features/remove_unnecessary_exports.feature` — Remove scenario about `recordMergedPrIssue` and `resetMergedPrIssues` (line 125-127) since these functions are being deleted entirely.
- `features/d1_client_dual_write.feature` — Review and remove any references to `phaseCostCommit.ts` dual-write path if present.

### Conditional documentation referenced
- `app_docs/feature-92py6q-d1-client-dual-write.md` — D1 dual-write documentation (relevant because we're converting from dual-write to D1-only).
- `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` — Historical context for the CSV commit flow being removed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Relocate `collectAllTokenTypes` and `FIXED_TOKEN_COLUMNS` to commentFormatter.ts

- Open `adws/cost/reporting/commentFormatter.ts`.
- Copy the `FIXED_TOKEN_COLUMNS` constant (line 15 of `csvWriter.ts`) and the `collectAllTokenTypes()` function (lines 30-43 of `csvWriter.ts`) into `commentFormatter.ts`.
- Remove the import `import { collectAllTokenTypes } from './csvWriter.ts';` from `commentFormatter.ts`.
- Verify `commentFormatter.ts` compiles with no references to `csvWriter.ts`.

### Step 2: Update barrel exports — reporting/index.ts

- Open `adws/cost/reporting/index.ts`.
- Remove all exports originating from `./csvWriter.ts` (lines 5-16: `ProjectTotalRow`, `FIXED_TOKEN_COLUMNS`, `collectAllTokenTypes`, `formatIssueCostCsv`, `writeIssueCostCsv`, `appendIssueCostCsv`, `parseIssueCostCsv`, `parseIssueCostTotal`, `formatProjectTotalCsv`, `rebuildProjectTotalCsv`).
- Keep the `commentFormatter.ts` exports (lines 18-24).
- The file should only re-export from `commentFormatter.ts` after this change.

### Step 3: Update barrel exports — cost/index.ts

- Open `adws/cost/index.ts`.
- Remove the `ProjectTotalRow` type export (line 41).
- Remove all CSV function exports from the reporting block (lines 42-57): `FIXED_TOKEN_COLUMNS`, `collectAllTokenTypes`, `formatIssueCostCsv`, `writeIssueCostCsv`, `appendIssueCostCsv`, `parseIssueCostCsv`, `parseIssueCostTotal`, `formatProjectTotalCsv`, `rebuildProjectTotalCsv`.
- Keep the comment formatter exports: `formatCostTable`, `formatDivergenceWarning`, `formatEstimateVsActual`, `formatCurrencyTotals`, `formatCostCommentSection`.
- Remove the `CostCommitQueue`/`costCommitQueue` export (lines 59-60).
- Keep the `postCostRecordsToD1` export (line 63).

### Step 4: Update barrel exports — core/index.ts

- Open `adws/core/index.ts`.
- Remove the `costCommitQueue`/`CostCommitQueue` re-export (line 136).
- Update the cost module re-export block (lines 138-157):
  - Remove `ProjectTotalRow` from the type export.
  - Remove all CSV function re-exports: `appendIssueCostCsv`, `writeIssueCostCsv`, `parseIssueCostCsv`, `parseIssueCostTotal`, `rebuildProjectTotalCsv`, `formatIssueCostCsv`, `formatProjectTotalCsv`, `collectAllTokenTypes`, `FIXED_TOKEN_COLUMNS`.
  - Keep: `PhaseCostRecord`, `CreatePhaseCostRecordsOptions` (types), `PhaseCostStatus`, `createPhaseCostRecords` (values), `formatCostTable`, `formatDivergenceWarning`, `formatEstimateVsActual`, `formatCurrencyTotals`, `formatCostCommentSection` (comment formatters).
- Update the comment on line 138 to remove "CSV writer" reference.

### Step 5: Update phaseRunner.ts — replace CSV commit with D1-only write

- Open `adws/core/phaseRunner.ts`.
- Replace the import `import { commitPhasesCostData } from '../phases/phaseCostCommit';` with `import { postCostRecordsToD1 } from '../cost/d1Client';`.
- Update `CostTracker.commit()` method (lines 80-82):
  - Replace the body to call `postCostRecordsToD1` directly as fire-and-forget.
  - The method should accept `config: WorkflowConfig` and `records: PhaseCostRecord[]`.
  - Derive `repoName` from `config.targetRepo?.repo ?? config.repoContext?.repoId.repo ?? 'unknown'`.
  - Call: `void postCostRecordsToD1({ project: repoName, repoUrl: process.env.GITHUB_REPO_URL, records });`
  - Wrap in try/catch and log errors without throwing.
- Update `runPhase()`: the call to `tracker.commit()` on line 129 remains the same (signature unchanged).
- Update `runPhasesParallel()`: the call to `tracker.commit()` on line 177 remains the same.
- Update JSDoc to remove CSV references (lines 4, 8, 77).
- Add import for `WorkflowConfig` type if not already imported (it is already imported from `../phases/workflowInit`).

### Step 6: Update prReviewCompletion.ts — remove CSV writes, add D1 write

- Open `adws/phases/prReviewCompletion.ts`.
- Remove import: `import { appendIssueCostCsv, rebuildProjectTotalCsv } from '../cost/reporting';`
- Remove import: `import { fetchExchangeRates } from '../cost/exchangeRates';`
- Add import: `import { postCostRecordsToD1 } from '../cost/d1Client';`
- In `buildPRReviewCostSection()` (lines 117-166):
  - In the `if (config.issueNumber && config.repoContext)` branch (lines 124-151):
    - Remove the `appendIssueCostCsv()` call (line 140).
    - Remove the `const rates = await fetchExchangeRates(['EUR']);` line (line 142).
    - Remove the `rebuildProjectTotalCsv()` call (line 143).
    - Add a fire-and-forget D1 write after creating `phaseCostRecords`:
      ```
      void postCostRecordsToD1({
        project: repoName,
        repoUrl: process.env.GITHUB_REPO_URL,
        records: phaseCostRecords,
      });
      ```
    - Update the catch label from `csvError` to `costError`.
  - The `else` branch (lines 151-165) needs no changes (it only does comment formatting, no CSV writes).

### Step 7: Update webhookHandlers.ts — remove CSV cost handling

- Open `adws/triggers/webhookHandlers.ts`.
- Remove imports (lines 10-12, 16):
  - `import { rebuildProjectTotalCsv } from '../cost/reporting';`
  - `import { fetchExchangeRates } from '../cost/exchangeRates';`
  - `import { costCommitQueue } from '../cost/commitQueue';`
  - From the vcs import, remove `commitAndPushCostFiles` and `pullLatestCostBranch` (keep `deleteRemoteBranch`).
- Remove the `mergedPrIssues` Set (line 25), `recordMergedPrIssue()` function (lines 28-30), and `wasMergedViaPR()` function (lines 33-35).
- Remove the entire "Handle cost CSV files through serialized queue" block (lines 121-140): the `try { costCommitQueue.enqueue(...) }` block.
- The remaining function should: handle PR close, clean up worktree, delete remote branch, extract issue number, close issue, and return.

### Step 8: Update trigger_webhook.ts — remove cost revert

- Open `adws/triggers/trigger_webhook.ts`.
- Remove imports (lines 13-16):
  - `import { rebuildProjectTotalCsv } from '../cost/reporting';`
  - `import { fetchExchangeRates } from '../cost/exchangeRates';`
  - `import { costCommitQueue } from '../cost/commitQueue';`
  - From the vcs import, remove `commitAndPushCostFiles` and `pullLatestCostBranch`.
- Remove the `wasMergedViaPR` import from `./webhookHandlers` (line 20).
- Delete the entire `handleIssueCostRevert()` function (lines 71-79).
- Remove the call to `handleIssueCostRevert()` in the `action === 'closed'` block (line 210: `if (repoName) handleIssueCostRevert(issueNumber, repoName).catch(...)`).

### Step 9: Remove `/commit_cost` from type system and model routing

- Open `adws/types/issueTypes.ts`.
  - Remove `| '/commit_cost'` from the `SlashCommand` type union (line 65). Remove the `// Cost tracking` comment above it (line 64).
- Open `adws/core/modelRouting.ts`.
  - Remove the `'/commit_cost': 'haiku',` entry from `SLASH_COMMAND_MODEL_MAP` (line 53) and its `// Cost tracking` comment (line 52).
  - Remove the `'/commit_cost': 'haiku',` entry from `SLASH_COMMAND_MODEL_MAP_FAST` (line 96).
  - Remove the `'/commit_cost': undefined,` entry from `SLASH_COMMAND_EFFORT_MAP` (line 139).
  - Remove the `'/commit_cost': undefined,` entry from `SLASH_COMMAND_EFFORT_MAP_FAST` (line 178).

### Step 10: Remove CSV git helpers from VCS module

- Open `adws/vcs/commitOperations.ts`.
  - Delete `pullLatestCostBranch()` function (lines 52-62).
  - Delete `CommitCostFilesOptions` interface (lines 64-67).
  - Delete `commitAndPushCostFiles()` function (lines 77-129).
  - Keep `commitChanges()`, `pushBranch()`, `commitAndPushKpiFile()`.
- Open `adws/vcs/index.ts`.
  - Remove `pullLatestCostBranch`, `commitAndPushCostFiles`, and `type CommitCostFilesOptions` from the commit operations export block.

### Step 11: Delete CSV source files

- Delete `adws/cost/reporting/csvWriter.ts`.
- Delete `adws/cost/commitQueue.ts`.
- Delete `adws/core/costCommitQueue.ts`.
- Delete `adws/phases/phaseCostCommit.ts`.
- Delete `.claude/commands/commit_cost.md`.
- Delete `workers/cost-api/migrate.ts`.

### Step 12: Delete projects/ directory

- Run `git rm -r projects/` to remove all CSV cost data files from git.
- Verify `projects/` no longer exists.

### Step 13: Update README.md

- Remove the `├── commit_cost.md` line from the project structure tree (line 139).
- Remove `│   ├── costCommitQueue.ts  # Cost CSV commit queue (core module)` from the core listing (line 237).
- Remove `│   ├── commitQueue.ts  # Cost CSV commit queue` from the cost listing (line 289).
- Remove `projects/               # Cost tracking CSV files per project` from the top-level listing (line 454).
- Remove `│   ├── phaseRunner.ts  # PhaseRunner / CostTracker composition` is fine to keep (PhaseRunner still exists), but update its comment if it mentions CSV.
- Update the `phaseCostCommit.ts` entry in the phases listing (line 319: remove this line).

### Step 14: Update BDD feature files and step definitions

- Delete `features/phase_cost_record_csv.feature` — entirely tests CSV output format.
- Delete `features/step_definitions/phaseCostRecordCsvSteps.ts` — step definitions for the above.
- Delete `features/csv_migration_d1_upload.feature` — tests the migration script being deleted.
- Open `features/cost_orchestrator_migration_cleanup.feature`:
  - Remove the `costCommitQueue.ts unchanged and functional` scenario (lines 205-207).
  - Remove the `costCommitQueue is still re-exported from core/index.ts` scenario (lines 210-212).
  - Remove/update any scenario asserting `rebuildProjectTotalCsv` import in `prReviewCompletion.ts` (around line 280) since that import is being removed.
- Open `features/step_definitions/costOrchestratorMigrationCleanupSteps.ts`:
  - Remove the `costCommitQueue` assertion step definitions (around lines 370-385).
  - Remove/update any step that asserts `rebuildProjectTotalCsv` exists in `prReviewCompletion.ts`.
- Open `features/step_definitions/costCommentFormatterSteps.ts`:
  - Remove the `import { formatIssueCostCsv } from '../../adws/cost/reporting/csvWriter.ts';` import (line 14).
  - Remove/update the step that reads `csvWriter.ts` source and asserts it doesn't reference `SHOW_COST_IN_COMMENTS` (around lines 425-429).
- Open `features/fix_pr_review_issue_number.feature`:
  - Remove scenarios referencing `adws/cost/reporting/csvWriter.ts` (lines 65-75).
- Open `features/step_definitions/fixPrReviewIssueNumberSteps.ts`:
  - Remove the comment and step definitions referencing `csvWriter.ts` and `rebuildProjectTotalCsv` (around lines 153-208).
- Open `features/remove_unnecessary_exports.feature`:
  - Remove the scenario about `recordMergedPrIssue` and `resetMergedPrIssues` exports (lines 125-127) since these functions are being deleted.
- Open `features/d1_client_dual_write.feature`:
  - Review for any references to `phaseCostCommit.ts` as the dual-write integration point and update scenario descriptions if needed (the scenarios should now reflect D1-only writes).

### Step 15: Run validation commands

- Run all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bunx tsc --noEmit` — Type-check the main project to catch broken imports and type errors from removed modules.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws sub-project specifically.
- `bun run lint` — Run linter to check for code quality issues (unused imports, etc.).
- `bun run build` — Build the application to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression BDD scenarios to verify no regressions in cost tracking, comment formatting, or webhook handling.

## Notes
- If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
- `parseIssueCostCsv()` was verified to only be used by the migration script (`workers/cost-api/migrate.ts`). Since migration to D1 is complete, both can be safely deleted.
- The `collectAllTokenTypes` function and `FIXED_TOKEN_COLUMNS` constant must be relocated to `commentFormatter.ts` BEFORE deleting `csvWriter.ts`, as the comment formatter depends on them for rendering cost tables.
- The `CostTracker.commit()` method in `phaseRunner.ts` must continue to swallow errors so cost write failures never abort workflows — this invariant transfers from CSV to D1.
- The `mergedPrIssues` tracking in `webhookHandlers.ts` exists solely to coordinate CSV operations between PR close and issue close handlers. With CSV gone, this coordination layer is unnecessary.
- `commitAndPushKpiFile()` in `commitOperations.ts` is unrelated to CSV cost and must NOT be deleted.
- Several `app_docs/` and `specs/` files reference CSV cost concepts historically. These are documentation artifacts and do not need modification unless they cause build/lint errors.
- The `features/` cleanup in Step 14 is critical — stale BDD scenarios that assert the existence of deleted files/functions will fail the regression suite.
