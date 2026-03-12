# Bug: PR review workflow endless loop due to unmatched ADW commit patterns

## Metadata
issueNumber: `134`
adwId: `1773310400641-1xl08g`
issueJson: `{"number":134,"title":"PR 133 in an endless loop","body":"PR [#133](https://github.com/paysdoc/AI_Dev_Workflow/pull/133) seems to be in an endless PR review loop where the same review comment is litigated over and over again.\n\nFind and fix the cause of this loop. \n\nImportant: Be careful when assessing the PR. It has hundreds of comments leading to a huge context. A small portion of it should be enough to understand what is going on. ","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T10:13:02Z","comments":[],"actionableComment":null}`

## Bug Description
PR #133 (and its predecessor PR #132) entered an endless PR review loop where the system repeatedly spawned new PR review workflows to address the same review comment ("resolve conflicts"). PR #132 accumulated ~100+ issue-level workflow comments from ~55 separate PR review instances, all attempting to address a single human review comment.

**Expected behavior:** After the PR review workflow commits code changes addressing a review comment, subsequent trigger invocations should recognize that the comment has been addressed and skip further review cycles.

**Actual behavior:** Every time the PR review workflow is triggered (via webhook cooldown expiry or cron poll), `getUnaddressedComments()` returns the same comment as unaddressed because `getLastAdwCommitTimestamp()` fails to recognize ADW commits on the branch, returning `null`. When `null` is returned, ALL human comments are treated as unaddressed, causing another full review cycle.

## Problem Statement
The `getLastAdwCommitTimestamp()` function in `adws/github/prCommentDetector.ts` uses hardcoded regex patterns to identify ADW commits (e.g., `/feat: implement #/`, `/feat: address PR review/`). These patterns do not account for the actual ADW commit message format, which is `<agentName>: <issueClass>: <message>` (e.g., `pr-review-orchestrator: feat: update error handling`). Because the patterns expect specific LLM-generated wording in the message portion (like "implement #" or "address PR review"), they fail to match commits where the LLM chose different wording. When no ADW commit is found, `getUnaddressedComments()` treats ALL human comments as unaddressed, triggering another review cycle — creating an endless loop.

## Solution Statement
Replace the hardcoded content-specific regex patterns in `getLastAdwCommitTimestamp()` with a single structural pattern that matches the universal ADW commit format: `<agentName>: <issueClass>: <message>`. The ADW commit format always starts with an agent/orchestrator name, followed by a colon-space, then an issue type, followed by another colon-space, then the message. This double-prefix structure is distinctive to ADW (normal developer commits use a single prefix like `feat: message`). Using the pattern `/^[\w\/-]+: \w+: /` reliably matches all ADW commits regardless of the LLM-generated message content.

## Steps to Reproduce
1. Create a PR with code changes made by ADW (commits follow `<agentName>: <type>: <message>` format)
2. Post a review comment on the PR (e.g., "resolve conflicts")
3. Trigger the PR review workflow via webhook or cron
4. The workflow runs, makes changes, and commits with a message like `pr-review-orchestrator: feat: resolve merge conflicts`
5. After cooldown/cron restart, the system re-triggers the PR review workflow
6. `getLastAdwCommitTimestamp()` returns `null` because the commit message doesn't match the hardcoded patterns
7. `getUnaddressedComments()` returns the original comment as unaddressed
8. The cycle repeats endlessly

## Root Cause Analysis
The root cause is in `adws/github/prCommentDetector.ts`, function `getLastAdwCommitTimestamp()` (lines 19-61).

The function scans git log output looking for ADW commits using these hardcoded patterns:
```typescript
const adwPatterns = [
  /feat: implement #/,
  /fix: implement #/,
  /chore: implement #/,
  /feat: address PR review/,
  /fix: address PR review/,
  /chore: address PR review/,
  /feat: add implementation plan for #/,
  /fix: add implementation plan for #/,
  /chore: add implementation plan for #/,
];
```

These patterns are flawed for two reasons:

1. **Missing agent name prefix**: ADW commits always include an agent name prefix (e.g., `pr-review-orchestrator: feat: ...`). While the regex does a substring match (so `feat: implement #` would match inside `agent: feat: implement #123`), the patterns still require specific wording in the message portion.

2. **LLM-generated message content is unpredictable**: The `/commit` slash command instructs the LLM to generate a commit message, so the wording varies. A PR review commit might be `pr-review-orchestrator: feat: resolve merge conflicts` or `pr-review-orchestrator: feat: update component per review feedback` — neither contains "address PR review" or "implement #".

