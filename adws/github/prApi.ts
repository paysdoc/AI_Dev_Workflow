/**
 * GitHub PR API functions using the gh CLI.
 */

import { execWithRetry } from '../core';
import { PRDetails, PRReviewComment, PRListItem, log } from '../core';
import { type RepoInfo } from './githubApi';
import { extractIssueNumberFromBranch } from '../triggers/webhookHandlers';


interface RawPRDetails {
  number: number;
  title: string;
  body?: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
}

interface RawPRReview {
  id: number;
  state: string;
  body?: string;
  submitted_at: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface RawPRLineComment {
  id: number;
  body: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  created_at: string;
  updated_at: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface RawPRListItem {
  number: number;
  headRefName: string;
  updatedAt: string;
}

/**
 * Fetches PR details using the gh CLI.
 * @param prNumber - The PR number to fetch
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function fetchPRDetails(prNumber: number, repoInfo: RepoInfo): PRDetails {
  const { owner, repo } = repoInfo;

  try {
    const json = execWithRetry(
      `gh pr view ${prNumber} --repo ${owner}/${repo} --json number,title,body,state,headRefName,baseRefName,url`
    );
    const raw = JSON.parse(json) as RawPRDetails;

    // Extract issue number from PR body (e.g., "Implements #12"), falling back to branch name
    const issueMatch = raw.body?.match(/Implements #(\d+)/);
    const issueNumber = issueMatch
      ? parseInt(issueMatch[1], 10)
      : extractIssueNumberFromBranch(raw.headRefName);

    return {
      number: raw.number,
      title: raw.title,
      body: raw.body || '',
      state: raw.state,
      headBranch: raw.headRefName,
      baseBranch: raw.baseRefName,
      url: raw.url,
      issueNumber,
      reviewComments: [],
    };
  } catch (error) {
    throw new Error(`Failed to fetch PR #${prNumber}: ${error}`);
  }
}

/**
 * Fetches PR review-body comments (top-level review submissions) using the GitHub API.
 * These are comments submitted via the "Submit review" dialog, not attached to specific code lines.
 */
export function fetchPRReviews(owner: string, repo: string, prNumber: number): PRReviewComment[] {
  try {
    const json = execWithRetry(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews --paginate`
    );
    const raw = JSON.parse(json) as RawPRReview[];

    return raw
      .filter((r) => r.state !== 'PENDING' && ((r.body && r.body.trim() !== '') || r.state === 'CHANGES_REQUESTED'))
      .map((r) => ({
        id: r.id,
        author: {
          login: r.user?.login || 'unknown',
          name: null,
          isBot: r.user?.type === 'Bot',
        },
        body: (r.body && r.body.trim() !== '') ? r.body : `[Review submitted: ${r.state}]`,
        path: '',
        line: null,
        createdAt: r.submitted_at,
        updatedAt: r.submitted_at,
      }));
  } catch (error) {
    log(`Failed to fetch PR reviews: ${error}`, 'error');
    return [];
  }
}

/**
 * Fetches all PR review comments: both line-level comments and review-body comments.
 * @param prNumber - The PR number to fetch comments for
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function fetchPRReviewComments(prNumber: number, repoInfo: RepoInfo): PRReviewComment[] {
  const { owner, repo } = repoInfo;
  log(`Fetching PR review comments for ${owner}/${repo}#${prNumber}`);

  let lineComments: PRReviewComment[] = [];
  try {
    const json = execWithRetry(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`
    );
    const raw = JSON.parse(json) as RawPRLineComment[];

    lineComments = raw.map((c) => ({
      id: c.id,
      author: {
        login: c.user?.login || 'unknown',
        name: null,
        isBot: c.user?.type === 'Bot',
      },
      body: c.body,
      path: c.path || '',
      line: c.line || c.original_line || null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  } catch (error) {
    log(`Failed to fetch PR review comments: ${error}`, 'error');
  }

  log(`Fetched ${lineComments.length} line-level comments for ${owner}/${repo}#${prNumber}`);

  const reviewBodyComments = fetchPRReviews(owner, repo, prNumber);
  log(`Fetched ${reviewBodyComments.length} review-body comments for ${owner}/${repo}#${prNumber}`);

  const allComments = [...lineComments, ...reviewBodyComments];
  log(`Total: ${allComments.length} comments for ${owner}/${repo}#${prNumber}`);
  return allComments;
}

/**
 * Posts a comment on a PR.
 * @param prNumber - The PR number to comment on
 * @param body - The comment body text
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function commentOnPR(prNumber: number, body: string, repoInfo: RepoInfo): void {
  const { owner, repo } = repoInfo;

  try {
    execWithRetry(
      `gh pr comment ${prNumber} --repo ${owner}/${repo} --body-file -`,
      { input: body, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    log(`Commented on PR #${prNumber}`, 'success');
  } catch (error) {
    log(`Failed to comment on PR: ${error}`, 'error');
  }
}

/**
 * Attempts to merge a PR using the gh CLI with a merge commit strategy.
 * @param prNumber - The PR number to merge
 * @param repoInfo - Repository info (owner/repo)
 * @returns Success flag and optional error message
 */
export function mergePR(prNumber: number, repoInfo: RepoInfo): { success: boolean; error?: string } {
  const { owner, repo } = repoInfo;
  try {
    execWithRetry(
      `gh pr merge ${prNumber} --merge --repo ${owner}/${repo}`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    log(`Merged PR #${prNumber} in ${owner}/${repo}`, 'success');
    return { success: true };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr || String(error);
    log(`Failed to merge PR #${prNumber}: ${stderr}`, 'error');
    return { success: false, error: stderr };
  }
}

/**
 * Approves a PR using the personal gh auth login identity.
 *
 * When a GitHub App is active (`GH_TOKEN` is set to the app token), the PR was authored
 * by the bot. GitHub does not allow a user to approve their own PR, so we temporarily
 * unset `GH_TOKEN` to force `gh` to fall back to the personal `gh auth login` identity,
 * which is a different actor from the bot author.
 *
 * @param prNumber - The PR number to approve
 * @param repoInfo - Repository info (owner/repo)
 * @returns Success flag and optional error message
 */
export function approvePR(prNumber: number, repoInfo: RepoInfo): { success: boolean; error?: string } {
  const { owner, repo } = repoInfo;
  const savedToken = process.env.GH_TOKEN;

  try {
    // Temporarily unset GH_TOKEN so gh uses the personal gh auth login identity
    delete process.env.GH_TOKEN;
    execWithRetry(
      `gh pr review ${prNumber} --approve --repo ${owner}/${repo}`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    log(`Approved PR #${prNumber} in ${owner}/${repo}`, 'success');
    return { success: true };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr || String(error);
    log(`Failed to approve PR #${prNumber}: ${stderr}`, 'error');
    return { success: false, error: stderr };
  } finally {
    // Restore GH_TOKEN regardless of outcome
    if (savedToken !== undefined) {
      process.env.GH_TOKEN = savedToken;
    }
  }
}

/**
 * Fetches open PRs for CRON trigger polling.
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function fetchPRList(repoInfo: RepoInfo): PRListItem[] {
  const { owner, repo } = repoInfo;

  try {
    const json = execWithRetry(
      `gh pr list --repo ${owner}/${repo} --state open --json number,headRefName,updatedAt`
    );
    const raw = JSON.parse(json) as RawPRListItem[];

    return raw.map((pr) => ({
      number: pr.number,
      headBranch: pr.headRefName,
      updatedAt: pr.updatedAt,
    }));
  } catch (error) {
    log(`Failed to fetch PR list: ${error}`, 'error');
    return [];
  }
}
