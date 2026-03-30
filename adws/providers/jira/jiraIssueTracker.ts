/**
 * Jira IssueTracker implementation.
 * Maps ADW's IssueTracker interface to Jira REST API v3 via JiraApiClient.
 */

import { log, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT } from '../../core';
import type { IssueTracker, Issue, IssueComment } from '../types';
import { BoardStatus } from '../types';
import { JiraApiClient } from './jiraApiClient';
import type { JiraIssueResponse, JiraCommentResponse } from './jiraTypes';
import { markdownToAdf, adfToPlainText } from './adfConverter';

/** Maps Jira status category keys to ADW state strings. */
const STATUS_CATEGORY_MAP: Record<string, string> = {
  new: 'OPEN',
  indeterminate: 'IN_PROGRESS',
  done: 'CLOSED',
};

/**
 * Matches a target status name against available transition names using fuzzy logic.
 * Exact match takes priority, then substring match.
 */
function matchTransition(
  targetStatus: string,
  transitions: readonly { readonly id: string; readonly name: string }[],
): { readonly id: string; readonly name: string } | null {
  const target = targetStatus.toLowerCase();

  const exact = transitions.find(t => t.name.toLowerCase() === target);
  if (exact) return exact;

  const fuzzy = transitions.find(t => t.name.toLowerCase().includes(target));
  return fuzzy ?? null;
}

export class JiraIssueTracker implements IssueTracker {
  private readonly client: JiraApiClient;
  private readonly projectKey: string;
  private readonly commentIssueMap = new Map<string, string>();

  constructor(client: JiraApiClient, projectKey: string) {
    this.client = client;
    this.projectKey = projectKey;
  }

  private toJiraKey(issueNumber: number): string {
    return `${this.projectKey}-${issueNumber}`;
  }

  private mapStatusCategory(statusCategoryKey: string): string {
    return STATUS_CATEGORY_MAP[statusCategoryKey] ?? statusCategoryKey.toUpperCase();
  }

  private toIssueComment(jiraComment: JiraCommentResponse, issueKey: string): IssueComment {
    this.commentIssueMap.set(jiraComment.id, issueKey);
    return {
      id: jiraComment.id,
      body: adfToPlainText(jiraComment.body),
      author: jiraComment.author.displayName,
      createdAt: jiraComment.created,
    };
  }

  private toIssue(jiraIssue: JiraIssueResponse): Issue {
    const comments = (jiraIssue.fields.comment?.comments ?? []).map(
      c => this.toIssueComment(c, jiraIssue.key),
    );

    return {
      id: jiraIssue.key,
      number: parseInt(jiraIssue.key.split('-').pop() ?? '0', 10),
      title: jiraIssue.fields.summary,
      body: adfToPlainText(jiraIssue.fields.description),
      state: this.mapStatusCategory(jiraIssue.fields.status.statusCategory.key),
      author: jiraIssue.fields.creator.displayName,
      labels: [...jiraIssue.fields.labels],
      comments,
    };
  }

  async fetchIssue(issueNumber: number): Promise<Issue> {
    const issueKey = this.toJiraKey(issueNumber);
    const jiraIssue = await this.client.getIssue(issueKey);
    return this.toIssue(jiraIssue);
  }

  commentOnIssue(issueNumber: number, body: string): void {
    const issueKey = this.toJiraKey(issueNumber);
    const adfBody = markdownToAdf(body);

    this.client.addComment(issueKey, adfBody).then(comment => {
      this.commentIssueMap.set(comment.id, issueKey);
      log(`Commented on Jira issue ${issueKey}`, 'success');
    }).catch(error => {
      log(`Failed to comment on Jira issue ${issueKey}: ${error}`, 'error');
    });
  }

  deleteComment(commentId: string): void {
    const issueKey = this.commentIssueMap.get(commentId);
    if (!issueKey) {
      log(`Cannot delete Jira comment ${commentId}: issue key not found in cache. Fetch comments first.`, 'warn');
      return;
    }

    this.client.deleteComment(issueKey, commentId).then(() => {
      this.commentIssueMap.delete(commentId);
      log(`Deleted Jira comment ${commentId} on ${issueKey}`, 'success');
    }).catch(error => {
      log(`Failed to delete Jira comment ${commentId}: ${error}`, 'error');
    });
  }

