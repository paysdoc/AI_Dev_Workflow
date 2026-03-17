# Bug: Fix webhook deduplication cooldown for issue events

## Metadata
issueNumber: `207`
adwId: `8af0pz-add-issue-level-dedu`
issueJson: `{"number":207,"title":"Add issue-level deduplication to prevent concurrent workflow spawning from duplicate webhook events","body":"## Problem\n\nA single `## Take action` comment can spawn multiple concurrent workflows when webhook events are delivered more than once (GitHub retries, tunnel/proxy hiccups, or multiple webhook configurations).\n\nObserved on issue #204: one `## Take action` spawned 3 concurrent workflows (`8kp95r`, `wdwmeo`, `tv7q0z`), each racing through stages and creating duplicate/interleaved comments. From the user's perspective, it appears the workflow \"starts from the beginning\" instead of resuming.\n\n### Root cause\n\nThe `issue_comment` handler in `trigger_webhook.ts` has no in-memory deduplication for issue events. PR review events already have a cooldown (`recentPrReviewTriggers` at line 29-37), but issue comments do not.\n\nThe `isAdwRunningForIssue` concurrency guard has a **TOCTOU race condition**: there is an ~8-second window between \"Take action\" arriving and the first workflow posting its \"starting\" comment. During this window, `isAdwRunningForIssue` finds zero ADW stage comments and returns `false`, allowing every duplicate delivery to spawn a new workflow.\n\n### Secondary: `extractAdwIdFromComment` regex mismatch\n\n`extractAdwIdFromComment` (`workflowCommentParsing.ts:127`) uses regex:\n```\n/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/\n```\n\nBut `generateAdwId` (`utils.ts:18-27`) produces IDs like `8kp95r-remove-run-bdd-scena` — no `adw-` prefix. The regex never matches, so `recoveryState.adwId` is always `null`. While `isAdwRunningForIssue` conservatively returns `true` when it can't extract an ID (safe fallback), this means recovery state can never properly track which ADW run to resume from.\n\n## Required changes\n\n1. **Add issue-level cooldown in `trigger_webhook.ts`** — mirror the existing `recentPrReviewTriggers` pattern:\n   - Add `recentIssueTriggers: Map<number, number>` with a 60-second cooldown\n   - Add `shouldTriggerIssueWorkflow(issueNumber)` guard\n   - Call it in the `issue_comment` handler before `classifyAndSpawnWorkflow`\n\n2. **Fix `extractAdwIdFromComment` regex** in `workflowCommentParsing.ts` — update the pattern to match the actual ID format produced by `generateAdwId` (`{random}-{slug}` without `adw-` prefix)\n\n3. **Add unit tests** for the new cooldown guard and the updated regex","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-17T06:34:39Z","comments":[],"actionableComment":null}`

## Bug Description
A single `## Take action` comment on an issue can spawn multiple concurrent ADW workflows when duplicate webhook events arrive (GitHub retries, tunnel/proxy hiccups, or multiple webhook configurations). Observed on issue #204: one `## Take action` spawned 3 concurrent workflows (`8kp95r`, `wdwmeo`, `tv7q0z`), each racing through stages and creating duplicate/interleaved comments. From the user's perspective, the workflow appears to "start from the beginning" instead of resuming.

**Expected behavior:** A single `## Take action` comment triggers exactly one workflow, regardless of how many times the webhook event is delivered.

**Actual behavior:** Each duplicate webhook delivery spawns a new workflow, leading to concurrent duplicate workflows racing against each other.

## Problem Statement
Two distinct problems need to be fixed:

1. **No issue-level cooldown:** The `issue_comment` handler in `trigger_webhook.ts` has no in-memory deduplication. PR review events already have a cooldown (`recentPrReviewTriggers` with 60s window), but issue comment events do not. The `isAdwRunningForIssue` guard has a TOCTOU race condition: there's an ~8-second window between the webhook arriving and the first workflow posting its "starting" comment, during which duplicate events pass through.

