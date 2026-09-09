/**
 * GitHub implementation of the CodeHost interface.
 *
 * Binds `createGhRepoApi(ctx)` once at construction, over a `GitContext` the
 * caller already holds. Every method reproduces the command, parse, error
 * policy and log line of its absorbed legacy free function
 * (`adws/github/prApi.ts`) exactly, logging through the injected `Logger`
 * port instead of `adws/core`'s `log`.
 */

import { consoleLogger, type GitContext, type Logger } from '../../gitContext';
import { createGhRepoApi, type GhRepoApi } from './ghRepoApi';
import { assertContextBoundTo } from './contextBinding';
import {
  parsePRDetails,
  parsePRReviews,
  parsePRLineComments,
  parsePRListItems,
  selectPreferredPR,
  parsePRApprovalState,
  type RawPRListEntry,
} from './ghPrParsers';
import {
  mapPRDetailsToPullRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToPullRequest,
  mapRawPRToSummary,
} from './mappers';
import {
  type CodeHost,
  type CreatePROptions,
  type ForgeActionResult,
  type MergedPullRequestRecord,
  type PullRequest,
  type PullRequestResult,
  type PullRequestSummary,
  type RepoIdentifier,
  type ReviewComment,
  validateRepoIdentifier,
} from '../types';

export interface GitHubCodeHostDeps {
  readonly logger?: Logger;
}

/** `error.stderr` when present (child-process failures), else `String(error)`. */
function stderrOf(error: unknown): string {
  return (error as { stderr?: string }).stderr || String(error);
}

/**
 * GitHub-specific implementation of the CodeHost interface. Bound to a
 * specific repository and `GitContext` at construction time.
 */
export class GitHubCodeHost implements CodeHost {
  private readonly gh: GhRepoApi;
  private readonly logger: Logger;

  constructor(ctx: GitContext, private readonly repoId: RepoIdentifier, deps: GitHubCodeHostDeps = {}) {
    assertContextBoundTo(ctx, repoId, 'createGitHubCodeHost');
    this.gh = createGhRepoApi(ctx);
    this.logger = deps.logger ?? consoleLogger;
  }

  /** Returns the bound RepoIdentifier. */
  getRepoIdentifier(): RepoIdentifier {
    return this.repoId;
  }

  getDefaultBranch(): string {
    return this.gh.defaultBranch();
  }

  /** Fetches PR details and maps to PullRequest. */
  fetchPullRequest(prNumber: number): PullRequest {
    try {
      return mapPRDetailsToPullRequest(parsePRDetails(this.gh.fetchPRDetails(prNumber)));
    } catch (error) {
      throw new Error(`Failed to fetch PR #${prNumber}: ${error}`);
    }
  }

  /** Posts a comment on the specified PR. */
  commentOnPullRequest(prNumber: number, body: string): void {
    try {
      this.gh.commentOnPR(prNumber, body);
      this.logger(`Commented on PR #${prNumber}`, 'success');
    } catch (error) {
      this.logger(`Failed to comment on PR: ${error}`, 'error');
    }
  }

  private fetchLineComments(prNumber: number): ReturnType<typeof parsePRLineComments> {
    try {
      return parsePRLineComments(this.gh.fetchPRReviewComments(prNumber));
    } catch (error) {
      this.logger(`Failed to fetch PR review comments: ${error}`, 'error');
      return [];
    }
  }

  private fetchReviewBodies(prNumber: number): ReturnType<typeof parsePRReviews> {
    try {
      return parsePRReviews(this.gh.fetchPRReviews(prNumber));
    } catch (error) {
      this.logger(`Failed to fetch PR reviews: ${error}`, 'error');
      return [];
    }
  }

  /** Fetches review comments (line-level + review-body) and maps to ReviewComment[]. */
  fetchReviewComments(prNumber: number): ReviewComment[] {
    const { owner, repo } = this.repoId;
    this.logger(`Fetching PR review comments for ${owner}/${repo}#${prNumber}`);

    const lineComments = this.fetchLineComments(prNumber);
    this.logger(`Fetched ${lineComments.length} line-level comments for ${owner}/${repo}#${prNumber}`);

    const reviewBodyComments = this.fetchReviewBodies(prNumber);
    this.logger(`Fetched ${reviewBodyComments.length} review-body comments for ${owner}/${repo}#${prNumber}`);

    const allComments = [...lineComments, ...reviewBodyComments];
    this.logger(`Total: ${allComments.length} comments for ${owner}/${repo}#${prNumber}`);
    return allComments.map(mapPRReviewCommentToReviewComment);
  }

