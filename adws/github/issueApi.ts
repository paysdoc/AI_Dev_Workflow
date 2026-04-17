/**
 * GitHub Issue API functions using the gh CLI.
 */

import { execWithRetry } from '../core';
import { GitHubIssue, IssueCommentSummary, log } from '../core';
import { type RepoInfo } from './githubApi';


interface RawGitHubUser {
  login?: string;
  name?: string | null;
  is_bot?: boolean;
}

interface RawGitHubLabel {
  id?: string;
  name: string;
  color?: string;
  description?: string | null;
}

interface RawGitHubMilestone {
  id?: string;
  number: number;
  title: string;
  description?: string | null;
  state: string;
}

interface RawGitHubComment {
  id?: string;
  author?: RawGitHubUser;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
}

interface RawGitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  author?: RawGitHubUser;
  assignees?: RawGitHubUser[];
  labels?: RawGitHubLabel[];
  milestone?: RawGitHubMilestone | null;
  comments?: RawGitHubComment[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  url: string;
}

/**
 * Transforms raw GitHub API response to GitHubIssue format.
 */
function transformIssueResponse(rawIssue: RawGitHubIssue): GitHubIssue {
  return {
    number: rawIssue.number,
    title: rawIssue.title,
    body: rawIssue.body || '',
    state: rawIssue.state,
    author: {
      login: rawIssue.author?.login || 'unknown',
      name: rawIssue.author?.name || null,
      isBot: rawIssue.author?.is_bot || false
    },
    assignees: (rawIssue.assignees || []).map((a) => ({
      login: a.login || 'unknown',
      name: a.name || null,
      isBot: a.is_bot || false
    })),
    labels: (rawIssue.labels || []).map((l) => ({
      id: l.id || '',
      name: l.name,
      color: l.color || '',
      description: l.description || null
    })),
    milestone: rawIssue.milestone ? {
      id: rawIssue.milestone.id || '',
      number: rawIssue.milestone.number,
      title: rawIssue.milestone.title,
      description: rawIssue.milestone.description || null,
      state: rawIssue.milestone.state
    } : null,
    comments: (rawIssue.comments || []).map((c) => ({
      id: c.id || '',
      author: {
        login: c.author?.login || 'unknown',
        name: c.author?.name || null,
        isBot: c.author?.is_bot || false
      },
      body: c.body,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt || null
    })),
    createdAt: rawIssue.createdAt,
    updatedAt: rawIssue.updatedAt,
    closedAt: rawIssue.closedAt || null,
    url: rawIssue.url
  };
}

/**
 * Fetches a GitHub issue by number using the gh CLI.
 * @param issueNumber - The issue number to fetch
 * @param repoInfo - Optional repository info override for targeting external repositories. Falls back to local git remote when not provided.
 */
export async function fetchGitHubIssue(issueNumber: number, repoInfo: RepoInfo): Promise<GitHubIssue> {
  const { owner, repo } = repoInfo;

  try {
    const issueJson = execWithRetry(
      `gh issue view ${issueNumber} --repo ${owner}/${repo} --json number,title,body,state,author,assignees,labels,milestone,comments,createdAt,updatedAt,closedAt,url`
    );

    const rawIssue = JSON.parse(issueJson) as RawGitHubIssue;
    return transformIssueResponse(rawIssue);
  } catch (error) {
    throw new Error(`Failed to fetch issue #${issueNumber}: ${error}`);
  }
}

/**
 * Posts a comment on a GitHub issue.
 * @param issueNumber - The issue number to comment on
 * @param body - The comment body text
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function commentOnIssue(issueNumber: number, body: string, repoInfo: RepoInfo): void {
  const { owner, repo } = repoInfo;

  try {
    execWithRetry(
      `gh issue comment ${issueNumber} --repo ${owner}/${repo} --body-file -`,
      { input: body, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    log(`Commented on issue #${issueNumber}`, 'success');
  } catch (error) {
    log(`Failed to comment on issue: ${error}`, 'error');
  }
}

/**
 * Formats a closure comment for an issue when its associated PR is closed.
 */
export function formatIssueClosureComment(prNumber: number, prUrl: string, wasMerged: boolean): string {
  const statusEmoji = wasMerged ? '\u2705' : '\uD83D\uDD34';
  const statusText = wasMerged ? 'merged' : 'closed without merging';
  const additionalInfo = wasMerged
    ? 'The implementation has been merged into the main branch.'
    : 'The associated PR was closed without merging.';

  return `${statusEmoji} **ADW Workflow Complete**

This issue has been ${statusText} via PR #${prNumber}.

${additionalInfo}

[View Pull Request](${prUrl})`;
}

