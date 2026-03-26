# Patch: Add @regression tag to review_proof.md Tags table

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #3: Regression scenarios (@regression tag) were not included in the scenario proof. The proof file has no '## @regression Scenarios' section, so there is no evidence that existing functionality continues to work. Resolution: Run regression scenarios (NODE_OPTIONS='--import tsx' bunx cucumber-js --tags '@regression') and include results in the scenario proof to verify zero regressions.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** The scenario proof (`scenario_proof.md`) contains only `@review-proof` and `@adw-308` results — no `@regression` section exists. This is because `.adw/review_proof.md` has a custom `## Tags` table that only lists `@review-proof` and `@adw-{issueNumber}`. When `parseReviewProofMd()` finds a `## Tags` section it replaces the defaults entirely, so `@regression` is never run by the scenario proof runner.
**Solution:** Add `| @regression | blocker | no |` to the `.adw/review_proof.md` `## Tags` table so the proof runner includes regression scenarios in every review proof.

## Files to Modify
Use these files to implement the patch:

- `.adw/review_proof.md` — Add `@regression` row to the `## Tags` table

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add @regression tag row to .adw/review_proof.md
- Open `.adw/review_proof.md`
- In the `## Tags` table, add a new row `| @regression | blocker | no |` as the **first data row** (before `@review-proof`), since it is the broadest tag and should run first
- The resulting table should be:
  ```
  | Tag | Severity | Optional |
  |-----|----------|----------|
  | @regression | blocker | no |
  | @review-proof | blocker | no |
  | @adw-{issueNumber} | blocker | yes |
  ```

### Step 2: Verify regression scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to confirm all regression scenarios execute and pass
- Confirm the output is non-empty (i.e., more than 0 scenarios run)

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Verify all regression scenarios pass (non-zero scenario count)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — Verify issue-specific scenarios still run
- `bun run lint` — Check code quality
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project

## Patch Scope
**Lines of code to change:** 1 line added to `.adw/review_proof.md`
**Risk level:** low
**Testing required:** `@regression` scenarios pass with non-zero count, `@adw-308` scenarios still run, lint and type checks clean
