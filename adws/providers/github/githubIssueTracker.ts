/**
 * GitHub implementation of the IssueTracker provider interface.
 *
 * Binds `createGhRepoApi(ctx)` once at construction, over a `GitContext` the
 * caller already holds — the adapter constructs no context, resolves no
 * token, and reads no environment. Every method reproduces the command,
 * parse, error policy and log line of its absorbed legacy free function
 * (`adws/github/issueApi.ts` / `issueListApi.ts` / `labelManager.ts` /
 * `projectBoardApi.ts`) exactly, logging through the injected `Logger` port.
 * The HITL Slack notification and the `adw:*` label catalogue are ADW
 * behaviours re-homed as the optional `onStatusMoved`/`resolveLabelDefinition`
 * seams — the library itself never learns about Slack or about ADW's colours.
 */

import { consoleLogger, type GitContext, type Logger } from '../../gitContext';
import type { IssueTracker, RepoIdentifier, Issue, IssueComment, IssueSummary, IssueListQuery, IssueListEntry } from '../types';
import { validateRepoIdentifier, BoardStatus } from '../types';
import { createGhRepoApi, type GhRepoApi } from './ghRepoApi';
import { assertContextBoundTo } from './contextBinding';
import {
  parseGitHubIssue,
  parseIssueState,
  parseIssueTitle,
  parseIssueCommentsRest,
  parseIssueLabelNames,
  parseCreatedIssueNumber,
  parseFirstIssueNumber,
  parseIssueSummaries,
  parseIssueListEntries,
} from './ghIssueParsers';
import { mapGitHubIssueToIssue, mapIssueCommentSummaryToIssueComment } from './mappers';

/** A label's canonical presentation — name, colour, and description — for the `applyLabel` lazy-create path. */
export interface GitHubLabelDefinition {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface GitHubIssueTrackerDeps {
  readonly logger?: Logger;
  /**
   * Invoked (and awaited) only after a move that returned `true`, inside the
   * same try/catch as the move; a throw from it is logged as a failed move
   * and yields `false`.
   */
  readonly onStatusMoved?: (issueNumber: number, status: BoardStatus) => void | Promise<void>;
  /** Consulted only on `applyLabel`'s lazy-create path; default `{ name: label, color: 'ededed', description: '' }`. */
  readonly resolveLabelDefinition?: (label: string) => GitHubLabelDefinition;
}

function isLabelNotFoundError(error: unknown): boolean {
  return /not found/i.test(String(error));
}

function defaultLabelDefinition(label: string): GitHubLabelDefinition {
  return { name: label, color: 'ededed', description: '' };
}

/**
 * IssueTracker implementation for GitHub Issues, bound to a specific
 * repository and `GitContext` at construction time.
 */
export class GitHubIssueTracker implements IssueTracker {
  private readonly gh: GhRepoApi;
  private readonly logger: Logger;
  private readonly onStatusMoved?: (issueNumber: number, status: BoardStatus) => void | Promise<void>;
  private readonly resolveLabelDefinition: (label: string) => GitHubLabelDefinition;

  constructor(ctx: GitContext, private readonly repoId: RepoIdentifier, deps: GitHubIssueTrackerDeps = {}) {
    validateRepoIdentifier(repoId);
    assertContextBoundTo(ctx, repoId, 'createGitHubIssueTracker');
    this.gh = createGhRepoApi(ctx);
    this.logger = deps.logger ?? consoleLogger;
    this.onStatusMoved = deps.onStatusMoved;
    this.resolveLabelDefinition = deps.resolveLabelDefinition ?? defaultLabelDefinition;
  }

  async fetchIssue(issueNumber: number): Promise<Issue> {
    try {
      return mapGitHubIssueToIssue(parseGitHubIssue(this.gh.fetchIssue(issueNumber)));
    } catch (error) {
      throw new Error(`Failed to fetch issue #${issueNumber}: ${error}`);
    }
  }

  commentOnIssue(issueNumber: number, body: string): void {
    try {
      this.gh.commentOnIssue(issueNumber, body);
      this.logger(`Commented on issue #${issueNumber}`, 'success');
    } catch (error) {
      this.logger(`Failed to comment on issue: ${error}`, 'error');
    }
  }

  deleteComment(commentId: string): void {
    const id = Number(commentId);
    try {
      this.gh.deleteIssueComment(id);
      this.logger(`Deleted comment ${id}`, 'success');
    } catch (error) {
      throw new Error(`Failed to delete comment ${id}: ${error}`);
    }
  }

  getIssueState(issueNumber: number): string {
    try {
      return parseIssueState(this.gh.issueState(issueNumber));
    } catch (error) {
      this.logger(`Failed to get issue state for #${issueNumber}: ${error}`, 'error');
      throw error;
    }
  }

