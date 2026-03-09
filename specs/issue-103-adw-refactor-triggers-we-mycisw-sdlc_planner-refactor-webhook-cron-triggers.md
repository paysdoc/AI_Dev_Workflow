# Feature: Refactor Triggers — Webhook as Gatekeeper, Cron as Backlog Sweeper

## Metadata
issueNumber: `103`
adwId: `refactor-triggers-we-mycisw`
issueJson: `{"number":103,"title":"Refactor Triggers: Webhook as Gatekeeper, Cron as Backlog Sweeper","body":"## User Story\n\nAs a developer using ADW, I want the webhook trigger to act as a real-time gatekeeper that immediately evaluates new issues and the cron trigger to act as a backlog sweeper that picks up deferred or unprocessed issues, so that issues are processed efficiently without duplication or resource exhaustion.\n\n## Background\n\nCurrently, the webhook and cron triggers work more or less similarly, with mainly the trigger type differing. This refactor separates their responsibilities to avoid overlap and enable smarter issue processing.\n\n## Acceptance Criteria\n\n### 1. Issue Dependency Checking\n\n- [ ] Create a `/find_issue_dependencies` slash command that:\n  - Parses the `## Dependencies` heading in an issue body\n  - Supports GitHub issue references (`#42`) and full URLs as dependency formats\n  - Resolves each referenced issue and checks whether it is open or closed\n  - Returns a list of open (blocking) dependencies\n- [ ] Dependency checking does **not** resolve transitive dependencies (e.g., if #10 depends on #9 and #9 depends on #8, only #9 is checked for #10)\n\n### 2. Webhook Trigger (Real-Time Gatekeeper)\n\nThe webhook reacts instantly to GitHub events and decides whether to admit or defer an issue.\n\n- [ ] On new issue or trigger comment (`adw`):\n  1. Run `/find_issue_dependencies` — if any dependencies are open, **defer** the issue (do not process, do not post a workflow comment)\n  2. Check the per-repository concurrency limit — if the limit is reached, **defer** the issue\n  3. If the issue passes both checks, process it using the existing workflow selection logic\n- [ ] On `issues.closed` event:\n  - Query all open issues in the same repository for a `## Dependencies` section referencing the closed issue\n  - For each dependent issue found, re-evaluate eligibility (dependencies resolved, concurrency available)\n  - Process newly-unblocked issues that pass all checks\n- [ ] The webhook must **not** post any comment on deferred issues, so the cron trigger can discover them later\n- [ ] starts a cron trigger in a new cli window for the repo\n  - [ ] If there is not already a cron process running for the repository, the webhook will start a new cron trigger that polls the repository. \n\n### 3. Cron Trigger (Backlog Sweeper)\n\nThe cron polls for issues that were deferred, missed, or became eligible since the last check.\n\n- [ ] Poll for open issues that meet **all** of the following criteria:\n  1. The issue has no ADW workflow comments (never been picked up)\n  2. The issue was created or last updated more than 5 minutes ago (grace period to avoid racing with the webhook)\n  3. `/find_issue_dependencies` returns no open dependencies\n  4. The per-repository concurrency limit has not been reached\n  5. If the issue is associated with a GitHub Project board, it is **not** already in an \"In Progress\" column\n- [ ] Eligible issues are processed in order of creation (oldest first)\n- [ ] Process issues using the existing workflow selection logic\n\n### 4. Per-Repository Concurrency Limit\n\n- [ ] Introduce a configurable maximum number of concurrently in-progress issues per repository (default: `5`)\n- [ ] Configuration via environment variable: `MAX_CONCURRENT_PER_REPO`\n- [ ] An issue counts as \"in progress\" when it has an ADW workflow comment **and** does not yet have a linked merged/closed PR\n- [ ] Both triggers enforce this limit before processing an issue\n\n### 5. Race Condition Prevention\n\n- [ ] The cron trigger skips issues created or updated within the last 5 minutes (grace period for webhook processing)\n- [ ] When the webhook begins processing an issue, it posts the initial workflow comment immediately (before spawning the agent) to signal ownership\n\n### 6. Logging and Visibility\n\n- [ ] When the webhook defers an issue due to open dependencies, log the reason and the blocking issue numbers\n- [ ] When either trigger defers an issue due to the concurrency limit, log the current in-progress count for that repository\n- [ ] No user-facing comment is posted for deferred issues — deferral is silent to avoid noise\n\n## Out of Scope\n\n- Transitive dependency resolution\n- Global (cross-repository) concurrency limits\n- Retry limits or exponential backoff for repeatedly-failing issues\n- Priority-based ordering beyond creation date\n\n## Technical Notes\n\n- The `/find_issue_dependencies` command should be usable standalone (e.g., `claude /find_issue_dependencies 123`) and return structured output for programmatic use by the triggers\n- The `issues.closed` webhook handler is a new event subscription that must be added to the GitHub webhook configuration\n- The grace period (5 minutes) and concurrency limit (5) should be constants that are easy to adjust\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T11:45:16Z","comments":[],"actionableComment":null}`

