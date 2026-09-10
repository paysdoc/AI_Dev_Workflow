import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  notifyReviewTransition,
  notifyBlockedTransition,
  buildNotifierDeps,
  type NotifierDeps,
  type NotifierPorts,
} from '../hitlBoardNotifier';
import { Platform, type RepoIdentifier, type Issue, type PullRequestRecord } from '../../providers/types';

const WEBHOOK_URL = 'https://hooks.slack.com/test';
const REPO_INFO = { owner: 'acme', repo: 'myrepo', platform: Platform.GitHub };

function makeFetchMock(ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status });
}

function makeIssueReader(
  title: string,
  labels: string[],
): NonNullable<NotifierDeps['readIssue']> {
  return async () => ({ title, labels });
}

function makePRLister(
  prs: { number: number; url: string; body: string; state?: string; updatedAt?: string }[],
): NonNullable<NotifierDeps['listOpenPRs']> {
  return () =>
    prs.map((pr) => ({
      number: pr.number,
      url: pr.url,
      body: pr.body,
      state: pr.state ?? 'OPEN',
      updatedAt: pr.updatedAt ?? new Date().toISOString(),
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

  it('picks the linked PR with the newest updatedAt, regardless of listing order', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Two attempts', ['hitl']),
      listOpenPRs: makePRLister([
        { number: 7, url: 'https://github.com/acme/myrepo/pull/7', body: 'Implements #42', updatedAt: '2026-09-02T10:00:00Z' },
        { number: 8, url: 'https://github.com/acme/myrepo/pull/8', body: 'Implements #42', updatedAt: '2026-09-09T10:00:00Z' },
      ]),
    };

    await notifyReviewTransition({ issueNumber: 42, repoInfo: REPO_INFO }, deps);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('/pull/8');
    expect(body.text).not.toContain('/pull/7');
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

    const deps: NotifierDeps = { readIssue: async () => null, listOpenPRs: () => null };

    await expect(
      notifyReviewTransition({ issueNumber: 999, repoInfo: REPO_INFO }, deps),
    ).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not post when the only linked PR is merged, not open', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    // listOpenPRs models the port-level OPEN filter — a merged-only pool is empty here.
    const deps: NotifierDeps = {
      readIssue: makeIssueReader('Already landed', ['hitl']),
      listOpenPRs: () => [],
    };

    await notifyReviewTransition({ issueNumber: 42, repoInfo: REPO_INFO }, deps);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not throw when listOpenPRs throws', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const deps: NotifierDeps = {
      readIssue: makeIssueReader('A stuck workflow', ['hitl']),
      listOpenPRs: () => { throw new Error('rate limited'); },
    };

    await expect(
      notifyReviewTransition({ issueNumber: 42, repoInfo: REPO_INFO }, deps),
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
// buildNotifierDeps — the one production reader set, over a resolved-later thunk
// ---------------------------------------------------------------------------

describe('buildNotifierDeps', () => {
  const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

  const SAMPLE_ISSUE: Issue = {
    id: '42', number: 42, title: 'Fix the retry budget', body: '', state: 'OPEN',
    author: 'octocat', labels: ['hitl'], comments: [], createdAt: '', url: '',
  };

  function fakePorts(overrides: Partial<NotifierPorts> = {}): NotifierPorts {
    return {
      issueTracker: { fetchIssue: async () => SAMPLE_ISSUE },
      codeHost: { listPullRequests: () => [] },
      ...overrides,
    };
  }

  it('does not invoke the thunk until a reader actually runs', () => {
    const resolvePorts = vi.fn(() => fakePorts());
    buildNotifierDeps(resolvePorts, REPO_ID);
    expect(resolvePorts).not.toHaveBeenCalled();
  });

  it('readIssue resolves title and string labels from the tracker', async () => {
    const deps = buildNotifierDeps(() => fakePorts(), REPO_ID);
    await expect(deps.readIssue(42, REPO_ID)).resolves.toEqual({ title: 'Fix the retry budget', labels: ['hitl'] });
  });

  it('readIssue returns null when the tracker throws', async () => {
    const deps = buildNotifierDeps(() => fakePorts({
      issueTracker: { fetchIssue: async () => { throw new Error('gh: not found'); } },
    }), REPO_ID);
    await expect(deps.readIssue(42, REPO_ID)).resolves.toBeNull();
  });

  it('listOpenPRs keeps only OPEN records and carries the forge-published url and updatedAt through', () => {
    const records: PullRequestRecord[] = [
      { number: 100, body: 'Implements #42', state: 'OPEN', mergedAt: null, updatedAt: '2026-09-01T00:00:00Z', url: 'https://github.com/acme/widget/pull/100' },
      { number: 101, body: 'Implements #43', state: 'CLOSED', mergedAt: null, updatedAt: '2026-09-02T00:00:00Z', url: 'https://github.com/acme/widget/pull/101' },
    ];
    const deps = buildNotifierDeps(() => fakePorts({ codeHost: { listPullRequests: () => records } }), REPO_ID);

    const prs = deps.listOpenPRs(REPO_ID);

    expect(prs).toEqual([
      { number: 100, url: 'https://github.com/acme/widget/pull/100', body: 'Implements #42', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z' },
    ]);
  });

  it('listOpenPRs returns null when the code host throws', () => {
    const deps = buildNotifierDeps(() => fakePorts({
      codeHost: { listPullRequests: () => { throw new Error('gh: rate limited'); } },
    }), REPO_ID);
    expect(deps.listOpenPRs(REPO_ID)).toBeNull();
  });
});