2. **Broken ADW ID extraction regex:** `extractAdwIdFromComment` in `workflowCommentParsing.ts` uses `/\`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])\`/` which requires an `adw-` prefix. However, `generateAdwId` produces IDs like `8kp95r-remove-run-bdd-scena` (no `adw-` prefix). The regex never matches, so `recoveryState.adwId` is always `null`, preventing proper recovery state tracking.

## Solution Statement
1. Add an in-memory `recentIssueTriggers` cooldown map in `trigger_webhook.ts` that mirrors the existing `recentPrReviewTriggers` pattern. Add a `shouldTriggerIssueWorkflow(issueNumber)` guard function and call it in the `issue_comment` handler before `classifyAndSpawnWorkflow`. Also apply the same guard to the `issues.opened` handler to prevent duplicate `opened` events from spawning multiple workflows.

2. Fix the `extractAdwIdFromComment` regex in `workflowCommentParsing.ts` to match the actual ADW ID format produced by `generateAdwId`: `{6-char-random}-{slug}` (e.g., `8kp95r-remove-run-bdd-scena`). Use the `**ADW ID:**` context marker for reliable extraction. Update the JSDoc comment to reflect the actual format.

## Steps to Reproduce
1. Set up a webhook-triggered ADW environment
2. Create a GitHub issue
3. Post a `## Take action` comment
4. Observe that GitHub delivers the webhook event multiple times (retries, tunnel hiccups)
5. Each delivery spawns a new workflow, resulting in 2-3+ concurrent workflows racing on the same issue
6. Duplicate/interleaved stage comments appear on the issue

## Root Cause Analysis
**Primary — TOCTOU race in `issue_comment` handler:**
- `trigger_webhook.ts` line 126 calls `isAdwRunningForIssue()` which checks for existing ADW stage comments on the issue
- `isAdwRunningForIssue()` (`workflowCommentsBase.ts:19-39`) fetches the issue from GitHub, looks for ADW stage comments, and returns `false` if none are found
- There is an ~8-second gap between receiving the webhook event and the spawned workflow posting its first "starting" comment
- During this window, duplicate webhook deliveries also find zero stage comments and pass through, each spawning a new workflow
- PR review events are protected by `recentPrReviewTriggers` (lines 29-37), but issue events have no equivalent guard

**Secondary — regex mismatch in `extractAdwIdFromComment`:**
- `workflowCommentParsing.ts:127` uses regex `/\`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])\`/` which requires `adw-` prefix
- `generateAdwId()` (`utils.ts:18-27`) produces IDs like `8kp95r-remove-run-bdd-scena` — no `adw-` prefix
- The `adw-` prefix appears only in the branch name template (e.g., `feat-issue-123-adw-8kp95r-...`), not in the ID itself
- The regex never matches, so `extractAdwIdFromComment` always returns `null`
- `isAdwRunningForIssue` line 36 falls back to `return true` when ADW ID extraction fails (safe but imprecise)
- `detectRecoveryState` line 184-185 can never populate `recoveryState.adwId`, breaking resume-from-prior-run logic

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/trigger_webhook.ts` — Primary file. Contains the webhook server and event handlers. The `issue_comment` handler (lines 110-142) lacks an issue-level cooldown guard. The existing `recentPrReviewTriggers` pattern (lines 29-37) should be mirrored for issue events.
- `adws/core/workflowCommentParsing.ts` — Contains `extractAdwIdFromComment` (line 126-129) with the broken regex that requires an `adw-` prefix not present in generated ADW IDs. Also contains `detectRecoveryState` which depends on this function.
- `adws/core/utils.ts` — Contains `generateAdwId` (lines 18-27) which produces the actual ADW ID format. Read-only reference to understand the ID format.
- `adws/github/workflowCommentsBase.ts` — Contains `isAdwRunningForIssue` (lines 19-39) which calls `extractAdwIdFromComment`. Read-only reference to understand how the ADW ID extraction is used.
- `adws/github/workflowCommentsIssue.ts` — Contains the comment templates that embed `**ADW ID:** \`${ctx.adwId}\``. Read-only reference to understand the actual comment format.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add issue-level cooldown guard in `trigger_webhook.ts`

