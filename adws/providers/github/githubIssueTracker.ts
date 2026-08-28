/**
 * GitHub implementation of the IssueTracker provider interface.
 * Wraps existing issueApi.ts and projectBoardApi.ts functions, binding them
 * to a specific RepoIdentifier at construction time.
 */

import type { IssueTracker, RepoIdentifier, Issue, IssueComment, IssueSummary, IssueListQuery, IssueListEntry } from '../types';
import { validateRepoIdentifier, BoardStatus } from '../types';
import type { RepoInfo } from '../../github/githubApi';
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
  toRepoInfo,
} from './mappers';

/**
 * IssueTracker implementation for GitHub Issues.
 * Bound to a specific repository at construction time — every method
 * passes the bound RepoInfo to the underlying function, never relying
 * on the global getTargetRepo() registry.
 */
export class GitHubIssueTracker implements IssueTracker {
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

  async moveToStatus(issueNumber: number, status: BoardStatus): Promise<boolean> {
    return moveIssueToStatus(issueNumber, status, this.repoInfo);
  }

  fetchLabels(issueNumber: number): readonly string[] {
    return ghFetchIssueLabels(issueNumber, this.repoInfo);
  }

  addLabel(issueNumber: number, labelName: string): void {
    ghAddIssueLabel(issueNumber, labelName, this.repoInfo);
  }

  applyLabel(issueNumber: number, labelName: string): void {
    ghApplyLabel(issueNumber, labelName, this.repoInfo);
  }

  ensureLabel(name: string, color: string, description: string): void {
    ghEnsureLabelExists(name, color, description, this.repoInfo);
  }

  createIssue(title: string, body: string): number {
    return ghCreateIssue(title, body, this.repoInfo);
  }

  updateIssueBody(issueNumber: number, body: string): void {
    ghUpdateIssueBody(issueNumber, body, this.repoInfo);
  }

  searchOpenIssues(search: string, limit: number): readonly IssueSummary[] {
    return ghSearchOpenIssues(search, limit, this.repoInfo);
  }

  findOpenUpgradeIssue(): number | null {
    return ghFindOpenUpgradeIssue(this.repoInfo);
  }

  listIssues(query: IssueListQuery): readonly IssueListEntry[] {
    return ghListIssues(query, this.repoInfo);
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
