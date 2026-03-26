# Chore: Remove 75 stale BDD scenarios with no regression cost

## Metadata
issueNumber: `321`
adwId: `z9k27x-remove-75-stale-bdd`
issueJson: `{"number":321,"title":"Remove 75 stale BDD scenarios with no regression cost","body":"## Summary\n\nThe regression suite currently has 79 broken scenarios (14 failed, 65 undefined). Investigation confirms 75 of these test designs that were never built, features intentionally removed, or specs with no step definitions. They can be deleted with zero regression cost.\n\n## Scenarios to remove\n\n### Undefined — design never built (22)\n- **`features/generic_pipeline_runner.feature`** — Tests `adws/core/pipelineRunner.ts` which doesn't exist. The orchestrator refactor took a different approach; no generic pipeline runner was built.\n\n### Undefined — infrastructure orphaned (21)\n- **`features/rate_limit_pause_resume.feature`** — Pause/resume infrastructure exists (`pauseQueue.ts`, `pauseQueueScanner.ts`) but orchestrators never wire into it. Scenarios describe integration that isn't there.\n\n### Failed — feature never landed (8)\n- **`features/review_step_def_independence.feature`** — All 8 scenarios assert `review.md` contains a \"Step 5: Step Definition Independence Check\" section. That section was planned (PR #310) but never actually added to `review.md`.\n\n### Failed — intentionally removed (1)\n- **`features/fix_bdd_scenarios_failure.feature`** (scenario: \"Step definition generation phase runs before review phase\") — Asserts `adwPlanBuildTestReview.tsx` calls `executeStepDefPhase`. The step def phase was intentionally replaced by `/implement-tdd` skill inline during build.\n\n### Failed — section never added (1)\n- **`features/application_type_screenshot_upload.feature`** (scenario: \"adw_init.md instruction includes Application Type section generation\") — Asserts `adw_init.md` generates \"## Application Type\". That section was never added to the init command.\n\n### Undefined — cron reevaluation has step defs now (22)\n- **`features/cron_issue_reevaluation.feature`** — Step definitions are being written separately. Remove from this cleanup scope. **Do NOT delete this file.**\n\n## Files to delete\n\n- `features/generic_pipeline_runner.feature`\n- `features/rate_limit_pause_resume.feature`\n- `features/review_step_def_independence.feature`\n- `features/step_definitions/reviewStepDefIndependenceSteps.ts`\n\n## Files to edit (remove specific scenarios only)\n\n- `features/fix_bdd_scenarios_failure.feature` — remove scenario \"Step definition generation phase runs before review phase in all review orchestrators\"\n- `features/application_type_screenshot_upload.feature` — remove scenario \"adw_init.md instruction includes Application Type section generation\"\n\n## Out of scope\n\n- `features/cron_issue_reevaluation.feature` — step defs being written separately\n- `features/fix_pr_routing_and_status.feature` — 2 scenarios need investigation (1 valid behavior, 1 genuine code gap)\n- `features/llm_dependency_extraction.feature` — 2 scenarios need rewriting to match regex-first implementation\n\n## Expected result\n\nRegression suite drops from 79 broken to ~4 broken (the PR routing and dependency extraction scenarios).","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-26T15:45:37Z","comments":[],"actionableComment":null}`

## Chore Description
The regression suite has 79 broken scenarios (14 failed, 65 undefined). Investigation confirms 75 of these test designs that were never built, features that were intentionally removed, or specs with no step definitions. This chore removes those 75 stale scenarios by deleting entire feature files where all scenarios are stale, removing individual stale scenarios from files that contain a mix of valid and stale scenarios, and deleting orphaned step definition files. The expected outcome is reducing broken scenarios from 79 to ~4.

## Relevant Files
Use these files to resolve the chore:

