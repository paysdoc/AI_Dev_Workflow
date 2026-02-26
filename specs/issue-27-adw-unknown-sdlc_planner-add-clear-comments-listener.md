# Feature: Add Clear Comments Webhook Listener

## Metadata
issueNumber: `27`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
Add a webhook listener that reacts to a GitHub issue comment containing the heading `## Clear`. When such a comment is detected, the webhook triggers `adwClearComments.tsx` to delete all comments on that issue (including the triggering "## Clear" comment itself). As an extra, confirm that both `## Take action` and `## Clear` are matched case-insensitively.

## User Story
As a developer managing ADW workflows
I want to post a `## Clear` comment on a GitHub issue
So that all comments on that issue are automatically removed without manual intervention

## Problem Statement
Currently, the webhook trigger handles `## Take action` comments to restart workflows, and `adwClearComments.tsx` exists as a standalone CLI tool. However, there is no automated hook that connects the two: a user cannot trigger a comment cleanup by posting `## Clear` on an issue. Additionally, it should be confirmed that both trigger keywords are matched case-insensitively so users don't have to be precise about capitalisation.

## Solution Statement
Add a `CLEAR_COMMENT_PATTERN` constant and a `isClearComment` helper to `workflowCommentsBase.ts` (matching the exact pattern of `ACTIONABLE_COMMENT_PATTERN`). Update the `issue_comment` webhook handler in `trigger_webhook.ts` to check for this pattern first, and spawn `adwClearComments.tsx` with the issue number when matched. Verify that `ACTIONABLE_COMMENT_PATTERN` already uses the `i` (case-insensitive) flag, and apply the same flag to `CLEAR_COMMENT_PATTERN`. Export the new utilities through the existing barrel exports. Add comprehensive unit tests covering both the pattern helpers and the webhook branching logic.

## Relevant Files

- `adws/github/workflowCommentsBase.ts` — Contains `ACTIONABLE_COMMENT_PATTERN`, `isActionableComment`, and all comment-detection helpers. Add `CLEAR_COMMENT_PATTERN` and `isClearComment` here.
- `adws/github/workflowComments.ts` — Re-export barrel for `workflowCommentsBase`. Add exports for the new clear-comment utilities.
- `adws/github/index.ts` — Top-level GitHub module barrel. Add exports for the new clear-comment utilities.
- `adws/triggers/trigger_webhook.ts` — Webhook server. Import `isClearComment` and add a branch in the `issue_comment` handler to spawn `adwClearComments.tsx`.
- `adws/triggers/webhookHandlers.ts` — Contains extracted handler functions (e.g., `handlePullRequestEvent`). Add `handleClearCommentEvent` here to keep `trigger_webhook.ts` thin and testable.
- `adws/adwClearComments.tsx` — Already-existing script that accepts an issue number and deletes all comments. No changes needed; just invoked by the new handler.
- `adws/__tests__/commentFiltering.test.ts` — Existing tests for `isActionableComment` and related helpers. Add a `describe('isClearComment', ...)` block here.
- `adws/__tests__/triggerCommentHandling.test.ts` — Existing tests for qualifying-issue logic. Add tests for the `## Clear` webhook branching.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed (TypeScript strict mode, single-responsibility, no decorators, pure functions).
- `adws/README.md` — ADW system documentation; consult when working in the `adws/` directory.

### New Files
_No new files required._

## Implementation Plan

### Phase 1: Foundation
Add the `CLEAR_COMMENT_PATTERN` constant and `isClearComment` helper to `workflowCommentsBase.ts`, mirroring the existing `ACTIONABLE_COMMENT_PATTERN` approach. Verify the `i` flag is already present on `ACTIONABLE_COMMENT_PATTERN` (it is: `/^## Take action$/mi`). Export the new identifiers through `workflowComments.ts` and `github/index.ts`.

### Phase 2: Core Implementation
Add `handleClearCommentEvent` to `webhookHandlers.ts`. This function receives the issue number, logs the action, and spawns `adwClearComments.tsx` with the issue number as its sole argument. In `trigger_webhook.ts`, import `isClearComment` from `../github`, then in the `issue_comment` block check for a clear comment **before** checking `isActionableComment`. If detected, call `handleClearCommentEvent` and return `{ status: 'clearing' }`.

### Phase 3: Integration
Add unit tests for `isClearComment` in `commentFiltering.test.ts` and for the webhook branching in `triggerCommentHandling.test.ts`. Run the full test suite, linter, and type checker to confirm zero regressions.

## Step by Step Tasks

### Step 1: Add `isClearComment` to `workflowCommentsBase.ts`
- After the `ACTIONABLE_COMMENT_PATTERN` block, add:
  ```ts
  /** Pattern matching the `## Clear` heading that signals a request to delete all issue comments. */
  export const CLEAR_COMMENT_PATTERN = /^## Clear$/mi;

  /** Returns true if the comment body contains the explicit `## Clear` directive heading. */
  export function isClearComment(commentBody: string): boolean {
    return CLEAR_COMMENT_PATTERN.test(commentBody);
  }
  ```
- No other changes to this file.

### Step 2: Export from `workflowComments.ts`
- In the `export { ... } from './workflowCommentsBase'` block, add `CLEAR_COMMENT_PATTERN` and `isClearComment` to the named exports.

### Step 3: Export from `github/index.ts`
- In the `// Workflow Comments` barrel section, add `CLEAR_COMMENT_PATTERN` and `isClearComment` to the named exports from `'./workflowComments'`.

