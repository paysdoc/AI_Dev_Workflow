/**
 * gitlabApiClient.test.ts — fake config in, curl argv out (#818).
 *
 * Proves GitLabApiClient builds its request from INJECTED configuration
 * (never from process.env), threads the injected logger, and preserves
 * today's exact curl argv shape, URL template, and error classification.
 */

import { describe, it, expect } from 'vitest';
import { GitLabApiClient, type GitLabConfig, type CurlResult, type CurlRunner } from '../gitlabApiClient';
import type { LogLevel } from '../../../gitContext/types';

function makeRecordingCurl(stdout: string, status: number | null = 0): { runCurl: CurlRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runCurl: CurlRunner = (args) => {
    calls.push([...args]);
    const result: CurlResult = { status, stdout, stderr: '' };
    return result;
  };
  return { runCurl, calls };
}

function makeLoggerSpy(): { logger: (message: string, level?: LogLevel) => void; messages: { message: string; level?: LogLevel }[] } {
  const messages: { message: string; level?: LogLevel }[] = [];
  return {
    logger: (message, level) => { messages.push({ message, level }); },
    messages,
  };
}

const CONFIG: GitLabConfig = { token: 'glpat-fake', instanceUrl: 'https://gitlab.example.com/' };

describe('GitLabApiClient — request shape from injected configuration (#818)', () => {
  it('getProject sends a GET with PRIVATE-TOKEN and the trimmed, encoded URL', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify({ default_branch: 'main' }));
    const client = new GitLabApiClient(CONFIG, { runCurl });

    const result = client.getProject('acme/widget');

    expect(calls).toHaveLength(1);
    const argv = calls[0];
    expect(argv).toContain('-X');
    expect(argv[argv.indexOf('-X') + 1]).toBe('GET');
    expect(argv).toContain('PRIVATE-TOKEN: glpat-fake');
    expect(argv).toContain('Content-Type: application/json');
    expect(argv).toContain('Accept: application/json');
    expect(argv).not.toContain('-d');
    expect(argv[argv.length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget');
    expect(result).toEqual({ default_branch: 'main' });
  });

  it('createMergeRequest sends a POST with a JSON body matching the payload', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify({ iid: 9 }));
    const client = new GitLabApiClient(CONFIG, { runCurl });
    const payload = { source_branch: 'feat', target_branch: 'main', title: 'T', description: 'D' };

    client.createMergeRequest('acme/widget', payload);

    const argv = calls[0];
    expect(argv[argv.indexOf('-X') + 1]).toBe('POST');
    const dIndex = argv.indexOf('-d');
    expect(dIndex).toBeGreaterThan(-1);
    expect(JSON.parse(argv[dIndex + 1])).toEqual(payload);
    expect(argv[argv.length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget/merge_requests');
  });

  it('createNote posts { body } to the notes endpoint', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify({ id: 1 }));
    const client = new GitLabApiClient(CONFIG, { runCurl });

    client.createNote('acme/widget', 7, 'hello');

    const argv = calls[0];
    expect(argv[argv.length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget/merge_requests/7/notes');
    const dIndex = argv.indexOf('-d');
    expect(JSON.parse(argv[dIndex + 1])).toEqual({ body: 'hello' });
  });

  it('listMergeRequests appends the state query only when given one', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify([]));
    const client = new GitLabApiClient(CONFIG, { runCurl });

    client.listMergeRequests('acme/widget', 'opened');
    client.listMergeRequests('acme/widget');

    expect(calls[0][calls[0].length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget/merge_requests?state=opened');
    expect(calls[1][calls[1].length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget/merge_requests');
  });

  it('getMergeRequest and listDiscussions build their expected URLs', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify({}));
    const client = new GitLabApiClient(CONFIG, { runCurl });

    client.getMergeRequest('acme/widget', 7);
    client.listDiscussions('acme/widget', 7);

    expect(calls[0][calls[0].length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget/merge_requests/7');
    expect(calls[1][calls[1].length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget/merge_requests/7/discussions');
  });

  it('empty stdout returns undefined', () => {
    const { runCurl } = makeRecordingCurl('');
    const client = new GitLabApiClient(CONFIG, { runCurl });

    expect(client.getProject('acme/widget')).toBeUndefined();
  });
});

describe('GitLabApiClient — error paths log through the injected logger at error level (#818)', () => {
  it('a non-zero curl exit throws and logs once at error', () => {
    const { runCurl } = makeRecordingCurl('boom', 1);
    const { logger, messages } = makeLoggerSpy();
    const client = new GitLabApiClient(CONFIG, { runCurl, logger });

    expect(() => client.getProject('acme/widget')).toThrow(/curl exited with code 1/);
    expect(messages).toHaveLength(1);
    expect(messages[0].level).toBe('error');
    expect(messages[0].message).toContain('projects/acme%2Fwidget');
  });

  it('a spawn error throws and logs at error', () => {
    const runCurl: CurlRunner = () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn curl ENOENT') });
    const { logger, messages } = makeLoggerSpy();
    const client = new GitLabApiClient(CONFIG, { runCurl, logger });

    expect(() => client.getProject('acme/widget')).toThrow(/spawn curl ENOENT/);
    expect(messages[0].level).toBe('error');
  });

  it('a 401-shaped body throws "failed with 401" and logs at error', () => {
    const { runCurl } = makeRecordingCurl(JSON.stringify({ message: '401 Unauthorized' }));
    const { logger, messages } = makeLoggerSpy();
    const client = new GitLabApiClient(CONFIG, { runCurl, logger });

    expect(() => client.getProject('acme/widget')).toThrow(/failed with 401/);
    expect(messages[0].level).toBe('error');
  });

  it('a 404-shaped body throws "failed with 404" and logs at error', () => {
    const { runCurl } = makeRecordingCurl(JSON.stringify({ message: '404 Not Found' }));
    const { logger, messages } = makeLoggerSpy();
    const client = new GitLabApiClient(CONFIG, { runCurl, logger });

    expect(() => client.getProject('acme/widget')).toThrow(/failed with 404/);
    expect(messages[0].level).toBe('error');
  });
});

describe('GitLabApiClient — ambient environment is ignored (#818)', () => {
  it('a poisoned GITLAB_TOKEN/GITLAB_INSTANCE_URL in process.env never reaches the wire', () => {
    const prevToken = process.env.GITLAB_TOKEN;
    const prevUrl = process.env.GITLAB_INSTANCE_URL;
    process.env.GITLAB_TOKEN = 'ambient-token-must-be-ignored';
    process.env.GITLAB_INSTANCE_URL = 'https://ambient.invalid';

    try {
      const { runCurl, calls } = makeRecordingCurl(JSON.stringify({ default_branch: 'main' }));
      const client = new GitLabApiClient(CONFIG, { runCurl });

      client.getProject('acme/widget');

      const argv = calls[0];
      expect(argv).toContain('PRIVATE-TOKEN: glpat-fake');
      expect(argv[argv.length - 1]).toContain('gitlab.example.com');
      expect(argv.join(' ')).not.toContain('ambient');
    } finally {
      if (prevToken === undefined) delete process.env.GITLAB_TOKEN; else process.env.GITLAB_TOKEN = prevToken;
      if (prevUrl === undefined) delete process.env.GITLAB_INSTANCE_URL; else process.env.GITLAB_INSTANCE_URL = prevUrl;
    }
  });

  it('constructing with no deps does not throw', () => {
    expect(() => new GitLabApiClient(CONFIG)).not.toThrow();
  });
});
