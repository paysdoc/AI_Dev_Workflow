/**
 * GitHub implementation of the IssueTracker provider interface.
 * Wraps existing issueApi.ts and projectBoardApi.ts functions, binding them
 * to a specific RepoIdentifier at construction time.
 */

import type { IssueTracker, RepoIdentifier, Issue, IssueComment } from '../types';
import { validateRepoIdentifier, BoardStatus } from '../types';
import type { RepoInfo } from '../../github/githubApi';
import {
  fetchGitHubIssue,
  commentOnIssue as ghCommentOnIssue,
  deleteIssueComment,
  closeIssue as ghCloseIssue,
  getIssueState as ghGetIssueState,
  fetchIssueCommentsRest,
  issueHasLabel as ghIssueHasLabel,
} from '../../github/issueApi';
import { moveIssueToStatus } from '../../github/projectBoardApi';
import {
  mapGitHubIssueToIssue,
  mapIssueCommentSummaryToIssueComment,
  toRepoInfo,
} from './mappers';

/**
 * IssueTracker implementation for GitHub Issues.
 * Bound to a specific repository at construction time — every method
 * passes the bound RepoInfo to the underlying function, never relying
 * on the global getTargetRepo() registry.
 */
class GitHubIssueTracker implements IssueTracker {
  private readonly repoInfo: RepoInfo;

  constructor(private readonly repoId: RepoIdentifier) {
    validateRepoIdentifier(repoId);
    this.repoInfo = toRepoInfo(repoId);
  }

  async fetchIssue(issueNumber: number): Promise<Issue> {
    const issue = await fetchGitHubIssue(issueNumber, this.repoInfo);
    return mapGitHubIssueToIssue(issue);
  }

  commentOnIssue(issueNumber: number, body: string): void {
    ghCommentOnIssue(issueNumber, body, this.repoInfo);
  }

  deleteComment(commentId: string): void {
    deleteIssueComment(Number(commentId), this.repoInfo);
  }

  async closeIssue(issueNumber: number, comment?: string): Promise<boolean> {
    return ghCloseIssue(issueNumber, this.repoInfo, comment);
  }

  getIssueState(issueNumber: number): string {
    return ghGetIssueState(issueNumber, this.repoInfo);
  }

  fetchComments(issueNumber: number): IssueComment[] {
    const comments = fetchIssueCommentsRest(issueNumber, this.repoInfo);
    return comments.map(mapIssueCommentSummaryToIssueComment);
  }

  issueHasLabel(issueNumber: number, labelName: string): boolean {
    return ghIssueHasLabel(issueNumber, labelName, this.repoInfo);
  }

  async moveToStatus(issueNumber: number, status: BoardStatus): Promise<boolean> {
    return moveIssueToStatus(issueNumber, status, this.repoInfo);
  }
}

/**
 * Factory function to create a GitHub IssueTracker provider.
 * @param repoId - The repository identifier to bind the provider to.
 * @returns An IssueTracker instance bound to the specified repository.
 */
export function createGitHubIssueTracker(repoId: RepoIdentifier): IssueTracker {
  return new GitHubIssueTracker(repoId);
}