### Files to delete (all scenarios stale)
- `features/generic_pipeline_runner.feature` — Tests `adws/core/pipelineRunner.ts` which was never built; the orchestrator refactor took a different approach. All 22 scenarios are undefined.
- `features/rate_limit_pause_resume.feature` — Describes pause/resume integration that orchestrators never wired into. All 21 scenarios are undefined.
- `features/review_step_def_independence.feature` — All 8 scenarios assert `review.md` contains a "Step 5: Step Definition Independence Check" section that was never added (PR #310 planned but never landed).
- `features/step_definitions/reviewStepDefIndependenceSteps.ts` — Step definitions for the deleted `review_step_def_independence.feature`. Orphaned once the feature file is removed.

### Files to edit (remove specific scenarios only)
- `features/fix_bdd_scenarios_failure.feature` — Remove the scenario at lines 94-99 titled "Step definition generation phase runs before review phase in all review orchestrators". The step def phase was intentionally replaced by `/implement-tdd` skill inline during build. The remaining 13 scenarios in this file are valid.
- `features/application_type_screenshot_upload.feature` — Remove the scenario at lines 57-61 titled "adw_init.md instruction includes Application Type section generation". The `adw_init.md` command never added the "## Application Type" section generation instruction. The remaining 19 scenarios in this file are valid.

### Out of scope (DO NOT touch)
- `features/cron_issue_reevaluation.feature` — Step defs being written separately
- `features/fix_pr_routing_and_status.feature` — 2 scenarios need investigation
- `features/llm_dependency_extraction.feature` — 2 scenarios need rewriting

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete entire stale feature files
- Delete `features/generic_pipeline_runner.feature` (22 undefined scenarios — design never built)
- Delete `features/rate_limit_pause_resume.feature` (21 undefined scenarios — infrastructure orphaned)
- Delete `features/review_step_def_independence.feature` (8 failed scenarios — feature never landed)

### Step 2: Delete orphaned step definition file
- Delete `features/step_definitions/reviewStepDefIndependenceSteps.ts` (step defs for the deleted `review_step_def_independence.feature`)

### Step 3: Remove stale scenario from fix_bdd_scenarios_failure.feature
- In `features/fix_bdd_scenarios_failure.feature`, remove the scenario block starting at line 94 through line 99:
  ```
  @adw-8fns89-error-in-issue-288 @regression
  Scenario: Step definition generation phase runs before review phase in all review orchestrators
    Given the file "adws/adwPlanBuildTestReview.tsx" exists
    And the file "adws/adwSdlc.tsx" exists
    And the file "adws/adwPlanBuildReview.tsx" exists
    Then in each review orchestrator the step def gen phase precedes the review phase
  ```
- Also remove the section comment on line 92 (`# ── 6. Orchestrator phase ordering ensures step defs exist before BDD run ──`) since this entire section is removed.
- Ensure the file still has a trailing newline and the remaining scenarios are properly structured.

### Step 4: Remove stale scenario from application_type_screenshot_upload.feature
- In `features/application_type_screenshot_upload.feature`, remove the scenario block starting at line 57 through line 61:
  ```
  @adw-278 @regression
  Scenario: adw_init.md instruction includes Application Type section generation
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/project.md" generation is found
    Then the instruction lists "## Application Type" as a section to generate
    And the instruction describes inferring the value from the target codebase
  ```
- Also remove the section comment on line 55 (`# --- /adw_init inference ---`) since the next scenario in that section ("adw_init infers web type for projects with frontend frameworks") does not have the `@regression` tag and is not part of this removal. However, the section comment should be preserved because the other two inference scenarios (lines 63-74) still exist under it.
- **Correction**: Keep the `# --- /adw_init inference ---` comment (line 55). Only remove lines 57-61 (the single stale scenario block). The two remaining inference scenarios (lines 63-74) still belong under that section heading.
- Ensure the file still has a trailing newline and the remaining scenarios are properly structured.

### Step 5: Verify no dangling imports or references
- Search the codebase for any imports or references to `reviewStepDefIndependenceSteps` to confirm no other file depends on the deleted step definition file.
- Search for any references to `generic_pipeline_runner`, `rate_limit_pause_resume`, or `review_step_def_independence` in other files to confirm no cross-references exist.

### Step 6: Run validation commands
- Run all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — TypeScript type check (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check (adws config)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run` — Dry-run regression scenarios to confirm no undefined/ambiguous steps remain for the kept scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-8fns89-error-in-issue-288 and @regression"` — Run the remaining fix_bdd_scenarios_failure regression scenarios to confirm they still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-278 and @regression"` — Run the remaining application_type_screenshot_upload regression scenarios to confirm they still pass

## Notes
- The `guidelines/coding_guidelines.md` file emphasizes code hygiene: "Remove unused variables, functions, and imports." This chore aligns with that guideline by removing stale test artifacts.
- **Do NOT touch** `features/cron_issue_reevaluation.feature` — step definitions are being written separately per the issue.
- **Do NOT touch** `features/fix_pr_routing_and_status.feature` or `features/llm_dependency_extraction.feature` — these are explicitly out of scope.
- The scenario count removed: 22 (generic_pipeline_runner) + 21 (rate_limit_pause_resume) + 8 (review_step_def_independence) + 1 (fix_bdd_scenarios_failure) + 1 (application_type_screenshot_upload) = 53 scenarios from direct deletions/edits. The remaining 22 from `cron_issue_reevaluation.feature` are excluded per the issue instructions, bringing the total stale scenarios addressed by this chore to 53 (the issue title says 75, which includes the 22 cron scenarios that are out of scope).
