# Bug: ADW issue classification misclassifies issues due to missing types and inconsistent command lists

## Metadata
issueNumber: `42`
adwId: `huge-problems-with-c-cxk395`
issueJson: `{"number":42,"title":"Huge problems with classification","body":"The ADW continuously misclassifies issues. Analyse the whole process THOROUGHLY. \nDetect all possible issue and fix.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-01T11:30:58Z","comments":[],"actionableComment":null}`

## Bug Description
The ADW issue classification system has multiple consistency bugs that cause issues to be misclassified. The classification pipeline uses a two-step approach: first trying `/classify_adw` (ADW-specific commands), then falling back to `/classify_issue` (heuristic AI classification). Both steps have issues:

1. The heuristic classifier's valid commands array (`classifyWithIssueCommand`) is missing `/adw_init`, so if the AI returns it, the result is silently dropped and defaults to `/feature`.
2. The `classify_adw.md` prompt's Instructions example list is missing 2 of the 13 valid ADW commands (`/adw_plan_build_review` and `/adw_plan_build_document`), which could cause the AI agent to not recognize these commands in issue text.
3. Seven of eight orchestrator files have hardcoded `validTypes` arrays missing `/adw_init`, meaning if `--issue-type /adw_init` is ever passed to them, they reject it and exit with an error.
4. The heuristic classifier uses `output.includes(cmd)` with `Array.find()`, which matches the first command in array order rather than the AI's actual recommendation — if the AI mentions rejected commands before the chosen one, the wrong command is returned.

**Expected behavior:** Issues are correctly classified based on their content, and all valid issue types are recognized throughout the pipeline.

**Actual behavior:** Issues can be misclassified due to incomplete command lists, inconsistent validation arrays, and fragile output parsing.

## Problem Statement
The classification pipeline has four categories of bugs:
1. **Incomplete valid command lists** in `issueClassifier.ts` and orchestrator argument parsers that don't include `/adw_init`
2. **Inconsistent ADW command prompt** in `classify_adw.md` where the Instructions example list doesn't match the Valid ADW Commands section
3. **Fragile heuristic output parsing** in `classifyWithIssueCommand` that can match the wrong command in ambiguous AI responses
4. **Scattered hardcoded arrays** duplicated across 8 orchestrator files instead of using a shared constant from `issueTypes.ts`

## Solution Statement
Fix all four categories:
1. Add `/adw_init` to the `validCommands` array in `classifyWithIssueCommand()` and to all orchestrator `validTypes` arrays
2. Update `classify_adw.md` Instructions line to include all 13 valid ADW commands
3. Replace the `output.includes(cmd)` approach with a regex that matches the last standalone slash command in the output, reducing false matches from AI verbosity
4. Extract the hardcoded `validTypes` array into a shared constant in `issueTypes.ts` and import it in all orchestrators to prevent future drift

## Steps to Reproduce
1. Create a GitHub issue that requires `/adw_init` classification but doesn't contain the literal `/adw_init` command — the heuristic fallback will classify it as `/feature`
2. Create a GitHub issue containing `/adw_plan_build_review` — the AI agent for `/classify_adw` may not recognize this command since it's missing from the Instructions example list
3. If the `/classify_issue` AI agent returns verbose output mentioning a rejected command before the chosen one (e.g., "Not a /chore, this is /bug"), `/chore` is incorrectly returned

## Root Cause Analysis
The root cause is **duplicated hardcoded arrays** that fell out of sync with the canonical type definitions. When `/adw_init` was added to `IssueClassSlashCommand`, the following locations were not updated:
- `issueClassifier.ts:185` — `validCommands` in `classifyWithIssueCommand()`
- `adwPlanBuildTest.tsx:70`, `adwSdlc.tsx:77`, `adwPlan.tsx:70`, `adwPlanBuildTestReview.tsx:74`, `adwPlanBuildDocument.tsx:68`, `adwPlanBuild.tsx:66`, `adwPlanBuildReview.tsx:70` — `validTypes` in `parseArguments()`
- `classify_adw.md` Instructions line — example list of commands

Additionally, the `output.includes(cmd)` parsing in `classifyWithIssueCommand` is inherently order-dependent and fragile for multi-command AI output.

## Relevant Files
Use these files to fix the bug:

