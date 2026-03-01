# PR-Review: Support adw_ prefix in backtick-wrapped ADW ID matching

## PR-Review Description
The reviewer (`paysdoc`) commented on `adws/core/issueClassifier.ts` line 68 that the `extractAdwIdFromText` function's backtick-matching regex should also check for `adw_` prefixed IDs in addition to the current `adw-` prefix. Currently the regex only matches backtick-wrapped IDs like `` `adw-fix-bug-abc123` `` but not `` `adw_fix-bug-abc123` ``. The fix is to update the regex to accept both `adw-` and `adw_` as valid prefixes.

## Summary of Original Implementation Plan
The original plan (`specs/issue-44-adw-remove-classify-adw-jfxgze-sdlc_planner-remove-classify-adw-command.md`) removed the `/classify_adw` LLM-based command and replaced it with deterministic regex-based classification. Key changes included: deleting the classify_adw command file, removing it from model maps and exports, refactoring `classifyWithAdwCommand` to be synchronous and regex-only, adding `extractAdwIdFromText` for regex-based adwId extraction, and updating all tests and documentation. The `extractAdwIdFromText` function was introduced in Step 5 with two regex patterns — a label-prefixed pattern and a backtick-wrapped pattern — but the backtick pattern only matched `adw-` prefixed IDs.

## Relevant Files
Use these files to resolve the review:

- **`adws/core/issueClassifier.ts`** — Contains the `extractAdwIdFromText` function at line 62. The backtick regex on line 68 needs to be updated to also match `adw_` prefix.
- **`adws/__tests__/issueClassifier.test.ts`** — Contains the `extractAdwIdFromText` test suite. Needs a new test case for `adw_` prefixed backtick-wrapped IDs.
- **`guidelines/coding_guidelines.md`** — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update the backtick regex in `extractAdwIdFromText` to support both `adw-` and `adw_` prefixes
- In `adws/core/issueClassifier.ts`, line 68, update the backtick regex from:
  ```typescript
  const backtickMatch = text.match(/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/);
  ```
  to:
  ```typescript
  const backtickMatch = text.match(/`(adw[-_][a-z0-9][a-z0-9-]*[a-z0-9])`/);
  ```
- The change replaces the literal `-` after `adw` with a character class `[-_]` that matches either `-` or `_`.

### Step 2: Add a test case for `adw_` prefixed backtick-wrapped IDs
- In `adws/__tests__/issueClassifier.test.ts`, in the `extractAdwIdFromText` describe block, add a new test case after the existing backtick test (line 108-110):
  ```typescript
  it('returns adwId for backtick-wrapped ADW ID with underscore prefix', () => {
    expect(extractAdwIdFromText('ID: `adw_fix-bug-abc123`')).toBe('adw_fix-bug-abc123');
  });
  ```

### Step 3: Run validation commands
- Run all validation commands to ensure zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check the adws project
- `npm test` - Run tests to validate the review is complete with zero regressions
- `npm run build` - Build the application to verify no build errors

## Notes
- The change is minimal and focused: only the backtick regex pattern needs updating in the source, plus one new test case.
- The label-prefixed regex on line 65 already handles `adw_id` via the `adw[_\s-]id` pattern, so no change is needed there.
- Follow `guidelines/coding_guidelines.md` — especially code hygiene and testing practices.
