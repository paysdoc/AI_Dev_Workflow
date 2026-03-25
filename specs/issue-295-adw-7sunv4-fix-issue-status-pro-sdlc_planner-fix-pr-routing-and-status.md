# Bug: Fix issue status propagation, PR routing, and PR-to-issue linking

## Metadata
issueNumber: `295`
adwId: `7sunv4-fix-issue-status-pro`
issueJson: `{"number":295,"title":"Fix issue status propagation, PR routing, and PR-to-issue linking","body":"## Problem\n\nThree related bugs affect issue lifecycle management:\n\n1. **Issues never reach 'Review' status** — `moveToStatus(BoardStatus.Review)` is only called in `prReviewCompletion.ts:179` (PR Review workflow), never in the main SDLC/PlanBuild workflows after PR creation.\n\n2. **PRs sometimes target `main` instead of `dev`** — The Claude agent running `/pull_request` executes `gh pr create` itself and sometimes ignores the passed default branch variable, routing PRs to `main`. This caused the `BoardStatus` fix (PR #272) to be reverted repeatedly as `dev`-based branches overwrote it during merge conflict resolution (observed on PRs #282-#293).\n\n3. **PR-to-issue linking is fragile** — The webhook handler (`webhookHandlers.ts`) looks for `Implements #N` in PR bodies, but the `/pull_request` skill tells the agent to use `Closes`. The branch name fallback (`/issue-(\\d+)/`) works but is treated as secondary.\n\n## Root causes\n\n- PR creation (push + `gh pr create`) is delegated to an LLM agent, making the base branch non-deterministic\n- `pullRequestCreator.ts` has a hardcoded `baseBranch: string = 'develop'` default (line 68) — wrong for all repos\n- The `CodeHost.createMergeRequest()` provider method exists but is never called — all PR creation bypasses the provider layer\n- No `moveToStatus(BoardStatus.Review)` call exists in any main workflow's PR phase\n\n## Solution\n\n### A. Add Review status transition in PR phase\n- Add `moveToStatus(BoardStatus.Review)` in `prPhase.ts` after successful PR creation\n\n### B. Refactor PR creation — split LLM text generation from programmatic creation\n1. **`.claude/commands/pull_request.md`** — remove `git push` and `gh pr create` steps; agent returns JSON `{\\\"title\\\": \\\"...\\\", \\\"body\\\": \\\"...\\\"}` only\n2. **`adws/agents/prAgent.ts`** — parse JSON `{title, body}` from agent output instead of extracting PR URL\n3. **`adws/phases/prPhase.ts`** — after agent returns title+body:\n   - Push branch programmatically (guaranteed before PR creation)\n   - Call `repoContext.codeHost.createMergeRequest()` with title, body, source/target branches, issue number\n   - Store returned `{ url, number }` in ctx\n\n### C. Fix CodeHost interface and implementations\n1. **`adws/providers/types.ts`** — change `createMergeRequest()` return type to `{ url: string; number: number }`\n2. **`adws/providers/github/githubCodeHost.ts`** — rewrite to call `gh pr create` directly with title/body/branches; remove `pullRequestCreator.ts` delegation and `minimalIssue` shim\n3. **`adws/providers/gitlab/gitlabCodeHost.ts`** — update return type to match\n4. **`adws/github/pullRequestCreator.ts`** — remove (dead code after refactor)\n\n### D. Simplify webhook PR-to-issue linking\n- **`adws/triggers/webhookHandlers.ts`** — remove `extractIssueNumberFromPRBody`; make `extractIssueNumberFromBranch` the sole mechanism\n- Remove unused ADW branch format regex; keep only `/issue-(\\d+)/` (verified: 145/145 historical PRs use this format)","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-03-25T10:24:55Z","comments":[{"author":"paysdoc","createdAt":"2026-03-25T10:26:35Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
Three related bugs affect the issue lifecycle management in ADW:

1. **Issues never reach "Review" status** — `moveToStatus(BoardStatus.Review)` is only called in `prReviewCompletion.ts:179` (the PR Review workflow), never in the main SDLC/PlanBuild workflows after PR creation. This means issues stay in "In Progress" on the project board even after a PR is created.

