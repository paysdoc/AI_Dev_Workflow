/**
 * A pull request one run created through the `gh` shadow is replayed against the mock GitHub API server once the run has
 * exited, and the next run's shadow answers from the mock's state. The pull request must come back as the same one: under the
 * number the shadow gave it, which the first run has written into its comments, and found by its head branch. Pure but for
 * the mock server's in-process state, which each test resets.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runGhCommand } from '../ghShadowCommands.ts';
import { forgeStateFrom, type ForgeRepository, type ForgeState } from '../ghShadowState.ts';
import { dispatchMockRequest, getMockServerState, resetMockServer, stopMockServer } from '../github-api-server.ts';

const REPOSITORY: ForgeRepository = { owner: 'acme', repo: 'widgets', defaultBranch: 'main' };
const ISSUE_NUMBER = 110110;
const BRANCH = 'feature-issue-110110';
const NOW = '2026-10-26T12:00:00.000Z';

const FORGE: ForgeState = {
  repository: REPOSITORY,
  issues: {
    [String(ISSUE_NUMBER)]: {
      number: ISSUE_NUMBER, title: 'Issue', body: '', state: 'OPEN', author: { login: 'u', name: '', is_bot: false }, assignees: [], labels: [],
      milestone: null, comments: [], createdAt: NOW, updatedAt: NOW, closedAt: null, url: `https://github.com/acme/widgets/issues/${ISSUE_NUMBER}`,
    },
  },
  pullRequests: {},
};

beforeEach(() => resetMockServer());
afterEach(() => stopMockServer());

function createPullRequest() {
  const argv = ['pr', 'create', '--repo', 'acme/widgets', '--title', 'feat: orders', '--head', BRANCH, '--base', 'main', '--body-file', '-'];
  return runGhCommand(argv, () => `Closes #${ISSUE_NUMBER}`, FORGE, () => NOW);
}

describe('a pull request created through the gh shadow, replayed against the mock', () => {
  it('carries the number the shadow gave it in the request it logs', () => {
    const outcome = createPullRequest();

    expect(outcome.stdout).toBe(`https://github.com/acme/widgets/pull/${ISSUE_NUMBER + 1}\n`);
    expect(outcome.log?.request).toMatchObject({ method: 'POST', path: '/repos/acme/widgets/pulls', body: { number: ISSUE_NUMBER + 1, head: BRANCH } });
  });

  it('is stored by the mock under that number, and the next shadow finds it there by its head branch', () => {
    const { log } = createPullRequest();
    if (!log?.request) throw new Error('Expected the shadow to log the pull request creation as a request');

    dispatchMockRequest(log.request.method, log.request.path, JSON.stringify(log.request.body));

    expect(Object.keys(getMockServerState().prs)).toContain(String(ISSUE_NUMBER + 1));
    const next = forgeStateFrom(getMockServerState(), REPOSITORY);
    expect(next.pullRequests[String(ISSUE_NUMBER + 1)]).toMatchObject({ number: ISSUE_NUMBER + 1, headRefName: BRANCH, baseRefName: 'main', state: 'OPEN' });
  });
});
