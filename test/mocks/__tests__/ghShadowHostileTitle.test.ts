/**
 * The adapter-to-shadow argv contract. devplatform builds `gh pr create` with a hostile title as one
 * argv element, and the gh shadow, handed that argv verbatim, records an open pull request whose
 * title is exactly the hostile one. Pure: the executor is a recorder and no process is spawned.
 */

import { describe, it, expect } from 'vitest';
import { createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import { forgeProviders } from '@paysdoc/devplatform/providers';
import { Platform, type RepoIdentifier } from '@paysdoc/devplatform';

import { runGhCommand } from '../ghShadowCommands.ts';
import type { ForgeState } from '../ghShadowState.ts';
import { makeCtx, makeSpyExec, type SpyCall } from '../gitContextFixture.ts';

const HOSTILE_TITLE = "Fix the user's `foo` $(echo pwned) crash";
const BODY = 'Implements #1029';
const SOURCE_BRANCH = 'chore-issue-1029-x';
const PR_URL = 'https://github.com/acme/widget/pull/1';
const NOW = '2026-10-08T00:00:00.000Z';

const IDENTITY: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

const FORGE: ForgeState = {
  repository: { owner: 'acme', repo: 'widget', defaultBranch: 'main' },
  issues: {},
  pullRequests: {},
};

function isPullRequestCreate({ argv }: SpyCall): boolean {
  return argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'create';
}

function recordPullRequestCreation(): SpyCall {
  const { exec, calls } = makeSpyExec(new Map([['gh pr list', '[]'], ['gh pr create', PR_URL]]));
  const providers = forgeProviders({
    forge: { codeHost: 'github', issueTracker: 'github' },
    identity: IDENTITY,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
    gitContext: makeCtx({}, exec),
  });

  providers.codeHost.createPullRequest({
    title: HOSTILE_TITLE,
    body: BODY,
    sourceBranch: SOURCE_BRANCH,
    targetBranch: 'main',
    linkedIssueNumber: 1029,
  });

  const creation = calls.find(isPullRequestCreate);
  if (!creation) throw new Error(`No "gh pr create" reached the executor. Saw: ${calls.map(({ argv }) => argv.join(' ')).join(' | ')}`);
  return creation;
}

describe('gh pr create with a hostile title', () => {
  it('carries the title as one argv element and the body on stdin', () => {
    const { argv, input } = recordPullRequestCreation();

    expect(argv[argv.indexOf('--title') + 1]).toBe(HOSTILE_TITLE);
    expect(argv[argv.indexOf('--head') + 1]).toBe(SOURCE_BRANCH);
    expect(argv[argv.indexOf('--body-file') + 1]).toBe('-');
    expect(input).toBe(BODY);
  });

  it('is recorded by the gh shadow as an open pull request with exactly that title', () => {
    const { argv, input } = recordPullRequestCreation();

    const outcome = runGhCommand(argv.slice(1), () => input ?? '', FORGE, () => NOW);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(`${PR_URL}\n`);
    const pullRequests = Object.values(outcome.state?.pullRequests ?? {});
    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0]).toMatchObject({ state: 'OPEN', title: HOSTILE_TITLE, body: BODY, headRefName: SOURCE_BRANCH });
  });

  it('is logged by the gh shadow as the REST request that carries exactly that title', () => {
    const { argv, input } = recordPullRequestCreation();

    const outcome = runGhCommand(argv.slice(1), () => input ?? '', FORGE, () => NOW);

    expect(outcome.log?.kind).toBe('write');
    expect(outcome.log?.request).toMatchObject({
      method: 'POST',
      path: '/repos/acme/widget/pulls',
      body: { title: HOSTILE_TITLE, head: SOURCE_BRANCH },
    });
  });
});
