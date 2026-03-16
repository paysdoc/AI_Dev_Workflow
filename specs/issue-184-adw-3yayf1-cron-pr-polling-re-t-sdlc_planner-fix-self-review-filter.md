# Bug: Cron PR polling re-triggers adwPrReview on ADW's own review comments

## Metadata
issueNumber: `184`
adwId: `3yayf1-cron-pr-polling-re-t`
issueJson: `{"number":184,"title":"Cron PR polling re-triggers adwPrReview on ADW's own review comments","body":"## Bug\n\nThe cron trigger's `checkPRsForReviewComments()` falsely detects ADW's own review submissions as unaddressed human feedback, causing `adwPrReview` to re-trigger on PRs that have no actual human review comments.\n\n## Root Cause\n\n`fetchPRReviews()` in `prApi.ts` fetches all PR review submissions from `pulls/{pr}/reviews`. The bot filter in `prCommentDetector.ts:62` relies on `user.type === 'Bot'` to exclude non-human comments. However, ADW's review agent submits reviews via `gh` CLI authenticated as the user's personal GitHub account (`gh auth login`), so these reviews have `user.type === 'User'` and pass the bot filter as \"human\" comments.\n\nThe timeline-based check in `getUnaddressedComments()` then compares review timestamps against the last ADW commit. Since the review is typically submitted *after* the final ADW commit, it's classified as \"unaddressed\" — triggering `adwPrReview` on every cron cycle (or on every cron restart, since `processedPRs` is in-memory only).\n\n## Reproduction\n\n1. Let ADW complete a full workflow (plan → build → review) on a PR\n2. Ensure no human review comments exist on the PR\n3. Start the cron trigger (`bunx tsx adws/triggers/trigger_cron.ts`)\n4. Observe that `adwPrReview` is spawned for the PR despite no human feedback\n\n## Expected Behavior\n\nADW's own review submissions should not be treated as unaddressed human feedback. The cron should only trigger `adwPrReview` when there are genuine human review comments that ADW has not yet addressed.\n\n## Affected Files\n\n- `adws/github/prCommentDetector.ts` — `getUnaddressedComments()` bot filter\n- `adws/github/prApi.ts` — `fetchPRReviews()` inclusion criteria\n- `adws/triggers/trigger_cron.ts` — `checkPRsForReviewComments()` polling loop","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T08:29:39Z","comments":[],"actionableComment":null}`

## Bug Description
The cron trigger's `checkPRsForReviewComments()` falsely detects ADW's own review submissions as unaddressed human feedback, causing `adwPrReview` to re-trigger on PRs that have no actual human review comments.

**Symptoms:**
- `adwPrReview` is spawned for PRs despite no human feedback
- This happens on every cron cycle or on every cron restart (since `processedPRs` is in-memory only)
- ADW enters an infinite feedback loop addressing its own reviews

**Expected behavior:** ADW's own review submissions should be excluded from the unaddressed comment detection. The cron should only trigger `adwPrReview` when genuine human review comments exist that ADW has not yet addressed.

## Problem Statement
The bot filter in `prCommentDetector.ts:62` relies solely on `user.type === 'Bot'` to exclude non-human comments. ADW submits reviews via `gh` CLI authenticated as the user's personal GitHub account (`gh auth login`), so these reviews have `user.type === 'User'` and pass the bot filter as "human" comments. The timeline-based check then classifies them as "unaddressed" since they're submitted after the last ADW commit.

## Solution Statement
Enhance the bot/self-review filter in `getUnaddressedComments()` with two additional detection mechanisms:

1. **Authenticated user filter**: Get the current `gh` authenticated username and exclude reviews from that user. Since ADW runs under the user's personal account, all ADW-submitted reviews come from that user. Self-reviews (the user reviewing their own PR) are also excluded, which is correct — the user doesn't need ADW to respond to their own comments.

2. **ADW body signature filter**: Exclude comments whose body matches the existing `isAdwComment()` pattern (checks for `<!-- adw-bot -->` marker and ADW heading patterns). This catches any ADW workflow comments that might appear in the review endpoints.

The combination provides comprehensive coverage:
- GitHub Bot accounts → caught by existing `isBot` check
- Claude Code-submitted reviews (via `gh pr review`) → caught by authenticated user check
- ADW workflow comments → caught by `isAdwComment()` body check
- Genuine reviews from other collaborators → not filtered (correct)

## Steps to Reproduce
1. Let ADW complete a full workflow (plan → build → review) on a PR
2. Ensure no human review comments exist on the PR
3. Start the cron trigger (`bunx tsx adws/triggers/trigger_cron.ts`)
4. Observe that `adwPrReview` is spawned for the PR despite no human feedback

## Root Cause Analysis
The root cause is a two-part filter gap in `prCommentDetector.ts:getUnaddressedComments()`:

1. **Insufficient bot detection (`prCommentDetector.ts:62`)**: The filter `comments.filter(c => !c.author.isBot)` only checks the `isBot` field, which is derived from `user.type === 'Bot'` in `prApi.ts`. GitHub's `user.type` is `'Bot'` only for GitHub App bot accounts. When ADW submits reviews via `gh` CLI authenticated as the user's personal account, `user.type` is `'User'`, so these reviews pass the filter.

