# ADW Known Runtime Issues Registry

Machine-readable registry of known runtime error patterns observed in ADW cron/webhook logs.
Used by the ADW notification agent to classify errors as known vs. novel.

## Schema

Each entry contains:
- **slug**: unique identifier for the issue class
- **pattern**: string(s) to match in log output
- **description**: what the error means
- **status**: `solved` | `mitigated` | `open`
- **solution**: what fix was applied (if any)
- **fix_attempts**: number of times a fix has been attempted
- **linked_issues**: GitHub issue/PR numbers related to this problem
- **first_seen**: approximate date first observed
- **sample_log**: representative log excerpt (max 5 lines)

---

## rate-limit-crash

- **pattern**: `You've hit your limit`, `You're out of extra usage`
- **description**: Claude API rate limit kills the agent mid-execution. Workflow crashes with ❌ ADW Workflow Error instead of pausing.
- **status**: solved
- **solution**: Rate limit detection in `agentProcessHandler.ts` returns `rateLimited: true`. `runPhase()` catches `RateLimitError` and calls `handleRateLimitPause()` which writes to pause queue, posts ⏸️ comment, and exits cleanly. Cron trigger probes and resumes automatically.
- **fix_attempts**: 2
- **linked_issues**: #314
- **first_seen**: 2026-03
- **sample_log**:
  ```
  ❌ [2026-03-25T13:20:10.500Z] [l9w3wm-extend-compaction-re] Document error: You've hit your limit
  ❌ [2026-03-25T13:20:17.088Z] [l9w3wm-extend-compaction-re] sdlc-orchestrator workflow failed: Error: Document Agent failed
  ```

## overloaded-error

- **pattern**: `"overloaded_error"` (requires `"type":"error"` in same chunk)
- **description**: Claude API returns HTTP 529 Overloaded. Workflow crashes.
- **status**: solved
- **solution**: Added `overloaded_error` to rate limit detection patterns in `agentProcessHandler.ts`. Triggers same pause/resume flow as rate limits. Detection requires `"type":"error"` JSON prefix to avoid false positives from commit messages or code content.
- **fix_attempts**: 2
- **linked_issues**: #314
- **first_seen**: 2026-03-27
- **sample_log**:
  ```
  ❌ [2026-03-27T09:45:31.182Z] [wuzgen-deploy-cost-api-work] plan-build-orchestrator workflow failed: Error: Plan Agent failed:
  API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded. https://docs.claude.com/en/api/errors"}}
  ```

## api-502-bad-gateway

- **pattern**: `502 Bad Gateway` (requires `"type":"error"` in same chunk)
- **description**: Cloudflare returns 502 during Claude API call. Transient infrastructure outage.
- **status**: solved
- **solution**: Added to rate limit detection with `"type":"error"` guard. Triggers pause/resume flow.
- **fix_attempts**: 1
- **linked_issues**: #314
- **first_seen**: 2026-03
- **sample_log**:
  ```
  ❌ [2026-03-25T14:00:33.480Z] [043c4n-create-implement-tdd] sdlc-orchestrator workflow failed: Error: Build Agent failed:
  Failed to authenticate. API Error: 401 <html><head><title>502 Bad Gateway</title></head>
  <body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html>
  ```

## invalid-auth-credentials

- **pattern**: `"Invalid authentication credentials"` (requires `"type":"error"` in same chunk)
- **description**: Claude API returns 401 with invalid credentials (distinct from expired OAuth). Transient auth failure.
- **status**: solved
- **solution**: Added to rate limit detection with `"type":"error"` guard. Triggers pause/resume flow.
- **fix_attempts**: 1
- **linked_issues**: #314
- **first_seen**: 2026-03
- **sample_log**:
  ```
  ❌ [2026-03-25T06:39:59.424Z] [a1vf0g-single-pass-alignmen] sdlc-orchestrator workflow failed: Error: Resolution agent
  returned invalid result. Expected JSON with 'resolved' boolean. Got: Failed to authenticate.
  API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}
  ```

## oauth-token-expired

- **pattern**: `authentication_error`, `OAuth token has expired`
- **description**: Claude CLI OAuth token expires mid-session. Agent retries fail.
- **status**: solved
- **solution**: `agentProcessHandler.ts` detects auth errors and kills process immediately. `claudeAgent.ts` checks `claude auth status`, retries once if auth is valid.
- **fix_attempts**: 1
- **linked_issues**: #213
- **first_seen**: 2026-03
- **sample_log**:
  ```
  ❌ [2026-03-22T10:15:32.100Z] [o9el5x-plan-file-not-saved] Plan error: Failed to authenticate.
  API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}
  ```

## rate-limit-false-positive

