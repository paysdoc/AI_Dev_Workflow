# Fix PR Routing, Review Status, and Issue Linking

**ADW ID:** 7sunv4-fix-issue-status-pro
**Date:** 2026-03-25
**Specification:** specs/issue-295-adw-7sunv4-fix-issue-status-pro-sdlc_planner-fix-pr-routing-and-status.md

## Overview

Three related bugs in issue lifecycle management were fixed: PRs were sometimes targeting `main` instead of the repo's actual default branch (because the LLM agent was free to deviate from the passed `defaultBranch`), issues never transitioned to "Review" status after PR creation, and webhook PR-to-issue linking was fragile due to a body-pattern mismatch. The fix splits PR creation into two deterministic phases — the agent generates structured JSON (title + body), and the `prPhase` programmatically pushes the branch and calls `CodeHost.createMergeRequest()` — then adds a `moveToStatus(BoardStatus.Review)` call after successful creation. Webhook linking is simplified to rely solely on the deterministic branch name.

## What Was Built

- **Structured PR content from agent** — `/pull_request` skill now returns JSON `{"title": "...", "body": "..."}` instead of a PR URL; `prAgent.ts` parses this JSON with a plain-text fallback
- **Programmatic PR creation in `prPhase.ts`** — branch push and `createMergeRequest()` are called by the phase after the agent returns, ensuring the correct base branch every time
- **Review status transition** — `moveToStatus(BoardStatus.Review)` is now called in `prPhase.ts` immediately after PR creation; errors are caught and logged without crashing the workflow
- **Rewritten `GitHubCodeHost.createMergeRequest()`** — calls `gh pr create` via `execSync` with a temp-file body to avoid shell-escaping issues; returns `{ url, number }`
- **Updated `GitLabCodeHost.createMergeRequest()`** — return type updated to `MergeRequestResult` (`{ url, number }`)
- **New `MergeRequestResult` interface** — added to `adws/providers/types.ts`; `CodeHost` interface updated accordingly
- **Deleted `pullRequestCreator.ts`** — dead code removed along with its barrel re-exports in `github/index.ts` and `adws/index.ts`
- **Simplified webhook issue linking** — `extractIssueNumberFromPRBody()` removed; `extractIssueNumberFromBranch()` uses only the `issue-(\d+)` pattern (verified against 145/145 historical PRs)

## Technical Implementation

### Files Modified

- `adws/providers/types.ts`: Added `MergeRequestResult` interface; `CodeHost.createMergeRequest()` now returns `MergeRequestResult` instead of `string`
- `adws/providers/github/githubCodeHost.ts`: Rewrote `createMergeRequest()` — removed `pullRequestCreator` delegation, added direct `gh pr create` via `execSync` with temp-file body, returns `{ url, number }`
- `adws/providers/gitlab/gitlabCodeHost.ts`: Updated `createMergeRequest()` to return `{ url: mr.web_url, number: mr.iid }`
- `adws/agents/prAgent.ts`: Replaced `extractPrUrlFromOutput()` with `extractPrContentFromOutput()`; exported `PrContent` interface; `runPullRequestAgent()` now returns `prContent` instead of `prUrl`
- `adws/phases/prPhase.ts`: Added `pushBranch`, `getDefaultBranch`, `BoardStatus` imports; phase now calls `createMergeRequest()` and `moveToStatus(BoardStatus.Review)` after agent returns
- `.claude/commands/pull_request.md`: Removed `git push` and `gh pr create` steps; updated `## Report` to instruct agent to return JSON `{title, body}` only
- `adws/triggers/webhookHandlers.ts`: Removed `extractIssueNumberFromPRBody()`; simplified `extractIssueNumberFromBranch()` to single `issue-(\d+)` pattern; simplified `handlePullRequestEvent()` linking logic
- `adws/github/index.ts`: Removed `createPullRequest` re-export
- `adws/index.ts`: Removed `createPullRequest` re-export

### Files Deleted

- `adws/github/pullRequestCreator.ts`: Dead code — PR creation now fully handled by `CodeHost.createMergeRequest()`

### Key Changes

- The `/pull_request` slash command no longer runs `git push` or `gh pr create` — it only analyzes the diff and returns a JSON object with `title` and `body`
- `prPhase.ts` is the single, deterministic source of truth for branch push and PR creation, using the provider layer's `createMergeRequest()` with an explicit `targetBranch` derived from `getDefaultBranch()`
- `GitHubCodeHost.createMergeRequest()` writes the PR body to a temp file before calling `gh pr create` to avoid multi-line shell-escaping failures; the temp file is cleaned up in a `finally` block
- `extractIssueNumberFromBranch()` is now the sole webhook linkage mechanism — the ADW branch format `{type}-{issueNumber}-{adwId}-{slug}` already embeds `issue-N` in the branch name, making body pattern matching redundant
- `moveToStatus(BoardStatus.Review)` is wrapped in try-catch so a board update failure never crashes the PR creation phase

## How to Use

No user-facing changes. The fix is transparent to workflow callers.

1. Run any main workflow (e.g., `bunx tsx adws/adwPlanBuild.tsx <issueNumber>`).
2. During the PR phase the agent generates PR content as JSON.
3. The phase programmatically pushes the branch and calls `createMergeRequest()` with the correct base branch.
4. The issue automatically transitions to "Review" on the project board.
5. When the PR is closed/merged, the webhook handler links the issue via the `issue-N` branch name pattern.

## Configuration

No new configuration required. Relies on existing `GH_TOKEN` / GitHub App auth for `gh pr create`.

## Testing

- `bun run lint` — verify no linting issues
- `bun run build` — verify no build errors
- `bunx tsc --noEmit -p adws/tsconfig.json` — verify interface alignment across providers
- `grep "moveToStatus.*Review" adws/phases/prPhase.ts` — confirm Review transition present
- `grep "createMergeRequest" adws/phases/prPhase.ts` — confirm programmatic PR creation
- `grep -r "createPullRequest" adws/ --include="*.ts"` — confirm deleted code has no remaining references

## Notes

- This refactor supersedes `feature-6ukg3s-1773849789984-fix-pr-default-branch-linking.md` — that doc patched the LLM prompt to pass `defaultBranch`; this fix removes the LLM from the push/create path entirely.
- The `refreshTokenIfNeeded()` call is retained in both `prAgent.ts` (before the agent runs) and `GitHubCodeHost.createMergeRequest()` (before `gh pr create`) to ensure fresh GitHub App auth at each step.
- GitLab's `createMergeRequest()` uses `mr.iid` (the project-scoped MR number) as the `number` field, consistent with how GitLab MR numbers are used elsewhere in the codebase.
