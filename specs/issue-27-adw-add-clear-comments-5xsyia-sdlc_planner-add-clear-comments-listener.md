# Feature: Add Clear Comments Webhook Listener

## Metadata
issueNumber: `27`
adwId: `add-clear-comments-5xsyia`
issueJson: `{"number":27,"title":"Add Clear comments","body":"Add a listener to the hook that reacts to an issue comment with \"## Clear\".\nThis will trigger the adwClearComments adw to remove all comments in the issue (including the new \"## clear\").\n\nAs an extra: update the trigger to recognise \"## Take action\" and \"## Clear\" as case insenitive","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-26T07:46:20Z","comments":[],"actionableComment":null}`

## Feature Description
Add a new webhook listener that detects issue comments containing the `## Clear` heading (case-insensitive) and triggers the existing `adwClearComments` logic to remove all comments from the issue. This provides a quick way to reset an issue's comment thread via a simple comment directive, similar to how `## Take action` triggers workflows. The `## Take action` pattern is already case-insensitive (`/mi` flag), so this requirement is already met. The new `## Clear` pattern will also be case-insensitive from the start.

## User Story
As a developer managing GitHub issues with ADW
I want to comment `## Clear` on an issue to remove all comments
So that I can quickly reset an issue's comment thread when a workflow has gone wrong or comments are cluttered

## Problem Statement
When an ADW workflow produces many comments on an issue (e.g., status updates, error reports), or a workflow has gone wrong, there is no easy way to clean up the issue from GitHub itself. The only option is to run `npx tsx adws/adwClearComments.tsx <issueNumber>` manually from the command line, which requires terminal access and knowledge of the CLI tool.

## Solution Statement
Add a `## Clear` comment detection pattern (`isClearComment`) to the shared comment utilities in `workflowCommentsBase.ts`, then handle it in the webhook's `issue_comment` handler (in `trigger_webhook.ts`) by invoking `clearIssueComments()` directly (synchronously, since it uses `execSync` internally). The clear action runs before the existing `## Take action` check so that a clear directive is never misinterpreted as a workflow trigger. The cron trigger does not need changes because clear is an imperative action best handled in real-time via webhooks.

## Relevant Files
Use these files to implement the feature:

- `adws/github/workflowCommentsBase.ts` — Contains `isActionableComment`, `ACTIONABLE_COMMENT_PATTERN`, and related comment utility functions. This is where the new `isClearComment` function and `CLEAR_COMMENT_PATTERN` will be added.
- `adws/github/index.ts` — Central export barrel for the `github/` module. Must export the new `isClearComment` function.
- `adws/triggers/trigger_webhook.ts` — Webhook server that handles `issue_comment` events. Must add the clear-comment detection branch.
- `adws/adwClearComments.tsx` — Contains the `clearIssueComments()` function that will be called when a clear comment is detected.
- `adws/__tests__/commentFiltering.test.ts` — Existing tests for `isActionableComment`. Add tests for `isClearComment` here.
- `adws/__tests__/triggerCommentHandling.test.ts` — Existing tests for cron trigger comment handling. Add webhook clear-comment handling tests here.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed during implementation.

### New Files
- `adws/__tests__/webhookClearComment.test.ts` — Dedicated test file for the webhook clear-comment handler logic, testing the integration between the webhook handler and `clearIssueComments`.

## Implementation Plan
### Phase 1: Foundation
Add the `## Clear` detection pattern and utility function to the shared comment utilities module (`workflowCommentsBase.ts`). This follows the exact same pattern as the existing `ACTIONABLE_COMMENT_PATTERN` / `isActionableComment`. Export the new function from the barrel `index.ts`.

### Phase 2: Core Implementation
Modify the webhook's `issue_comment` handler in `trigger_webhook.ts` to check for `isClearComment` before the existing `isActionableComment` check. When a clear comment is detected, call `clearIssueComments(issueNumber)` directly and respond with an appropriate JSON status.

### Phase 3: Integration
Add comprehensive unit tests for the new pattern, the utility function, and the webhook handler behavior. Ensure all existing tests continue to pass.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `CLEAR_COMMENT_PATTERN` and `isClearComment` to `workflowCommentsBase.ts`
- Add a new regex constant `CLEAR_COMMENT_PATTERN` with value `/^## Clear$/mi` (case-insensitive, multiline) directly below the existing `ACTIONABLE_COMMENT_PATTERN`.
- Add a new function `isClearComment(commentBody: string): boolean` that returns `true` if the comment body matches the pattern. Follow the same style as `isActionableComment`.
- Add a JSDoc comment matching the style of the existing functions.

### Step 2: Export `isClearComment` and `CLEAR_COMMENT_PATTERN` from `github/index.ts`
- Add `isClearComment` and `CLEAR_COMMENT_PATTERN` to the `Workflow Comments` export block in `adws/github/index.ts`.

