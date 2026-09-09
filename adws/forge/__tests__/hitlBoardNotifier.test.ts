import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  notifyReviewTransition,
  notifyBlockedTransition,
  buildNotifierDeps,
  type NotifierDeps,
} from '../hitlBoardNotifier';
import { Platform, type RepoIdentifier } from '../../providers/types';
import { makeCtx, makeSpyExec } from '../../providers/github/__tests__/gitContextFixture';

const WEBHOOK_URL = 'https://hooks.slack.com/test';
const REPO_INFO = { owner: 'acme', repo: 'myrepo', platform: Platform.GitHub };

function makeFetchMock(ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status });
}

function makeIssueReader(
  title: string,
  labels: string[],
): NonNullable<NotifierDeps['readIssue']> {
  return () => ({ title, labels: labels.map((name) => ({ name })) });
}

function makePRLister(
  prs: { number: number; url: string; body: string }[],
): NonNullable<NotifierDeps['listOpenPRs']> {
  return () =>
    prs.map((pr) => ({
      ...pr,
      state: 'OPEN',
      headRefName: `feature-issue-${pr.number}-x`,
      baseRefName: 'main',
      updatedAt: new Date().toISOString(),
    }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// notifyReviewTransition
// ---------------------------------------------------------------------------

describe('notifyReviewTransition', () => {
  it('posts :eyes: Slack message for a hitl issue with a matching PR', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Fix the retry budget', ['hitl']),
      listOpenPRs: makePRLister([
        { number: 100, url: 'https://github.com/acme/myrepo/pull/100', body: 'Implements #123' },
      ]),
    };

    await notifyReviewTransition({ issueNumber: 123, repoInfo: REPO_INFO }, deps);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain(':eyes:');
    expect(body.text).toContain('HITL issue #123');
    expect(body.text).toContain('Fix the retry budget');
    expect(body.text).toContain('In Review');
    expect(body.text).toContain('Approve to merge');
    expect(body.text).toContain('https://github.com/acme/myrepo/pull/100');
    expect(body.text).not.toContain('/issues/123');
  });

  it('posts for a hitl issue whose PR uses the repo-qualified `Closes owner/repo#N` body', async () => {
    // #592 regression: the SDLC PR template emits `Closes owner/repo#N`, not `Implements #N`.
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('JUnit report rail', ['hitl']),
      listOpenPRs: makePRLister([
        { number: 592, url: 'https://github.com/acme/myrepo/pull/592', body: 'Closes acme/myrepo#578' },
      ]),
    };

    await notifyReviewTransition({ issueNumber: 578, repoInfo: REPO_INFO }, deps);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('HITL issue #578');
    expect(body.text).toContain('https://github.com/acme/myrepo/pull/592');
  });

  it('posts nothing for a non-hitl issue and does not call listOpenPRs', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);
    const prLister = vi.fn();

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Routine bump', []),
      listOpenPRs: prLister,
    };

    await notifyReviewTransition({ issueNumber: 124, repoInfo: REPO_INFO }, deps);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(prLister).not.toHaveBeenCalled();
  });

  it('picks only the PR matching the exact issue number (digit boundary)', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Bootstrap', ['hitl']),
      listOpenPRs: makePRLister([
        { number: 50, url: 'https://github.com/acme/myrepo/pull/50', body: 'Implements #1' },
        { number: 60, url: 'https://github.com/acme/myrepo/pull/60', body: 'Implements #12' },
      ]),
    };

    await notifyReviewTransition({ issueNumber: 1, repoInfo: REPO_INFO }, deps);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('/pull/50');
    expect(body.text).not.toContain('/pull/60');
  });

  it('ignores promotion PRs and unrelated impl PRs', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Add retry budget', ['hitl']),
      listOpenPRs: makePRLister([
        { number: 100, url: 'https://github.com/acme/myrepo/pull/100', body: 'Implements #123' },
        { number: 200, url: 'https://github.com/acme/myrepo/pull/200', body: 'Moves scenario foo.feature into the regression suite' },
        { number: 300, url: 'https://github.com/acme/myrepo/pull/300', body: 'Implements #456' },
      ]),
    };

    await notifyReviewTransition({ issueNumber: 123, repoInfo: REPO_INFO }, deps);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('/pull/100');
    expect(body.text).not.toContain('/pull/200');
    expect(body.text).not.toContain('/pull/300');
  });

  it('does not post when no matching PR is found', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Some issue', ['hitl']),
      listOpenPRs: makePRLister([]),
    };

    await notifyReviewTransition({ issueNumber: 999, repoInfo: REPO_INFO }, deps);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('swallows a failing fetch without throwing', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Resilient issue', ['hitl']),
      listOpenPRs: makePRLister([
        { number: 152, url: 'https://github.com/acme/myrepo/pull/152', body: 'Implements #152' },
      ]),
    };

    await expect(
      notifyReviewTransition({ issueNumber: 152, repoInfo: REPO_INFO }, deps),
    ).resolves.toBeUndefined();
  });

  it('does not throw when readIssue returns null', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = { readIssue: () => null, listOpenPRs: () => null };

    await expect(
      notifyReviewTransition({ issueNumber: 999, repoInfo: REPO_INFO }, deps),
    ).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// notifyBlockedTransition — discarded
// ---------------------------------------------------------------------------

describe('notifyBlockedTransition — discarded', () => {
  it('posts :no_entry: message with issue URL for a hitl issue', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Wire the export endpoint', ['hitl']),
      listOpenPRs: () => null,
    };

    await notifyBlockedTransition({ issueNumber: 130, repoInfo: REPO_INFO, source: 'discarded' }, deps);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain(':no_entry:');
    expect(body.text).toContain('HITL issue #130');
    expect(body.text).toContain('Wire the export endpoint');
    expect(body.text).toContain('discarded');
    expect(body.text).toContain('https://github.com/acme/myrepo/issues/130');
  });

  it('posts nothing for a non-hitl issue', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Bump lockfile', []),
      listOpenPRs: () => null,
    };

    await notifyBlockedTransition({ issueNumber: 133, repoInfo: REPO_INFO, source: 'discarded' }, deps);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// notifyBlockedTransition — review_error
// ---------------------------------------------------------------------------

describe('notifyBlockedTransition — review_error', () => {
  it('posts :warning: message with snippet and issue URL', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Tighten the auth guard', ['hitl']),
      listOpenPRs: () => null,
    };

    await notifyBlockedTransition(
      {
        issueNumber: 131,
        repoInfo: REPO_INFO,
        source: 'review_error',
        errorMessage: 'Assertion failed: expected approval state APPROVED',
      },
      deps,
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain(':warning:');
    expect(body.text).toContain('HITL issue #131');
    expect(body.text).toContain('Tighten the auth guard');
    expect(body.text).toContain('PR review failed');
    expect(body.text).toContain('needs attention');
    expect(body.text).toContain('Assertion failed');
    expect(body.text).toContain('https://github.com/acme/myrepo/issues/131');
  });

  it('collapses multi-line error to single line, truncated to ≤200 chars', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const longError =
      'Error: review build failed\n' +
      'at line 1\n'.repeat(50) +
      'TAIL-MARKER end';

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Refactor the merge gate', ['hitl']),
      listOpenPRs: () => null,
    };

    await notifyBlockedTransition(
      { issueNumber: 132, repoInfo: REPO_INFO, source: 'review_error', errorMessage: longError },
      deps,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('Error: review build failed');
    expect(body.text).not.toContain('\n');
    expect(body.text).not.toContain('TAIL-MARKER');
    const snippetMatch = body.text.match(/PR review failed: (.+?) — needs attention/);
    expect(snippetMatch).not.toBeNull();
    expect(snippetMatch![1].length).toBeLessThanOrEqual(200);
  });

  it('swallows a failing Slack delivery without throwing', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Something', ['hitl']),
      listOpenPRs: () => null,
    };

    await expect(
      notifyBlockedTransition({ issueNumber: 200, repoInfo: REPO_INFO, source: 'discarded' }, deps),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildNotifierDeps — the one production reader set
// ---------------------------------------------------------------------------

describe('buildNotifierDeps', () => {
  const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

  it('readIssue parses title and labels from the fetchIssue JSON', () => {
    const json = JSON.stringify({ title: 'Fix the retry budget', labels: [{ name: 'hitl' }] });
    const { exec } = makeSpyExec(new Map([['gh issue view', json]]));
    const deps = buildNotifierDeps(makeCtx({}, exec), REPO_ID);
    expect(deps.readIssue(42, REPO_ID)).toEqual({ title: 'Fix the retry budget', labels: [{ name: 'hitl' }] });
  });

  it('readIssue returns null when exec throws', () => {
    const throwingExec = (): string => { throw new Error('gh: not found'); };
    const deps = buildNotifierDeps(makeCtx({}, throwingExec), REPO_ID);
    expect(deps.readIssue(42, REPO_ID)).toBeNull();
  });

  it('listOpenPRs keeps only OPEN PRs and builds the pull URL', () => {
    const json = JSON.stringify([
      { number: 100, body: 'Implements #42', state: 'OPEN' },
      { number: 101, body: 'Implements #43', state: 'CLOSED' },
    ]);
    const { exec } = makeSpyExec(new Map([['--state all', json]]));
    const deps = buildNotifierDeps(makeCtx({}, exec), REPO_ID);
    const prs = deps.listOpenPRs(REPO_ID);
    expect(prs).toEqual([
      { number: 100, url: 'https://github.com/acme/widget/pull/100', body: 'Implements #42', state: 'OPEN', headRefName: '', baseRefName: '', updatedAt: '' },
    ]);
  });

  it('listOpenPRs returns null when exec throws', () => {
    const throwingExec = (): string => { throw new Error('gh: rate limited'); };
    const deps = buildNotifierDeps(makeCtx({}, throwingExec), REPO_ID);
    expect(deps.listOpenPRs(REPO_ID)).toBeNull();
  });
});
