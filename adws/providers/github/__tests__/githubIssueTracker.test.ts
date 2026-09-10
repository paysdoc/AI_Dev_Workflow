import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGitHubIssueTracker, GitHubIssueTracker } from '../githubIssueTracker';
import { Platform, BoardStatus, type RepoIdentifier } from '../../types';
import { makeCtx, makeSpyExec, makeCapturingLogger, FRAMEWORK_ROOT } from './gitContextFixture';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

describe('GitHubIssueTracker — command strings', () => {
  it('fetchLabels(42) spawns the exact gh issue view command from the bound framework root, with the context token', async () => {
    const { exec, calls } = makeSpyExec();
    const ctx = makeCtx({}, exec);
    const tracker = createGitHubIssueTracker(ctx, REPO_ID);

    tracker.fetchLabels(42);

    expect(calls[0].command).toBe('gh issue view 42 --repo acme/widget --json labels');
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].env.GH_TOKEN).toBe('gh-token-abc');
  });

  it('createIssue spawns gh issue create with the title and pipes the body via stdin', async () => {
    const { exec, calls } = makeSpyExec(new Map([['gh issue create', 'https://github.com/acme/widget/issues/101']]));
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    tracker.createIssue('title', 'body text');

    expect(calls[0].command).toContain("gh issue create --repo acme/widget --title 'title'");
    expect(calls[0].input).toBe('body text');
  });
});

describe('GitHubIssueTracker — parse and map', () => {
  it('fetchIssue maps a raw payload to Issue, flattening labels to names with the unknown-author default', async () => {
    const json = JSON.stringify({
      number: 42, title: 'Ship it', state: 'OPEN', labels: [{ name: 'hitl' }],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', url: 'https://x',
    });
    const { exec } = makeSpyExec(new Map([['gh issue view 42', json]]));
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    const issue = await tracker.fetchIssue(42);

    expect(issue.author).toBe('unknown');
    expect(issue.labels).toEqual(['hitl']);
  });

  it('fetchComments maps the REST shape (user.login/created_at)', () => {
    const json = JSON.stringify([{ id: 90210, body: 'first', user: { login: 'octocat' }, created_at: '2026-01-04T00:00:00Z' }]);
    const { exec } = makeSpyExec(new Map([['comments', json]]));
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    const comments = tracker.fetchComments(42);

    expect(comments).toEqual([{ id: '90210', body: 'first', author: 'octocat', createdAt: '2026-01-04T00:00:00Z' }]);
  });

  it('createIssue returns 101 parsed from the issue URL and logs success', () => {
    const { logger, logs } = makeCapturingLogger();
    const { exec } = makeSpyExec(new Map([['gh issue create', 'https://github.com/acme/widget/issues/101']]));
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    const result = tracker.createIssue('title', 'body');

    expect(result).toBe(101);
    expect(logs).toContainEqual({ message: 'Created issue #101: title', level: 'success' });
  });
});

