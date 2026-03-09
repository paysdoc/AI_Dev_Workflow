/**
 * Low-level Jira REST API v3 client using native fetch().
 * Handles authentication, request building, and error handling.
 */

import { log } from '../../core';
import type { JiraIssueResponse, JiraCommentResponse, JiraCommentPage, JiraTransition, JiraTransitionsResponse } from './jiraTypes';

export interface JiraCloudAuth {
  readonly email: string;
  readonly apiToken: string;
}

export interface JiraDataCenterAuth {
  readonly pat: string;
}

export type JiraAuth = JiraCloudAuth | JiraDataCenterAuth;

function isCloudAuth(auth: JiraAuth): auth is JiraCloudAuth {
  return 'email' in auth && 'apiToken' in auth;
}

export class JiraApiClient {
  private readonly instanceUrl: string;
  private readonly auth: JiraAuth;

  constructor(instanceUrl: string, auth: JiraAuth) {
    this.instanceUrl = instanceUrl.replace(/\/+$/, '');
    this.auth = auth;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (isCloudAuth(this.auth)) {
      const credentials = btoa(`${this.auth.email}:${this.auth.apiToken}`);
      headers['Authorization'] = `Basic ${credentials}`;
    } else {
      headers['Authorization'] = `Bearer ${this.auth.pat}`;
    }

    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.instanceUrl}/rest/api/3/${path}`;
    const headers = this.buildHeaders();

    const options: RequestInit = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const message = `Jira API ${method} ${path} failed with ${response.status}: ${errorBody}`;

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        log(`Jira API rate limited. Retry-After: ${retryAfter ?? 'unknown'}`, 'warn');
      }

      log(message, 'error');
      throw new Error(message);
    }

    // DELETE returns 204 with no content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async getIssue(issueKey: string): Promise<JiraIssueResponse> {
    return this.request<JiraIssueResponse>('GET', `issue/${issueKey}?expand=renderedFields`);
  }

  async addComment(issueKey: string, adfBody: object): Promise<JiraCommentResponse> {
    return this.request<JiraCommentResponse>('POST', `issue/${issueKey}/comment`, { body: adfBody });
  }

  async deleteComment(issueKey: string, commentId: string): Promise<void> {
    return this.request<void>('DELETE', `issue/${issueKey}/comment/${commentId}`);
  }

  async getComments(issueKey: string): Promise<readonly JiraCommentResponse[]> {
    const page = await this.request<JiraCommentPage>('GET', `issue/${issueKey}/comment`);
    return page.comments;
  }

  async getTransitions(issueKey: string): Promise<readonly JiraTransition[]> {
    const result = await this.request<JiraTransitionsResponse>('GET', `issue/${issueKey}/transitions`);
    return result.transitions;
  }

  async doTransition(issueKey: string, transitionId: string): Promise<void> {
    return this.request<void>('POST', `issue/${issueKey}/transitions`, { transition: { id: transitionId } });
  }
}