- **pattern**: `RateLimitError` thrown but no actual rate limit (e.g., commit message containing detection keywords)
- **description**: Rate limit detection matched against agent tool output (git log, code content) rather than actual API errors. Caused by overly broad string matching.
- **status**: solved
- **solution**: Detection patterns for `overloaded_error`, `502 Bad Gateway`, and `Invalid authentication credentials` now require `"type":"error"` JSON prefix in the same stdout chunk. Prevents matching commit messages or code content.
- **fix_attempts**: 1
- **linked_issues**: none
- **first_seen**: 2026-03-30
- **sample_log**:
  ```
  ⚠️ [2026-03-30T07:12:04.843Z] [swn3ci-fix-missing-d1-cost] Plan terminated due to rate limit / API outage
  ❌ [2026-03-30T07:12:04.843Z] [swn3ci-fix-missing-d1-cost] init-orchestrator workflow failed: RateLimitError: Rate limit detected during phase: Pull Request
  (false positive triggered by git log containing commit message "fix: detect 529 overloaded_error as rate limit trigger")
  ```

## rate-limit-not-pausing

- **pattern**: `RateLimitError` thrown but `❌ ADW Workflow Error` posted instead of `⏸️ Paused`
- **description**: `handleRateLimitPause()` calls `process.exit(0)` but Node.js exit is async — `throw err` in `runPhase()` executes before process dies, propagating to orchestrator's generic catch block which calls `handleWorkflowError()`.
- **status**: solved
- **solution**: `runPhase()` in `phaseRunner.ts` now returns `undefined as never` after calling `handleRateLimitPause()`, preventing the throw from reaching the orchestrator's catch block.
- **fix_attempts**: 1
- **linked_issues**: none
- **first_seen**: 2026-03-30
- **sample_log**:
  ```
  ⚠️ [2026-03-30T08:35:57.360Z] [lk7gc0-1774859497862] Plan terminated due to rate limit / API outage
  ✅ [2026-03-30T08:35:58.524Z] [lk7gc0-1774859497862] Commented on issue #347
  ❌ [2026-03-30T08:35:59.909Z] [lk7gc0-1774859497862] sdlc-orchestrator workflow failed: RateLimitError: Rate limit detected during phase: Plan
  (posted ❌ ADW Workflow Error instead of ⏸️ Paused)
  ```

## claude-cli-enoent

- **pattern**: `spawn /Users/martin/.local/bin/claude ENOENT`, `spawn claude ENOENT`
- **description**: Claude CLI binary not found at spawn time. Typically caused by Claude auto-update replacing the symlink target. The old version directory is deleted before the new symlink is written.
- **status**: mitigated
- **solution**: Retry upgraded to 3 attempts with exponential backoff (500ms → 1s → 2s). Path is re-resolved on every attempt via `clearClaudeCodePathCache()` to pick up new symlink target. Pre-flight CLI validation added at workflow start.
- **fix_attempts**: 1
- **linked_issues**: #315
- **first_seen**: 2026-03
- **sample_log**:
  ```
  ❌ [2026-03-25T13:20:10.500Z] [l9w3wm-extend-compaction-re] Document error: spawn /Users/martin/.local/bin/claude ENOENT
  ⚠️ [2026-03-25T13:20:10.500Z] [l9w3wm-extend-compaction-re] Claude CLI not found at /Users/martin/.local/bin/claude, retrying after re-resolving path...
  ❌ [2026-03-25T13:20:11.502Z] [l9w3wm-extend-compaction-re] Document error: spawn /Users/martin/.local/bin/claude ENOENT
  ❌ [2026-03-25T13:20:17.088Z] [l9w3wm-extend-compaction-re] sdlc-orchestrator workflow failed: Error: Document Agent failed: spawn /Users/martin/.local/bin/claude ENOENT
  ```

## enoent-commit-message-leak

- **pattern**: `Commit message:` followed by `spawn` or `ENOENT` error strings (e.g., `Commit message: review-agent: feat: spawn /Users/martin/.local/bin/claude ENOENT`)
- **description**: When the commit agent fails (ENOENT or other spawn error), the error string flows through `extractCommitMessageFromOutput` and `validateCommitMessage` unchecked, resulting in a garbage commit with the error text as the message.
- **status**: `solved`
- **solution**: Added `result.success` guard in `runCommitAgent` (`agents/gitAgent.ts`). If `result.success` is `false`, throws `Error("Commit agent '<name>' failed: <output excerpt>")` instead of extracting a commit message from error output.
- **fix_attempts**: 1
- **linked_issues**: #377
- **first_seen**: 2026-04
- **sample_log**:
  ```
  ✅ [2026-04-01T10:12:33.000Z] [abc123-fix-issue] Commit message: review-agent: feat: spawn /Users/martin/.local/bin/claude ENOENT
  (garbage commit created with the ENOENT error string as the commit message)
  ```