/**
 * Fetches the current state of a GitHub issue.
 * Returns the issue state ('OPEN' or 'CLOSED').
 * @param issueNumber - The issue number to check
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function getIssueState(issueNumber: number, repoInfo: RepoInfo): string {
  const { owner, repo } = repoInfo;

  try {
    const json = execWithRetry(
      `gh issue view ${issueNumber} --repo ${owner}/${repo} --json state`
    );
    const result = JSON.parse(json);
    return result.state;
  } catch (error) {
    log(`Failed to get issue state for #${issueNumber}: ${error}`, 'error');
    throw error;
  }
}

/**
 * Closes a GitHub issue with an optional comment.
 * @param issueNumber - The issue number to close
 * @param comment - Optional comment to post before closing
 * @param repoInfo - Optional repository info override for targeting external repositories.
 * @returns true if the issue was closed, false if already closed or error occurred
 */
export async function closeIssue(issueNumber: number, repoInfo: RepoInfo, comment?: string): Promise<boolean> {
  const { owner, repo } = repoInfo;

  try {
    // Check if issue is already closed
    const state = getIssueState(issueNumber, repoInfo);
    if (state === 'CLOSED') {
      log(`Issue #${issueNumber} is already closed, skipping`, 'info');
      return false;
    }

    // Post comment before closing if provided
    if (comment) {
      commentOnIssue(issueNumber, comment, repoInfo);
    }

    // Close the issue
    execWithRetry(
      `gh issue close ${issueNumber} --repo ${owner}/${repo}`
    );
    log(`Closed issue #${issueNumber}`, 'success');
    return true;
  } catch (error) {
    log(`Failed to close issue #${issueNumber}: ${error}`, 'error');
    return false;
  }
}

/**
 * Fetches the title of a GitHub issue synchronously.
 * Returns '(unknown)' on error to avoid breaking callers that use this for logging.
 * @param issueNumber - The issue number to fetch the title for
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function getIssueTitleSync(issueNumber: number, repoInfo: RepoInfo): string {
  const { owner, repo } = repoInfo;

  try {
    const json = execWithRetry(
      `gh issue view ${issueNumber} --repo ${owner}/${repo} --json title`
    );
    const result = JSON.parse(json) as { title: string };
    return result.title;
  } catch {
    return '(unknown)';
  }
}

/**
 * Fetches all comments on a GitHub issue via the REST API.
 * Returns comments with numeric IDs needed for deletion.
 * @param issueNumber - The issue number to fetch comments for
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function fetchIssueCommentsRest(issueNumber: number, repoInfo: RepoInfo): IssueCommentSummary[] {
  const { owner, repo } = repoInfo;
  try {
    const json = execWithRetry(
      `gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`
    );
    const raw = JSON.parse(json);
    return (raw as Record<string, unknown>[]).map((c: Record<string, unknown>) => ({
      id: c.id as number,
      body: (c.body as string) || '',
      authorLogin: (c.user as Record<string, unknown>)?.login as string || 'unknown',
      createdAt: c.created_at as string,
    }));
  } catch (error) {
    throw new Error(`Failed to fetch comments for issue #${issueNumber}: ${error}`);
  }
}

/**
 * Checks whether a GitHub issue has a specific label by performing a real-time
 * `gh issue view --json labels` call. Returns `false` on error (fail-open design —
 * if the check cannot be completed, auto-merge proceeds normally).
 * @param issueNumber - The issue number to inspect
 * @param labelName - The label name to look for (case-sensitive)
 * @param repoInfo - Repository owner and repo name
 */
export function issueHasLabel(issueNumber: number, labelName: string, repoInfo: RepoInfo): boolean {
  const { owner, repo } = repoInfo;

  try {
    const json = execWithRetry(
      `gh issue view ${issueNumber} --repo ${owner}/${repo} --json labels`
    );
    const result = JSON.parse(json) as { labels: { name: string }[] };
    return (result.labels || []).some((l) => l.name === labelName);
  } catch (error) {
    log(`issueHasLabel: failed to check label "${labelName}" on issue #${issueNumber}: ${error}`, 'warn');
    return false;
  }
}

/**
 * Adds a label to a GitHub issue.
 * @param issueNumber - The issue number to label
 * @param labelName - The label name to add
 * @param repoInfo - Repository owner and repo name
 */
export function addIssueLabel(issueNumber: number, labelName: string, repoInfo: RepoInfo): void {
  const { owner, repo } = repoInfo;
  try {
    execWithRetry(
      `gh issue edit ${issueNumber} --repo ${owner}/${repo} --add-label ${labelName}`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    log(`Added label "${labelName}" to issue #${issueNumber}`, 'success');
  } catch (error) {
    log(`Failed to add label "${labelName}" to issue #${issueNumber}: ${error}`, 'error');
  }
}

/**
 * Deletes a single issue comment by its REST API numeric ID.
 * @param commentId - The numeric ID of the comment to delete
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function deleteIssueComment(commentId: number, repoInfo: RepoInfo): void {
  const { owner, repo } = repoInfo;
  try {
    execWithRetry(
      `gh api -X DELETE repos/${owner}/${repo}/issues/comments/${commentId}`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    log(`Deleted comment ${commentId}`, 'success');
  } catch (error) {
    throw new Error(`Failed to delete comment ${commentId}: ${error}`);
  }
}