## Feature Description
This feature refactors the ADW trigger system to give the webhook and cron triggers distinct, complementary roles. The **webhook** becomes a real-time gatekeeper — it evaluates incoming issues immediately and either admits them for processing or silently defers them. The **cron** becomes a backlog sweeper — it periodically scans for deferred, missed, or newly-eligible issues and processes them. This separation eliminates overlap, prevents duplicate processing, and enables smarter issue handling through dependency checking and per-repository concurrency limits.

## User Story
As a developer using ADW
I want the webhook trigger to act as a real-time gatekeeper that immediately evaluates new issues and the cron trigger to act as a backlog sweeper that picks up deferred or unprocessed issues
So that issues are processed efficiently without duplication or resource exhaustion

## Problem Statement
Currently both triggers (webhook and cron) have overlapping responsibilities with minimal differentiation beyond the trigger mechanism. There is no dependency checking between issues, no concurrency limits per repository, and no mechanism to defer issues intelligently. This can lead to resource exhaustion when many issues arrive simultaneously and prevents orderly processing of issues that depend on others.

## Solution Statement
Separate the webhook and cron triggers into distinct roles:
1. **Webhook (Gatekeeper)**: Evaluates issues in real-time against dependency and concurrency checks. Passes eligible issues to the workflow. Silently defers ineligible issues. Handles `issues.closed` events to unblock dependent issues. Starts a cron process if one isn't already running.
2. **Cron (Backlog Sweeper)**: Polls for deferred/missed issues with a 5-minute grace period, enforces the same dependency and concurrency checks, and processes eligible issues oldest-first.
3. **Shared infrastructure**: A dependency parser (`findIssueDependencies`), a concurrency checker (`getConcurrentIssueCount`), and configurable constants (`GRACE_PERIOD_MS`, `MAX_CONCURRENT_PER_REPO`).

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_webhook.ts` — Main webhook trigger. Must be refactored to add dependency checking, concurrency gating, `issues.closed` handler for unblocking dependents, early workflow comment posting, and cron process spawning.
- `adws/triggers/trigger_cron.ts` — Main cron trigger. Must be refactored to become a backlog sweeper with grace period filtering, dependency checking, concurrency checking, and project board status checking.
- `adws/triggers/webhookHandlers.ts` — Webhook event handlers. The `issues.closed` cost revert logic stays here; the new dependency-unblocking handler can be added here.
- `adws/core/config.ts` — Configuration constants. Add `MAX_CONCURRENT_PER_REPO` env var and `GRACE_PERIOD_MS` constant.
- `adws/github/issueApi.ts` — GitHub issue API. Contains `fetchGitHubIssue`, `getIssueState`, `commentOnIssue`. Will be used by the dependency resolver to check issue states.
- `adws/github/workflowCommentsBase.ts` — Workflow comment utilities. `isAdwComment` and `isAdwRunningForIssue` are used to detect in-progress issues and determine concurrency.
- `adws/github/workflowCommentsIssue.ts` — `postWorkflowComment` is used for the early "starting" comment in the webhook.
- `adws/core/issueClassifier.ts` — `classifyIssueForTrigger` and `getWorkflowScript` for workflow routing.
- `adws/types/issueTypes.ts` — Type definitions. Add `SlashCommand` entry for `/find_issue_dependencies` and extend `SlashCommand` type.
- `adws/github/prApi.ts` — `fetchPRList` for checking linked PRs when computing concurrency.
- `adws/github/githubApi.ts` — `RepoInfo` type and `getRepoInfo` utility.
- `adws/core/constants.ts` — Orchestrator ID constants.
- `.env.sample` — Document the new `MAX_CONCURRENT_PER_REPO` env var.
- `guidelines/coding_guidelines.md` — Must follow these coding guidelines.
- `adws/README.md` — Conditional doc for working in `adws/` directory.

### New Files
- `adws/triggers/issueDependencies.ts` — Issue dependency parser and resolver. Parses `## Dependencies` section, resolves issue references, checks open/closed state. Exported as a pure module for both triggers and standalone use.
- `adws/triggers/__tests__/issueDependencies.test.ts` — Unit tests for dependency parsing and resolution.
- `adws/triggers/concurrencyGuard.ts` — Per-repository concurrency limit checker. Counts in-progress issues (has ADW comment + no merged/closed PR). Exported for both triggers.
- `adws/triggers/__tests__/concurrencyGuard.test.ts` — Unit tests for concurrency guard.
- `adws/triggers/issueEligibility.ts` — Shared eligibility check combining dependency + concurrency checks. Used by both webhook and cron.
- `adws/triggers/__tests__/issueEligibility.test.ts` — Unit tests for eligibility checks.
- `adws/triggers/__tests__/triggerWebhookGatekeeper.test.ts` — Tests for webhook gatekeeper behavior (defer on deps, defer on concurrency, unblock on close).
- `adws/triggers/__tests__/triggerCronSweeper.test.ts` — Tests for cron sweeper behavior (grace period, dependency check, concurrency, ordering).
- `.claude/commands/find_issue_dependencies.md` — Slash command for standalone dependency checking.