### Step 4: Add `handleClearCommentEvent` to `webhookHandlers.ts`
- Import `log` from `'../core'` (already imported) and `spawn` / `spawnDetached`-style logic. Since `spawnDetached` is a module-private function in `trigger_webhook.ts`, the handler should simply return the arguments to spawn rather than calling it directly, or duplicate the minimal spawn logic.
- Following the existing pattern, add a simple exported function:
  ```ts
  /**
   * Handles a "## Clear" issue comment event.
   * Spawns adwClearComments.tsx to delete all comments on the issue.
   */
  export function handleClearCommentEvent(issueNumber: number): { status: string; issue: number } {
    log(`Clear comment on issue #${issueNumber}, triggering adwClearComments`);
    return { status: 'clearing', issue: issueNumber };
  }
  ```
- The actual spawning remains in `trigger_webhook.ts` to keep `webhookHandlers.ts` free of `child_process` concerns (it currently only imports from `'../core'` and `'../github'`).

### Step 5: Update the `issue_comment` handler in `trigger_webhook.ts`
- Import `isClearComment` from `'../github'` (add to the existing import line).
- Inside the `issue_comment` block, after resolving `commentBody` and `issueNumber`, add a check **before** the `isActionableComment` check:
  ```ts
  if (isClearComment(commentBody)) {
    log(`Clear directive on issue #${issueNumber}, spawning adwClearComments`);
    spawnDetached('npx', ['tsx', 'adws/adwClearComments.tsx', String(issueNumber)]);
    jsonResponse(res, 200, { status: 'clearing', issue: issueNumber });
    return;
  }
  ```
- No other changes to the server logic.

### Step 6: Add unit tests for `isClearComment` in `commentFiltering.test.ts`
- Import `isClearComment` and `CLEAR_COMMENT_PATTERN` from `'../github/workflowCommentsBase'`.
- Add a `describe('isClearComment', ...)` block covering:
  - Returns `true` for `'## Clear'`
  - Returns `true` for `'## clear'` (case-insensitive)
  - Returns `true` for `'## CLEAR'` (case-insensitive)
  - Returns `true` for a comment with `## Clear` followed by body text
  - Returns `true` for a comment with text before `## Clear`
  - Returns `false` for a plain comment without the directive
  - Returns `false` for an ADW system comment
  - Returns `false` for `'## Clear'` not at the start of a line (inline)
  - Returns `false` for an empty string

### Step 7: Add webhook branching tests in `triggerCommentHandling.test.ts`
- Add a `describe('webhook clear comment handling', ...)` block using the existing `isQualifyingIssue` replication pattern to verify that a `## Clear` comment is **not** treated as a qualifying (actionable) issue comment (i.e., `isActionableComment` returns false for it) — this validates no cross-contamination between the two directives.

### Step 8: Run Validation Commands
- Execute all commands listed in the `Validation Commands` section to confirm zero regressions.

## Testing Strategy

### Unit Tests
- `isClearComment`: at least 9 cases covering truthy (exact, lowercase, uppercase, with body, with prefix), falsy (plain text, ADW comment, inline occurrence, empty string).
- Verify `isActionableComment` returns `false` for `'## Clear'` — the two directives must not overlap.
- Verify `isClearComment` returns `false` for `'## Take action'` — same reason.

### Edge Cases
- `## clear ` (trailing space) — should **not** match (pattern anchors `$` with no trailing content).
- `  ## Clear` (leading spaces on the line) — should **not** match (`^` is multiline, no leading whitespace allowed).
- Multi-line comment where `## Clear` appears mid-body — should match (multiline `m` flag).
- Comment containing both `## Take action` and `## Clear` — `isClearComment` returns true; the webhook handler should fire the clear path because it is checked first.

## Acceptance Criteria
- Posting a comment containing `## Clear` (any capitalisation) on a GitHub issue triggers a webhook event that spawns `adwClearComments.tsx` with the issue number, clearing all comments.
- Posting `## clear` or `## CLEAR` also triggers the clear workflow (case-insensitive).
- `## Take action` comments continue to work exactly as before.
- `## Take action` is matched case-insensitively (already implemented via `/mi` flag; confirmed by existing tests).
- A comment containing both `## Clear` and `## Take action` triggers the clear path, not the action path (clear is checked first).
- All existing unit tests pass with zero modifications.
- `npm run lint`, `npx tsc --noEmit`, `npx tsc --noEmit -p adws/tsconfig.json`, and `npm test` all exit with code 0.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

```bash
# Lint
npm run lint

# Type check (Next.js app)
npx tsc --noEmit

# Type check (adws scripts)
npx tsc --noEmit -p adws/tsconfig.json

# Unit tests
npm test
```

## Notes
- `adwClearComments.tsx` already exists and is fully functional; it only needs to be invoked by the new webhook handler.
- The `ACTIONABLE_COMMENT_PATTERN` already uses the `i` flag (`/^## Take action$/mi`), so the case-insensitive behavior for "## Take action" is already in place — the existing tests in `commentFiltering.test.ts` (lines 116–123) confirm this. No change needed there.
- Keep `webhookHandlers.ts` free of `child_process` imports; the `spawnDetached` helper in `trigger_webhook.ts` is the right place to call `spawn`.
- Follow the coding guidelines: no decorators, strict TypeScript types, single responsibility per function, files under 300 lines.
