# Bug: adwInit.tsx rejects /adw_init as a valid --issue-type

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
When running `npx tsx adws/adwInit.tsx 39 --issue-type /adw_init`, the script exits with the error:
```
Invalid issue type: /adw_init. Valid values: /feature, /bug, /chore, /pr_review
```

**Expected behavior:** `/adw_init` should be accepted as a valid `--issue-type` value by `adwInit.tsx`, since it is a valid member of the `IssueClassSlashCommand` type and `adwInit.tsx` is the dedicated orchestrator for `/adw_init` workflows.

**Actual behavior:** The hardcoded `validTypes` array in `adwInit.tsx:65` only contains `['/feature', '/bug', '/chore', '/pr_review']`, omitting `/adw_init`, causing the script to reject it and exit with code 1.

## Problem Statement
The `parseArguments()` function in `adwInit.tsx` validates the `--issue-type` flag against a hardcoded array of valid types that does not include `/adw_init`. This is inconsistent with the `IssueClassSlashCommand` type definition in `issueTypes.ts` which does include `/adw_init`, and with `adwInit.tsx` being the canonical orchestrator for `/adw_init` issues.

## Solution Statement
Add `/adw_init` to the `validTypes` array in `adwInit.tsx`'s `parseArguments()` function. This is the only orchestrator that needs this change — the other orchestrators (`adwPlan.tsx`, `adwPlanBuild.tsx`, etc.) correctly exclude `/adw_init` because they are not meant to handle that issue type.

## Steps to Reproduce
1. Run: `npx tsx adws/adwInit.tsx 39 --issue-type /adw_init --target-repo paysdoc/AI_Dev_Workflow --clone-url https://github.com/paysdoc/AI_Dev_Workflow.git`
2. Observe error: `Invalid issue type: /adw_init. Valid values: /feature, /bug, /chore, /pr_review`
3. Script exits with code 1 instead of proceeding with the init workflow

## Root Cause Analysis
When `/adw_init` was added as a new `IssueClassSlashCommand` variant (in `issueTypes.ts`), the `validTypes` array in `adwInit.tsx:65` was not updated to include it. All orchestrator scripts have their own hardcoded `validTypes` arrays for `--issue-type` validation, and `adwInit.tsx` — the one script that specifically should accept `/adw_init` — was left with the original four-type list.

The `issueTypes.ts` file correctly defines `/adw_init` in:
- `IssueClassSlashCommand` type (line 5)
- `adwCommandToIssueTypeMap` (line 43)
- `adwCommandToOrchestratorMap` (line 64)
- `issueTypeToOrchestratorMap` (line 77)
- `commitPrefixMap` (line 97)
- `branchPrefixMap` (line 109)
- `branchPrefixAliases` (line 121)

But `adwInit.tsx`'s local validation doesn't reflect this.

## Relevant Files
Use these files to fix the bug:

- `adws/adwInit.tsx` — Contains the `parseArguments()` function with the hardcoded `validTypes` array at line 65 that needs `/adw_init` added. This is the only file that needs to change.
- `adws/core/issueTypes.ts` — Reference file; defines `IssueClassSlashCommand` which already includes `/adw_init`. No changes needed, but confirms the fix is correct.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `/adw_init` to the validTypes array in `adwInit.tsx`
- Open `adws/adwInit.tsx`
- On line 65, change:
  ```typescript
  const validTypes: IssueClassSlashCommand[] = ['/feature', '/bug', '/chore', '/pr_review'];
  ```
  to:
  ```typescript
  const validTypes: IssueClassSlashCommand[] = ['/feature', '/bug', '/chore', '/pr_review', '/adw_init'];
  ```
- Also update the error message on line 37 and line 69 to include `/adw_init` in the printed valid values (the error message is generated dynamically from `validTypes.join(', ')` on line 69, so it will automatically update; verify line 37's hardcoded string in `printUsageAndExit()` matches)

### 2. Update the usage help text in `printUsageAndExit()`
- On line 37, update the hardcoded help text from:
  ```
  Valid values: /feature, /bug, /chore, /pr_review
  ```
  to:
  ```
  Valid values: /feature, /bug, /chore, /pr_review, /adw_init
  ```

### 3. Run validation commands
- Run all validation commands listed below to confirm the fix compiles, passes linting, and passes all existing tests with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws project to verify no type errors
- `npm run lint` — Run linter to check for code quality issues
- `npm test` — Run tests to validate the fix introduces no regressions

## Notes
- This is a one-line fix (plus a help text update). The `validTypes` array on line 65 is the only change needed; the error message on line 69 is dynamically generated from the array.
- The other orchestrator scripts (`adwPlan.tsx`, `adwPlanBuild.tsx`, `adwSdlc.tsx`, etc.) correctly exclude `/adw_init` from their `validTypes` because they are not designed to handle `/adw_init` issue types. Only `adwInit.tsx` needs this change.
- Follow `guidelines/coding_guidelines.md` conventions throughout.