## Implementation Plan

### Phase 1: Foundation
Build the shared infrastructure that both triggers will use:
1. **Issue dependency parser** (`issueDependencies.ts`): Parse `## Dependencies` heading from issue body, extract `#N` and full URL references, resolve each against the GitHub API to check open/closed state.
2. **Concurrency guard** (`concurrencyGuard.ts`): Count in-progress issues for a repository — issues with ADW workflow comments that don't yet have a linked merged/closed PR.
3. **Eligibility checker** (`issueEligibility.ts`): Combine dependency + concurrency checks into a single `checkIssueEligibility()` function returning `{ eligible: boolean; reason?: string }`.
4. **Configuration** (`config.ts`): Add `MAX_CONCURRENT_PER_REPO` (default 5) and `GRACE_PERIOD_MS` (default 300_000 = 5 min).

### Phase 2: Core Implementation
Refactor both triggers to use the new infrastructure:
1. **Webhook gatekeeper**: Before spawning a workflow, run eligibility checks. If ineligible, log the reason and return without posting a comment. On eligible, post the "starting" workflow comment immediately (before spawning the agent). Handle `issues.closed` event to re-evaluate dependent issues. Spawn a cron process if none is running.
2. **Cron backlog sweeper**: Filter issues by grace period (skip recently created/updated). Check for ADW workflow comments (skip already-picked-up issues). Run eligibility checks (dependencies + concurrency). Process eligible issues oldest-first. Optionally check GitHub Project board status.

### Phase 3: Integration
1. **Slash command**: Create `/find_issue_dependencies` for standalone use.
2. **Type updates**: Add `/find_issue_dependencies` to `SlashCommand` type and model maps.
3. **Env sample**: Document `MAX_CONCURRENT_PER_REPO` in `.env.sample`.
4. **Comprehensive testing**: Ensure all new and modified code has unit test coverage.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add configuration constants
- In `adws/core/config.ts`, add:
  - `MAX_CONCURRENT_PER_REPO`: `parseInt(process.env.MAX_CONCURRENT_PER_REPO || '5', 10)` — maximum concurrent in-progress issues per repository.
  - `GRACE_PERIOD_MS`: `300_000` (5 minutes) — grace period for cron to avoid racing with webhook.
- In `.env.sample`, add a comment and entry for `MAX_CONCURRENT_PER_REPO`.
- Export both from the core barrel (`adws/core/index.ts`).

### Step 2: Create issue dependency parser (`adws/triggers/issueDependencies.ts`)
- Create a pure function `parseDependencies(issueBody: string): number[]` that:
  - Finds the `## Dependencies` heading (case-insensitive).
  - Extracts all `#N` references and full GitHub issue URLs (`https://github.com/owner/repo/issues/N`) from the section below that heading until the next `##` heading or end of text.
  - Returns a deduplicated array of issue numbers.
- Create an async function `findOpenDependencies(issueBody: string, repoInfo?: RepoInfo): Promise<number[]>` that:
  - Calls `parseDependencies()` to get dependency issue numbers.
  - For each, calls `getIssueState()` from `issueApi.ts` to check if the issue is open.
  - Returns only the issue numbers that are still open (blocking).