  async closeIssue(issueNumber: number, comment?: string): Promise<boolean> {
    const issueKey = this.toJiraKey(issueNumber);

    try {
      const jiraIssue = await this.client.getIssue(issueKey);
      if (jiraIssue.fields.status.statusCategory.key === 'done') {
        log(`Jira issue ${issueKey} is already done, skipping`, 'info');
        return false;
      }

      if (comment) {
        const adfBody = markdownToAdf(comment);
        await this.client.addComment(issueKey, adfBody);
      }

      const transitions = await this.client.getTransitions(issueKey);
      const doneTransition = transitions.find(
        t => t.to.statusCategory.key === 'done',
      );

      if (!doneTransition) {
        log(`No "Done" transition available for Jira issue ${issueKey}`, 'warn');
        return false;
      }

      await this.client.doTransition(issueKey, doneTransition.id);
      log(`Closed Jira issue ${issueKey}`, 'success');
      return true;
    } catch (error) {
      log(`Failed to close Jira issue ${issueKey}: ${error}`, 'error');
      return false;
    }
  }

  getIssueState(issueNumber: number): string {
    // The interface is synchronous, but Jira requires an API call.
    // This is a limitation — callers should use fetchIssue().state instead.
    // For compatibility, we trigger a background fetch and return a placeholder.
    const issueKey = this.toJiraKey(issueNumber);
    let state = 'UNKNOWN';

    this.client.getIssue(issueKey).then(issue => {
      state = this.mapStatusCategory(issue.fields.status.statusCategory.key);
    }).catch(error => {
      log(`Failed to get state for Jira issue ${issueKey}: ${error}`, 'error');
    });

    return state;
  }

  fetchComments(issueNumber: number): IssueComment[] {
    const issueKey = this.toJiraKey(issueNumber);
    const comments: IssueComment[] = [];

    this.client.getComments(issueKey).then(jiraComments => {
      for (const jc of jiraComments) {
        comments.push(this.toIssueComment(jc, issueKey));
      }
    }).catch(error => {
      log(`Failed to fetch comments for Jira issue ${issueKey}: ${error}`, 'error');
    });

    return comments;
  }

  async moveToStatus(issueNumber: number, status: BoardStatus): Promise<boolean> {
    const issueKey = this.toJiraKey(issueNumber);

    try {
      const jiraIssue = await this.client.getIssue(issueKey);
      const currentStatus = jiraIssue.fields.status.name;

      if (currentStatus.toLowerCase() === status.toLowerCase()) {
        log(`Jira issue ${issueKey} already in "${currentStatus}", skipping`, 'info');
        return true;
      }

      const transitions = await this.client.getTransitions(issueKey);
      const matched = matchTransition(status, transitions);

      if (!matched) {
        const available = transitions.map(t => t.name).join(', ');
        log(`Status "${status}" not found in available transitions for ${issueKey}. Available: ${available}`, 'warn');
        return false;
      }

      await this.client.doTransition(issueKey, matched.id);
      log(`Moved Jira issue ${issueKey} to "${matched.name}"`, 'success');
      return true;
    } catch (error) {
      log(`Failed to move Jira issue ${issueKey} to "${status}": ${error}`, 'error');
      return false;
    }
  }

  /** Not yet implemented for Jira. */
  issueHasLabel(_issueNumber: number, _labelName: string): boolean {
    throw new Error('issueHasLabel is not yet implemented for the Jira provider');
  }
}

/**
 * Factory function to create a JiraIssueTracker from environment variables.
 */
export function createJiraIssueTracker(instanceUrl: string, projectKey: string): IssueTracker {
  if (JIRA_EMAIL && JIRA_API_TOKEN) {
    const client = new JiraApiClient(instanceUrl, { email: JIRA_EMAIL, apiToken: JIRA_API_TOKEN });
    return new JiraIssueTracker(client, projectKey);
  }

  if (JIRA_PAT) {
    const client = new JiraApiClient(instanceUrl, { pat: JIRA_PAT });
    return new JiraIssueTracker(client, projectKey);
  }

  throw new Error(
    'Jira authentication not configured. Set JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_PAT (Data Center/Server).',
  );
}
