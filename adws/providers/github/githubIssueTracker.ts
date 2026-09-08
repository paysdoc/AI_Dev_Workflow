/**
 * GitHub implementation of the IssueTracker provider interface.
 * Wraps existing issueApi.ts and projectBoardApi.ts functions, binding them
 * to a specific RepoIdentifier at construction time.
 */

import type { IssueTracker, RepoIdentifier, Issue, IssueComment, IssueSummary, IssueListQuery, IssueListEntry } from '../types';
import { validateRepoIdentifier, BoardStatus } from '../types';
import {
  fetchGitHubIssue,
  commentOnIssue as ghCommentOnIssue,
  deleteIssueComment,
  closeIssue as ghCloseIssue,
  getIssueState as ghGetIssueState,
  fetchIssueCommentsRest,
  fetchIssueLabels as ghFetchIssueLabels,
  addIssueLabel as ghAddIssueLabel,
  createIssue as ghCreateIssue,
  updateIssueBody as ghUpdateIssueBody,
  searchOpenIssues as ghSearchOpenIssues,
  findOpenUpgradeIssue as ghFindOpenUpgradeIssue,
} from '../../github/issueApi';
import { listIssues as ghListIssues } from '../../github/issueListApi';
import { applyLabel as ghApplyLabel, ensureLabelExists as ghEnsureLabelExists } from '../../github/labelManager';
import { moveIssueToStatus } from '../../github/projectBoardApi';
import {
  mapGitHubIssueToIssue,
  mapIssueCommentSummaryToIssueComment,
} from './mappers';

/**
 * IssueTracker implementation for GitHub Issues.
 * Bound to a specific repository at construction time — every method
 * passes the bound RepoIdentifier to the underlying function, never relying
 * on the global getTargetRepo() registry.
 */
export class GitHubIssueTracker implements IssueTracker {
  constructor(private readonly repoId: RepoIdentifier) {
    validateRepoIdentifier(repoId);
  }

  async fetchIssue(issueNumber: number): Promise<Issue> {
    const issue = await fetchGitHubIssue(issueNumber, this.repoId);
    return mapGitHubIssueToIssue(issue);
  }

  commentOnIssue(issueNumber: number, body: string): void {
    ghCommentOnIssue(issueNumber, body, this.repoId);
  }

  deleteComment(commentId: string): void {
    deleteIssueComment(Number(commentId), this.repoId);
  }

  async closeIssue(issueNumber: number, comment?: string): Promise<boolean> {
    return ghCloseIssue(issueNumber, this.repoId, comment);
  }

  getIssueState(issueNumber: number): string {
    return ghGetIssueState(issueNumber, this.repoId);
  }

  fetchComments(issueNumber: number): IssueComment[] {
    const comments = fetchIssueCommentsRest(issueNumber, this.repoId);
    return comments.map(mapIssueCommentSummaryToIssueComment);
  }

  async moveToStatus(issueNumber: number, status: BoardStatus): Promise<boolean> {
    return moveIssueToStatus(issueNumber, status, this.repoId);
  }

  fetchLabels(issueNumber: number): readonly string[] {
    return ghFetchIssueLabels(issueNumber, this.repoId);
  }

  addLabel(issueNumber: number, labelName: string): void {
    ghAddIssueLabel(issueNumber, labelName, this.repoId);
  }

  applyLabel(issueNumber: number, labelName: string): void {
    ghApplyLabel(issueNumber, labelName, this.repoId);
  }

  ensureLabel(name: string, color: string, description: string): void {
    ghEnsureLabelExists(name, color, description, this.repoId);
  }

  createIssue(title: string, body: string): number {
    return ghCreateIssue(title, body, this.repoId);
  }

  updateIssueBody(issueNumber: number, body: string): void {
    ghUpdateIssueBody(issueNumber, body, this.repoId);
  }

  searchOpenIssues(search: string, limit: number): readonly IssueSummary[] {
    return ghSearchOpenIssues(search, limit, this.repoId);
  }

  findOpenUpgradeIssue(): number | null {
    return ghFindOpenUpgradeIssue(this.repoId);
  }

  listIssues(query: IssueListQuery): readonly IssueListEntry[] {
    return ghListIssues(query, this.repoId);
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