describe('GitHubIssueTracker — error policies', () => {
  it('commentOnIssue swallows and logs at error', () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('gh api error: 500'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(() => tracker.commentOnIssue(42, 'x')).not.toThrow();
    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('addLabel swallows and logs at error', () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('gh api error: 500'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(() => tracker.addLabel(42, 'hitl')).not.toThrow();
    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('updateIssueBody logs at error and rethrows', () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('gh api error: 500'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(() => tracker.updateIssueBody(42, 'x')).toThrow('gh api error: 500');
    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('getIssueState logs at error and rethrows', () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('gh api error: 500'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(() => tracker.getIssueState(42)).toThrow('gh api error: 500');
    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('deleteComment rethrows a wrapped message naming the comment id', () => {
    const exec = (): string => { throw new Error('boom'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    expect(() => tracker.deleteComment('55')).toThrow('Failed to delete comment 55: Error: boom');
  });

  it('fetchComments rethrows a wrapped message naming the issue', () => {
    const exec = (): string => { throw new Error('boom'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    expect(() => tracker.fetchComments(42)).toThrow('Failed to fetch comments for issue #42: Error: boom');
  });

  it('fetchIssue rethrows a wrapped message naming the issue', async () => {
    const exec = (): string => { throw new Error('boom'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    await expect(tracker.fetchIssue(42)).rejects.toThrow('Failed to fetch issue #42: Error: boom');
  });

  it('fetchLabels fails open to [] with a warn log', () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('boom'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(tracker.fetchLabels(42)).toEqual([]);
    expect(logs[0].level).toBe('warn');
  });

  it('searchOpenIssues and findOpenUpgradeIssue are best-effort with no log', () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('boom'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(tracker.searchOpenIssues('x', 5)).toEqual([]);
    expect(tracker.findOpenUpgradeIssue()).toBeNull();
    expect(logs).toHaveLength(0);
  });

  it('listIssues rethrows with no log', () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('boom'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(() => tracker.listIssues({ fields: ['number'] })).toThrow();
    expect(logs).toHaveLength(0);
  });
});

describe('GitHubIssueTracker — closeIssue', () => {
  it('already-closed: returns false, logs info, issues no close command', async () => {
    const { logger, logs } = makeCapturingLogger();
    const { exec, calls } = makeSpyExec(new Map([['--json state', JSON.stringify({ state: 'CLOSED' })]]));
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    const result = await tracker.closeIssue(42);

    expect(result).toBe(false);
    expect(calls.some((c) => c.command.includes('gh issue close'))).toBe(false);
    expect(logs.some((l) => l.level === 'info')).toBe(true);
  });

  it('open with comment: comments before closing, returns true, logs success', async () => {
    const { exec, calls } = makeSpyExec(new Map([['--json state', JSON.stringify({ state: 'OPEN' })]]));
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    const result = await tracker.closeIssue(42, 'closing comment');

    expect(result).toBe(true);
    const commentIdx = calls.findIndex((c) => c.command.includes('gh issue comment 42'));
    const closeIdx = calls.findIndex((c) => c.command.includes('gh issue close 42'));
    expect(commentIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(commentIdx);
  });

  it('state-fetch throwing: returns false with two error log lines', async () => {
    const { logger, logs } = makeCapturingLogger();
    const exec = (): string => { throw new Error('boom'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    const result = await tracker.closeIssue(42);

    expect(result).toBe(false);
    expect(logs.filter((l) => l.level === 'error')).toHaveLength(2);
  });
});

describe('GitHubIssueTracker — moveToStatus', () => {
  const projectResponse = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
  const itemResponse = JSON.stringify({
    data: { repository: { issue: { projectItems: { nodes: [
      { id: 'ITEM_1', project: { id: 'PVT_1' }, fieldValueByName: { name: 'Todo' } },
    ] } } } },
  });
  const fieldResponse = JSON.stringify({
    data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_REVIEW', name: 'Review' }] } } },
  });
  const moveResponse = JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });

  function makeMoveExec(): ReturnType<typeof makeSpyExec> {
    const responses = new Map([
      ['projectsV2(first:1)', projectResponse],
      ['projectItems(first:50)', itemResponse],
      ['field(name:', fieldResponse],
      ['updateProjectV2ItemFieldValue', moveResponse],
    ]);
    return makeSpyExec(responses);
  }

  it('calls onStatusMoved once, awaited, only when the move returns true', async () => {
    const { exec } = makeMoveExec();
    const calls: Array<[number, BoardStatus]> = [];
    let resolved = false;
    const onStatusMoved = async (n: number, s: BoardStatus): Promise<void> => {
      calls.push([n, s]);
      await new Promise((r) => setTimeout(r, 1));
      resolved = true;
    };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { onStatusMoved });

    const result = await tracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(true);
    expect(calls).toEqual([[42, BoardStatus.Review]]);
    expect(resolved).toBe(true);
  });

  it('does not call onStatusMoved when the move returns false', async () => {
    const exec = (): string => { throw new Error('gh api error: 500'); };
    let called = false;
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { onStatusMoved: async () => { called = true; } });

    const result = await tracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(false);
    expect(called).toBe(false);
  });

  it('a throwing hook is logged as a failed move and yields false', async () => {
    const { logger, logs } = makeCapturingLogger();
    const { exec } = makeMoveExec();
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, {
      logger,
      onStatusMoved: async () => { throw new Error('slack down'); },
    });

    const result = await tracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(false);
    expect(logs[0]).toEqual({ message: 'Failed to move issue #42 to "Review": Error: slack down', level: 'error' });
  });
});

describe('GitHubIssueTracker — applyLabel', () => {
  it('success path: one --add-label command, no gh label create', () => {
    const { exec, calls } = makeSpyExec();
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    tracker.applyLabel(42, 'adw:feature');

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toContain('--add-label');
    expect(calls.some((c) => c.command.includes('gh label create'))).toBe(false);
  });

  it('not-found: warns, creates the label with the injected definition, retries once', () => {
    const { logger, logs } = makeCapturingLogger();
    let editCalls = 0;
    const exec: ReturnType<typeof makeSpyExec>['exec'] = (command) => {
      if (command.includes('issue edit')) {
        editCalls++;
        if (editCalls === 1) throw new Error('label not found');
      }
      return '';
    };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, {
      logger,
      resolveLabelDefinition: (label) => ({ name: label, color: 'b60205', description: 'ADW lane escalated to human (terminal)' }),
    });

    expect(() => tracker.applyLabel(42, 'adw:blocked')).not.toThrow();
    expect(logs.some((l) => l.level === 'warn')).toBe(true);
    expect(editCalls).toBe(2);
  });

  it('persistent not-found: exactly one create, retry error propagates', () => {
    const exec: ReturnType<typeof makeSpyExec>['exec'] = (command) => {
      if (command.includes('issue edit')) throw new Error('label not found');
      return '';
    };
    let createCount = 0;
    const wrappedExec: ReturnType<typeof makeSpyExec>['exec'] = (command, opts) => {
      if (command.includes('gh label create')) createCount++;
      return exec(command, opts);
    };
    const tracker = createGitHubIssueTracker(makeCtx({}, wrappedExec), REPO_ID);

    expect(() => tracker.applyLabel(42, 'adw:chore')).toThrow();
    expect(createCount).toBe(1);
  });

  it('non-"not found" error rethrows with an error log and no create', () => {
    const { logger, logs } = makeCapturingLogger();
    let sawCreate = false;
    const exec: ReturnType<typeof makeSpyExec>['exec'] = (command) => {
      if (command.includes('gh label create')) sawCreate = true;
      if (command.includes('issue edit')) throw new Error('HTTP 500 Internal Server Error');
      return '';
    };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID, { logger });

    expect(() => tracker.applyLabel(42, 'adw:feature')).toThrow(/500/);
    expect(sawCreate).toBe(false);
    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('with no resolveLabelDefinition injected, the create carries the ededed/empty-description default', () => {
    let createCommand = '';
    let editCalls = 0;
    const exec: ReturnType<typeof makeSpyExec>['exec'] = (command) => {
      if (command.includes('gh label create')) createCommand = command;
      if (command.includes('issue edit')) {
        editCalls++;
        if (editCalls === 1) throw new Error('label not found');
      }
      return '';
    };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    tracker.applyLabel(42, 'adw:blocked');

    expect(createCommand).toContain('--color ededed');
    expect(createCommand).toContain("--description ''");
  });
});

describe('GitHubIssueTracker — default logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('with no logger injected, console.log sees the bare message (consoleLogger form)', () => {
    const { exec } = makeSpyExec();
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);

    tracker.addLabel(42, 'hitl');

    expect(consoleSpy).toHaveBeenCalledWith('Added label "hitl" to issue #42');
  });
});

describe('GitHubIssueTracker — factory identity refusal', () => {
  it('throws naming both identities when the context is bound elsewhere', () => {
    const ctx = makeCtx({ owner: 'octo', repo: 'infra' });
    expect(() => createGitHubIssueTracker(ctx, { owner: 'acme', repo: 'widget', platform: Platform.GitHub }))
      .toThrow(/acme\/widget/);
  });

  it('accepts a case-different identity', () => {
    const ctx = makeCtx({ owner: 'ACME', repo: 'Widget' });
    expect(() => createGitHubIssueTracker(ctx, { owner: 'acme', repo: 'widget', platform: Platform.GitHub })).not.toThrow();
  });

  it('still refuses an empty owner via validateRepoIdentifier, before the context-binding check', () => {
    const ctx = makeCtx();
    expect(() => createGitHubIssueTracker(ctx, { owner: '', repo: 'widget', platform: Platform.GitHub })).toThrow(/owner/);
  });

  it('createGitHubIssueTracker returns a GitHubIssueTracker instance', () => {
    const tracker = createGitHubIssueTracker(makeCtx(), REPO_ID);
    expect(tracker).toBeInstanceOf(GitHubIssueTracker);
  });
});