- Add a new `ISSUE_COOLDOWN_MS` constant set to `60_000` (60 seconds), matching `PR_REVIEW_COOLDOWN_MS`
- Add a new `recentIssueTriggers` map: `new Map<number, number>()` — mirrors `recentPrReviewTriggers`
- Add a new `shouldTriggerIssueWorkflow(issueNumber: number): boolean` function that mirrors `shouldTriggerPrReview`:
  - Get current timestamp with `Date.now()`
  - Check if `issueNumber` exists in `recentIssueTriggers` and the elapsed time is less than `ISSUE_COOLDOWN_MS`
  - If within cooldown, return `false`
  - Otherwise, set `recentIssueTriggers.set(issueNumber, now)` and return `true`
- In the `issue_comment` handler (around line 124, after `isActionableComment` check), add:
  - Call `shouldTriggerIssueWorkflow(issueNumber)` before proceeding
  - If it returns `false`, respond with `{ status: 'ignored', reason: 'duplicate' }` and return early
  - Add a log message: `log(\`Issue #${issueNumber} cooldown active, ignoring duplicate webhook\`)`
- In the `issues.opened` handler (around line 176, after issue number extraction), add:
  - Call `shouldTriggerIssueWorkflow(issueNumber)` before proceeding
  - If it returns `false`, respond with `{ status: 'ignored', reason: 'duplicate' }` and return early

### 2. Fix `extractAdwIdFromComment` regex in `workflowCommentParsing.ts`

- Update the regex on line 127 from:
  ```typescript
  const match = commentBody.match(/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/);
  ```
  to:
  ```typescript
  const match = commentBody.match(/\*\*ADW ID:\*\*\s*`([a-z0-9][a-z0-9-]*[a-z0-9])`/);
  ```
  This change:
  - Removes the `adw-` prefix requirement that never matches
  - Anchors the match to the `**ADW ID:**` context marker for reliable extraction (avoids false matches from branch names, plan paths, or other backtick-wrapped strings in the comment)
  - Matches the actual format produced by `generateAdwId`: `{random}-{slug}` (e.g., `8kp95r-remove-run-bdd-scena`)
- Update the JSDoc comment on line 125 to accurately describe the matched format:
  ```typescript
  /** Extracts the ADW ID from a comment body. Matches the `{random}-{slug}` format produced by generateAdwId. */
  ```

### 3. Export the cooldown guard for testability

- Export `shouldTriggerIssueWorkflow` from `trigger_webhook.ts` so it can be tested and reused
- Add it to the existing re-export block at lines 26-27 if appropriate, or simply mark the function as `export`

### 4. Run validation commands

- Run `bun run lint` to check for code quality issues
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` to verify TypeScript type checking passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws-specific type checking passes

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root-level TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Notes
- The `guidelines/coding_guidelines.md` file must be strictly adhered to. Key points: clarity over cleverness, modularity, type safety, immutability.
- ADW does not use unit tests (see `guidelines/coding_guidelines.md` and `.adw/project.md`). Validation is through type checking, linting, and BDD scenarios.
- The cooldown constant `ISSUE_COOLDOWN_MS` is set to 60 seconds to match the existing `PR_REVIEW_COOLDOWN_MS` for consistency.
- The `recentIssueTriggers` map is in-memory only — it resets on server restart, which is acceptable since the cooldown is a short-lived deduplication window.
- The regex fix uses the `**ADW ID:**` context anchor to avoid false positives from other backtick-wrapped content in comments (branch names like `feat-issue-123-adw-8kp95r-...`, plan paths like `specs/issue-207-plan.md`, etc.).
- The `issues.opened` handler also needs the cooldown guard since duplicate `opened` events can trigger the same race condition.
