/**
 * Low-level Jira REST API v3 client using native fetch().
 * Handles authentication, request building, and error handling.
 *
 * Configuration is INJECTED (#818) — never read from process.env. Logs via the
 * `Logger` port (adws/gitContext/types.ts), defaulting to `consoleLogger`.
 * `fetchFn` is the hermetic transport test seam; production uses global fetch.
 */

import type { Logger } from '../../gitContext/types';
import { consoleLogger } from '../../gitContext/consoleLogger';
import type { JiraIssueResponse, JiraCommentResponse, JiraCommentPage, JiraTransition, JiraTransitionsResponse } from './jiraTypes';

export interface JiraCloudAuth {
  readonly email: string;
  readonly apiToken: string;
}

export interface JiraDataCenterAuth {
  readonly pat: string;
}

export type JiraAuth = JiraCloudAuth | JiraDataCenterAuth;

export function isCloudAuth(auth: JiraAuth): auth is JiraCloudAuth {
  return 'email' in auth && 'apiToken' in auth;
}

/** Runs a fetch request, returning its Response. Production default calls global fetch; tests inject a recorder. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Deps idiom: both optional so a consumer that injects nothing gets `consoleLogger` and real `fetch`. */
export interface JiraApiClientDeps {
  readonly logger?: Logger;
  readonly fetchFn?: FetchFn;
}

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

export class JiraApiClient {
  private readonly instanceUrl: string;
  private readonly auth: JiraAuth;
  private readonly logger: Logger;
  private readonly fetchFn: FetchFn;

  constructor(instanceUrl: string, auth: JiraAuth, deps: JiraApiClientDeps = {}) {
    this.instanceUrl = instanceUrl.replace(/\/+$/, '');
    this.auth = auth;
    this.logger = deps.logger ?? consoleLogger;
    this.fetchFn = deps.fetchFn ?? defaultFetch;
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

    const response = await this.fetchFn(url, options);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const message = `Jira API ${method} ${path} failed with ${response.status}: ${errorBody}`;

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        this.logger(`Jira API rate limited. Retry-After: ${retryAfter ?? 'unknown'}`, 'warn');
      }

      this.logger(message, 'error');
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
