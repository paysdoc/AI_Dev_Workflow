/**
 * Low-level GitLab REST API v4 client using synchronous HTTP calls.
 * Uses spawnSync with curl to match the synchronous CodeHost interface contract.
 */

import { spawnSync } from 'child_process';
import { log } from '../../core';
import type {
  GitLabProject,
  GitLabMergeRequest,
  GitLabNote,
  GitLabDiscussion,
  GitLabCreateMRPayload,
} from './gitlabTypes';

export class GitLabApiClient {
  private readonly instanceUrl: string;
  private readonly token: string;

  constructor(instanceUrl: string, token: string) {
    this.instanceUrl = instanceUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private request<T>(method: string, path: string, body?: unknown): T {
    const url = `${this.instanceUrl}/api/v4/${path}`;
    const args = [
      '-s', '-S',
      '-X', method,
      '-H', `PRIVATE-TOKEN: ${this.token}`,
      '-H', 'Content-Type: application/json',
      '-H', 'Accept: application/json',
    ];

    if (body !== undefined) {
      args.push('-d', JSON.stringify(body));
    }

    args.push(url);

    const result = spawnSync('curl', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.error) {
      const message = `GitLab API ${method} ${path} failed: ${result.error.message}`;
      log(message, 'error');
      throw new Error(message);
    }

    if (result.status !== 0) {
      const message = `GitLab API ${method} ${path} curl exited with code ${result.status}: ${result.stderr}`;
      log(message, 'error');
      throw new Error(message);
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      return undefined as T;
    }

    const parsed = JSON.parse(stdout) as T;

    // GitLab returns error objects with a `message` or `error` field
    const errorObj = parsed as Record<string, unknown>;
    if (errorObj && typeof errorObj === 'object' && ('error' in errorObj || 'message' in errorObj)) {
      const errorMessage = (errorObj.error ?? errorObj.message) as string;
      if (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('unauthorized')) {
        const msg = `GitLab API ${method} ${path} failed with 401: ${errorMessage}`;
        log(msg, 'error');
        throw new Error(msg);
      }
      if (typeof errorMessage === 'string' && errorMessage === '404 Not Found') {
        const msg = `GitLab API ${method} ${path} failed with 404: ${errorMessage}`;
        log(msg, 'error');
        throw new Error(msg);
      }
    }

    return parsed;
  }

  private encodePath(projectPath: string): string {
    return encodeURIComponent(projectPath);
  }

  getProject(projectPath: string): GitLabProject {
    return this.request<GitLabProject>('GET', `projects/${this.encodePath(projectPath)}`);
  }

  createMergeRequest(projectPath: string, payload: GitLabCreateMRPayload): GitLabMergeRequest {
    return this.request<GitLabMergeRequest>(
      'POST',
      `projects/${this.encodePath(projectPath)}/merge_requests`,
      payload,
    );
  }

  getMergeRequest(projectPath: string, mrIid: number): GitLabMergeRequest {
    return this.request<GitLabMergeRequest>(
      'GET',
      `projects/${this.encodePath(projectPath)}/merge_requests/${mrIid}`,
    );
  }

  createNote(projectPath: string, mrIid: number, body: string): GitLabNote {
    return this.request<GitLabNote>(
      'POST',
      `projects/${this.encodePath(projectPath)}/merge_requests/${mrIid}/notes`,
      { body },
    );
  }

  listDiscussions(projectPath: string, mrIid: number): readonly GitLabDiscussion[] {
    return this.request<readonly GitLabDiscussion[]>(
      'GET',
      `projects/${this.encodePath(projectPath)}/merge_requests/${mrIid}/discussions`,
    );
  }

  listMergeRequests(projectPath: string, state?: string): readonly GitLabMergeRequest[] {
    const query = state ? `?state=${state}` : '';
    return this.request<readonly GitLabMergeRequest[]>(
      'GET',
      `projects/${this.encodePath(projectPath)}/merge_requests${query}`,
    );
  }
}
