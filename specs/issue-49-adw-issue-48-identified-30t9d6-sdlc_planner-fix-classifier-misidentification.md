# Bug: Classifier falsely matches ADW commands inside fenced code blocks

## Metadata
issueNumber: `49`
adwId: `issue-48-identified-30t9d6`
issueJson: `{"number":49,"title":"Issue #48 identified as adw init","body":"Issue 48 was misidentified. AGAIN!!\n\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-01T16:02:26Z","comments":[],"actionableComment":null}`

## Bug Description
When issue #48 ("Clearing issue comments triggers additional classification") was processed by the classifier, it was incorrectly identified as `/adw_init`. The issue body contains a webhook JSON payload inside a fenced code block (` ``` `) that includes `"body": "/adw_init"` from a different repo's issue (Millennium #35). The `extractAdwCommandFromText` function scans the entire text for ADW command patterns without filtering out fenced code blocks, causing it to match `/adw_init` from inside quoted JSON data.

**Expected behavior:** Issue #48 should fall through to the heuristic classifier (`/classify_issue`), which would correctly identify it as `/bug`.

**Actual behavior:** The deterministic regex classifier matches `/adw_init` from inside a fenced code block in the issue body, incorrectly classifying it as `/adw_init` and routing it to `adws/adwInit.tsx`.

## Problem Statement
The `extractAdwCommandFromText` function in `adws/core/issueClassifier.ts` does not strip fenced code blocks before scanning for ADW commands. Any ADW command string appearing inside a code block (e.g., in logs, JSON payloads, example data) will be falsely matched as an actual command.

## Solution Statement
Add a helper function `stripFencedCodeBlocks` that removes fenced code block content (` ```...``` `) from text before scanning for ADW commands. Apply this stripping in `extractAdwCommandFromText` so that commands embedded in code blocks are ignored. Also apply it in `extractAdwIdFromText` for consistency. Add comprehensive tests covering the new behavior.

## Steps to Reproduce
1. Create a GitHub issue whose body contains a fenced code block with an ADW command embedded inside (e.g., JSON with `"body": "/adw_init"`)
2. Trigger the classifier (via cron or webhook) for that issue
3. Observe the classifier detects `/adw_init` via regex instead of falling through to the heuristic classifier
4. The issue is routed to `adws/adwInit.tsx` instead of the correct workflow

## Root Cause Analysis
In `adws/core/issueClassifier.ts`, the `extractAdwCommandFromText` function at line 31 receives raw text and scans it with regex patterns:

```typescript
const pattern = new RegExp(`${cmd.replace('/', '\\/')}\\b`);
return pattern.test(text);
```

This matches `/adw_init` (or any valid ADW command) anywhere in the text, including:
- Inside fenced code blocks (` ```...``` `)
- Inside inline code (`` `...` ``)
- Inside JSON strings embedded in issues

When issue #48's body contains a code block with webhook JSON that includes `"body": "/adw_init"`, the regex matches it as an actual command. The `classifyWithAdwCommand` function (line 87) passes `issueBody` directly to `extractAdwCommandFromText` without any pre-processing.

## Relevant Files
Use these files to fix the bug:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `adws/core/issueClassifier.ts` — Contains `extractAdwCommandFromText`, `extractAdwIdFromText`, and `classifyWithAdwCommand`. This is where the bug exists and where the fix will be applied.
- `adws/__tests__/issueClassifier.test.ts` — Unit tests for the classifier functions. New tests must be added here to cover the code-block stripping behavior.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `stripFencedCodeBlocks` helper function to `adws/core/issueClassifier.ts`
- Add a new exported function `stripFencedCodeBlocks(text: string): string` before `extractAdwCommandFromText`.
- The function should remove all fenced code block content (triple-backtick blocks) from the input text.
- Use a regex like `/```[\s\S]*?```/g` to match and remove fenced code blocks (both with and without language specifiers).
- Add a JSDoc comment explaining the function's purpose.
- Log when code blocks are stripped for debugging visibility.

### 2. Apply `stripFencedCodeBlocks` in `extractAdwCommandFromText`
- At the beginning of `extractAdwCommandFromText`, call `stripFencedCodeBlocks` on the input `text` before scanning for commands.
- Use the stripped text for all subsequent regex matching.
- This ensures ADW commands inside code blocks are not falsely matched.

### 3. Apply `stripFencedCodeBlocks` in `extractAdwIdFromText`
- At the beginning of `extractAdwIdFromText`, call `stripFencedCodeBlocks` on the input `text` before scanning for adwId patterns.
- This provides consistency so adwId patterns inside code blocks are also ignored.

### 4. Add unit tests in `adws/__tests__/issueClassifier.test.ts`
- Add a new `describe('stripFencedCodeBlocks')` test block with tests for:
  - Returns text unchanged when no code blocks are present.
  - Strips a single fenced code block.
  - Strips multiple fenced code blocks.
  - Strips code blocks with language specifiers (e.g., ` ```json `).
  - Preserves text outside code blocks.
- Add tests to `describe('extractAdwCommandFromText')` for:
  - Returns `null` when `/adw_init` appears only inside a fenced code block (the exact scenario from issue #48).
  - Returns the command when it appears both inside a code block and outside (the outside one should still match).
  - Returns `null` when command is only in a code block with a language specifier.
- Add tests to `describe('extractAdwIdFromText')` for:
  - Returns `null` when adwId pattern appears only inside a fenced code block.

### 5. Run validation commands
- Run the validation commands below to confirm all tests pass and there are no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm test` — Run all tests to validate the bug fix and zero regressions.
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws directory to verify no type errors.
- `npm run lint` — Run linter to check for code quality issues.
- `npm run build` — Build the application to verify no build errors.

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`. In particular: pure functions, meaningful variable names, JSDoc documentation, and comprehensive edge case testing.
- The `stripFencedCodeBlocks` function should be a pure function with no side effects.
- The fix is minimal and surgical — it only adds pre-processing of text before regex matching, without changing any other classifier behavior.
- This is a recurring issue (the user says "AGAIN!!"), so the test coverage should be thorough to prevent regressions.