- Do NOT resolve transitive dependencies.
- Keep the file under 100 lines.

### Step 3: Write tests for issue dependency parser (`adws/triggers/__tests__/issueDependencies.test.ts`)
- Test `parseDependencies()`:
  - Issue body with `## Dependencies` section containing `#42`, `#10`.
  - Issue body with full URLs (`https://github.com/owner/repo/issues/42`).
  - Issue body with mixed formats.
  - Issue body with no Dependencies section → empty array.
  - Issue body with empty Dependencies section → empty array.
  - Deduplicated results when same issue referenced multiple times.
  - Case-insensitive heading matching (`## dependencies`, `## DEPENDENCIES`).
  - Dependencies section ends at next `##` heading.
- Test `findOpenDependencies()`:
  - Mock `getIssueState` to return 'OPEN' or 'CLOSED' for different issues.
  - Verify only open issues are returned.
  - Verify empty array when all dependencies are closed.
  - Verify empty array when no dependencies section exists.

### Step 4: Create concurrency guard (`adws/triggers/concurrencyGuard.ts`)
- Create an async function `getInProgressIssueCount(repoInfo: RepoInfo): Promise<number>` that:
  - Fetches all open issues for the repo (using `gh issue list`).
  - For each issue, checks if it has any ADW workflow comment (`isAdwComment` from `workflowCommentsBase.ts`).
  - For issues with ADW comments, checks if there's a linked merged/closed PR (by searching for `Implements #N` in open/closed PRs or checking the issue's linked PR status).
  - Counts issues that have ADW comments but no linked merged/closed PR as "in progress".
  - Returns the count.
- Create a function `isConcurrencyLimitReached(repoInfo: RepoInfo): Promise<boolean>` that:
  - Calls `getInProgressIssueCount()` and compares against `MAX_CONCURRENT_PER_REPO`.
  - Returns `true` if the limit is reached or exceeded.
- Keep the file under 150 lines.

### Step 5: Write tests for concurrency guard (`adws/triggers/__tests__/concurrencyGuard.test.ts`)
- Test `getInProgressIssueCount()`:
  - Mock `execSync` / GitHub API calls.
  - 0 open issues → count 0.
  - 3 open issues with ADW comments, 0 with merged PRs → count 3.
  - 5 open issues, 2 with ADW comments, 1 with merged PR → count 1.
  - Issues without ADW comments don't count.
- Test `isConcurrencyLimitReached()`:
  - Count below limit → false.
  - Count at limit → true.
  - Count above limit → true.

### Step 6: Create issue eligibility checker (`adws/triggers/issueEligibility.ts`)
- Create an interface `EligibilityResult { eligible: boolean; reason?: string; blockingIssues?: number[] }`.
- Create an async function `checkIssueEligibility(issueNumber: number, issueBody: string, repoInfo: RepoInfo): Promise<EligibilityResult>` that:
  1. Calls `findOpenDependencies(issueBody, repoInfo)` — if any open dependencies, return `{ eligible: false, reason: 'open_dependencies', blockingIssues: [...] }`.
  2. Calls `isConcurrencyLimitReached(repoInfo)` — if limit reached, return `{ eligible: false, reason: 'concurrency_limit' }`.
  3. If both pass, return `{ eligible: true }`.
- Export the function and interface.
- Keep the file under 80 lines.

### Step 7: Write tests for issue eligibility checker (`adws/triggers/__tests__/issueEligibility.test.ts`)
- Mock `findOpenDependencies` and `isConcurrencyLimitReached`.
- Test: no deps, no concurrency limit → eligible.
- Test: open dependencies → not eligible with reason and blocking issues.
- Test: concurrency limit reached → not eligible with reason.
- Test: both deps and concurrency → not eligible (deps checked first).

### Step 8: Refactor webhook trigger (`adws/triggers/trigger_webhook.ts`)
- **On `issues.opened` event**:
  1. Fetch the issue body.
  2. Call `checkIssueEligibility()`.
  3. If not eligible, log the reason with details (blocking issue numbers or concurrency count) and return `{ status: 'deferred' }` — do NOT post any workflow comment.
  4. If eligible, post the "starting" workflow comment immediately (before spawning the agent) by calling `postWorkflowComment(issueNumber, 'starting', ctx)`.
  5. Then spawn the workflow as before.
