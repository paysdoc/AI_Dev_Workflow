import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { GhOutcome } from '../ghShadowArgs.ts';
import type { ForgeState, GhPullRequest } from '../ghShadowState.ts';
import { gitIn, landMergedPullRequest } from '../ghShadowLanding.ts';

const FILE = 'features/per-issue/feature-1.feature';
const BEFORE = 'Feature: Before\n';
const AFTER = '@promotion-suggested-2026-10-02\nFeature: Before\n';
const HEAD_BRANCH = 'chore/promotion-sweep';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(repository: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function commitFile(repository: string, content: string, message: string): void {
  writeFileSync(join(repository, FILE), content, 'utf-8');
  git(repository, 'add', '--', FILE);
  git(repository, 'commit', '-q', '-m', message);
}

/** A repository on `main` holding one file, with the remote-tracking ref a clone would have. */
function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'adw-landing-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Landing Test');
  git(dir, 'config', 'user.email', 'landing@test.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'features/per-issue'), { recursive: true });
  commitFile(dir, BEFORE, 'Initial commit');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
  git(dir, 'branch', 'seed');
  return dir;
}

/** The branch is made as the sweep makes its own: off `main`, with one commit, and `main` is checked out again afterwards. */
function withHeadBranch(dir: string): void {
  git(dir, 'checkout', '-q', '-b', HEAD_BRANCH);
  commitFile(dir, AFTER, 'chore: mark feature-1 promotion-suggested');
  git(dir, 'checkout', '-q', 'main');
}

function pullRequest(number: number): GhPullRequest {
  return {
    number, title: 'chore: promotion sweep', body: '', state: 'MERGED', headRefName: HEAD_BRANCH, baseRefName: 'main',
    url: `https://github.com/acme/widgets/pull/${number}`, mergedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    labels: [], reviewDecision: '', reviews: [], comments: [],
  };
}

function forgeWith(number: number): ForgeState {
  return { repository: { owner: 'acme', repo: 'widgets', defaultBranch: 'main' }, issues: {}, pullRequests: { [String(number)]: pullRequest(number) } };
}

/** What the shadow's `pr merge` hands back for a pull request of its own repository. */
function mergeOutcome(number: number): GhOutcome {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    state: forgeWith(number),
    log: {
      kind: 'write',
      argv: ['pr', 'merge', String(number), '--merge', '--repo', 'acme/widgets'],
      request: { method: 'PUT', path: `/repos/acme/widgets/pulls/${number}/merge`, body: { merge_method: 'merge' } },
    },
  };
}

describe('landMergedPullRequest', () => {
  it('moves the base branch, its remote-tracking ref and the checked-out file to the head of the merged branch', () => {
    const dir = repository();
    withHeadBranch(dir);
    const outcome = mergeOutcome(7);

    const result = landMergedPullRequest(outcome, gitIn(dir));

    expect(result).toBe(outcome);
    const head = git(dir, 'rev-parse', HEAD_BRANCH);
    expect(git(dir, 'rev-parse', 'main')).toBe(head);
    expect(git(dir, 'rev-parse', 'refs/remotes/origin/main')).toBe(head);
    expect(readFileSync(join(dir, FILE), 'utf-8')).toBe(AFTER);
  });

  it('still lands the merge once the head branch has been deleted, because the sweep deletes it only afterwards', () => {
    const dir = repository();
    withHeadBranch(dir);

    landMergedPullRequest(mergeOutcome(7), gitIn(dir));
    git(dir, 'branch', '-D', HEAD_BRANCH);

    expect(readFileSync(join(dir, FILE), 'utf-8')).toBe(AFTER);
    expect(git(dir, 'rev-parse', 'refs/remotes/origin/main')).toBe(git(dir, 'rev-parse', 'main'));
  });

  it('leaves the repository alone for a call that merged nothing', () => {
    const dir = repository();
    withHeadBranch(dir);
    const comment: GhOutcome = { stdout: '', stderr: '', exitCode: 0, state: forgeWith(7), log: { kind: 'write', argv: ['issue', 'comment', '7'], request: { method: 'POST', path: '/repos/acme/widgets/issues/7/comments', body: {} } } };
    const before = git(dir, 'rev-parse', 'main');

    expect(landMergedPullRequest(comment, gitIn(dir))).toBe(comment);
    expect(git(dir, 'rev-parse', 'main')).toBe(before);
  });

  it('leaves the repository alone for a merge that named another repository, which changed no forge state', () => {
    const dir = repository();
    withHeadBranch(dir);
    const elsewhere: GhOutcome = { ...mergeOutcome(7), state: undefined };
    const before = git(dir, 'rev-parse', 'main');

    expect(landMergedPullRequest(elsewhere, gitIn(dir))).toBe(elsewhere);
    expect(git(dir, 'rev-parse', 'main')).toBe(before);
  });

  it('fails the call, persisting and logging nothing, when the base branch cannot be fast-forwarded to the head', () => {
    const dir = repository();
    withHeadBranch(dir);
    commitFile(dir, 'Feature: Diverged\n', 'A commit the head branch does not hold');
    const before = git(dir, 'rev-parse', 'main');

    const result = landMergedPullRequest(mergeOutcome(7), gitIn(dir));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('gh shadow: could not land pull request #7');
    expect(result.state).toBeUndefined();
    expect(result.log).toBeUndefined();
    expect(git(dir, 'rev-parse', 'main')).toBe(before);
  });

  it('fails the call when the repository is not on the pull request\'s base branch', () => {
    const dir = repository();
    withHeadBranch(dir);
    git(dir, 'checkout', '-q', 'seed');

    const result = landMergedPullRequest(mergeOutcome(7), gitIn(dir));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('is on "seed", not on "main"');
    expect(result.log).toBeUndefined();
  });

  it('fails the call when the head branch does not exist', () => {
    const dir = repository();

    const result = landMergedPullRequest(mergeOutcome(7), gitIn(dir));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(HEAD_BRANCH);
  });
});
