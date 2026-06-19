# GitHub API

## Overview

This module provides all GitHub API interactions used by ADW: a thin wrapper around `gh` CLI commands, GitHub App JWT authentication, issue and PR CRUD operations, workflow comment routing, and label lifecycle management. It is the sole interface between ADW's orchestrators and the GitHub platform.

## Responsibilities

- `getRepoInfo`: parses `owner/repo` from the local git remote URL (HTTPS or SSH).
- `getRepoInfoFromUrl` / `getRepoInfoFromPayload`: parse `owner/repo` from a URL or `owner/repo` string.
- `getAuthenticatedUser`: returns the currently authenticated GitHub username via `gh api user`; result is cached for the process lifetime.
- `activateGitHubAppAuth`: generates a GitHub App installation token and sets `GH_TOKEN` + git identity env vars; returns false when the app is not configured.
- `ensureAppAuthForRepo`: checks whether the active `GH_TOKEN` targets the given repo and refreshes it if not; used by the webhook handler where each request may target a different repo.
- `refreshTokenIfNeeded`: refreshes the installation token when it is within 5 minutes of expiry; no-op when the app is not configured.
- `getInstallationToken`: returns a valid installation token for a repo, fetching and caching a new one when the cached token is near expiry.
- `fetchGitHubIssue`: fetches a full issue via `gh issue view --json`; maps the raw response to the `GitHubIssue` type.
- `commentOnIssue` / `deleteIssueComment`: post and delete issue comments.
- `fetchIssueCommentsRest`: fetches all issue comments via the REST API with numeric IDs.
- `issueHasLabel` / `addIssueLabel`: check and apply labels to issues; `issueHasLabel` fails open (returns false on error).
- `createIssue` / `updateIssueBody` / `closeIssue`: create, update, and close issues.
- `findOpenUpgradeIssue`: returns the number of the first open `adw:upgrade`-labeled issue, or null.
- `getIssueState` / `getIssueTitleSync`: read issue state and title synchronously.
- `fetchPRDetails`: fetches PR metadata; extracts `issueNumber` from the PR body (`Implements #N`) or falls back to the branch name pattern.
- `fetchPRReviewComments` / `fetchPRReviews`: fetch line-level and review-body comments for a PR.
- `commentOnPR`: posts a comment on a PR.
- `mergePR`: merges a PR with a merge-commit strategy.
- `approvePR`: approves a PR; when a GitHub App is active, temporarily swaps `GH_TOKEN` to `GITHUB_PAT` so the approval comes from a personal account (GitHub forbids self-approval).
- `fetchPRApprovalState`: checks approval using `reviewDecision`; falls back to per-reviewer-latest aggregation (`isApprovedFromReviewsList`) when `reviewDecision` is null or empty.
- `fetchPRList`: fetches open PRs for cron polling.
- `selectPreferredPR`: picks the most-recently-updated open PR for a branch, or the most-recently-updated PR overall when none are open.
- `readAdwLabelNames` / `readAdwLabels`: pure functions that interpret a list of label names into an `AdwLabelReading` with `optOut`, `classification`, and `conflict` fields.
- `ensureAdwLabelsExist`: idempotently creates all seven `adw:*` labels on a repo using `--force`.
- `applyLabel`: adds a label to an issue; on "not found" errors, lazy-creates the label and retries once.
- `workflowComments`: re-exports comment parsing (ADW signature detection, stage extraction, recovery-state detection) and comment-posting functions for both issues and PRs.

## Contracts & Invariants

- `activateGitHubAppAuth` sets `process.env.GH_TOKEN` globally; all subsequent `gh` CLI invocations in the process use the app identity until `ensureAppAuthForRepo` switches it.
- Installation tokens are cached per `owner/repo`; the REFRESH_BUFFER_MS (5 min) ensures tokens are renewed before GitHub rejects them.
- `approvePR` restores the original `GH_TOKEN` in its `finally` block regardless of success or failure.
- `fetchPRApprovalState` treats an empty string `reviewDecision` the same as null (GitHub CLI returns `""` on repos without branch protection).
- `issueHasLabel` is fail-open — it returns `false` on any error so that auto-merge proceeds normally when the label check cannot complete.
- `readAdwLabelNames` is pure: same inputs always produce the same `AdwLabelReading`.
- `ADW_CLASSIFICATION_LABELS` maps the four classification label names to their slash-command counterparts; `ADW_NONE_LABEL` (`adw:none`) signals opt-out.

## Configuration

GitHub App authentication requires `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY_PATH` env vars. `GITHUB_PAT` is required alongside app configuration for `approvePR`. When these vars are absent, `isGitHubAppConfigured()` returns false and `activateGitHubAppAuth` is a no-op.

## Gotchas

- `activeRepo` is a module-level singleton; in the webhook server (which handles multiple repos concurrently), `ensureAppAuthForRepo` must be called per-request before any `gh` call — otherwise a prior request's token may be in effect.
- `selectPreferredPR` prefers OPEN PRs to prevent a closed/merged PR from blocking the active open one on the same branch (issue #508).
- `getAuthenticatedUser` caches `null` on failure rather than retrying; a failed lookup at startup persists for the process lifetime.
- `workflowComments` is a barrel re-export; some symbols come from `core/workflowCommentParsing` (platform-agnostic) and some from GitHub-specific sub-modules.
- `hasWontFixLabel` in `prApi` normalizes label names (lowercase, strip punctuation) for matching, so `wontfix`, `Won't fix`, and `wont-fix` all match.
