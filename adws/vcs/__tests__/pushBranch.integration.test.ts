/**
 * Real-git integration tests for GitContext.pushBranch() — re-homed from
 * vcs/commitOperations (#662). Proves the three behavioral acceptance criteria
 * end-to-end against a local bare remote (no network).
 *
 * A: append-only push still works
 * B: a rewritten branch (amend) pushes successfully (the core bug fix)
 * C: a genuinely-moved remote causes a distinct thrown error and is not clobbered
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitContext } from '../../gitContext';
import type { GitContextOptions } from '../../gitContext/types';

const BRANCH = 'feature-test-648';

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeTestContext(workdir: string): GitContext {
  const options: GitContextOptions = {
    owner: 'test',
    repo: 'test',
    selfHost: true,
    token: 'dummy-token-for-local-test',
    gitIdentity: {
      authorName: 'ADW Test',
      authorEmail: 'test@adw.test',
      committerName: 'ADW Test',
      committerEmail: 'test@adw.test',
    },
    frameworkRepoRoot: workdir,
    targetReposDir: tmpdir(),
  };
  return new GitContext(options);
}

let bareRemote: string;
let workdir: string;

beforeEach(() => {
  bareRemote = mkdtempSync(join(tmpdir(), 'adw-648-bare-'));
  workdir = mkdtempSync(join(tmpdir(), 'adw-648-work-'));

  git('git init --bare', bareRemote);
  git(`git clone "${bareRemote}" .`, workdir);
  git('git config user.email "test@adw.test"', workdir);
  git('git config user.name "ADW Test"', workdir);
  git(`git checkout -b ${BRANCH}`, workdir);
  git('git commit --allow-empty -m "initial commit"', workdir);
  git(`git push -u origin ${BRANCH}`, workdir);
});

afterEach(() => {
  rmSync(bareRemote, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

describe('GitContext.pushBranch integration (real git)', () => {
  it('Scenario A: append-only commit pushes successfully', () => {
    const ctx = makeTestContext(workdir);
    git('git commit --allow-empty -m "forward commit"', workdir);
    const localTip = git('git rev-parse HEAD', workdir);

    ctx.pushBranch(BRANCH, workdir);

    const remoteTip = git(`git rev-parse ${BRANCH}`, bareRemote);
    expect(remoteTip).toBe(localTip);
  });

  it('Scenario B: rewritten branch (amend) pushes successfully instead of deadlocking', () => {
    const ctx = makeTestContext(workdir);
    git('git commit --allow-empty --amend -m "rewritten commit"', workdir);
    const localTip = git('git rev-parse HEAD', workdir);

    expect(() => ctx.pushBranch(BRANCH, workdir)).not.toThrow();

    const remoteTip = git(`git rev-parse ${BRANCH}`, bareRemote);
    expect(remoteTip).toBe(localTip);
  });

  it('Scenario C: genuine divergence is rejected distinctly and the remote is not clobbered', () => {
    const ctx = makeTestContext(workdir);
    const workdir2 = mkdtempSync(join(tmpdir(), 'adw-648-work2-'));
    try {
      git(`git clone "${bareRemote}" .`, workdir2);
      git('git config user.email "other@adw.test"', workdir2);
      git('git config user.name "Other Writer"', workdir2);
      git(`git checkout ${BRANCH}`, workdir2);
      git('git commit --allow-empty -m "other writer commit"', workdir2);
      git(`git push origin ${BRANCH}`, workdir2);
      const otherWriterTip = git(`git rev-parse ${BRANCH}`, bareRemote);

      git('git commit --allow-empty --amend -m "adw rewritten commit"', workdir);

      let thrown: Error | undefined;
      try {
        ctx.pushBranch(BRANCH, workdir);
      } catch (e) {
        thrown = e as Error;
      }

      expect(thrown).toBeDefined();
      expect(thrown?.message).toMatch(/force-with-lease/);

      const remoteTipAfter = git(`git rev-parse ${BRANCH}`, bareRemote);
      expect(remoteTipAfter).toBe(otherWriterTip);
    } finally {
      rmSync(workdir2, { recursive: true, force: true });
    }
  });
});
