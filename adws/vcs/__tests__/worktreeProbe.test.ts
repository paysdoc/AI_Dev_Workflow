import { describe, it, expect, vi } from 'vitest';
import { probeWorktree, clearOrphanedIndexLock } from '../worktreeProbe';
import type { ProbeDeps } from '../worktreeProbe';
import * as path from 'path';

const GIT_DIR = '/repo/.git/worktrees/feat';
const WT_PATH = '/repo/.worktrees/feat';
const BRANCH = 'feature-issue-99-x';

function makeDeps(overrides: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    existsSync: vi.fn().mockReturnValue(false),
    resolveGitDir: vi.fn().mockReturnValue(GIT_DIR),
    currentBranch: vi.fn().mockReturnValue(BRANCH),
    worktreeRegistration: vi.fn().mockReturnValue('healthy'),
    isProcessLive: vi.fn().mockReturnValue(false),
    rmSync: vi.fn(),
    ...overrides,
  };
}

const INPUT = { worktreePath: WT_PATH, expectedBranch: BRANCH };

// ─── index.lock signal ────────────────────────────────────────────────────────

describe('indexLock signal', () => {
  it('lock absent → absent', () => {
    const deps = makeDeps({ existsSync: vi.fn().mockReturnValue(false) });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.indexLock).toBe('absent');
  });

  it('lock present + dead owner → orphaned', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) => p.endsWith('index.lock')),
      isProcessLive: vi.fn().mockReturnValue(false),
    });
    const probe = probeWorktree({ ...INPUT, recordedPid: 1234, recordedPidStartedAt: 'old-era' }, deps);
    expect(probe.indexLock).toBe('orphaned');
  });

  it('lock present + live owner → live_held', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) => p.endsWith('index.lock')),
      isProcessLive: vi.fn().mockReturnValue(true),
    });
    const probe = probeWorktree({ ...INPUT, recordedPid: 1234, recordedPidStartedAt: 'live-era' }, deps);
    expect(probe.indexLock).toBe('live_held');
  });

  it('lock present + no recordedPid → orphaned (no owner to be live)', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) => p.endsWith('index.lock')),
    });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.indexLock).toBe('orphaned');
  });
});

// ─── liveOwner signal ─────────────────────────────────────────────────────────

describe('liveOwner signal', () => {
  it('pid + startedAt + isProcessLive → true', () => {
    const deps = makeDeps({ isProcessLive: vi.fn().mockReturnValue(true) });
    const probe = probeWorktree({ ...INPUT, recordedPid: 999, recordedPidStartedAt: 'era' }, deps);
    expect(probe.liveOwner).toBe(true);
  });

  it('pid + startedAt + !isProcessLive → false', () => {
    const deps = makeDeps({ isProcessLive: vi.fn().mockReturnValue(false) });
    const probe = probeWorktree({ ...INPUT, recordedPid: 999, recordedPidStartedAt: 'era' }, deps);
    expect(probe.liveOwner).toBe(false);
  });

  it('missing recordedPid → false', () => {
    const deps = makeDeps({ isProcessLive: vi.fn().mockReturnValue(true) });
    const probe = probeWorktree({ ...INPUT, recordedPidStartedAt: 'era' }, deps);
    expect(probe.liveOwner).toBe(false);
    expect(deps.isProcessLive).not.toHaveBeenCalled();
  });

  it('missing recordedPidStartedAt → false', () => {
    const deps = makeDeps({ isProcessLive: vi.fn().mockReturnValue(true) });
    const probe = probeWorktree({ ...INPUT, recordedPid: 999 }, deps);
    expect(probe.liveOwner).toBe(false);
    expect(deps.isProcessLive).not.toHaveBeenCalled();
  });
});

// ─── interruptedOp signal ─────────────────────────────────────────────────────

describe('interruptedOp signal', () => {
  it('rebase-merge dir present → rebase', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) => p.endsWith('rebase-merge')),
    });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.interruptedOp).toBe('rebase');
  });

  it('rebase-apply dir present → rebase', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) => p.endsWith('rebase-apply')),
    });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.interruptedOp).toBe('rebase');
  });

  it('MERGE_HEAD present → merge', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) => p.endsWith('MERGE_HEAD')),
    });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.interruptedOp).toBe('merge');
  });

  it('CHERRY_PICK_HEAD present → cherry_pick', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) => p.endsWith('CHERRY_PICK_HEAD')),
    });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.interruptedOp).toBe('cherry_pick');
  });

  it('none present → none', () => {
    const probe = probeWorktree(INPUT, makeDeps());
    expect(probe.interruptedOp).toBe('none');
  });

  it('rebase-merge beats MERGE_HEAD (rebase checked first)', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) =>
        p.endsWith('rebase-merge') || p.endsWith('MERGE_HEAD'),
      ),
    });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.interruptedOp).toBe('rebase');
  });

  it('MERGE_HEAD beats CHERRY_PICK_HEAD', () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) =>
        p.endsWith('MERGE_HEAD') || p.endsWith('CHERRY_PICK_HEAD'),
      ),
    });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.interruptedOp).toBe('merge');
  });
});

// ─── headOnExpectedBranch signal ─────────────────────────────────────────────

describe('headOnExpectedBranch signal', () => {
  it('currentBranch === expectedBranch → true', () => {
    const deps = makeDeps({ currentBranch: vi.fn().mockReturnValue(BRANCH) });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.headOnExpectedBranch).toBe(true);
  });

  it('currentBranch !== expectedBranch → false', () => {
    const deps = makeDeps({ currentBranch: vi.fn().mockReturnValue('other-branch') });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.headOnExpectedBranch).toBe(false);
  });

  it('currentBranch null → false (detached HEAD / failure)', () => {
    const deps = makeDeps({ currentBranch: vi.fn().mockReturnValue(null) });
    const probe = probeWorktree(INPUT, deps);
    expect(probe.headOnExpectedBranch).toBe(false);
  });
});

// ─── resolveGitDir null → missing + no throw ─────────────────────────────────

describe('resolveGitDir null', () => {
  it('returns registration:missing and does not throw', () => {
    const deps = makeDeps({ resolveGitDir: vi.fn().mockReturnValue(null) });
    let probe: ReturnType<typeof probeWorktree> | null = null;
    expect(() => { probe = probeWorktree(INPUT, deps); }).not.toThrow();
    expect(probe!.registration).toBe('missing');
  });
});

// ─── clearOrphanedIndexLock ───────────────────────────────────────────────────

describe('clearOrphanedIndexLock', () => {
  it('removes the lock when present', () => {
    const rmSync = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(true),
      rmSync,
    });
    clearOrphanedIndexLock(WT_PATH, deps);
    expect(rmSync).toHaveBeenCalledWith(
      path.join(GIT_DIR, 'index.lock'),
      { force: true },
    );
  });

  it('does not call rmSync when lock is absent', () => {
    const rmSync = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      rmSync,
    });
    clearOrphanedIndexLock(WT_PATH, deps);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('does not throw when resolveGitDir returns null', () => {
    const deps = makeDeps({ resolveGitDir: vi.fn().mockReturnValue(null) });
    expect(() => clearOrphanedIndexLock(WT_PATH, deps)).not.toThrow();
  });
});