- **On `issue_comment` event (actionable comment)**:
  1. Before spawning, run the same eligibility check.
  2. If not eligible, log and defer silently.
  3. If eligible, post "starting" comment and spawn.
- **On `issues.closed` event** (new handler — add alongside existing worktree cleanup):
  1. After worktree cleanup and cost revert, query all open issues in the repo for `## Dependencies` sections referencing the closed issue number.
  2. For each dependent issue found, call `checkIssueEligibility()`.
  3. For newly-eligible issues, classify and spawn the workflow (with early "starting" comment).
  4. Log unblocked issues.
- **Cron process spawning**:
  1. After the webhook server starts, check if a cron process is already running for the target repo (check for a running process or a PID file).
  2. If not running, spawn `bunx tsx adws/triggers/trigger_cron.ts` as a detached process.
  3. Log the cron process start.
- Extract the shared `fetchIssueBody` helper if needed for the `issues.closed` handler.

### Step 9: Write tests for webhook gatekeeper behavior (`adws/triggers/__tests__/triggerWebhookGatekeeper.test.ts`)
- Test that webhook defers when issue has open dependencies (no comment posted, reason logged).
- Test that webhook defers when concurrency limit is reached (no comment posted, reason logged).
- Test that webhook processes eligible issue (starting comment posted, workflow spawned).
- Test `issues.closed` handler finds and re-evaluates dependent issues.
- Test `issues.closed` handler processes newly-unblocked issues.
- Test cron spawning on server start.
- Mock all external calls (`fetchGitHubIssue`, `checkIssueEligibility`, `postWorkflowComment`, `classifyIssueForTrigger`, `spawn`).

