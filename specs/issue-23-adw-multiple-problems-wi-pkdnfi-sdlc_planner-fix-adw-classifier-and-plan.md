# Bug: ADW classifier, plan agent, and worktree cleanup fail on external target repos

## Metadata
issueNumber: `23`
adwId: `multiple-problems-wi-pkdnfi`
issueJson: `{"number":23,"title":"Multiple problems with the ADW","body":"There are several problems with the adw - especially when running on a different target repo.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-26T06:40:33Z","comments":[],"actionableComment":null}`

## Bug Description
When the ADW system runs against an external target repository (e.g., `vestmatic/vestmatic`), three cascading failures occur:

1. **Classifier fails to recognize `/adw_init`**: The `/classify_adw` agent (running haiku) returns no valid ADW command. This causes a fallback to `/classify_issue`, which classifies the issue as `/chore` instead of routing to the `/adw_init` workflow. The log shows: `ADW classifier returned no valid command for issue #6`.

2. **Plan agent produces no output**: The plan agent runs in the target repo's worktree CWD but the `.claude/commands/` slash commands (e.g., `/chore`, `/commit`) exist only in the ADW repo. The Claude CLI can't find the command templates, so it exits with 0 turns/0 tool calls. The plan file is never created, leading to: `Cannot read plan file at .../specs/issue-6-plan.md: ENOENT`. The commit agent also fails with `Unknown skill: commit`.

3. **Worktree cleanup operates on wrong repo**: When an issue is closed, the webhook handler calls `removeWorktreesForIssue(issueNumber)` without passing the target repo path. The `listWorktrees()` function runs `git worktree list` in the ADW repo's CWD, finding no matching worktrees. The target repo's worktrees are never cleaned up.

## Problem Statement
The ADW system cannot operate on external target repositories because:
- The classifier relies on an unreliable haiku model to extract explicit command strings that could be matched deterministically
- Slash commands are resolved from `CWD/.claude/commands/` but are only present in the ADW repo, not the target repo
- Worktree cleanup doesn't account for the target repo context during issue close events

## Solution Statement
Fix all three issues with minimal, surgical changes:

1. **Classifier**: Add a deterministic regex pre-check in `issueClassifier.ts` that scans the issue body for explicit `/adw_*` patterns before invoking the haiku agent. When a match is found, return immediately without calling the AI classifier.

2. **Plan agent / slash commands**: Copy the ADW repo's `.claude/commands/` directory to the target repo worktree during worktree setup in `workflowLifecycle.ts`. This ensures all slash commands are available when agents run in the target repo CWD.

3. **Worktree cleanup**: Modify the webhook issue close handler in `trigger_webhook.ts` to extract the target repo path from the webhook payload and pass it to `removeWorktreesForIssue`. Update `removeWorktreesForIssue`, `listWorktrees`, and `parseWorktreeBranches` in `worktreeCleanup.ts` to accept an optional `cwd` parameter.

## Steps to Reproduce
1. Create a new GitHub issue in an external target repository (e.g., `vestmatic/vestmatic`) with the body containing `/adw_init`
2. The ADW webhook trigger receives the issue event and spawns the classification pipeline
3. The `/classify_adw` haiku agent fails to return a valid JSON command → falls back to `/classify_issue` → classifies as `/chore`
4. The `/chore` orchestrator spawns the plan agent in the target repo worktree
5. The plan agent can't find `.claude/commands/chore.md` in the target repo → exits with 0 turns → plan file never created
6. The orchestrator tries to read the plan file → ENOENT error
7. When the issue is closed, worktree cleanup runs against the ADW repo instead of the target repo

## Root Cause Analysis

### Bug 1: Classifier
- `classifyWithAdwCommand()` in `issueClassifier.ts:80-118` invokes the `/classify_adw` haiku agent to extract ADW commands from issue text as JSON
- Haiku is unreliable at outputting structured JSON — it produced 2 turns but no parseable command
- There is no deterministic pre-check: even when the issue body contains an explicit `/adw_init` string, the system relies entirely on the AI model to extract it
- The `parseAdwClassificationOutput()` function at line 41-68 correctly validates the JSON but never receives valid input

### Bug 2: Plan not found
- `runPlanAgent()` in `planAgent.ts:200-234` calls `runClaudeAgentWithCommand(issueType, args, ...)` with `cwd` set to the target repo worktree
- `runClaudeAgentWithCommand()` in `claudeAgent.ts:288-348` spawns the Claude CLI with `cwd: cwd || process.cwd()`
- The Claude CLI resolves slash commands from `<cwd>/.claude/commands/<command>.md`
- When CWD is the target repo worktree, `.claude/commands/chore.md` doesn't exist → CLI returns without executing → 0 turns, 0 tool calls, exit code 0
- `handleAgentProcess()` at line 153 returns `success: true` for exit code 0 with no `lastResult`, masking the failure
- The orchestrator proceeds to read the plan file that was never created → ENOENT

