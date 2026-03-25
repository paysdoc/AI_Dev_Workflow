/**
 * GitHub implementation of the CodeHost interface.
 * Delegates to existing prApi and gitBranchOperations functions.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RepoInfo } from '../../github/githubApi';
import { fetchPRDetails, fetchPRReviewComments, commentOnPR, fetchPRList } from '../../github/prApi';
import { getDefaultBranch as ghGetDefaultBranch } from '../../vcs/branchOperations';
import { refreshTokenIfNeeded } from '../../github/githubAppAuth';
import {
  type CodeHost,
  type CreateMROptions,
  type MergeRequest,
  type MergeRequestResult,
  type RepoIdentifier,
  type ReviewComment,
  validateRepoIdentifier,
} from '../types';
import {
  mapPRDetailsToMergeRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToMergeRequest,
} from './mappers';

/**
 * GitHub-specific implementation of the CodeHost interface.
 * Bound to a specific repository at construction time.
 */
export class GitHubCodeHost implements CodeHost {
  private readonly repoId: RepoIdentifier;
  private readonly repoInfo: RepoInfo;

  constructor(repoId: RepoIdentifier) {
    this.repoId = repoId;
    this.repoInfo = { owner: repoId.owner, repo: repoId.repo };
  }

  /** Returns the bound RepoIdentifier. */
  getRepoIdentifier(): RepoIdentifier {
    return this.repoId;
  }

  /** Delegates to gitBranchOperations.getDefaultBranch(). */
  getDefaultBranch(): string {
    return ghGetDefaultBranch();
  }

  /** Fetches PR details and maps to MergeRequest. */
  fetchMergeRequest(mrNumber: number): MergeRequest {
    const pr = fetchPRDetails(mrNumber, this.repoInfo);
    return mapPRDetailsToMergeRequest(pr);
  }

  /** Posts a comment on the specified PR. */
  commentOnMergeRequest(mrNumber: number, body: string): void {
    commentOnPR(mrNumber, body, this.repoInfo);
  }

  /** Fetches review comments and maps to ReviewComment[]. */
  fetchReviewComments(mrNumber: number): ReviewComment[] {
    const comments = fetchPRReviewComments(mrNumber, this.repoInfo);
    return comments.map(mapPRReviewCommentToReviewComment);
  }

  /** Lists open PRs and maps to MergeRequest[]. */
  listOpenMergeRequests(): MergeRequest[] {
    const items = fetchPRList(this.repoInfo);
    return items.map(mapPRListItemToMergeRequest);
  }

  /**
   * Creates a pull request via `gh pr create` with the provided title and body.
   * Writes the body to a temp file to avoid shell-escaping issues.
   * Returns the PR URL and number.
   */
  createMergeRequest(options: CreateMROptions): MergeRequestResult {
    refreshTokenIfNeeded();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-pr-'));
    const tempFilePath = path.join(tempDir, 'pr-body.md');

    try {
      fs.writeFileSync(tempFilePath, options.body, 'utf-8');

      const repoFlag = `--repo ${this.repoInfo.owner}/${this.repoInfo.repo}`;
      const prUrl = execSync(
        `gh pr create --title "${options.title.replace(/"/g, '\\"')}" --body-file "${tempFilePath}" --base "${options.targetBranch}" --head "${options.sourceBranch}" ${repoFlag}`,
        { encoding: 'utf-8', shell: '/bin/bash' },
      ).trim();

      const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
      if (!numberMatch) {
        throw new Error(`Could not extract PR number from URL: ${prUrl}`);
      }

      return { url: prUrl, number: parseInt(numberMatch[1], 10) };
    } finally {
      try {
        fs.unlinkSync(tempFilePath);
        fs.rmdirSync(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Factory function that creates a GitHubCodeHost bound to the given repository.
 * Validates the RepoIdentifier before construction.
 */
export function createGitHubCodeHost(repoId: RepoIdentifier): CodeHost {
  validateRepoIdentifier(repoId);
  return new GitHubCodeHost(repoId);
}