  /** Lists open PRs and maps to PullRequest[]. */
  listOpenPullRequests(): PullRequest[] {
    try {
      return parsePRListItems(this.gh.fetchPRList()).map(mapPRListItemToPullRequest);
    } catch (error) {
      this.logger(`Failed to fetch PR list: ${error}`, 'error');
      return [];
    }
  }

  /**
   * Creates a pull request via `gh pr create` with the provided title and body.
   * Reuses an existing open PR on the branch, if one is found, rather than
   * opening a second. Returns the PR URL and number.
   */
  createPullRequest(options: CreatePROptions): PullRequestResult {
    try {
      const existingJson = this.gh.findPRByBranch(options.sourceBranch);
      const parsed = JSON.parse(existingJson) as Array<{ number: number; state: string; headRefName: string; baseRefName: string; updatedAt: string }>;
      const open = parsed.filter((p) => p.state === 'OPEN');
      if (open.length > 0) {
        const pr = open[0];
        const url = `https://github.com/${this.repoId.owner}/${this.repoId.repo}/pull/${pr.number}`;
        this.logger(`Existing PR #${pr.number} found for branch ${options.sourceBranch}, reusing`, 'info');
        return { url, number: pr.number };
      }
    } catch {
      // If the check fails, fall through to normal PR creation
    }

    const prUrl = this.gh.createPR(options.title, options.body, options.sourceBranch, options.targetBranch);

    const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
    if (!numberMatch) {
      throw new Error(`Could not extract PR number from URL: ${prUrl}`);
    }

    return { url: prUrl, number: parseInt(numberMatch[1], 10) };
  }

  /** Finds the PR for a branch (open, or most-recently-updated when none are open); null if none. */
  findPullRequestByBranch(branchName: string): PullRequestSummary | null {
    try {
      const pr = selectPreferredPR(JSON.parse(this.gh.findPRByBranch(branchName)) as RawPRListEntry[]);
      return pr ? mapRawPRToSummary(pr) : null;
    } catch {
      return null;
    }
  }

  /** True when the PR has at least one qualifying approval. */
  isPullRequestApproved(prNumber: number): boolean {
    try {
      return parsePRApprovalState(this.gh.prApprovalState(prNumber));
    } catch (error) {
      this.logger(`fetchPRApprovalState: failed to fetch reviews for PR #${prNumber}: ${error}`, 'warn');
      return false;
    }
  }

  /** Approves a PR under the bound identity. */
  approvePullRequest(prNumber: number): ForgeActionResult {
    try {
      this.gh.approvePR(prNumber);
      this.logger(`Approved PR #${prNumber} in ${this.repoId.owner}/${this.repoId.repo}`, 'success');
      return { success: true };
    } catch (error) {
      const stderr = stderrOf(error);
      this.logger(`Failed to approve PR #${prNumber}: ${stderr}`, 'error');
      return { success: false, error: stderr };
    }
  }

  /** Merges a PR. */
  mergePullRequest(prNumber: number): ForgeActionResult {
    try {
      this.gh.mergePR(prNumber);
      this.logger(`Merged PR #${prNumber} in ${this.repoId.owner}/${this.repoId.repo}`, 'success');
      return { success: true };
    } catch (error) {
      const stderr = stderrOf(error);
      this.logger(`Failed to merge PR #${prNumber}: ${stderr}`, 'error');
      return { success: false, error: stderr };
    }
  }

  /** Sets a repo secret (e.g. GitHub Actions). */
  setSecret(name: string, value: string): void {
    this.gh.setSecret(name, value);
  }

  /** Merged PRs, newest first, at most `limit`. Throws on failure. */
  listMergedPullRequests(limit: number): readonly MergedPullRequestRecord[] {
    return JSON.parse(this.gh.fetchMergedPRs(limit)) as MergedPullRequestRecord[];
  }
}

/**
 * Factory function that creates a GitHubCodeHost bound to the given
 * `GitContext` and repository. Validates the RepoIdentifier and refuses a
 * context bound to a different owner/repo before construction.
 */
export function createGitHubCodeHost(ctx: GitContext, repoId: RepoIdentifier, deps: GitHubCodeHostDeps = {}): CodeHost {
  validateRepoIdentifier(repoId);
  return new GitHubCodeHost(ctx, repoId, deps);
}
