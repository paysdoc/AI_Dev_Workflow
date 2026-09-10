/**
 * Low-level GitLab REST API v4 client using synchronous HTTP calls.
 * Uses spawnSync with curl to match the synchronous CodeHost interface contract.
 *
 * Configuration is INJECTED (#818) — never read from the environment. Logs via the
 * `Logger` port (adws/gitContext/types.ts), defaulting to `consoleLogger`.
 * `runCurl` is the hermetic transport test seam; production uses a real curl.
 */

import { spawnSync } from 'child_process';
import type { Logger } from '../../gitContext/types';
import { consoleLogger } from '../../gitContext/consoleLogger';
import type {
  GitLabProject,
  GitLabMergeRequest,
  GitLabNote,
  GitLabDiscussion,
  GitLabCreateMRPayload,
} from './gitlabTypes';

/** The injected configuration `createGitLabCodeHost` takes (#818): the personal access token (api scope) and the instance origin, e.g. `https://gitlab.com`. Never read from the environment inside the adapter. */
export interface GitLabConfig {
  readonly token: string;
  readonly instanceUrl: string;
}

/** The result shape `spawnSync` satisfies structurally — the hermetic transport seam. */
export type CurlResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
};

/** Runs curl with the given argv, returning its result. Production default spawns a real curl; tests inject a recorder. */
export type CurlRunner = (args: readonly string[]) => CurlResult;

/** Deps idiom: both optional so a consumer that injects nothing gets `consoleLogger` and a real `curl`. */
export interface GitLabApiClientDeps {
  readonly logger?: Logger;
  readonly runCurl?: CurlRunner;
}

const defaultCurlRunner: CurlRunner = (args) =>
  spawnSync('curl', [...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

export class GitLabApiClient {
  private readonly instanceUrl: string;
  private readonly token: string;
  private readonly logger: Logger;
  private readonly runCurl: CurlRunner;

  constructor(config: GitLabConfig, deps: GitLabApiClientDeps = {}) {
    this.instanceUrl = config.instanceUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.logger = deps.logger ?? consoleLogger;
    this.runCurl = deps.runCurl ?? defaultCurlRunner;
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

    const result = this.runCurl(args);

    if (result.error) {
      const message = `GitLab API ${method} ${path} failed: ${result.error.message}`;
      this.logger(message, 'error');
      throw new Error(message);
    }

    if (result.status !== 0) {
      const message = `GitLab API ${method} ${path} curl exited with code ${result.status}: ${result.stderr}`;
      this.logger(message, 'error');
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
        this.logger(msg, 'error');
        throw new Error(msg);
      }
      if (typeof errorMessage === 'string' && errorMessage === '404 Not Found') {
        const msg = `GitLab API ${method} ${path} failed with 404: ${errorMessage}`;
        this.logger(msg, 'error');
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
