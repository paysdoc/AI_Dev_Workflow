/**
 * gitlabCodeHost.test.ts — factory validation and end-to-end drive through a
 * fake curl runner, proving `createGitLabCodeHost` threads injected
 * configuration and deps down to the client it builds (#818).
 */

import { describe, it, expect } from 'vitest';
import { createGitLabCodeHost } from '../gitlabCodeHost';
import type { CurlResult, CurlRunner } from '../gitlabApiClient';
import { Platform, type RepoIdentifier } from '../../types';
import type { LogLevel } from '../../../gitContext/types';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitLab };

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

describe('createGitLabCodeHost — validates injected configuration (#818)', () => {
  it('throws naming the token when blank', () => {
    expect(() => createGitLabCodeHost(REPO_ID, { token: '', instanceUrl: 'https://gitlab.com' })).toThrow(/non-empty token/);
  });

  it('throws naming the instanceUrl when blank', () => {
    expect(() => createGitLabCodeHost(REPO_ID, { token: 'glpat-x', instanceUrl: '' })).toThrow(/non-empty instanceUrl/);
  });

  it('throws via validateRepoIdentifier when the owner is blank', () => {
    expect(() => createGitLabCodeHost({ owner: '', repo: 'widget', platform: Platform.GitLab }, { token: 'x', instanceUrl: 'https://gitlab.com' })).toThrow(/owner/);
  });
});

describe('createGitLabCodeHost — end-to-end through the factory with a fake curl (#818)', () => {
  const CONFIG = { token: 'glpat-injected', instanceUrl: 'https://gitlab.example.com' };

  it('getDefaultBranch returns the branch and hits the project URL', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify({ default_branch: 'develop' }));
    const codeHost = createGitLabCodeHost(REPO_ID, CONFIG, { runCurl });

    expect(codeHost.getDefaultBranch()).toBe('develop');
    expect(calls[0][calls[0].length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget');
  });

  it('createPullRequest maps body to description and returns url/number', () => {
    const { runCurl } = makeRecordingCurl(JSON.stringify({
      iid: 9,
      web_url: 'https://gitlab.example.com/acme/widget/-/merge_requests/9',
    }));
    const codeHost = createGitLabCodeHost(REPO_ID, CONFIG, { runCurl });

    const result = codeHost.createPullRequest({ sourceBranch: 'feat', targetBranch: 'main', title: 'T', body: 'B' });

    expect(result).toEqual({ url: 'https://gitlab.example.com/acme/widget/-/merge_requests/9', number: 9 });
  });

  it('commentOnPullRequest posts to the notes endpoint', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify({ id: 1 }));
    const codeHost = createGitLabCodeHost(REPO_ID, CONFIG, { runCurl });

    codeHost.commentOnPullRequest(9, 'x');

    expect(calls[0][calls[0].length - 1]).toBe('https://gitlab.example.com/api/v4/projects/acme%2Fwidget/merge_requests/9/notes');
  });

  it('listOpenPullRequests queries state=opened', () => {
    const { runCurl, calls } = makeRecordingCurl(JSON.stringify([]));
    const codeHost = createGitLabCodeHost(REPO_ID, CONFIG, { runCurl });

    codeHost.listOpenPullRequests();

    expect(calls[0][calls[0].length - 1]).toContain('?state=opened');
  });

  it('threads the injected logger to the underlying client on failure', () => {
    const runCurl: CurlRunner = () => ({ status: 22, stdout: '', stderr: 'boom' });
    const { logger, messages } = makeLoggerSpy();
    const codeHost = createGitLabCodeHost(REPO_ID, CONFIG, { runCurl, logger });

    expect(() => codeHost.getDefaultBranch()).toThrow();
    expect(messages).toHaveLength(1);
    expect(messages[0].level).toBe('error');
  });

  it('getRepoIdentifier returns the bound identifier', () => {
    const { runCurl } = makeRecordingCurl('');
    const codeHost = createGitLabCodeHost(REPO_ID, CONFIG, { runCurl });

    expect(codeHost.getRepoIdentifier()).toEqual(REPO_ID);
  });
});
