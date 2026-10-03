import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../perIssueSweepPersist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../perIssueSweepPersist')>();
  return { ...actual, prepareSweepBase: vi.fn(), cleanupSweepBase: vi.fn() };
});

import { runPromotionSweep } from '../promotionSweep';
import { PROMOTION_SWEEP_SPEC } from '../promotionSweepDefaults';
import { prepareSweepBase, cleanupSweepBase } from '../perIssueSweepPersist';
import type { SweepBase } from '../perIssueSweepPersist';
import { harness, PATH_612, QUALIFYING_SCORE_6 } from './fixtures/promotionSweepHarness';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runPromotionSweep — sweep worktree lifecycle', () => {
  const fakeBase = (): SweepBase => ({
    ctx: { lsFiles: vi.fn(() => []) },
    worktreePath: '/sweep-worktree',
  }) as unknown as SweepBase;

  it('never creates a sweep worktree for a fully injected caller', async () => {
    await runPromotionSweep(harness({ [PATH_612]: QUALIFYING_SCORE_6 }).deps);

    expect(prepareSweepBase).not.toHaveBeenCalled();
    expect(cleanupSweepBase).not.toHaveBeenCalled();
  });

  it('creates the worktree once, on the promotion sweep branch, when a default needs it, and tears it down', async () => {
    const base = fakeBase();
    vi.mocked(prepareSweepBase).mockReturnValue(base);
    const h = harness({}, { listPerIssueFeatures: undefined, scenariosConfig: undefined });

    await runPromotionSweep(h.deps);

    expect(prepareSweepBase).toHaveBeenCalledTimes(1);
    expect(prepareSweepBase).toHaveBeenCalledWith(h.deps.boundary, PROMOTION_SWEEP_SPEC);
    expect(cleanupSweepBase).toHaveBeenCalledTimes(1);
    expect(cleanupSweepBase).toHaveBeenCalledWith(base);
  });

  it('tears the worktree down when a collaborator throws', async () => {
    const base = fakeBase();
    vi.mocked(prepareSweepBase).mockReturnValue(base);
    const h = harness({}, {
      scenariosConfig: undefined,
      loadStats: () => { throw new Error('boom'); },
    });

    await expect(runPromotionSweep(h.deps)).rejects.toThrow('boom');

    expect(cleanupSweepBase).toHaveBeenCalledWith(base);
  });

  it('degrades to an empty sweep when the worktree cannot be prepared', async () => {
    vi.mocked(prepareSweepBase).mockReturnValue(null);
    const h = harness({}, { listPerIssueFeatures: undefined, scenariosConfig: undefined });

    const report = await runPromotionSweep(h.deps);

    expect(report).toMatchObject({ originated: [], redriven: [], declined: [], withdrawn: [], left: [] });
    expect(cleanupSweepBase).not.toHaveBeenCalled();
  });
});