## pr-already-exists

- **pattern**: `a pull request for branch .* already exists`
- **description**: `gh pr create` fails because a PR for the same branch already exists from a previous workflow run.
- **status**: solved
- **solution**: PR creation checks for existing PR via `gh pr list --head <branch>` before calling `gh pr create`. If PR exists, returns its URL instead of creating a new one.
- **fix_attempts**: 1
- **linked_issues**: #315
- **first_seen**: 2026-03
- **sample_log**:
  ```
  ❌ [2026-03-25T15:33:13.259Z] [aym0n5-create-implement-tdd] sdlc-orchestrator workflow failed: Error: Command failed:
  gh pr create --title "feat: #304 - Create /implement_tdd skill" --base "dev" --head "feature-issue-304-implement-tdd-skill"
  a pull request for branch "feature-issue-304-implement-tdd-skill" into branch "dev" already exists:
  https://github.com/paysdoc/AI_Dev_Workflow/pull/309
  ```

## no-commits-between-branches

- **pattern**: `No commits between`
- **description**: `gh pr create` fails because the feature branch has no commits diverging from the base branch. Build agent reported success but produced no actual changes.
- **status**: mitigated
- **solution**: `execWithRetry` now recognizes this as a non-retryable error and fails immediately instead of retrying 3 times. Root cause (build agent producing no commits) is a separate upstream problem.
- **fix_attempts**: 1
- **linked_issues**: none
- **first_seen**: 2026-03-30
- **sample_log**:
  ```
  ✅ [2026-03-30T07:47:40.072Z] [9bjsqg-fix-missing-d1-cost] Pull Request completed successfully
  ✅ [2026-03-30T07:47:42.880Z] [9bjsqg-fix-missing-d1-cost] Pushed branch to origin
  pull request create failed: GraphQL: No commits between dev and chore-issue-344-d1-cost-writes-observability (createPullRequest)
  ❌ [2026-03-30T07:47:45.305Z] [9bjsqg-fix-missing-d1-cost] execWithRetry: non-retryable error, failing immediately
  ```

## non-retryable-error-retried

- **pattern**: `execWithRetry failed (attempt 2/3)` or `(attempt 3/3)` with non-transient errors including `"No commits between"`, `"already exists"`, `"is not mergeable"`
- **description**: `execWithRetry` retried errors that can never succeed on retry (e.g., "No commits between", "already exists", "is not mergeable").
- **status**: solved
- **solution**: Added `NON_RETRYABLE_PATTERNS` list to `execWithRetry` in `core/utils.ts`. Matching errors are thrown immediately without retry. Patterns include: `"No commits between"`, `"already exists"`, `"is not mergeable"`.
- **fix_attempts**: 1
- **linked_issues**: #377
- **first_seen**: 2026-03-30
- **sample_log**:
  ```
  ❌ [2026-03-30T07:47:45.305Z] [9bjsqg-fix-missing-d1-cost] execWithRetry failed (attempt 1/3): Error: Command failed: gh pr create ...
  ❌ [2026-03-30T07:47:45.305Z] [9bjsqg-fix-missing-d1-cost] execWithRetry: non-retryable error, failing immediately
  ```

## json-parse-failure-crash

- **pattern**: `Resolution agent returned invalid result. Expected JSON with 'resolved' boolean`
- **description**: LLM agent instructed to return JSON returns free-text reasoning instead. `resolutionAgent` and `validationAgent` throw on parse failure, crashing the workflow.
- **status**: solved
- **solution**: JSON parse retry (1 retry, 2 attempts total) + graceful degradation. On failure: `resolutionAgent` returns `{ resolved: false }`, `validationAgent` returns failed validation. Review issue arrays filtered for undefined elements to prevent `issueDescription` TypeError.
- **fix_attempts**: 1
- **linked_issues**: #315
- **first_seen**: 2026-03-25
- **sample_log**:
  ```
  ❌ [2026-03-25T14:00:33.480Z] [78f2zu-create-implement-tdd] sdlc-orchestrator workflow failed: Error: Resolution agent
  returned invalid result. Expected JSON with 'resolved' boolean. Got: Now let me check the PRD and the
  existing skill references to understand the unit test conditional logic the plan mentions.
  ```

## issue-description-typeerror

- **pattern**: `TypeError: Cannot read properties of undefined (reading 'issueDescription')`
- **description**: Review agent returns partially-valid JSON with undefined array elements. Code accesses `.issueDescription` on undefined entry.
- **status**: solved
- **solution**: Review issue arrays filtered for undefined/null entries before property access in `reviewRetry.ts`.
- **fix_attempts**: 1
- **linked_issues**: #315
- **first_seen**: 2026-03-25
- **sample_log**:
  ```
  ❌ [2026-03-25T13:20:12.825Z] [p6ud7v-remove-ungeneratable] sdlc-orchestrator workflow failed:
  TypeError: Cannot read properties of undefined (reading 'issueDescription')
  ```