- `adws/core/issueTypes.ts` — Source of truth for `IssueClassSlashCommand` type. Add a shared `VALID_ISSUE_TYPES` constant array here.
- `adws/core/issueClassifier.ts` — Contains `classifyWithIssueCommand()` with the hardcoded `validCommands` array (line 185) and fragile `output.includes()` parsing (line 186). Fix both.
- `.claude/commands/classify_adw.md` — Contains the ADW workflow extraction prompt with an incomplete Instructions example list (missing `/adw_plan_build_review` and `/adw_plan_build_document`).
- `adws/adwPlanBuildTest.tsx` — Orchestrator with hardcoded `validTypes` missing `/adw_init` (line 70).
- `adws/adwSdlc.tsx` — Orchestrator with hardcoded `validTypes` missing `/adw_init` (line 77).
- `adws/adwPlan.tsx` — Orchestrator with hardcoded `validTypes` missing `/adw_init` (line 70).
- `adws/adwPlanBuildTestReview.tsx` — Orchestrator with hardcoded `validTypes` missing `/adw_init` (line 74).
- `adws/adwPlanBuildDocument.tsx` — Orchestrator with hardcoded `validTypes` missing `/adw_init` (line 68).
- `adws/adwPlanBuild.tsx` — Orchestrator with hardcoded `validTypes` missing `/adw_init` (line 66).
- `adws/adwPlanBuildReview.tsx` — Orchestrator with hardcoded `validTypes` missing `/adw_init` (line 70).
- `adws/adwInit.tsx` — Reference orchestrator that already includes `/adw_init` in its `validTypes` (line 65).
- `adws/core/index.ts` — Barrel export file; must re-export the new `VALID_ISSUE_TYPES` constant.
- `adws/__tests__/issueClassifier.test.ts` — Tests for the classifier. Add tests for the new parsing logic and `/adw_init` handling.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add shared `VALID_ISSUE_TYPES` constant to `issueTypes.ts`
- In `adws/core/issueTypes.ts`, add a new exported constant array derived from `IssueClassSlashCommand`:
  ```typescript
  export const VALID_ISSUE_TYPES: readonly IssueClassSlashCommand[] = ['/chore', '/bug', '/feature', '/pr_review', '/adw_init'] as const;
  ```
- Place it right after the `IssueClassSlashCommand` type definition (after line 5)
- Ensure it's exported from `adws/core/index.ts` (add to barrel exports if not already)

### 2. Fix `classifyWithIssueCommand` in `issueClassifier.ts`
- Import `VALID_ISSUE_TYPES` from `issueTypes.ts`
- Replace the hardcoded `validCommands` array at line 185 with `VALID_ISSUE_TYPES`
- Replace the fragile `output.includes(cmd)` parsing (line 186) with a regex-based approach that finds the last slash command in the output:
  ```typescript
  const commandPattern = VALID_ISSUE_TYPES.map(cmd => cmd.replace('/', '\\/')).join('|');
  const regex = new RegExp(`(${commandPattern})(?!.*(?:${commandPattern}))`, 's');
  const match = output.match(regex);
  const matchedCommand = match ? match[1] as IssueClassSlashCommand : undefined;
  ```
  This matches the last occurrence of any valid command, so if the AI says "Not /chore, this is /bug", `/bug` is correctly returned.

### 3. Update all orchestrator `validTypes` arrays to use `VALID_ISSUE_TYPES`
- In each of these 7 files, replace the hardcoded `validTypes` array with the imported `VALID_ISSUE_TYPES` constant:
  - `adws/adwPlanBuildTest.tsx` (line 70)
  - `adws/adwSdlc.tsx` (line 77)
  - `adws/adwPlan.tsx` (line 70)
  - `adws/adwPlanBuildTestReview.tsx` (line 74)
  - `adws/adwPlanBuildDocument.tsx` (line 68)
  - `adws/adwPlanBuild.tsx` (line 66)
  - `adws/adwPlanBuildReview.tsx` (line 70)
- Also update `adws/adwInit.tsx` (line 65) to use the shared constant for consistency
- Import `VALID_ISSUE_TYPES` from `./core` in each file (add to existing import if `IssueClassSlashCommand` is already imported)
- Update the help text in `printUsageAndExit()` in each file to show valid types dynamically: ``Valid values: ${VALID_ISSUE_TYPES.join(', ')}``

### 4. Fix `classify_adw.md` Instructions example list
- In `.claude/commands/classify_adw.md`, update the Instructions line (line 7) to include all 13 valid ADW commands. Add the missing `/adw_plan_build_review` and `/adw_plan_build_document` to the example list in the Instructions section so it matches the Valid ADW Commands section exactly.

### 5. Update tests in `issueClassifier.test.ts`
- Add a test to `classifyWithIssueCommand` (via `classifyIssueForTrigger` or `classifyGitHubIssue`) that verifies `/adw_init` is recognized when the heuristic classifier returns it
- Add a test that verifies the last-match parsing behavior: when the AI output contains multiple commands (e.g., "Not /chore, definitely /bug"), the last command is returned
- Verify existing tests still pass with the new parsing logic

### 6. Run Validation Commands
- Execute the validation commands below to ensure all fixes work correctly with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check the ADW scripts
- `npm test` - Run tests to validate the bug is fixed with zero regressions

## Notes
- The `adwInit.tsx` orchestrator already includes `/adw_init` in its `validTypes` — use it as the reference for the correct pattern.
- The 7 non-init orchestrators will probably never receive `--issue-type /adw_init` in practice (since `/adw_init` routes to `adwInit.tsx`), but using the shared constant prevents future drift when new issue types are added.
- The `classify_issue.md` prompt intentionally does NOT include `/adw_init` — that command should be caught by `/classify_adw` first. No changes needed to `classify_issue.md`.
- When implementing the regex-based parsing in step 2, ensure the `'s'` flag (dotAll) is used so `.` matches newlines in multiline AI output.