### Bug 3: Worktree cleanup on wrong repo
- `trigger_webhook.ts:263-268` handles issue close events by calling `removeWorktreesForIssue(issueNumber)` with no repo context
- Unlike the `issue_comment` handler (line 197) and `issues.opened` handler (line 276) which call `extractTargetRepoArgs(body)`, the `issues.closed` handler does NOT extract target repo info
- `listWorktrees()` in `worktreeOperations.ts:243-264` runs `git worktree list --porcelain` without a `cwd` parameter, defaulting to the ADW repo
- The target repo's worktrees are at a different path and are never found

## Relevant Files
Use these files to fix the bug:

- `adws/core/issueClassifier.ts` — Contains `classifyWithAdwCommand()` and `classifyIssueForTrigger()`. Needs regex pre-check for deterministic ADW command matching before calling the haiku agent.
- `adws/core/issueTypes.ts` — Contains `AdwSlashCommand` type and `adwCommandToIssueTypeMap`. Needed to build the regex pattern from valid commands.
- `adws/phases/workflowLifecycle.ts` — Contains `initializeWorkflow()` which sets up the worktree. Needs to copy `.claude/commands/` to the target repo worktree.
- `adws/triggers/trigger_webhook.ts` — Contains the issue close handler. Needs to extract target repo info and pass it to worktree cleanup.
- `adws/github/worktreeCleanup.ts` — Contains `removeWorktreesForIssue()` and `parseWorktreeBranches()`. Needs optional `cwd` parameter.
- `adws/github/worktreeOperations.ts` — Contains `listWorktrees()`. Needs optional `cwd` parameter.
- `adws/agents/claudeAgent.ts` — Contains `handleAgentProcess()`. Needs to detect and warn on 0-turn agent completions (defensive improvement).
- `adws/__tests__/issueClassifier.test.ts` — Existing classifier tests. Needs new tests for regex pre-check.
- `adws/__tests__/worktreeOperations.test.ts` — Existing worktree tests. Needs new tests for `cwd` parameter support.
- `adws/core/targetRepoManager.ts` — Contains `getTargetRepoWorkspacePath()` for resolving target repo paths. Referenced for worktree cleanup path resolution.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `adws/README.md` — ADW system documentation for context.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add deterministic regex pre-check for ADW commands in the classifier

In `adws/core/issueClassifier.ts`:

- Add a new function `extractAdwCommandFromText(text: string): AdwSlashCommand | null` that:
  - Imports the `adwCommandToIssueTypeMap` keys to build the list of valid commands
  - Sorts them by length descending (so `/adw_plan_build_test_review` matches before `/adw_plan`)
  - Uses a regex to find the first `/adw_*` command in the text (match whole word: `/adw_init\b`)
  - Returns the matched command if it exists in `adwCommandToIssueTypeMap`, else `null`

- Modify `classifyWithAdwCommand()` to call `extractAdwCommandFromText()` on the issue body (passed via a new optional `issueBody` parameter or extracted from the `issueContext` argument) BEFORE running the haiku agent
  - If a command is found deterministically, return the classification result immediately without calling the agent
  - Log the deterministic match: `Issue #${issueNumber} matched ADW command ${command} via regex pre-check`

- Modify `classifyIssueForTrigger()` and `classifyGitHubIssue()` to pass the issue body to `classifyWithAdwCommand()`

### 2. Copy `.claude/commands/` to target repo worktrees

In `adws/phases/workflowLifecycle.ts`:

- Add a new function `copyClaudeCommandsToWorktree(worktreePath: string): void` that:
  - Determines the ADW repo root path (use `path.resolve(__dirname, '../../')` since `workflowLifecycle.ts` is in `adws/phases/`)
  - Checks if `<adwRepoRoot>/.claude/commands/` exists
  - Creates `<worktreePath>/.claude/commands/` directory (recursive)
  - Copies all `.md` files from the ADW repo's `.claude/commands/` to the worktree's `.claude/commands/`
  - Only copies files that don't already exist in the destination (don't overwrite target repo's own commands)
  - Logs the copy operation

