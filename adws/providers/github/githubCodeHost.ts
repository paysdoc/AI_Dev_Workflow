/**
 * GitHub implementation of the CodeHost interface.
 *
 * Wraps existing GitHub PR/code-review operations behind the platform-agnostic
 * CodeHost interface. The class is bound to a specific repository at construction
 * time via a RepoIdentifier, ensuring all operations target the correct repo.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from '../../core';
import { fetchPRDetails, fetchPRReviewComments, commentOnPR, fetchPRList } from '../../github/prApi';
import { pushBranch } from '../../github/gitCommitOperations';
import type { RepoInfo } from '../../github/githubApi';
import type { CodeHost, RepoIdentifier, MergeRequest, ReviewComment, CreateMROptions } from '../types';
import { validateRepoIdentifier } from '../types';
import {
  mapPRDetailsToMergeRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToMergeRequest,
} from './mappers';

/**
 * GitHub-specific implementation of the CodeHost interface.
 *
 * All operations are bound to the RepoIdentifier provided at construction time.
 * Delegates to existing functions in prApi.ts and gitCommitOperations.ts,
 * applying type transformations between GitHub-specific and platform-agnostic types.
 */
export class GitHubCodeHost implements CodeHost {
  private readonly repoId: RepoIdentifier;
  private readonly repoInfo: RepoInfo;

  constructor(repoId: RepoIdentifier) {
    validateRepoIdentifier(repoId);
    this.repoId = repoId;
    this.repoInfo = { owner: repoId.owner, repo: repoId.repo };
  }

  /** Returns the bound RepoIdentifier. */
  getRepoIdentifier(): RepoIdentifier {
    return this.repoId;
  }

  /**
   * Gets the default branch of the bound repository using the GitHub CLI.
   * Targets the specific repo via `--repo owner/repo` flag, fixing the
   * inconsistency where the existing function only targets the cwd repo.
   */
  getDefaultBranch(): string {
    try {
      const result = execSync(
        `gh repo view --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --json defaultBranchRef --jq '.defaultBranchRef.name'`,
        { encoding: 'utf-8' }
      );
      const branchName = result.trim();

      if (!branchName) {
        throw new Error('GitHub CLI returned empty default branch name');
      }

      return branchName;
    } catch (error) {
      throw new Error(`Failed to get default branch for ${this.repoInfo.owner}/${this.repoInfo.repo}: ${error}`);
    }
  }

  /**
   * Fetches PR details and maps them to a platform-agnostic MergeRequest.
   * @param mrNumber - The pull request number to fetch
   */
  fetchMergeRequest(mrNumber: number): MergeRequest {
    const prDetails = fetchPRDetails(mrNumber, this.repoInfo);
    return mapPRDetailsToMergeRequest(prDetails);
  }

  /**
   * Posts a comment on a pull request.
   * @param mrNumber - The pull request number to comment on
   * @param body - The comment body text
   */
  commentOnMergeRequest(mrNumber: number, body: string): void {
    commentOnPR(mrNumber, body, this.repoInfo);
  }

  /**
   * Fetches all review comments for a pull request and maps them to platform-agnostic ReviewComments.
   * @param mrNumber - The pull request number to fetch comments for
   */
  fetchReviewComments(mrNumber: number): ReviewComment[] {
    const comments = fetchPRReviewComments(mrNumber, this.repoInfo);
    return comments.map(mapPRReviewCommentToReviewComment);
  }

  /**
   * Lists all open pull requests and maps them to platform-agnostic MergeRequests.
   */
  listOpenMergeRequests(): MergeRequest[] {
    const prList = fetchPRList(this.repoInfo);
    return prList.map(mapPRListItemToMergeRequest);
  }

  /**
   * Creates a pull request using the GitHub CLI with pre-built title and body.
   *
   * Pushes the source branch first, then creates the PR. Uses `gh pr create`
   * directly instead of the existing `createPullRequest` function, which couples
   * issue-specific body generation.
   *
   * @param options - The merge request creation options
   * @returns The PR URL if successful, empty string otherwise
   */
  createMergeRequest(options: CreateMROptions): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-pr-'));
    const tempFilePath = path.join(tempDir, 'pr-body.md');

    try {
      fs.writeFileSync(tempFilePath, options.body, 'utf-8');

      pushBranch(options.sourceBranch);

      const prUrl = execSync(
        `gh pr create --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --title "${options.title.replace(/"/g, '\\"')}" --body-file "${tempFilePath}" --base ${options.targetBranch} --head ${options.sourceBranch}`,
        { encoding: 'utf-8', shell: '/bin/bash' }
      ).trim();

      log(`Created PR: ${prUrl}`, 'success');
      return prUrl;
    } catch (error) {
      log(`Failed to create PR: ${error}`, 'error');
      return '';
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
 * Factory function to create a GitHubCodeHost instance.
 *
 * @param repoId - The repository identifier to bind the code host to
 * @returns A CodeHost implementation bound to the specified GitHub repository
 */
export function createGitHubCodeHost(repoId: RepoIdentifier): CodeHost {
  return new GitHubCodeHost(repoId);
}