### Step 3: Add clear-comment handling to the webhook `issue_comment` handler
- In `adws/triggers/trigger_webhook.ts`, import `isClearComment` from `../github` and `clearIssueComments` from `../adwClearComments`.
- In the `issue_comment` handler block, after the `action !== 'created'` guard and after extracting `commentBody` and `issueNumber`, add a check for `isClearComment(commentBody)` **before** the existing `isActionableComment(commentBody)` check.
- When a clear comment is detected:
  - Log the action: `log(\`Clear directive on issue #${issueNumber}, clearing all comments\`)`.
  - Call `clearIssueComments(issueNumber)` and capture the result.
  - Log the result summary.
  - Respond with `jsonResponse(res, 200, { status: 'cleared', issue: issueNumber, deleted: result.deleted })`.
  - Return early so the actionable-comment logic is not reached.

### Step 4: Add unit tests for `isClearComment` in `commentFiltering.test.ts`
- Add a new `describe('isClearComment', ...)` block in `adws/__tests__/commentFiltering.test.ts`.
- Import `isClearComment` from `../github/workflowCommentsBase`.
- Test cases:
  - Returns `true` for `## Clear` (exact match).
  - Returns `true` for `## clear` (lowercase).
  - Returns `true` for `## CLEAR` (uppercase).
  - Returns `true` for `## Clear` with surrounding text (e.g., `Some context\n\n## Clear`).
  - Returns `false` for `## Take action` (not a clear comment).
  - Returns `false` for plain text containing the word "clear" without heading.
  - Returns `false` for empty string.
  - Returns `false` for ADW system comment.

### Step 5: Add webhook clear-comment handler test in `webhookClearComment.test.ts`
- Create `adws/__tests__/webhookClearComment.test.ts`.
- Mock `child_process` (for `execSync` used by `clearIssueComments` → `fetchIssueCommentsRest` / `deleteIssueComment`).
- Mock `../core/utils` for `log`.
- Test that when the webhook receives an `issue_comment` event with body `## Clear`, it invokes `clearIssueComments` and responds with `{ status: 'cleared' }`.
- Test that when the webhook receives an `issue_comment` event with body `## clear` (lowercase), it also triggers the clear logic.
- Test that a normal `## Take action` comment does NOT trigger the clear logic (falls through to the existing handler).

### Step 6: Run validation commands
- Run `npm run lint` to verify no linting errors.
- Run `npx tsc --noEmit` and `npx tsc --noEmit -p adws/tsconfig.json` to verify no type errors.
- Run `npm test` to verify all tests pass with zero regressions.

## Testing Strategy
### Unit Tests
- **`isClearComment` function**: Test case-insensitive matching, multiline handling, negative cases (empty string, plain text, ADW comments, actionable comments).
- **Webhook clear-comment handler**: Test that the webhook correctly identifies `## Clear` comments and calls `clearIssueComments`, and that non-clear comments still flow through to the existing `isActionableComment` path.

### Edge Cases
- `## Clear` with trailing whitespace or extra newlines.
- `## Clear` embedded within a longer comment (e.g., text before and after the heading).
- Mixed-case variations: `## cLeAr`, `## CLEAR`, `## clear`.
- A comment that contains both `## Clear` and `## Take action` — `## Clear` should take precedence since it's checked first.
- `issue_comment` events with `action` other than `created` (e.g., `edited`, `deleted`) should be ignored.
- Missing `issueNumber` in the payload should be handled gracefully.

## Acceptance Criteria
- A `## Clear` comment (case-insensitive) on a GitHub issue triggers the deletion of all comments on that issue via the webhook.
- The webhook responds with `{ status: 'cleared', issue: <number>, deleted: <count> }` on success.
- The `## Take action` directive continues to work exactly as before (no regressions).
- The `## Take action` pattern remains case-insensitive (already implemented).
- All existing tests pass.
- New unit tests cover `isClearComment` and the webhook handler's clear-comment branch.
- Code follows the project's coding guidelines (TypeScript strict mode, JSDoc, pure functions where possible).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the Next.js application
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `npm test` — Run all tests to validate the feature works with zero regressions

## Notes
- The `## Take action` pattern (`ACTIONABLE_COMMENT_PATTERN`) already uses the `/mi` flag, so it is already case-insensitive. No changes needed for that part of the "extra" requirement.
- The `clearIssueComments` function in `adwClearComments.tsx` is synchronous (uses `execSync` internally), so it can be called directly in the webhook handler without `async/await` complexity.
- The cron trigger (`trigger_cron.ts`) does not need changes — clear is a real-time imperative action best handled by the webhook. The cron trigger only processes qualifying issues for workflow triggering.
- Implementation must strictly follow the coding guidelines in `guidelines/coding_guidelines.md`.
