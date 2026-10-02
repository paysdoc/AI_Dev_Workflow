import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { persistRemovalViaPr, persistCommitViaPr, SWEEP_COMMIT_MESSAGE, type SweepBase } from '../perIssueSweepPersist';
import { makeFakeBase } from './fixtures/perIssueSweepPersistHarness';

describe('persistRemovalViaPr', () => {
  it('no-op when paths is empty — no guard check, no commit', async () => {
    const base = makeFakeBase();

    await persistRemovalViaPr([], base);

    expect(base.findOpenSweepPr).not.toHaveBeenCalled();
    expect(base.ctx.removeAndCommitPaths).not.toHaveBeenCalled();
  });

  it('skips when an open sweep PR already exists — no commit, no push, no new PR', async () => {
    const base = makeFakeBase({ findOpenSweepPr: vi.fn(() => 7) });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.ctx.removeAndCommitPaths).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('#7'), 'info');
  });

  it('no-op when removeAndCommitPaths reports nothing staged — no push, no PR', async () => {
    const base = makeFakeBase({
      ctx: { removeAndCommitPaths: vi.fn(() => false), pushBranch: vi.fn() } as unknown as SweepBase['ctx'],
    });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.ctx.pushBranch).not.toHaveBeenCalled();
    expect(base.openPr).not.toHaveBeenCalled();
  });

  it('commits scoped to exactly the given paths with the stable sweep commit message', async () => {
    const base = makeFakeBase();
    const paths = ['features/per-issue/feature-1.feature', 'features/per-issue/step_definitions/feature-1.steps.ts'];

    await persistRemovalViaPr(paths, base);

    expect(base.ctx.removeAndCommitPaths).toHaveBeenCalledWith(paths, SWEEP_COMMIT_MESSAGE, base.worktreePath);
  });

  it('a push failure is logged at error and does not open a PR (never throws)', async () => {
    const base = makeFakeBase({
      ctx: {
        removeAndCommitPaths: vi.fn(() => true),
        pushBranch: vi.fn(() => { throw new Error('stale info'); }),
      } as unknown as SweepBase['ctx'],
    });

    await expect(persistRemovalViaPr(['features/per-issue/feature-1.feature'], base)).resolves.toBeUndefined();

    expect(base.openPr).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('stale info'), 'error');
  });

  it('a zero/falsy PR number is logged at error and does not attempt a merge', async () => {
    const base = makeFakeBase({ openPr: vi.fn(() => 0) });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.mergePr).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('PR number'), 'error');
  });

  it('a merge failure is logged at error, leaving the PR open (retried next sweep)', async () => {
    const base = makeFakeBase({ mergePr: vi.fn(() => ({ success: false, error: 'required check pending' })) });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('required check pending'), 'error');
  });

  it('happy path: commits, pushes the sweep branch, opens a PR, and merges it', async () => {
    const base = makeFakeBase();
    const paths = ['features/per-issue/feature-1.feature'];

    await persistRemovalViaPr(paths, base);

    expect(base.ctx.pushBranch).toHaveBeenCalledWith(base.sweepBranch, base.worktreePath);
    expect(base.openPr).toHaveBeenCalledWith(base.sweepBranch, base.defaultBranch);
    expect(base.mergePr).toHaveBeenCalledWith(42);
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('#42'), 'success');
  });
});

describe('persistCommitViaPr', () => {
  it('skips when an open sweep PR already exists — commit is never invoked, nothing landed', async () => {
    const base = makeFakeBase({ findOpenSweepPr: vi.fn(() => 7) });
    const commit = vi.fn(() => true);

    const landed = await persistCommitViaPr(commit, base);

    expect(landed).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('#7'), 'info');
  });

  it('no-op when commit(base) returns false — no push, no PR, nothing landed', async () => {
    const base = makeFakeBase();
    const commit = vi.fn(() => false);

    const landed = await persistCommitViaPr(commit, base);

    expect(landed).toBe(false);
    expect(base.ctx.pushBranch).not.toHaveBeenCalled();
    expect(base.openPr).not.toHaveBeenCalled();
  });

  it('happy path: invokes commit(base), pushes, opens a PR, merges it, and reports it landed', async () => {
    const base = makeFakeBase();
    const commit = vi.fn(() => true);

    const landed = await persistCommitViaPr(commit, base);

    expect(landed).toBe(true);
    expect(commit).toHaveBeenCalledWith(base);
    expect(base.ctx.pushBranch).toHaveBeenCalledWith(base.sweepBranch, base.worktreePath);
    expect(base.mergePr).toHaveBeenCalledWith(42);
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('#42'), 'success');
  });

  it('prefixes log lines with the given label', async () => {
    const base = makeFakeBase({ findOpenSweepPr: vi.fn(() => 9) });

    await persistCommitViaPr(() => true, base, 'docsIndexSweep');

    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('docsIndexSweep:'), 'info');
  });

  it('a merge failure is logged at error, leaving the PR open and reporting nothing landed', async () => {
    const base = makeFakeBase({ mergePr: vi.fn(() => ({ success: false, error: 'required check pending' })) });

    const landed = await persistCommitViaPr(() => true, base);

    expect(landed).toBe(false);
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('required check pending'), 'error');
  });

  it('a falsy PR number reports nothing landed and never attempts a merge', async () => {
    const base = makeFakeBase({ openPr: vi.fn(() => 0) });

    const landed = await persistCommitViaPr(() => true, base);

    expect(landed).toBe(false);
    expect(base.mergePr).not.toHaveBeenCalled();
  });

  it('a push failure reports nothing landed and never throws', async () => {
    const base = makeFakeBase({
      ctx: { pushBranch: vi.fn(() => { throw new Error('stale info'); }) } as unknown as SweepBase['ctx'],
    });

    await expect(persistCommitViaPr(() => true, base)).resolves.toBe(false);

    expect(base.openPr).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('stale info'), 'error');
  });
});
