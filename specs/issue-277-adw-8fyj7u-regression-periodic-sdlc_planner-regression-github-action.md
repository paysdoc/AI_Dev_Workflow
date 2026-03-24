# Chore: @regression periodic GitHub Action

## Metadata
issueNumber: `277`
adwId: `8fyj7u-regression-periodic`
issueJson: `{"number":277,"title":"@regression periodic GitHub Action","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nCreate a GitHub Actions workflow that runs the full `@regression` BDD scenario suite on a schedule. This replaces the previous behavior where `@regression` ran during every review phase.\n\nThe workflow should:\n- Run on a configurable cron schedule (e.g., daily or weekly)\n- Execute `@regression`-tagged scenarios using the command from `.adw/scenarios.md`\n- Report results (pass/fail summary, failing scenario names)\n- Failures are informational — they flag drift but don't block any live workflow\n\nSee PRD section: \"Three-Tier Tag Strategy\" — `@regression` is the full safety net that runs periodically, not during review.\n\n## Acceptance criteria\n\n- [ ] GitHub Actions workflow file exists (e.g., `.github/workflows/regression.yml`)\n- [ ] Workflow runs on a configurable cron schedule\n- [ ] Workflow executes `@regression`-tagged scenarios\n- [ ] Workflow reports pass/fail results clearly\n- [ ] Workflow can also be triggered manually (`workflow_dispatch`)\n- [ ] Failures do not block any other workflow or deployment\n\n## Blocked by\n\n- Blocked by #273 (machine-readable review_proof.md + tag-driven scenario execution)\n\n## User stories addressed\n\n- User story 17","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:01:09Z","comments":[{"author":"paysdoc","createdAt":"2026-03-24T18:54:36Z","body":"## Take action"}],"actionableComment":null}`

## Chore Description

Create a GitHub Actions workflow file (`.github/workflows/regression.yml`) that runs the full `@regression` BDD scenario suite on a configurable cron schedule. This is part of the "Three-Tier Tag Strategy" from the review revamp: `@regression` is the full safety net that runs periodically (not during every review phase).

The workflow already exists as an untracked file at `.github/workflows/regression.yml` with a complete implementation. The chore requires:
1. Verifying the existing workflow file meets all acceptance criteria
2. Ensuring the README.md project structure section references the workflow
3. Committing both files

The existing `regression.yml` already implements:
- Daily cron schedule (`0 6 * * *`) — configurable by editing the cron expression
- `workflow_dispatch` for manual triggering
- Bun setup and dependency installation
- Execution of `@regression`-tagged scenarios via `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`
- JSON result output with pass/fail summary and failing scenario names
- Non-blocking (`exit 0` after capturing exit code) — failures are informational
- Results artifact upload for later inspection

## Relevant Files
Use these files to resolve the chore:

- `.github/workflows/regression.yml` — The GitHub Actions workflow file (already exists as untracked). This is the primary deliverable. Verify it matches all acceptance criteria.
- `README.md` — Already updated to reference `.github/workflows/regression.yml` in the project structure tree. Verify the reference is correct.
- `.adw/commands.md` — Contains the `## Run Regression Scenarios` command (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`). Used as the source of truth for the regression command.
- `.adw/scenarios.md` — Contains the BDD scenario configuration including the regression scenario command. Used to verify the workflow uses the correct command.
- `cucumber.js` — Cucumber configuration file. Needed to understand the default format/import settings.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify the regression workflow file against acceptance criteria

- Read `.github/workflows/regression.yml` and verify each acceptance criterion:
  - [x] File exists at `.github/workflows/regression.yml`
  - [x] Runs on a configurable cron schedule (`schedule` with `cron: '0 6 * * *'`)
  - [x] Executes `@regression`-tagged scenarios (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`)
  - [x] Reports pass/fail results clearly (JSON parsing step with total/passed/failed counts + failing scenario names)
  - [x] Can be triggered manually (`workflow_dispatch`)
  - [x] Failures do not block (`set +e` + `exit 0` pattern ensures non-blocking)
- Verify the regression command matches `.adw/commands.md` `## Run Regression Scenarios` section
- Verify the workflow uses `--format summary --format json:regression-results.json` for both human-readable output and machine-readable results

### Step 2: Verify README.md references the workflow

- Confirm that `README.md` includes `.github/workflows/regression.yml` in the project structure tree
- The README already shows:
  ```
  .github/
  └── workflows/
      └── regression.yml  # Periodic @regression BDD scenario runner
  ```
- No changes needed if this is already present

### Step 3: Verify the workflow has no issues

- Check that the `Report results` step correctly handles the case where `regression-results.json` might not exist (it does — uses `if [ -f regression-results.json ]`)
- Check that the `Upload results artifact` step uses `if-no-files-found: ignore` (it does)
- Verify `actions/checkout@v4`, `oven-sh/setup-bun@v2`, and `actions/upload-artifact@v4` are current major versions

### Step 4: Run validation commands

- Run all validation commands to ensure no regressions were introduced

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors (runs `tsc`)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check for adws directory

## Notes
- The `regression.yml` workflow is already fully implemented and meets all acceptance criteria. The implementation step is primarily verification and committing.
- The cron schedule `0 6 * * *` runs daily at 06:00 UTC. This can be changed to weekly (e.g., `0 6 * * 1` for Mondays) by editing the cron expression — no code changes needed.
- The workflow uses `set +e` and `exit 0` to ensure the scenario execution step always succeeds, even if scenarios fail. This is intentional — regression failures are informational, not blocking.
- The `regression-results.json` artifact is uploaded for inspection after the run. It contains the full Cucumber JSON output.
- No environment secrets are needed for this workflow since it only runs BDD scenarios that validate code structure and patterns (no API calls or external services).
- If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines.