  async closeIssue(issueNumber: number, comment?: string): Promise<boolean> {
    try {
      const state = this.getIssueState(issueNumber);
      if (state === 'CLOSED') {
        this.logger(`Issue #${issueNumber} is already closed, skipping`, 'info');
        return false;
      }
      if (comment) {
        this.commentOnIssue(issueNumber, comment);
      }
      this.gh.closeIssue(issueNumber);
      this.logger(`Closed issue #${issueNumber}`, 'success');
      return true;
    } catch (error) {
      this.logger(`Failed to close issue #${issueNumber}: ${error}`, 'error');
      return false;
    }
  }

  fetchComments(issueNumber: number): IssueComment[] {
    try {
      return parseIssueCommentsRest(this.gh.fetchIssueComments(issueNumber)).map(mapIssueCommentSummaryToIssueComment);
    } catch (error) {
      throw new Error(`Failed to fetch comments for issue #${issueNumber}: ${error}`);
    }
  }

  async moveToStatus(issueNumber: number, status: BoardStatus): Promise<boolean> {
    try {
      const moved = this.gh.moveIssueToStatus(issueNumber, status);
      if (moved) {
        await this.onStatusMoved?.(issueNumber, status);
      }
      return moved;
    } catch (error) {
      this.logger(`Failed to move issue #${issueNumber} to "${status}": ${error}`, 'error');
      return false;
    }
  }

  fetchLabels(issueNumber: number): readonly string[] {
    try {
      return parseIssueLabelNames(this.gh.issueLabels(issueNumber));
    } catch (error) {
      this.logger(`fetchIssueLabels: failed to fetch labels on issue #${issueNumber}: ${error}`, 'warn');
      return [];
    }
  }

  addLabel(issueNumber: number, labelName: string): void {
    try {
      this.gh.addIssueLabel(issueNumber, labelName);
      this.logger(`Added label "${labelName}" to issue #${issueNumber}`, 'success');
    } catch (error) {
      this.logger(`Failed to add label "${labelName}" to issue #${issueNumber}: ${error}`, 'error');
    }
  }

  applyLabel(issueNumber: number, labelName: string): void {
    try {
      this.gh.applyLabel(issueNumber, labelName);
      return;
    } catch (error) {
      if (!isLabelNotFoundError(error)) {
        this.logger(`applyLabel: unexpected error adding label "${labelName}" to issue #${issueNumber}: ${error}`, 'error');
        throw error;
      }
    }
    this.logger(`applyLabel: label "${labelName}" not found on repo, lazy-creating`, 'warn');
    const def = this.resolveLabelDefinition(labelName);
    this.gh.createLabel(def.name, def.color, def.description);
    this.gh.applyLabel(issueNumber, labelName);
  }

  ensureLabel(name: string, color: string, description: string): void {
    this.gh.createLabel(name, color, description);
  }

  createIssue(title: string, body: string): number {
    const issueNumber = parseCreatedIssueNumber(this.gh.createIssue(title, body));
    this.logger(`Created issue #${issueNumber}: ${title}`, 'success');
    return issueNumber;
  }

  updateIssueBody(issueNumber: number, body: string): void {
    try {
      this.gh.updateIssueBody(issueNumber, body);
      this.logger(`Updated body of issue #${issueNumber}`, 'success');
    } catch (error) {
      this.logger(`Failed to update body of issue #${issueNumber}: ${error}`, 'error');
      throw error;
    }
  }

  searchOpenIssues(search: string, limit: number): readonly IssueSummary[] {
    try {
      return parseIssueSummaries(this.gh.listOpenIssues({ fields: ['number', 'title'], search, limit }));
    } catch {
      return [];
    }
  }

  findOpenUpgradeIssue(): number | null {
    try {
      return parseFirstIssueNumber(this.gh.findOpenUpgradeIssue());
    } catch {
      return null;
    }
  }

  listIssues(query: IssueListQuery): readonly IssueListEntry[] {
    return parseIssueListEntries(this.gh.listOpenIssues(query));
  }

  getIssueTitle(issueNumber: number): string {
    try {
      return parseIssueTitle(this.gh.issueTitle(issueNumber));
    } catch {
      return '(unknown)';
    }
  }
}

/**
 * Factory function to create a GitHub IssueTracker provider, bound to the
 * given `GitContext` and repository. Refuses a context bound to a different
 * owner/repo than `repoId`.
 */
export function createGitHubIssueTracker(ctx: GitContext, repoId: RepoIdentifier, deps: GitHubIssueTrackerDeps = {}): IssueTracker {
  return new GitHubIssueTracker(ctx, repoId, deps);
}