- Call `copyClaudeCommandsToWorktree(worktreePath)` in `initializeWorkflow()` after the worktree is created/resolved, specifically in the `targetRepoWorkspacePath` branch (around line 123-124), right after `ensureWorktree()` and before the workflow context is initialized

### 3. Fix worktree cleanup to operate on the correct repository

In `adws/github/worktreeOperations.ts`:

- Modify `listWorktrees(cwd?: string)` to accept an optional `cwd` parameter:
  - Pass `{ encoding: 'utf-8', cwd }` to `execSync` when `cwd` is provided
  - This ensures `git worktree list` runs in the correct repository context

In `adws/github/worktreeCleanup.ts`:

- Modify `parseWorktreeBranches(cwd?: string)` to accept an optional `cwd` parameter:
  - Pass `{ encoding: 'utf-8', cwd }` to `execSync`

- Modify `removeWorktreesForIssue(issueNumber: number, cwd?: string)` to accept an optional `cwd` parameter:
  - Pass `cwd` to `listWorktrees(cwd)`
  - Pass `cwd` to `parseWorktreeBranches(cwd)`
  - Pass `{ stdio: 'pipe', cwd }` to `execSync` for `git worktree remove` and `git worktree prune` calls

In `adws/triggers/trigger_webhook.ts`:

- In the `action === 'closed'` block for issues (line 263):
  - Call `extractTargetRepoArgs(body)` to get the target repo info
  - Resolve the target repo workspace path using `getTargetRepoWorkspacePath()` from `targetRepoManager.ts` (parse `owner/repo` from the args)
  - Pass the workspace path as `cwd` to `removeWorktreesForIssue(issueNumber, targetRepoWorkspacePath)`
  - If no target repo args exist (same-repo issue), call without `cwd` (existing behavior)

### 4. Add defensive logging for 0-turn agent completions

In `adws/agents/claudeAgent.ts`:

- In the `handleAgentProcess()` function, in the `else if (code === 0)` block (line 153):
  - Add a warning log when `state.turnCount === 0`: `log(\`${agentName}: Agent exited successfully but produced no output (0 turns). The slash command may not be available in the working directory.\`, 'warn')`
  - This doesn't change the return value (to avoid breaking existing behavior) but provides diagnostic information for debugging

### 5. Add unit tests for the regex pre-check

In `adws/__tests__/issueClassifier.test.ts`:

- Add a new `describe('extractAdwCommandFromText')` block with tests:
  - Returns `/adw_init` when text contains `/adw_init`
  - Returns `/adw_plan_build_test` when text contains `/adw_plan_build_test` (not `/adw_plan`)
  - Returns `/adw_sdlc` when command is embedded in prose
  - Returns `null` when no ADW command is present
  - Returns `null` for empty text
  - Returns `null` for partial matches like `/adw_unknown`
  - Returns the first match when multiple commands are present

- Add a test for the deterministic pre-check path in `classifyWithAdwCommand`:
  - When issue context contains an explicit `/adw_init`, the classification should return without calling `runClaudeAgentWithCommand`

### 6. Add unit tests for `cwd` parameter support in worktree functions

In `adws/__tests__/worktreeOperations.test.ts`:

- Add tests for `listWorktrees(cwd)`:
  - Passes `cwd` to `execSync` when provided
  - Falls back to default behavior when `cwd` is omitted

- Add tests for `removeWorktreesForIssue(issueNumber, cwd)`:
  - Passes `cwd` to all internal `execSync` calls when provided

### 7. Run validation commands

Run all validation commands from the Validation Commands section below to ensure no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check adws directory
- `npm test` - Run all tests to validate fixes with zero regressions
- `npm run build` - Build the application to verify no build errors

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`. Key requirements: strict TypeScript (no `any`), functional style (map/filter/reduce over loops), immutability, pure functions, meaningful variable names.
- The `/classify_adw` model is set to `haiku` in `adws/core/config.ts:137`. The regex pre-check makes the model choice irrelevant for explicit commands, so no model change is needed.
- The `copyClaudeCommandsToWorktree` function should NOT copy `.claude/settings.json` or `.claude/hooks/` — only the `commands/` subdirectory. This prevents ADW-specific settings from interfering with the target repo.
- When copying commands, existing files in the target repo's `.claude/commands/` should NOT be overwritten. The target repo's own commands take precedence.
- The `claudeAgent.ts` defensive logging change is a non-breaking diagnostic improvement. It does not change the `success` return value to avoid cascading changes across all consumers.
- For the worktree cleanup fix, when the webhook payload comes from the same repo as the ADW installation (no external target repo), the existing behavior (no `cwd`) is preserved.
