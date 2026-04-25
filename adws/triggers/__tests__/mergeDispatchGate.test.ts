import { describe, it, expect, vi } from 'vitest';
import type { RepoInfo } from '../../github/githubApi';
import { shouldDispatchMerge, type MergeDispatchDeps } from '../mergeDispatchGate';

vi.mock('../../core', () => ({ log: vi.fn() }));

const repoInfo: RepoInfo = { owner: 'acme', repo: 'widgets' };

function makeDeps(overrides: Partial<MergeDispatchDeps> = {}): MergeDispatchDeps {
  return {
    readLock: vi.fn().mockReturnValue(null),
    isLive: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('shouldDispatchMerge', () => {
  it('dispatches when there is no lock record', () => {
    const deps = makeDeps({ readLock: vi.fn().mockReturnValue(null) });
    expect(shouldDispatchMerge(repoInfo, 42, deps)).toBe(true);
  });

  it('dispatches when the lock PID is dead', () => {
    const deps = makeDeps({
      readLock: vi.fn().mockReturnValue({ pid: 12345, pidStartedAt: 'old-start' }),
      isLive: vi.fn().mockReturnValue(false),
    });
    expect(shouldDispatchMerge(repoInfo, 42, deps)).toBe(true);
  });

  it('defers when the lock is held by a live PID', () => {
    const deps = makeDeps({
      readLock: vi.fn().mockReturnValue({ pid: 12345, pidStartedAt: 'live-start' }),
      isLive: vi.fn().mockReturnValue(true),
    });
    expect(shouldDispatchMerge(repoInfo, 42, deps)).toBe(false);
  });

  it('dispatches when pidStartedAt is empty (malformed lock) without calling isLive', () => {
    const isLive = vi.fn();
    const deps = makeDeps({
      readLock: vi.fn().mockReturnValue({ pid: 12345, pidStartedAt: '' }),
      isLive,
    });
    expect(shouldDispatchMerge(repoInfo, 42, deps)).toBe(true);
    expect(isLive).not.toHaveBeenCalled();
  });
});
