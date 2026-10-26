/**
 * The forge state the `gh` shadow answers from is normalised from the mock GitHub API server's records. A pull request that one
 * run created through the shadow reaches the mock as the body of the create request, whose `head` and `base` are the branch
 * names themselves, and a later run reads it back by branch. Pure: no I/O.
 */

import { describe, it, expect } from 'vitest';

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