## gh-cli-transient-failure

- **pattern**: `Failed to fetch exchange rates`, `Failed to fetch PRs`, `Failed to fetch open issues`, `Error classifying issue`
- **description**: GitHub CLI (`gh`) calls fail due to transient network/API issues. No retry logic — bare `execSync` throws immediately.
- **status**: solved
- **solution**: All `gh` CLI calls wrapped with `execWithRetry` (3 attempts, exponential backoff starting at 500ms).
- **fix_attempts**: 1
- **linked_issues**: #315
- **first_seen**: 2026-03
- **sample_log**:
  ```
  ❌ [2026-03-18T14:22:05.100Z] Failed to fetch PRs for concurrency check
  ❌ [2026-03-18T14:22:05.200Z] Error classifying issue #122: Command failed: gh issue view 122 --json body
  ```

## wrong-repo-context

- **pattern**: `could not read Username for 'https://github.com'`, `Branch .* does not exist and no base branch was provided`
- **description**: Git operations target the ADW repo instead of the external target repo. Missing `baseRepoPath`/`cwd` parameter in worktree, fetch, and merge operations.
- **status**: open
- **solution**: Pending. Fix requires threading repo context through all git operations. `autoMergeHandler.ts`, `copyEnvToWorktree()`, `getRepoInfo()` need `cwd` parameter. New target repo clones should use SSH URLs.
- **fix_attempts**: 0
- **linked_issues**: #317
- **first_seen**: 2026-03-26
- **sample_log**:
  ```
  📋 [2026-03-26T06:50:54.070Z] [sh6cb4-re-initialize-adw] Fetching latest changes in /Users/martin/projects/vestmatic/vestmatic...
  Error: Command failed: git fetch origin
  fatal: could not read Username for 'https://github.com': Device not configured
  ```

## auto-merge-empty-log-dir

- **pattern**: (no error pattern — diagnosed by empty log directory with name matching `*-auto-merge-pr-*`)
- **description**: Auto-merge handler creates log directory then exits early (PR already merged, worktree failure, missing context) without writing any files. Zero visibility into what happened.
- **status**: solved
- **solution**: Write a `skip_reason.txt` file before each early return in `autoMergeHandler.ts` and `autoMergePhase.ts`.
- **fix_attempts**: 1
- **linked_issues**: #315
- **first_seen**: 2026-03
- **sample_log**:
  ```
  (no log output — empty directory at logs/6t7i8u-auto-merge-pr-240/)
  ```

## cron-ignores-unblocked-issues

- **pattern**: (no error pattern — diagnosed by issues not being picked up after dependencies close)
- **description**: Cron trigger filters out issues with any ADW comment (`hasAdwWorkflowComment`), making failed/paused/deferred issues invisible. Also, `processedIssues` set never clears for deferred issues. Dependency parser only matches `## Dependencies` heading, not `## Blocked by`.
- **status**: solved
- **solution**: Cron checks latest ADW comment status instead of blanket filter. Re-eligible statuses: `error`, `paused`, `review_failed`, `build_failed`. Deferred issues not added to `processedIssues`. Dependency parser extended with keyword proximity matching and `## Blocked by` support. In-memory cache per issue body hash.
- **fix_attempts**: 1
- **linked_issues**: #314
- **first_seen**: 2026-03-25
- **sample_log**:
  ```
  📋 [2026-03-25T20:15:00.000Z] Polling for backlog issues...
  📋 [2026-03-25T20:15:00.500Z] Fetched 15 open issue(s)
  📋 [2026-03-25T20:15:00.600Z] Found 0 candidate issue(s) after filtering
  (issue #308 open with closed dependencies but filtered out by hasAdwWorkflowComment)
  ```

## context-compaction-degradation

- **pattern**: `"subtype":"compact_boundary"`
- **description**: Claude Code hits context window limit during long build sessions, compacts conversation. Agent continues with degraded context, producing lower quality output.
- **status**: solved
- **solution**: Compaction detected in JSONL stream. Agent is killed and restarted with fresh context using existing continuation mechanism.
- **fix_attempts**: 1
- **linked_issues**: #298, #299
- **first_seen**: 2026-03
- **sample_log**:
  ```
  📋 [2026-03-24T11:30:45.000Z] [abc123-feature-impl] Build agent: Context compaction detected — killing process to restart with fresh context.
  📋 [2026-03-24T11:30:45.100Z] [abc123-feature-impl] Build agent finished: Exit code: 143
  📋 [2026-03-24T11:30:45.200Z] [abc123-feature-impl] Compaction recovery: restarting build agent (continuation 1/3)
  ```
