import { vi } from 'vitest';
import { JANITOR_GRACE_PERIOD_MS, type JanitorDeps } from '../../devServerJanitor';

export const OLD = JANITOR_GRACE_PERIOD_MS * 2;    // 60 min — outside grace period

export function makeDeps(overrides: Partial<JanitorDeps> = {}): JanitorDeps {
  return {
    readdirTargetRepos: vi.fn().mockReturnValue([]),
    isGitRepo: vi.fn().mockReturnValue(true),
    hasAdwMarker: vi.fn().mockReturnValue(true),
    listWorktrees: vi.fn().mockReturnValue([]),
    readTopLevelState: vi.fn().mockReturnValue(null),
    readTopLevelStateRaw: vi.fn().mockReturnValue(null),
    listAdwStateDirs: vi.fn().mockReturnValue([]),
    isAgentProcessRunning: vi.fn().mockReturnValue(false),
    isIssueLockHeldByLiveProcess: vi.fn().mockReturnValue(false),
    getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    hasProcessesInDirectory: vi.fn().mockReturnValue(true),
    killProcessesInDirectory: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}
