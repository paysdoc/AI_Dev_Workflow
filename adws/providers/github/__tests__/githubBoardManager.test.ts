import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGitHubBoardManager } from '../githubBoardManager';
import { Platform, type RepoIdentifier } from '../../types';
import { makeCtx, makeSpyExec, makeCapturingLogger } from './gitContextFixture';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

describe('GitHubBoardManager — findBoard', () => {
  it('issues gh api graphql with the alternate-identity token and returns the first node id', async () => {
    const json = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
    const ctx = makeCtx({ tokenProvider: { credentialEnv: ({ purpose }) => ({ GH_TOKEN: purpose === 'alternateIdentity' ? 'pat-alt' : 'ordinary' }) } },
      makeSpyExec(new Map([['projectsV2', json]])).exec);
    const bm = createGitHubBoardManager(ctx, REPO_ID);

    const result = await bm.findBoard();

    expect(result).toBe('PVT_1');
  });

  it('returns null and logs a warn line when the exec throws', async () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('gh api error: 500'); };
    const bm = createGitHubBoardManager(makeCtx({}, exec), REPO_ID, { logger });

    const result = await bm.findBoard();

    expect(result).toBeNull();
    expect(logs[0]).toEqual({ message: 'Failed to find project for acme/widget: Error: gh api error: 500', level: 'warn' });
  });
});

describe('GitHubBoardManager — ensureColumns', () => {
  it('logs a warn line and returns false when no Status field is found', async () => {
    const { logger, logs } = makeCapturingLogger();
    const json = JSON.stringify({ data: { node: { field: null } } });
    const { exec } = makeSpyExec(new Map([['field(name:', json]]));
    const bm = createGitHubBoardManager(makeCtx({}, exec), REPO_ID, { logger });

    const result = await bm.ensureColumns('PVT_1');

    expect(result).toBe(false);
    expect(logs).toContainEqual({ message: 'No Status field found on project board', level: 'warn' });
  });

  it('logs an info line per added column on a successful merge', async () => {
    const { logger, logs } = makeCapturingLogger();
    const fieldJson = JSON.stringify({ data: { node: { field: { id: 'F_1', options: [] } } } });
    const { exec } = makeSpyExec(new Map([['field(name:', fieldJson]]));
    const bm = createGitHubBoardManager(makeCtx({}, exec), REPO_ID, { logger });

    await bm.ensureColumns('PVT_1');

    const infoLogs = logs.filter((l) => l.level === 'info');
    expect(infoLogs).toHaveLength(5);
    expect(infoLogs[0].message).toContain('Added board column "Blocked"');
  });

  it('the injected logger receives every line — nothing reaches console when a logger is injected', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { logger } = makeCapturingLogger();
      const exec = (): string => { throw new Error('boom'); };
      const bm = createGitHubBoardManager(makeCtx({}, exec), REPO_ID, { logger });

      await bm.findBoard();

      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('GitHubBoardManager — construction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a mismatched context identity', () => {
    const ctx = makeCtx({ owner: 'octo', repo: 'infra' });
    expect(() => createGitHubBoardManager(ctx, REPO_ID)).toThrow(/octo\/infra/);
  });

  it('refuses an empty owner via validateRepoIdentifier', () => {
    expect(() => createGitHubBoardManager(makeCtx(), { owner: '', repo: 'widget', platform: Platform.GitHub })).toThrow(/owner/);
  });
});