3. **Missing issue type prefixes**: The patterns only check `feat:`, `fix:`, `chore:` but the `commitPrefixMap` in `issueTypes.ts` also defines `review:` (for `/pr_review`) and `adwinit:` (for `/adw_init`), which are never matched.

When none of the patterns match, the function returns `null`, and `getUnaddressedComments()` (line 85-88) treats all human comments as unaddressed, triggering the endless loop.

## Relevant Files
Use these files to fix the bug:

- `adws/github/prCommentDetector.ts` — Contains `getLastAdwCommitTimestamp()` with the broken regex patterns (primary fix location) and `getUnaddressedComments()` which uses it
- `adws/github/__tests__/prCommentDetector.test.ts` — Existing tests for prCommentDetector; needs new tests for the pattern matching logic
- `adws/types/issueTypes.ts` — Contains `commitPrefixMap` defining the valid issue type prefixes used in ADW commits (reference for understanding valid commit formats)
- `adws/core/constants.ts` — Contains `OrchestratorId` defining all valid orchestrator/agent name prefixes (reference)
- `.claude/commands/commit.md` — Defines the commit message format `<agentName>: <issueClass>: <commit message>` (reference)
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read reference files to understand commit format and valid values
- Read `adws/types/issueTypes.ts` to understand the `commitPrefixMap` and valid issue type values
- Read `adws/core/constants.ts` to understand the `OrchestratorId` values (valid agent name prefixes)
- Read `.claude/commands/commit.md` to confirm the commit message format template
- Read `guidelines/coding_guidelines.md` to follow coding conventions

### 2. Fix `getLastAdwCommitTimestamp()` in `adws/github/prCommentDetector.ts`
- Replace the hardcoded `adwPatterns` array (lines 29-42) with a single structural regex pattern that matches the universal ADW commit format
- The new pattern should be: `/^[\w\/-]+: \w+: /` — this matches `<agentName>: <issueClass>: ` at the start of the commit message
  - `[\w\/-]+` matches agent names like `pr-review-orchestrator`, `/feature`, `build-agent`, `sdlc_planner`
  - `\w+` matches issue type prefixes like `feat`, `fix`, `chore`, `bug`, `review`, `adwinit`
  - The double colon-space structure is distinctive to ADW commits (normal commits use single prefix like `feat: message`)
- Update the pattern matching check on line 51 to use the new single pattern instead of iterating over `adwPatterns`
- Update the JSDoc comment to reflect the new matching strategy

### 3. Update tests in `adws/github/__tests__/prCommentDetector.test.ts`
- Add a new `describe` block for `getLastAdwCommitTimestamp` pattern matching
- Add test cases that verify the new pattern matches all ADW commit formats:
  - `pr-review-orchestrator: feat: resolve merge conflicts` (PR review commit)
  - `build-agent: fix: update error handling` (build agent commit)
  - `/feature: feat: add provider config` (slash-prefixed agent name)
  - `sdlc_planner: chore: update dependencies` (underscore agent name)
  - `document-agent: feat: update docs` (document agent commit)
  - `review-agent: review: address feedback` (review prefix)
  - `plan-orchestrator: adwinit: initialize project` (adwinit prefix)
- Add test cases that verify normal developer commits are NOT matched:
  - `feat: add new feature` (single prefix — not ADW)
  - `fix: resolve bug` (single prefix — not ADW)
  - `Merge branch 'main'` (merge commit)
  - `Update README.md` (plain message)
  - `Initial commit` (plain message)
- Add test that verifies `getLastAdwCommitTimestamp` returns the correct timestamp when an ADW commit is found with the new pattern
- Add test that verifies `getLastAdwCommitTimestamp` returns `null` when only non-ADW commits exist
- Add test for `getUnaddressedComments` that verifies comments posted before an ADW commit are NOT returned as unaddressed

### 4. Run validation commands
- Run all validation commands listed below to ensure the fix works correctly with zero regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check adws project
- `bun run test` - Run all tests to validate the fix with zero regressions

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The fix is intentionally surgical — it targets only the commit pattern matching logic in `getLastAdwCommitTimestamp()`. While there are secondary contributing factors (no concurrency control for PR review triggers, ephemeral cooldown state), those are separate concerns that don't cause the endless loop on their own. Fixing the pattern matching ensures that once an ADW commit is made, subsequent triggers correctly see the comment as addressed.
- The structural pattern `^[\w\/-]+: \w+: ` is preferred over listing known agent names because it's forward-compatible — new agents/orchestrators added in the future will automatically be recognized without updating the pattern.
- The `commitPrefixMap` in `issueTypes.ts` defines `review:` and `adwinit:` prefixes that were never included in the old patterns, meaning PR review commits with `/pr_review` issue type and init commits were always invisible to the detector.
