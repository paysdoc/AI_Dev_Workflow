# Bug: clearComments deletes comments of another issue / wrong repo

## Metadata
issueNumber: `33`
adwId: `clearcomments-delete-4ran6d`
issueJson: `{"number":33,"title":"clearComments deletes comments of another issue","body":"clearComments deletes comments of a different issue - possibly in a different repo. \n\nInstead of only logging the issue number being deleted, also log the issue title and the first 10 characters of the comment.\n\nEnsure that ALL ADWs are aware of the repo they should operate in. Currently it still looks like some ","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-26T12:56:38Z","comments":[],"actionableComment":null}`

## Bug Description
The `clearIssueComments` function in `adws/adwClearComments.tsx` does not accept or propagate repository context (`repoInfo`). When called from triggers (webhook and cron), it falls back to `getRepoInfo()` which reads the git remote of the **current working directory** — not necessarily the target repository where the issue lives.

**Symptoms:**
- Comments from the wrong repository's issue are fetched and deleted
- Log messages only show the issue number being deleted, with no issue title or comment preview, making it impossible to verify correct operation

**Expected behavior:**
- `clearIssueComments` should operate on the correct repository specified by the caller
- Log messages should include the issue title and a preview of each comment being deleted (first 10 characters)

**Actual behavior:**
- `clearIssueComments` always uses `getRepoInfo()` (local git remote) regardless of which repo the issue belongs to
- Log messages only show issue number, not title or comment content

## Problem Statement
1. `clearIssueComments()` does not accept a `repoInfo` parameter and therefore cannot target external repositories
2. Neither `fetchIssueCommentsRest()` nor `deleteIssueComment()` receive `repoInfo` from `clearIssueComments`, so they default to the local repo
3. Both triggers (`trigger_webhook.ts` and `trigger_cron.ts`) call `clearIssueComments(issueNumber)` without passing repo context, even though the webhook has repo info available in its payload and the cron trigger has it cached in `repoInfo`
4. Deletion logs are insufficient — they only show the comment ID, not the issue title or comment content

## Solution Statement
1. Add an optional `repoInfo?: RepoInfo` parameter to `clearIssueComments()` and pass it through to `fetchIssueCommentsRest()` and `deleteIssueComment()`
2. Enhance logging in `clearIssueComments` to include the issue title (fetched via `fetchGitHubIssue`) and the first 10 characters of each comment body being deleted
3. Update `trigger_webhook.ts` to extract `repoInfo` from the webhook payload and pass it to `clearIssueComments()`
4. Update `trigger_cron.ts` to pass its cached `repoInfo` to `clearIssueComments()`
5. Update all existing tests to validate repo context propagation

## Steps to Reproduce
1. Set up ADW with a webhook or cron trigger pointed at a different repository than the one ADW is installed in
2. Create an issue in the target repository with some comments
3. Post a `## Clear` comment on the issue
4. Observe that `clearIssueComments` uses `getRepoInfo()` (the ADW repo) instead of the target repo
5. Comments from the wrong repo's issue are fetched/deleted (or an error occurs if the issue number doesn't exist there)

## Root Cause Analysis
The root cause is in `adws/adwClearComments.tsx:54`:

```typescript
export function clearIssueComments(issueNumber: number): ClearCommentsResult {
  const comments = fetchIssueCommentsRest(issueNumber);
  // ...
  deleteIssueComment(comment.id);
```

Both `fetchIssueCommentsRest` and `deleteIssueComment` accept an optional `repoInfo` parameter (see `adws/github/issueApi.ts:228,252`), but `clearIssueComments` does not accept or forward this parameter. When omitted, both functions call `getRepoInfo()` which reads the local git remote — potentially a different repo entirely.

The callers in triggers also don't pass repo context:
- `trigger_webhook.ts:226`: `clearIssueComments(issueNumber)` — webhook payload has repo info via `extractTargetRepoArgs()` but a `RepoInfo` object is not extracted
- `trigger_cron.ts:103`: `clearIssueComments(issue.number)` — cron has `repoInfo` cached at module scope but doesn't pass it

## Relevant Files
Use these files to fix the bug:

- `adws/adwClearComments.tsx` — The `clearIssueComments` function that needs to accept and propagate `repoInfo`, and needs enhanced logging with issue title + comment preview
- `adws/github/issueApi.ts` — Contains `fetchIssueCommentsRest` and `deleteIssueComment` which already accept optional `repoInfo`; also contains `fetchGitHubIssue` needed for fetching the issue title
- `adws/github/githubApi.ts` — Contains `RepoInfo` type, `getRepoInfo()`, and `getRepoInfoFromPayload()` utility
- `adws/triggers/trigger_webhook.ts` — Calls `clearIssueComments` without repo context; needs to extract `RepoInfo` from webhook payload and pass it
- `adws/triggers/trigger_cron.ts` — Calls `clearIssueComments` without repo context; has `repoInfo` cached but doesn't pass it
- `adws/__tests__/clearComments.test.ts` — Unit tests for `clearIssueComments` that need updating for `repoInfo` propagation and new logging behavior
- `adws/__tests__/webhookClearComment.test.ts` — Integration tests for webhook clear-comment handling that need updating for `repoInfo` propagation
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Update `clearIssueComments` signature and implementation in `adws/adwClearComments.tsx`

