/**
 * GitHub PR API functions using the gh CLI.
 */

import { execSync } from 'child_process';
import { PRDetails, PRReviewComment, PRListItem, log } from '../core';
import { type RepoInfo } from './githubApi';
import { getTargetRepo } from '../core/targetRepoRegistry';

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
export function fetchPRDetails(prNumber: number, repoInfo?: RepoInfo): PRDetails {
  const { owner, repo } = repoInfo ?? getTargetRepo();

  try {
    const json = execSync(
      `gh pr view ${prNumber} --repo ${owner}/${repo} --json number,title,body,state,headRefName,baseRefName,url`,
      { encoding: 'utf-8' }
    );
    const raw = JSON.parse(json) as RawPRDetails;

    // Extract issue number from PR body (e.g., "Implements #12")
    const issueMatch = raw.body?.match(/Implements #(\d+)/);
    const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : null;

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
    const json = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews --paginate`,
      { encoding: 'utf-8' }
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
export function fetchPRReviewComments(prNumber: number, repoInfo?: RepoInfo): PRReviewComment[] {
  const { owner, repo } = repoInfo ?? getTargetRepo();
  log(`Fetching PR review comments for ${owner}/${repo}#${prNumber}`);

  let lineComments: PRReviewComment[] = [];
  try {
    const json = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`,
      { encoding: 'utf-8' }
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
export function commentOnPR(prNumber: number, body: string, repoInfo?: RepoInfo): void {
  const { owner, repo } = repoInfo ?? getTargetRepo();

  try {
    execSync(
      `gh pr comment ${prNumber} --repo ${owner}/${repo} --body-file -`,
      { encoding: 'utf-8', input: body, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    log(`Commented on PR #${prNumber}`, 'success');
  } catch (error) {
    log(`Failed to comment on PR: ${error}`, 'error');
  }
}

/**
 * Fetches open PRs for CRON trigger polling.
 * @param repoInfo - Optional repository info override for targeting external repositories.
 */
export function fetchPRList(repoInfo?: RepoInfo): PRListItem[] {
  const { owner, repo } = repoInfo ?? getTargetRepo();

  try {
    const json = execSync(
      `gh pr list --repo ${owner}/${repo} --state open --json number,headRefName,updatedAt`,
      { encoding: 'utf-8' }
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