2. **Timeline comparison creates false positives**: `getUnaddressedComments()` treats all comments posted after the last ADW commit as "unaddressed". ADW's own review is typically submitted *after* the final commit (the review happens post-build), so it's always classified as unaddressed — triggering `adwPrReview` on every cron cycle.

The `processedPRs` in-memory set in `trigger_cron.ts` masks this during a single cron session (once processed, the PR is skipped), but on restart the set is empty and the false positive recurs.

## Relevant Files
Use these files to fix the bug:

- `adws/github/githubApi.ts` — Add the `getAuthenticatedUser()` cached helper function here, alongside existing GitHub utility functions (`getRepoInfo`, etc.). Re-export it from the barrel.
- `adws/github/prCommentDetector.ts` — The primary fix location. `getUnaddressedComments()` at line 62 needs an enhanced filter that checks authenticated user login and ADW body signatures in addition to `isBot`.
- `adws/github/index.ts` — Add `getAuthenticatedUser` to the re-exports from `githubApi`.
- `adws/core/workflowCommentParsing.ts` — Contains `isAdwComment()` which will be imported into `prCommentDetector.ts` for body-based detection. Read-only reference.
- `adws/github/prApi.ts` — Contains `fetchPRReviews()` and `fetchPRReviewComments()` where `isBot` is set. Read-only reference for understanding the data flow.
- `adws/triggers/trigger_cron.ts` — Contains `checkPRsForReviewComments()`. No changes needed; the fix in `prCommentDetector.ts` propagates through `hasUnaddressedComments()`.
- `guidelines/coding_guidelines.md` — Read and follow these coding guidelines during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read guidelines and reference files
- Read `guidelines/coding_guidelines.md` to ensure all changes follow the project coding standards.
- Read `adws/github/githubApi.ts` to understand the existing GitHub utility pattern.
- Read `adws/github/prCommentDetector.ts` to understand the current bot filter implementation.
- Read `adws/core/workflowCommentParsing.ts` to understand `isAdwComment()` and its exports.
- Read `adws/github/prApi.ts` to understand how `isBot` is set in `fetchPRReviews()` and `fetchPRReviewComments()`.
- Read `adws/github/index.ts` to understand the barrel export structure.

### 2. Add `getAuthenticatedUser()` to `githubApi.ts`
- Add a module-level cached variable `let cachedAuthenticatedUser: string | null | undefined = undefined;` (where `undefined` means "not yet fetched", `null` means "fetch failed").
- Add a function `getAuthenticatedUser(): string | null` that:
  - Returns the cached value if already fetched (`!== undefined`).
  - Runs `gh api user --jq .login` via `execSync` to get the current authenticated username.
  - Caches the result (username string on success, `null` on failure).
  - Catches errors, logs a warning, and returns `null` on failure (graceful degradation).
- Export `getAuthenticatedUser` from `githubApi.ts`.

### 3. Re-export `getAuthenticatedUser` from barrel files
- Add `getAuthenticatedUser` to the re-export list in `adws/github/index.ts` (in the `githubApi` re-export block).

### 4. Enhance the bot filter in `getUnaddressedComments()`
- In `adws/github/prCommentDetector.ts`:
  - Add imports: `getAuthenticatedUser` from `./githubApi` and `isAdwComment` from `../core/workflowCommentParsing`.
  - Replace the existing bot filter at line 62:
    ```ts
    const humanComments = comments.filter(c => !c.author.isBot);
    ```
    With an enhanced filter that also excludes self-reviews and ADW-signed comments:
    ```ts
    const authenticatedUser = getAuthenticatedUser();
    const humanComments = comments.filter(c => {
      if (c.author.isBot) return false;
      if (authenticatedUser && c.author.login === authenticatedUser) return false;
      if (isAdwComment(c.body)) return false;
      return true;
    });
    ```
  - Update the log message to reflect the enhanced filter:
    ```ts
    log(`Found ${humanComments.length} human comments (filtered ${comments.length - humanComments.length} bot/self/ADW comments)`);
    ```

### 5. Run validation commands to confirm the fix
- Run all validation commands listed in the `Validation Commands` section below.
- Ensure zero type errors, zero lint errors, and all tests pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsc --noEmit` - Type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type-check the adws subproject
- `bun run lint` - Run linter to check for code quality issues
- `bun run test` - Run tests to validate the bug is fixed with zero regressions

## Notes
- **No changes to `prApi.ts`**: The `isBot` field semantics are preserved as-is (reflecting GitHub's `user.type`). The enhanced filter is applied at the decision point in `prCommentDetector.ts` rather than the data layer, avoiding unintended side effects for other consumers of `fetchPRReviews()`.
- **No changes to `trigger_cron.ts`**: The in-memory `processedPRs` set is a secondary concern. Once the bot filter correctly excludes ADW reviews, re-checking PRs on cron restart will correctly find zero unaddressed comments and skip them.
- **Graceful degradation**: If `getAuthenticatedUser()` fails (no network, `gh` not authenticated), the filter falls back to the existing `isBot`-only behavior. The `isAdwComment()` body check still provides partial coverage.
- **Self-review filtering is intentional**: Filtering out reviews from the authenticated user also excludes manual self-reviews. This is correct behavior — if the user reviews their own PR, ADW should not auto-respond to those comments.
- **Coding guidelines**: Follow `guidelines/coding_guidelines.md` strictly — use declarative filters (map/filter), prefer pure functions, maintain type safety, keep files under 300 lines.
