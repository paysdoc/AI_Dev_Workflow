/**
 * GitHub implementation of the IssueTracker provider interface.
 * Wraps existing issueApi.ts and projectBoardApi.ts functions, binding them
 * to a specific RepoIdentifier at construction time.
 */

import type { IssueTracker, RepoIdentifier, WorkItem, WorkItemComment } from '../types';
import { validateRepoIdentifier } from '../types';
import type { RepoInfo } from '../../github/githubApi';
import {
  fetchGitHubIssue,
  commentOnIssue as ghCommentOnIssue,
  deleteIssueComment,
  closeIssue as ghCloseIssue,
  getIssueState as ghGetIssueState,
  fetchIssueCommentsRest,
} from '../../github/issueApi';
import { moveIssueToStatus } from '../../github/projectBoardApi';
import {
  mapGitHubIssueToWorkItem,
  mapIssueCommentSummaryToWorkItemComment,
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

  async fetchIssue(issueNumber: number): Promise<WorkItem> {
    const issue = await fetchGitHubIssue(issueNumber, this.repoInfo);
    return mapGitHubIssueToWorkItem(issue);
  }

  commentOnIssue(issueNumber: number, body: string): void {
    ghCommentOnIssue(issueNumber, body, this.repoInfo);
  }

  deleteComment(commentId: string): void {
    deleteIssueComment(Number(commentId), this.repoInfo);
  }

  async closeIssue(issueNumber: number, comment?: string): Promise<boolean> {
    return ghCloseIssue(issueNumber, comment, this.repoInfo);
  }

  getIssueState(issueNumber: number): string {
    return ghGetIssueState(issueNumber, this.repoInfo);
  }

  fetchComments(issueNumber: number): WorkItemComment[] {
    const comments = fetchIssueCommentsRest(issueNumber, this.repoInfo);
    return comments.map(mapIssueCommentSummaryToWorkItemComment);
  }

  async moveToStatus(issueNumber: number, status: string): Promise<void> {
    await moveIssueToStatus(issueNumber, status, this.repoInfo);
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