- Add `repoInfo?: RepoInfo` parameter to `clearIssueComments(issueNumber: number, repoInfo?: RepoInfo)`
- Import `RepoInfo` from `./github` and `fetchGitHubIssue` from `./github`
- Pass `repoInfo` to `fetchIssueCommentsRest(issueNumber, repoInfo)`
- Pass `repoInfo` to `deleteIssueComment(comment.id, repoInfo)`
- Before the deletion loop, fetch the issue to get the title: call `fetchGitHubIssue(issueNumber, repoInfo)` (this is async, so either make `clearIssueComments` async or use `execSync` approach via `getIssueState`-like pattern). Since the callers already handle the sync nature, we should keep it synchronous by using a lightweight approach: use `execSync` with `gh issue view` to get the title, similar to how `getIssueState` works in `issueApi.ts`. Alternatively, add a new sync helper `getIssueTitle(issueNumber, repoInfo)` in `issueApi.ts`.
- Actually, the simplest approach: add a small sync function `getIssueTitleSync(issueNumber: number, repoInfo?: RepoInfo): string` in `issueApi.ts` that fetches just the title via `gh issue view --json title`.
- In the `clearIssueComments` function, fetch the issue title and log it: `log(\`Found ${comments.length} comment(s) on issue #${issueNumber} ("${issueTitle}")\`, 'info')`
- In the deletion loop, log the first 10 characters of each comment body: `log(\`Deleting comment ${comment.id}: "${comment.body.substring(0, 10)}..."\`, 'info')` before calling `deleteIssueComment`
- Update the CLI `main()` function to also accept an optional `--repo owner/repo` argument and parse it into `RepoInfo` to pass to `clearIssueComments`

### 2. Add `getIssueTitleSync` helper in `adws/github/issueApi.ts`

- Add a new exported sync function `getIssueTitleSync(issueNumber: number, repoInfo?: RepoInfo): string` that:
  - Resolves `repoInfo` with `getRepoInfo()` fallback (same pattern as other functions)
  - Runs `gh issue view ${issueNumber} --repo ${owner}/${repo} --json title`
  - Parses and returns the title string
  - Returns `'(unknown)'` on error (non-throwing, since this is supplementary logging)
- Export the function from `githubApi.ts` re-exports

### 3. Update `trigger_webhook.ts` to pass `repoInfo` to `clearIssueComments`

- In the `issue_comment` handler, before calling `clearIssueComments`, extract `RepoInfo` from the webhook payload's `repository.full_name` field using `getRepoInfoFromPayload()`
- Import `getRepoInfoFromPayload` from `../github/githubApi`
- Pass the extracted `repoInfo` to `clearIssueComments(issueNumber, repoInfo)`
- The extraction logic should be: `const repository = body.repository as Record<string, unknown> | undefined; const repoFullName = repository?.full_name as string | undefined;` and then `const repoInfo = repoFullName ? getRepoInfoFromPayload(repoFullName) : undefined;`

### 4. Update `trigger_cron.ts` to pass `repoInfo` to `clearIssueComments`

- Pass the module-scoped `repoInfo` constant to `clearIssueComments(issue.number, repoInfo)` at line 103

### 5. Update unit tests in `adws/__tests__/clearComments.test.ts`

- Update `clearIssueComments` tests to verify `repoInfo` is propagated:
  - Add a test that passes `repoInfo` and verifies the correct repo is used in API calls (no `getRepoInfo()` call from git remote)
  - Update existing tests to account for the new `getIssueTitleSync` call (one additional `execSync` mock per `clearIssueComments` invocation for the title fetch)
  - Add a test verifying log output includes issue title and comment body preview

### 6. Update integration tests in `adws/__tests__/webhookClearComment.test.ts`

- Update the `handleIssueComment` helper to accept and pass `repoInfo` parameter
- Add test cases verifying that webhook payload repo info is correctly propagated
- Update existing mock setups to account for the additional `getIssueTitleSync` exec call

### 7. Run Validation Commands

- Run all validation commands listed below to verify the fix with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the Next.js application
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `npm test` — Run all tests to validate the bug is fixed with zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` coding guidelines must be strictly followed: use explicit types, avoid `any`, isolate side effects, and write unit tests.
- The `fetchIssueCommentsRest` and `deleteIssueComment` functions in `issueApi.ts` already accept optional `repoInfo` — this fix is about propagating that parameter from the callers through `clearIssueComments`.
- The `getRepoInfoFromPayload` utility in `githubApi.ts` already exists and parses `owner/repo` strings — reuse it in the webhook trigger.
- Keep `clearIssueComments` synchronous to match the current calling pattern in both triggers.
- The `getIssueTitleSync` helper should be non-throwing to avoid breaking the clear flow when the title fetch fails (e.g., network error). Log the issue title when available, fall back to `'(unknown)'`.
