# Patch: Add @regression tag to review_proof.md so scenario proof verifies zero regressions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #3: @regression scenarios were not included in the scenario proof. The proof only shows @review-proof (0 scenarios) and @adw-308 (failed). There is no verification that existing regression scenarios still pass. Resolution: Run @regression scenarios and include results in the scenario proof to verify zero regressions.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** The scenario proof file (`scenario_proof.md`) only contains results for `@review-proof` (0 scenarios) and `@adw-308` (failed). The `@regression` tag is missing because `.adw/review_proof.md` overrides the default tag configuration (which includes `@regression`) with a custom `## Tags` table that only lists `@review-proof` and `@adw-{issueNumber}`. When `parseReviewProofMd()` in `adws/core/projectConfig.ts` finds a `## Tags` section, it replaces the defaults entirely, so `@regression` is never run.
**Solution:** Add `| @regression | blocker | no |` to the `.adw/review_proof.md` `## Tags` table so the scenario proof runner includes regression scenarios alongside the issue-specific and review-proof tags.

## Files to Modify
Use these files to implement the patch:

- `.adw/review_proof.md` — Add `@regression` row to the `## Tags` table

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add @regression tag to .adw/review_proof.md
- Add a new row `| @regression | blocker | no |` to the `## Tags` table, before the existing `@review-proof` row (placing the broadest tag first)
- The table should become:
  ```
  | Tag | Severity | Optional |
  |-----|----------|----------|
  | @regression | blocker | no |
  | @review-proof | blocker | no |
  | @adw-{issueNumber} | blocker | yes |
  ```

### Step 2: Verify the fix
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to confirm regression scenarios execute and pass
- Confirm the tag is now picked up by reviewing `parseReviewProofMd()` behavior: since `.adw/review_proof.md` has a `## Tags` section, `parseTagsTable()` parses all three rows, so the scenario proof runner will now iterate over `@regression`, `@review-proof`, and `@adw-{issueNumber}`

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify they pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — Verify issue-specific scenarios still run
- `bun run lint` — Check code quality
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project

## Patch Scope
**Lines of code to change:** 1 line added to `.adw/review_proof.md`
**Risk level:** low
**Testing required:** `@regression` scenarios pass, `@adw-308` scenarios still run, lint and type checks clean
