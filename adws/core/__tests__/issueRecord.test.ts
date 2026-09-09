import { describe, it, expect } from 'vitest';
import { fetchIssueRecord } from '../issueRecord';
import { GitContext } from '../../gitContext';
import type { GitContextOptions, ExecFn } from '../../gitContext';
import { createLiteralTokenProvider } from '../../providers/github/githubTokenProvider';

function makeCtx(exec: ExecFn): GitContext {
  const options: GitContextOptions = {
    owner: 'acme',
    repo: 'widget',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
    gitIdentity: {
      authorName: 'ADW Bot', authorEmail: 'bot@adw.dev',
      committerName: 'ADW Bot', committerEmail: 'bot@adw.dev',
    },
    frameworkRepoRoot: '/srv/adw/framework',
    targetReposDir: '/srv/adw/repos',
  };
  return new GitContext(options, { exec });
}

describe('fetchIssueRecord', () => {
  it('runs the bound context\'s fetch-issue command for the bound owner/repo', async () => {
    const calls: string[] = [];
    const json = JSON.stringify({
      number: 42, title: 'Ship it', state: 'OPEN',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', url: 'https://x',
    });
    const exec: ExecFn = (command) => {
      calls.push(command);
      return json;
    };

    const issue = await fetchIssueRecord(makeCtx(exec), 42);

    expect(calls.some((c) => c.includes('gh issue view 42') && c.includes('acme/widget'))).toBe(true);
    expect(issue.number).toBe(42);
    expect(issue.title).toBe('Ship it');
  });

  it('applies the legacy defaults — unknown author, empty body — when absent from the payload', async () => {
    const json = JSON.stringify({
      number: 42, title: 'Ship it', state: 'OPEN',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', url: 'https://x',
    });
    const exec: ExecFn = () => json;

    const issue = await fetchIssueRecord(makeCtx(exec), 42);

    expect(issue.author).toEqual({ login: 'unknown', name: null, isBot: false });
    expect(issue.body).toBe('');
  });

  it('rejects with the legacy wrapped message naming the issue on a refused command', async () => {
    const exec: ExecFn = () => { throw new Error('boom'); };

    await expect(fetchIssueRecord(makeCtx(exec), 42)).rejects.toThrow('Failed to fetch issue #42: Error: boom');
  });
});
