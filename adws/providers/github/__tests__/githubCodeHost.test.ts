import { describe, it, expect } from 'vitest';
import { createGitHubCodeHost, GitHubCodeHost } from '../githubCodeHost';
import { mapRawPRToSummary } from '../mappers';
import { Platform, type RepoIdentifier } from '../../types';
import { makeCtx, makeSpyExec, makeCapturingLogger, FRAMEWORK_ROOT } from './gitContextFixture';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

describe('GitHubCodeHost — command strings', () => {
  it('fetchPRDetails spawns the exact gh pr view command from the framework root', () => {
    const json = JSON.stringify({ number: 7, title: 'T', body: '', state: 'OPEN', headRefName: 'x', baseRefName: 'main', url: 'https://x' });
    const { exec, calls } = makeSpyExec(new Map([['gh pr view 7', json]]));
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID);

    codeHost.fetchPullRequest(7);

    expect(calls[0].command).toBe('gh pr view 7 --repo acme/widget --json number,title,body,state,headRefName,baseRefName,url');
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('prApprovalState spawns gh pr view --json reviewDecision,reviews', () => {
    const { exec, calls } = makeSpyExec(new Map([['reviewDecision', JSON.stringify({ reviewDecision: 'APPROVED', reviews: [] })]]));
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID);

    codeHost.isPullRequestApproved(7);

    expect(calls[0].command).toBe('gh pr view 7 --repo acme/widget --json reviewDecision,reviews');
  });

  it('approvePR carries the elevated credential (alternate literal)', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = makeCtx({ tokenProvider: { credentialEnv: ({ purpose }) => ({ GH_TOKEN: purpose === 'alternateIdentity' ? 'pat-alt' : 'ordinary' }) } }, exec);
    const codeHost = createGitHubCodeHost(ctx, REPO_ID);

    codeHost.approvePullRequest(7);

    expect(calls[0].command).toBe('gh pr review 7 --approve --repo acme/widget');
    expect(calls[0].env.GH_TOKEN).toBe('pat-alt');
  });

  it('mergePR spawns gh pr merge', () => {
    const { exec, calls } = makeSpyExec();
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID);

    codeHost.mergePullRequest(7);

    expect(calls[0].command).toBe('gh pr merge 7 --merge --repo acme/widget');
  });

  it('fetchPRList spawns gh pr list --state open', () => {
    const { exec, calls } = makeSpyExec(new Map([['--state open', '[]']]));
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID);

    codeHost.listOpenPullRequests();

    expect(calls[0].command).toBe('gh pr list --repo acme/widget --state open --json number,headRefName,updatedAt');
  });

  it('findPRByBranch spawns gh pr list --head', () => {
    const { exec, calls } = makeSpyExec(new Map([['--head', '[]']]));
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID);

    codeHost.findPullRequestByBranch('feature-x');

    expect(calls[0].command).toContain('gh pr list --repo acme/widget --head "feature-x"');
  });
});

