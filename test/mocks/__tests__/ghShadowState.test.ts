/**
 * The forge state the `gh` shadow answers from is normalised from the mock GitHub API server's records. A pull request that one
 * run created through the shadow reaches the mock as the body of the create request, whose `head` and `base` are the branch
 * names themselves, and a later run reads it back by branch. An issue's close reason is read from either shape, and the
 * shadow's issue search and close honour it. Pure: no I/O.
 */

import { describe, it, expect } from 'vitest';

import { runGhCommand } from '../ghShadowCommands.ts';
import { forgeStateFrom, type ForgeRepository } from '../ghShadowState.ts';
import type { MockServerState } from '../types.ts';

const REPOSITORY: ForgeRepository = { owner: 'acme', repo: 'widgets', defaultBranch: 'main' };

function mockWith(prs: Record<string, unknown>): MockServerState {
  return { issues: {}, prs, comments: {}, labels: {}, secrets: {} };
}

function onlyPullRequest(prs: Record<string, unknown>) {
  const { pullRequests } = forgeStateFrom(mockWith(prs), REPOSITORY);
  return Object.values(pullRequests)[0];
}

describe('forgeStateFrom — the branches of a pull request', () => {
  it('reads head and base as the branch names of a create request, which the mock stores as they were sent', () => {
    const created = { number: 4321, title: 'feat: add orders', head: 'feature-issue-7', base: 'develop', body: 'Closes #7', state: 'OPEN' };

    expect(onlyPullRequest({ '4321': created })).toMatchObject({ number: 4321, headRefName: 'feature-issue-7', baseRefName: 'develop' });
  });

  it('still reads the branches nested as a REST response has them', () => {
    const rest = { number: 5, head: { ref: 'feature-issue-5' }, base: { ref: 'develop' }, state: 'open' };

    expect(onlyPullRequest({ '5': rest })).toMatchObject({ headRefName: 'feature-issue-5', baseRefName: 'develop' });
  });

  it('still reads the branches as gh names them', () => {
    const ghShaped = { number: 6, headRefName: 'feature-issue-6', baseRefName: 'develop', state: 'OPEN' };

    expect(onlyPullRequest({ '6': ghShaped })).toMatchObject({ headRefName: 'feature-issue-6', baseRefName: 'develop' });
  });

  it('falls back to the default branch for a base that is not named, and to no head branch', () => {
    expect(onlyPullRequest({ '8': { number: 8, state: 'OPEN' } })).toMatchObject({ headRefName: '', baseRefName: 'main' });
  });
});

function mockWithIssues(issues: Record<string, unknown>): MockServerState {
  return { issues, prs: {}, comments: {}, labels: {}, secrets: {} };
}

const PROPOSAL_LABELS = [{ name: 'adw:none' }, { name: 'promotion-proposal' }];

describe('forgeStateFrom — the reason an issue was closed for', () => {
  it('reads a REST state_reason of not_planned as NOT_PLANNED, a closed issue without one as COMPLETED, and an open one as none', () => {
    const { issues } = forgeStateFrom(
      mockWithIssues({
        '40': { number: 40, state: 'closed', state_reason: 'not_planned' },
        '41': { number: 41, state: 'closed' },
        '42': { number: 42, state: 'open' },
      }),
      REPOSITORY,
    );

    expect([issues['40'].stateReason, issues['41'].stateReason, issues['42'].stateReason]).toEqual(['NOT_PLANNED', 'COMPLETED', '']);
  });
});

describe('the gh shadow — close reasons', () => {
  const state = forgeStateFrom(
    mockWithIssues({
      '40': { number: 40, title: 'Promotion Proposal 2026-11-01', state: 'closed', state_reason: 'completed', labels: PROPOSAL_LABELS },
      '41': { number: 41, title: 'Promotion Proposal 2026-11-08', state: 'closed', state_reason: 'not_planned', labels: PROPOSAL_LABELS },
      '42': { number: 42, title: 'Promotion Proposal 2026-11-15', state: 'open', labels: PROPOSAL_LABELS },
    }),
    REPOSITORY,
  );

  function listedNumbers(search: string): number[] {
    const argv = ['issue', 'list', '--repo', 'acme/widgets', '--state', 'all', '--json', 'number', '--search', search, '--limit', '100'];
    const outcome = runGhCommand(argv, () => '', state);
    return (JSON.parse(outcome.stdout) as { number: number }[]).map((issue) => issue.number);
  }

  it('lists only the not-planned proposals for reason:"not planned", and only the completed ones for reason:completed', () => {
    expect(listedNumbers('label:"promotion-proposal" reason:"not planned"')).toEqual([41]);
    expect(listedNumbers('label:"promotion-proposal" reason:completed')).toEqual([40]);
  });

  it('records an issue close as COMPLETED', () => {
    const outcome = runGhCommand(['issue', 'close', '42', '--repo', 'acme/widgets'], () => '', state);

    expect(outcome.state?.issues['42']).toMatchObject({ state: 'CLOSED', stateReason: 'COMPLETED' });
  });
});