2. **PRs sometimes target `main` instead of `dev`** — The Claude agent running `/pull_request` executes `gh pr create` directly and sometimes ignores the passed `defaultBranch` variable, routing PRs to `main`. This caused the `BoardStatus` fix (PR #272) to be reverted repeatedly as `dev`-based branches overwrote it during merge conflict resolution (observed on PRs #282-#293).

3. **PR-to-issue linking is fragile** — The webhook handler (`webhookHandlers.ts`) looks for `Implements #N` in PR bodies, but the `/pull_request` skill tells the agent to use `Closes`. The branch name fallback (`/issue-(\d+)/`) works but is treated as secondary.

## Problem Statement
PR creation is delegated entirely to an LLM agent (which runs `git push` and `gh pr create`), making the base branch non-deterministic, the PR body format inconsistent, and the issue status transition impossible to guarantee. The `CodeHost.createMergeRequest()` provider method exists but is never called in the PR phase — all PR creation bypasses the provider layer.

## Solution Statement
Split the PR creation flow into two phases: (1) the LLM agent generates PR title and body text as structured JSON, and (2) the `prPhase.ts` programmatically pushes the branch and creates the PR via `repoContext.codeHost.createMergeRequest()`. This guarantees the correct base branch, consistent PR body format, and enables the `moveToStatus(BoardStatus.Review)` call after successful creation. Webhook issue linking is simplified to use branch name extraction only, since branch names are deterministic.

## Steps to Reproduce
1. Run any main workflow (e.g., `bunx tsx adws/adwPlanBuild.tsx <issueNumber>`) against a target repo where the default branch is not `main`
2. Observe the created PR may target `main` instead of the repo's actual default branch
3. Check the project board — the issue remains in "In Progress", never transitions to "Review"
4. Close the PR via webhook — if the PR body uses `Closes #N` (as instructed by the slash command) instead of `Implements #N` (as expected by the webhook), the body-based extraction fails and falls back to branch name

## Root Cause Analysis
1. **Non-deterministic PR base branch**: `pull_request.md` instructs the LLM agent to run `gh pr create --base <defaultBranch>`, but the agent is free to deviate. The `defaultBranch` variable is correctly computed by `getDefaultBranch()` in `prAgent.ts`, but the LLM agent may ignore it or use `main` as a fallback.

2. **Missing Review status transition**: `prPhase.ts` has no `moveToStatus(BoardStatus.Review)` call. The only call exists in `prReviewCompletion.ts:179`, which is part of the PR Review workflow (a separate workflow), not the main SDLC/PlanBuild workflows.

3. **PR body format mismatch**: `webhookHandlers.ts:46` uses `Implements #N` regex but `pull_request.md` instructs the agent to write `Closes #N`. The branch name extraction works as a fallback but logs a misleading message when the body pattern fails.

4. **Dead code in CodeHost**: `pullRequestCreator.ts` has a hardcoded `baseBranch: string = 'develop'` default (line 68), and the `GitHubCodeHost.createMergeRequest()` method delegates to it with a minimal issue shim. Neither is used by the actual PR creation flow.

## Relevant Files
Use these files to fix the bug:

- `adws/providers/types.ts` — Contains `CodeHost` interface with `createMergeRequest()` return type (currently `string`, needs to return `{ url: string; number: number }`) and `CreateMROptions` type and `BoardStatus` enum
- `adws/providers/github/githubCodeHost.ts` — GitHub `CodeHost` implementation; `createMergeRequest()` delegates to `pullRequestCreator.ts` with a minimal issue shim; needs rewrite to call `gh pr create` directly
- `adws/providers/gitlab/gitlabCodeHost.ts` — GitLab `CodeHost` implementation; `createMergeRequest()` returns `string`; needs return type update to match interface
- `adws/phases/prPhase.ts` — PR creation phase; calls `runPullRequestAgent()` and extracts PR URL; needs to be refactored to receive JSON title/body from agent, push branch, call `createMergeRequest()`, and call `moveToStatus(BoardStatus.Review)`
- `adws/agents/prAgent.ts` — PR agent wrapper; `extractPrUrlFromOutput()` extracts URL; needs refactor to parse JSON `{title, body}` output
- `.claude/commands/pull_request.md` — Slash command template; includes `git push` and `gh pr create` steps; needs simplification to return JSON only
- `adws/github/pullRequestCreator.ts` — Legacy PR creation function with hardcoded `develop` default; to be deleted (dead code after refactor)
- `adws/github/index.ts` — Re-exports `createPullRequest` from `pullRequestCreator.ts`; needs re-export removed
- `adws/index.ts` — Re-exports `createPullRequest` from `./github`; needs re-export removed
- `adws/triggers/webhookHandlers.ts` — Webhook handler with `extractIssueNumberFromPRBody()` and `extractIssueNumberFromBranch()`; body extraction to be removed, branch extraction simplified to `issue-(\d+)` only
- `adws/vcs/commitOperations.ts` — Contains `pushBranch()` function used for programmatic branch push
- `adws/vcs/branchOperations.ts` — Contains `getDefaultBranch()` and `getCurrentBranch()` functions
- `adws/phases/phaseCommentHelpers.ts` — Contains `postIssueStageComment()` used by PR phase
- `adws/agents/commandAgent.ts` — Generic command agent runner used by `prAgent.ts`
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `app_docs/feature-6ukg3s-1773849789984-fix-pr-default-branch-linking.md` — Context on prior PR default branch fix
- `app_docs/feature-wrzj5j-harden-project-board-status.md` — Context on board status hardening
- `app_docs/feature-tdlgz7-fix-boardstatus-invalid-values.md` — Context on BoardStatus enum fix
- `app_docs/feature-y000tl-fix-issue-number-res-pr-review-issue-number.md` — Context on issue number extraction from branches

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Update `CodeHost` interface return type in `adws/providers/types.ts`

- Change the `createMergeRequest()` method signature from returning `string` to returning `{ url: string; number: number }`
- Add a new `MergeRequestResult` interface: `{ url: string; number: number }`
- Update the `CodeHost` interface: `createMergeRequest(options: CreateMROptions): MergeRequestResult`

### 2. Rewrite `GitHubCodeHost.createMergeRequest()` in `adws/providers/github/githubCodeHost.ts`

- Remove the import of `createPullRequest` from `../../github/pullRequestCreator`
- Remove the import of `GitHubIssue` type (no longer needed for the minimal issue shim)
- Rewrite `createMergeRequest()` to:
  - Write the PR body to a temp file (to avoid shell escaping issues)
  - Call `gh pr create --title "..." --body-file "..." --base <targetBranch> --head <sourceBranch> --repo <owner/repo>` via `execSync`
  - Parse the returned PR URL to extract the PR number (regex: `/\/pull\/(\d+)$/`)
  - Return `{ url, number }` matching the new `MergeRequestResult` type
  - Clean up the temp file in a `finally` block
- Import `execSync` from `child_process`, `fs` from `fs`, `os` from `os`, `path` from `path`
- Import `refreshTokenIfNeeded` from `../../github/githubAppAuth` to ensure valid auth before the `gh` call

### 3. Update `GitLabCodeHost.createMergeRequest()` in `adws/providers/gitlab/gitlabCodeHost.ts`

- Update `createMergeRequest()` return type to match `MergeRequestResult`
- The GitLab API response (`mr`) already contains `iid` (MR number) and `web_url`
- Return `{ url: mr.web_url, number: mr.iid }` instead of just `mr.web_url`

### 4. Refactor `.claude/commands/pull_request.md` to return JSON only

- Remove steps 4 (`git push`) and 5 (`gh pr create`) from the `## Run` section
- Remove step 6 (capture PR URL)
- Keep steps 1-3 (git diff/log analysis for generating good PR descriptions)
- Update the `## Report` section to instruct the agent to return a JSON object:
  ```
  Return ONLY a JSON object with the PR title and body (no other text):
  {"title": "<pr_title>", "body": "<pr_body>"}
  ```
- The `## Instructions` section remains the same (PR title format, body content requirements)

### 5. Refactor `adws/agents/prAgent.ts` to parse JSON output

- Replace `extractPrUrlFromOutput()` with `extractPrContentFromOutput()` that:
  - Finds a JSON object in the agent output (handle markdown code fences)
  - Parses `{ title: string; body: string }` from the JSON
  - Falls back to extracting title from first non-empty line and body from remaining lines if JSON parsing fails
- Define a `PrContent` interface: `{ title: string; body: string }`
- Update `prAgentConfig` to use `extractOutput: extractPrContentFromOutput` with type `CommandAgentConfig<PrContent>`
- Update `runPullRequestAgent()` return type from `AgentResult & { prUrl: string }` to `AgentResult & { prContent: PrContent }`
- Return `{ ...result, prContent: result.parsed }` instead of `{ ...result, prUrl: result.parsed }`

### 6. Refactor `adws/phases/prPhase.ts` to use programmatic PR creation

- Import `BoardStatus` from `../providers/types`
- Import `pushBranch` from `../vcs`
- Import `getDefaultBranch` from `../vcs/branchOperations`
- After `runPullRequestAgent()` returns:
  - Extract `prContent` (title, body) from the agent result
  - Push the branch programmatically: `pushBranch(currentBranch, worktreePath)`
  - Get the default branch: `const defaultBranch = getDefaultBranch(worktreePath)`
  - Call `repoContext.codeHost.createMergeRequest()` with:
    - `title: prContent.title`
    - `body: prContent.body`
    - `sourceBranch: currentBranch`
    - `targetBranch: defaultBranch`
    - `linkedIssueNumber: issueNumber`
  - Store the returned `{ url, number }` in `ctx.prUrl`
- After successful PR creation (after `postIssueStageComment` for `pr_created`):
  - Add `await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Review)`
  - Wrap in try-catch to prevent workflow crash if board status update fails

### 7. Delete `adws/github/pullRequestCreator.ts`

- Delete the file entirely — it is dead code after the refactor
- All PR creation now goes through `CodeHost.createMergeRequest()`

### 8. Remove `createPullRequest` re-exports

- In `adws/github/index.ts`: remove the line `export { createPullRequest } from './pullRequestCreator';`
- In `adws/index.ts`: remove `createPullRequest` from the exports list under `// GitHub module`

### 9. Simplify webhook PR-to-issue linking in `adws/triggers/webhookHandlers.ts`

- Remove the `extractIssueNumberFromPRBody()` function entirely
- Simplify `extractIssueNumberFromBranch()`:
  - Remove the ADW branch format regex (`^(?:feat|feature|bug|bugfix|chore|fix|hotfix)-(\d+)-/`)
  - Keep only the `issue-(\d+)` pattern (verified: 145/145 historical PRs match this format)
- Update `handlePullRequestEvent()`:
  - Replace `extractIssueNumberFromPRBody(prBody) ?? extractIssueNumberFromBranch(headBranch)` with just `extractIssueNumberFromBranch(headBranch)`
  - Remove the conditional log that checks `extractIssueNumberFromPRBody(prBody)` — the branch name is now the sole mechanism
  - Update the "no issue link found" log message to reference "no `issue-N` pattern in branch name" instead of "no `Implements #N` pattern"

### 10. Verify no other callers reference deleted code

- Search for any remaining imports of `createPullRequest` from `pullRequestCreator` or the barrel exports
- Search for any remaining references to `extractIssueNumberFromPRBody`
- Fix any broken imports

### 11. Run validation commands

- Run all validation commands listed below to confirm the bug is fixed with zero regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module specifically (catches interface mismatches in providers)
- `grep -r "createPullRequest" adws/ --include="*.ts" | grep -v "node_modules"` — Verify no remaining references to deleted `createPullRequest` function
- `grep -r "extractIssueNumberFromPRBody" adws/ --include="*.ts" | grep -v "node_modules"` — Verify no remaining references to deleted `extractIssueNumberFromPRBody` function
- `grep -r "pullRequestCreator" adws/ --include="*.ts" | grep -v "node_modules"` — Verify no remaining imports from deleted module
- `grep "moveToStatus.*Review" adws/phases/prPhase.ts` — Verify the Review status transition was added
- `grep "createMergeRequest" adws/phases/prPhase.ts` — Verify programmatic PR creation is in the phase
- `grep "pushBranch" adws/phases/prPhase.ts` — Verify programmatic branch push is in the phase
- `grep -v "gh pr create" .claude/commands/pull_request.md` — Verify `gh pr create` was removed from the slash command (should show all lines; no matches expected)
- `grep -v "git push" .claude/commands/pull_request.md` — Verify `git push` was removed from the slash command

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: pure functions, type safety, immutability, no `any` types.
- The `GitLabCodeHost.createMergeRequest()` needs the `iid` field from the GitLab API response. Verify the `GitLabApiClient.createMergeRequest()` response type includes `iid`.
- Read `app_docs/feature-6ukg3s-1773849789984-fix-pr-default-branch-linking.md` for context on the prior PR default branch fix — this refactor supersedes that work by making PR creation deterministic.
- Read `app_docs/feature-wrzj5j-harden-project-board-status.md` and `app_docs/feature-tdlgz7-fix-boardstatus-invalid-values.md` for context on board status handling.
- Read `app_docs/feature-y000tl-fix-issue-number-res-pr-review-issue-number.md` for context on `extractIssueNumberFromBranch` usage in PR review workflows.
- The `refreshTokenIfNeeded()` call in `prAgent.ts` should be retained — it ensures GitHub App auth is valid before the agent runs. A second call in `GitHubCodeHost.createMergeRequest()` ensures auth is fresh for the programmatic `gh pr create` call.
- When deleting `pullRequestCreator.ts`, verify there are no test files or BDD step definitions that import from it.
- The `prPhase.ts` refactor should handle the case where `repoContext` is `undefined` (defensive guard already exists in current code). When `repoContext` is undefined, fall back to the old agent-based PR creation flow or throw a clear error.