describe('GitHubCodeHost — parse and map', () => {
  it('fetchPullRequest maps "Implements #N" and the branch fallback', () => {
    const withMarker = JSON.stringify({ number: 7, title: 'T', body: 'Implements #12', state: 'OPEN', headRefName: 'feature-issue-42-x', baseRefName: 'main', url: 'https://x' });
    const { exec: exec1 } = makeSpyExec(new Map([['gh pr view', withMarker]]));
    expect(createGitHubCodeHost(makeCtx({}, exec1), REPO_ID).fetchPullRequest(7).linkedIssueNumber).toBe(12);

    const noMarker = JSON.stringify({ number: 7, title: 'T', body: 'no marker', state: 'OPEN', headRefName: 'feature-issue-42-x', baseRefName: 'main', url: 'https://x' });
    const { exec: exec2 } = makeSpyExec(new Map([['gh pr view', noMarker]]));
    expect(createGitHubCodeHost(makeCtx({}, exec2), REPO_ID).fetchPullRequest(7).linkedIssueNumber).toBe(42);
  });

  it('fetchReviewComments concatenates line comments and review bodies, emitting the four progress lines', () => {
    const lineJson = JSON.stringify([{ id: 1, body: 'nit', path: 'a.ts', line: 3, created_at: 't1', updated_at: 't1', user: { login: 'r' } }]);
    const reviewJson = JSON.stringify([{ id: 2, state: 'CHANGES_REQUESTED', body: '', submitted_at: 't2', user: { login: 'm' } }]);
    const { exec } = makeSpyExec(new Map([['pulls/7/comments', lineJson], ['pulls/7/reviews', reviewJson]]));
    const { logger, logs } = makeCapturingLogger();
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID, { logger });

    const comments = codeHost.fetchReviewComments(7);

    expect(comments).toHaveLength(2);
    expect(comments[1].body).toBe('[Review submitted: CHANGES_REQUESTED]');
    expect(logs).toHaveLength(4);
    expect(logs[0].message).toContain('Fetching PR review comments');
    expect(logs[3].message).toContain('Total: 2 comments');
  });

  it('isPullRequestApproved runs the reviewDecision matrix and warns+false on throw', () => {
    const { exec } = makeSpyExec(new Map([['reviewDecision', JSON.stringify({ reviewDecision: 'APPROVED', reviews: [] })]]));
    expect(createGitHubCodeHost(makeCtx({}, exec), REPO_ID).isPullRequestApproved(7)).toBe(true);

    const { logger, logs } = makeCapturingLogger();
    const throwingExec = (): string => { throw new Error('gh: rate limited'); };
    const codeHost = createGitHubCodeHost(makeCtx({}, throwingExec), REPO_ID, { logger });
    expect(codeHost.isPullRequestApproved(7)).toBe(false);
    expect(logs[0].level).toBe('warn');
  });

  it('approvePullRequest/mergePullRequest report { success: false, error } carrying stderr, or String(error) otherwise', () => {
    const stderrError = Object.assign(new Error('wrapped'), { stderr: 'actual stderr text' });
    const exec = (): string => { throw stderrError; };
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID);
    expect(codeHost.approvePullRequest(7)).toEqual({ success: false, error: 'actual stderr text' });

    const plainError = (): string => { throw new Error('plain failure'); };
    const codeHost2 = createGitHubCodeHost(makeCtx({}, plainError), REPO_ID);
    expect(codeHost2.mergePullRequest(7)).toEqual({ success: false, error: 'Error: plain failure' });
  });

  it('findPullRequestByBranch prefers the open PR (#508) and returns null on throw', () => {
    const json = JSON.stringify([
      { number: 5, state: 'CLOSED', headRefName: 'feature-x', baseRefName: 'main', updatedAt: '2026-02-01T00:00:00Z', labels: [] },
      { number: 9, state: 'OPEN', headRefName: 'feature-x', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z', labels: [{ name: 'hitl' }] },
    ]);
    const { exec } = makeSpyExec(new Map([['--head', json]]));
    const result = createGitHubCodeHost(makeCtx({}, exec), REPO_ID).findPullRequestByBranch('feature-x');
    expect(result?.number).toBe(9);
    expect(result?.labels).toEqual(['hitl']);

    const throwingExec = (): string => { throw new Error('gh api error: 500'); };
    expect(createGitHubCodeHost(makeCtx({}, throwingExec), REPO_ID).findPullRequestByBranch('feature-x')).toBeNull();
  });

  it('createPullRequest reuses an existing open PR and logs the reuse line at info', () => {
    const json = JSON.stringify([{ number: 9, state: 'OPEN', headRefName: 'feature-x', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z' }]);
    const { exec, calls } = makeSpyExec(new Map([['--head', json]]));
    const { logger, logs } = makeCapturingLogger();
    const codeHost = createGitHubCodeHost(makeCtx({}, exec), REPO_ID, { logger });

    const result = codeHost.createPullRequest({ title: 'T', body: 'b', sourceBranch: 'feature-x', targetBranch: 'main' });

    expect(result.number).toBe(9);
    expect(calls.some((c) => c.command.includes('gh pr create'))).toBe(false);
    expect(logs).toContainEqual({ message: 'Existing PR #9 found for branch feature-x, reusing', level: 'info' });
  });

  it('setSecret passes the value as input', () => {
    const { exec, calls } = makeSpyExec();
    createGitHubCodeHost(makeCtx({}, exec), REPO_ID).setSecret('MY_SECRET', 'super-secret');
    expect(calls[0].input).toBe('super-secret');
    expect(calls[0].command).not.toContain('super-secret');
  });

  it('listMergedPullRequests parses and returns unchanged', () => {
    const { exec } = makeSpyExec(new Map([['--state merged', JSON.stringify([{ body: 'Closes #1', mergedAt: '2024-01-01' }])]]));
    const result = createGitHubCodeHost(makeCtx({}, exec), REPO_ID).listMergedPullRequests(200);
    expect(result).toEqual([{ body: 'Closes #1', mergedAt: '2024-01-01' }]);
  });
});

describe('mapRawPRToSummary', () => {
  it('flattens labels to a string array', () => {
    const summary = mapRawPRToSummary({
      number: 7, state: 'OPEN', headRefName: 'feature-x', baseRefName: 'main',
      labels: [{ name: 'hitl' }, { name: 'wontfix' }],
    });
    expect(summary).toEqual({ number: 7, state: 'OPEN', sourceBranch: 'feature-x', targetBranch: 'main', labels: ['hitl', 'wontfix'] });
  });

  it('defaults a missing labels field to an empty array', () => {
    const summary = mapRawPRToSummary({ number: 7, state: 'MERGED', headRefName: 'feature-x', baseRefName: 'main' });
    expect(summary.labels).toEqual([]);
  });
});

describe('GitHubCodeHost — factory and identity', () => {
  it('createGitHubCodeHost returns a GitHubCodeHost instance', () => {
    expect(createGitHubCodeHost(makeCtx(), REPO_ID)).toBeInstanceOf(GitHubCodeHost);
  });

  it('refuses a mismatched context identity', () => {
    const ctx = makeCtx({ owner: 'octo', repo: 'infra' });
    expect(() => createGitHubCodeHost(ctx, REPO_ID)).toThrow(/octo\/infra/);
  });
});
