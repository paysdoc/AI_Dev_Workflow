import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    loadProjectConfig: vi.fn(),
  };
});

import type { MarkerWrite } from '../promotionSweepDefaults';
import { writeFileSync } from 'fs';
import {
  defaultsFor, makeFakeGitContext, makeFakeBase, makeFakeIssueTracker, NOW, HOST_CHECKOUT, SWEEP_WORKTREE,
} from './fixtures/promotionSweepDefaultsHarness';

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('persistMarkers', () => {
  const writes: readonly MarkerWrite[] = [
    { filePath: 'features/per-issue/feature-611.feature', content: 'tagged 611', message: 'chore: mark feature-611 promotion-suggested' },
    { filePath: 'features/per-issue/feature-612.feature', content: 'declined 612', message: 'chore: mark feature-612 promotion-declined' },
  ];

  it('writes every marker into the sweep worktree and commits each file on its own', async () => {
    const ctx = makeFakeGitContext();

    await defaultsFor(ctx).persistMarkers(writes);

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(writeFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/per-issue/feature-611.feature`, 'tagged 611');
    expect(writeFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/per-issue/feature-612.feature`, 'declined 612');
    expect(ctx.addAndCommitPaths).toHaveBeenCalledTimes(2);
    expect(ctx.addAndCommitPaths).toHaveBeenCalledWith(
      ['features/per-issue/feature-611.feature'], 'chore: mark feature-611 promotion-suggested', SWEEP_WORKTREE,
    );
    expect(ctx.addAndCommitPaths).toHaveBeenCalledWith(
      ['features/per-issue/feature-612.feature'], 'chore: mark feature-612 promotion-declined', SWEEP_WORKTREE,
    );
  });

  it('pushes the sweep branch once, opens one pull request into the default branch, merges it and resolves true', async () => {
    const ctx = makeFakeGitContext();
    const base = makeFakeBase(ctx);

    const landed = await defaultsFor(ctx, { base }).persistMarkers(writes);

    expect(landed).toBe(true);
    expect(ctx.pushBranch).toHaveBeenCalledTimes(1);
    expect(ctx.pushBranch).toHaveBeenCalledWith('chore/promotion-sweep', SWEEP_WORKTREE);
    expect(base.openPr).toHaveBeenCalledTimes(1);
    expect(base.openPr).toHaveBeenCalledWith('chore/promotion-sweep', 'dev');
    expect(base.mergePr).toHaveBeenCalledWith(42);
  });

  it('never pushes the default branch and never touches the host checkout', async () => {
    const ctx = makeFakeGitContext();

    await defaultsFor(ctx).persistMarkers(writes);

    expect(ctx.pushBranch).not.toHaveBeenCalledWith('dev', expect.anything());
    expect(ctx.pushBranch).not.toHaveBeenCalledWith(expect.anything(), HOST_CHECKOUT);
    expect(ctx.addAndCommitPaths).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), HOST_CHECKOUT);
    expect(vi.mocked(writeFileSync).mock.calls.every(([target]) => String(target).startsWith(SWEEP_WORKTREE))).toBe(true);
  });

  it('resolves false when the pull request cannot be merged', async () => {
    const ctx = makeFakeGitContext();
    const base = makeFakeBase(ctx, { mergePr: vi.fn(() => ({ success: false, error: 'merge refused' })) });

    await expect(defaultsFor(ctx, { base }).persistMarkers(writes)).resolves.toBe(false);
  });

  it('resolves false without pushing when no write changes the files', async () => {
    const ctx = makeFakeGitContext({ addAndCommitPaths: vi.fn(() => false) });

    await expect(defaultsFor(ctx).persistMarkers(writes)).resolves.toBe(false);
    expect(ctx.pushBranch).not.toHaveBeenCalled();
  });

  it('still lands the batch when only some of the writes change a file', async () => {
    const ctx = makeFakeGitContext({ addAndCommitPaths: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true) });

    await expect(defaultsFor(ctx).persistMarkers(writes)).resolves.toBe(true);
    expect(ctx.addAndCommitPaths).toHaveBeenCalledTimes(2);
  });

  it('resolves false and writes nothing without a sweep base', async () => {
    const ctx = makeFakeGitContext();

    await expect(defaultsFor(ctx, { withBase: false }).persistMarkers(writes)).resolves.toBe(false);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(ctx.addAndCommitPaths).not.toHaveBeenCalled();
  });
});

describe('fileIssue', () => {
  it('creates the issue and applies every label via the injected issue tracker', () => {
    const issueTracker = makeFakeIssueTracker({ createIssue: vi.fn(() => 501) });
    const ctx = makeFakeGitContext({ owner: 'vestmatic', repo: 'vestmatic-research' });

    defaultsFor(ctx, { issueTracker }).fileIssue({
      title: 'Promote feature-611',
      body: 'Promotes: feature-611',
      labels: ['regression-promotion', 'hitl'],
    });

    expect(issueTracker.createIssue).toHaveBeenCalledWith('Promote feature-611', 'Promotes: feature-611');
    expect(issueTracker.applyLabel).toHaveBeenCalledWith(501, 'regression-promotion');
    expect(issueTracker.applyLabel).toHaveBeenCalledWith(501, 'hitl');
  });

  it('propagates a throw from issueTracker.createIssue (no per-candidate swallow here — the shell catches it)', () => {
    const issueTracker = makeFakeIssueTracker({ createIssue: vi.fn(() => { throw new Error('gh: issue create failed'); }) });

    expect(() => defaultsFor(makeFakeGitContext(), { issueTracker }).fileIssue({ title: 't', body: 'b', labels: [] })).toThrow();
  });
});