### Step 10: Refactor cron trigger (`adws/triggers/trigger_cron.ts`)
- **Replace `isQualifyingIssue()`** with a new eligibility flow:
  1. Fetch open issues with their comments and bodies (extend `gh issue list` fields to include `body` and `updatedAt`).
  2. Filter out issues that have any ADW workflow comments (already picked up). Use `isAdwComment` to detect.
  3. Filter out issues created or last updated within `GRACE_PERIOD_MS` (5 minutes) to avoid racing with the webhook.
  4. For remaining issues, call `checkIssueEligibility()` for dependency and concurrency checks.
  5. Optionally check GitHub Project board status (if the issue is on a project board, skip if it's in "In Progress" column).
  6. Sort eligible issues by `createdAt` ascending (oldest first).
  7. Process each eligible issue using existing classification and workflow spawning logic.
- Keep the existing PR review comment polling unchanged.
- Update the `RawIssue` interface to include `body` and `updatedAt` fields.
- Update `fetchOpenIssues()` to request `body` and `updatedAt` from `gh issue list`.

### Step 11: Write tests for cron sweeper behavior (`adws/triggers/__tests__/triggerCronSweeper.test.ts`)
- Test grace period filtering: issues updated <5 min ago are skipped.
- Test ADW comment filtering: issues with ADW workflow comments are skipped.
- Test dependency check integration: issues with open dependencies are skipped.
- Test concurrency check integration: issues skipped when limit is reached.
- Test oldest-first ordering.
- Test that eligible issues are processed with correct classification.
- Mock all external calls.

### Step 12: Create `/find_issue_dependencies` slash command
- Create `.claude/commands/find_issue_dependencies.md`:
  - Takes an issue number as `$1`.
  - Reads the issue body from GitHub.
  - Parses the `## Dependencies` section.
  - Resolves each referenced issue's state.
  - Returns structured output listing all dependencies with their status (open/closed) and a list of blocking (open) dependencies.
- Update `adws/types/issueTypes.ts`:
  - Add `'/find_issue_dependencies'` to the `SlashCommand` type.
- Update `adws/core/config.ts`:
  - Add `'/find_issue_dependencies'` entry to `SLASH_COMMAND_MODEL_MAP` (use `'sonnet'`).
  - Add `'/find_issue_dependencies'` entry to `SLASH_COMMAND_MODEL_MAP_FAST` (use `'haiku'`).
  - Add `'/find_issue_dependencies'` entry to `SLASH_COMMAND_EFFORT_MAP` (use `'low'`).
  - Add `'/find_issue_dependencies'` entry to `SLASH_COMMAND_EFFORT_MAP_FAST` (use `'low'`).

### Step 13: Update `.env.sample` with new configuration
- Add `MAX_CONCURRENT_PER_REPO` with documentation comment.

### Step 14: Run validation commands
- Execute all validation commands to ensure zero regressions.

## Testing Strategy

### Unit Tests
- **`issueDependencies.test.ts`**: Test `parseDependencies()` for various formats (hash refs, URLs, mixed, empty, no heading). Test `findOpenDependencies()` with mocked GitHub API calls.
- **`concurrencyGuard.test.ts`**: Test `getInProgressIssueCount()` with various issue/PR states. Test `isConcurrencyLimitReached()` against the configurable limit.
- **`issueEligibility.test.ts`**: Test `checkIssueEligibility()` combining both guards, ensuring correct prioritization and result types.
- **`triggerWebhookGatekeeper.test.ts`**: Test the refactored webhook handler paths for deferral (deps/concurrency), processing (eligible), and `issues.closed` unblocking logic.
- **`triggerCronSweeper.test.ts`**: Test the refactored cron polling with grace period, ADW comment filtering, dependency/concurrency checks, and oldest-first ordering.

### Edge Cases
- Issue body with no `## Dependencies` section → no dependencies, eligible.
- Issue body with `## Dependencies` containing only closed issues → eligible.
- Issue with dependencies that reference issues in different repos (full URL format) → handle gracefully.
- Concurrency limit of 0 → all issues deferred (edge config).
- Concurrency limit very high → effectively no limit.
- `issues.closed` event when no dependent issues exist → no-op.
- `issues.closed` event when dependent issues still have other open dependencies → still deferred.
- Race condition: webhook and cron both try to process the same issue → early "starting" comment from webhook prevents cron from picking it up.
- Cron grace period: issue created exactly 5 minutes ago (boundary condition).
- Malformed dependency references (e.g., `#abc`, `#0`, negative numbers) → ignored gracefully.

## Acceptance Criteria
- [ ] `parseDependencies()` correctly extracts issue numbers from `## Dependencies` sections with `#N` and full URL formats.
- [ ] `findOpenDependencies()` returns only open (blocking) dependency issue numbers.
- [ ] `getInProgressIssueCount()` correctly counts in-progress issues (has ADW comment, no merged/closed PR).
- [ ] `isConcurrencyLimitReached()` correctly compares against `MAX_CONCURRENT_PER_REPO`.
- [ ] `checkIssueEligibility()` returns correct eligibility result combining both checks.
- [ ] Webhook defers issues with open dependencies (no comment posted, reason logged).
- [ ] Webhook defers issues when concurrency limit is reached (no comment posted, count logged).
- [ ] Webhook processes eligible issues with early "starting" comment before spawning.
- [ ] Webhook `issues.closed` handler re-evaluates and unblocks dependent issues.
- [ ] Webhook spawns a cron process if one isn't already running.
- [ ] Cron skips issues created/updated within the last 5 minutes.
- [ ] Cron skips issues that already have ADW workflow comments.
- [ ] Cron runs dependency and concurrency checks on remaining issues.
- [ ] Cron processes eligible issues oldest-first.
- [ ] `/find_issue_dependencies` slash command works standalone.
- [ ] `MAX_CONCURRENT_PER_REPO` is configurable via environment variable (default: 5).
- [ ] All new code has unit test coverage.
- [ ] All existing tests continue to pass (zero regressions).
- [ ] All new files are under 300 lines per coding guidelines.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type check main project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW scripts.
- `bun run test` — Run all tests to validate the feature works with zero regressions.

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: keep files under 300 lines, prefer pure functions, use strict TypeScript types, isolate side effects at boundaries.
- Read `adws/README.md` when working in the `adws/` directory for architectural context.
- The `GRACE_PERIOD_MS` (5 minutes) and `MAX_CONCURRENT_PER_REPO` (5) should be exported constants that are easy to adjust — not hardcoded in multiple places.
- The dependency parser intentionally does NOT resolve transitive dependencies — this is explicitly out of scope.
- The Project board "In Progress" check for the cron trigger is a best-effort feature. If the issue is not associated with a project board, skip the check.
- When the webhook posts the "starting" comment early, it should use the existing `postWorkflowComment()` from `workflowCommentsIssue.ts` with the `'starting'` stage. This serves as both user notification and ownership signal to prevent cron from picking up the same issue.
- For the cron process spawning from the webhook, consider using a simple PID file or port-based detection to check if a cron is already running, rather than complex IPC.
