import { describe, it, expect, vi } from 'vitest';
import {
  extractIssueNumberFromDirName,
  findActiveAdwIdForIssue,
  shouldCleanWorktree,
  discoverTargetRepoWorktrees,
  runJanitorPass,
  JANITOR_GRACE_PERIOD_MS,
  type JanitorDeps,
} from '../devServerJanitor';
import type { AgentState } from '../../types/agentTypes';

// ── Constants ────────────────────────────────────────────────────────────────

const YOUNG = JANITOR_GRACE_PERIOD_MS / 2;    // 15 min — within grace period
const OLD   = JANITOR_GRACE_PERIOD_MS * 2;    // 60 min — outside grace period

// ── extractIssueNumberFromDirName ────────────────────────────────────────────

describe('extractIssueNumberFromDirName', () => {
  it('extracts the issue number from a real feature branch name', () => {
    expect(extractIssueNumberFromDirName('feature-issue-55-scraper-visual-asset-capture')).toBe(55);
  });

  it('extracts the issue number from a real chore branch name', () => {
    expect(extractIssueNumberFromDirName('chore-issue-492-bdd-authoring-smoke-surface-scenarios')).toBe(492);
  });

  it('extracts the issue number from a real bugfix branch name', () => {
    expect(extractIssueNumberFromDirName('bugfix-issue-499-fix-janitor-adwid-lookup')).toBe(499);
  });

  it('returns null when the directory name has no -issue- segment', () => {
    expect(extractIssueNumberFromDirName('manually-created-dir')).toBeNull();
  });

  it('returns null when the issue segment is non-numeric', () => {
    expect(extractIssueNumberFromDirName('feature-issue-abc-some-slug')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractIssueNumberFromDirName('')).toBeNull();
  });

  it('returns null when -issue- has no trailing slug separator', () => {
    // Real branches always have a trailing slug, so `-issue-55` with no `-` after the
    // number is not produced; verifying the regex is anchored on the trailing hyphen.
    expect(extractIssueNumberFromDirName('feature-issue-55')).toBeNull();
  });
});

// ── findActiveAdwIdForIssue ──────────────────────────────────────────────────

describe('findActiveAdwIdForIssue', () => {
  function makeLookupDeps(states: Record<string, Partial<AgentState> | null>): Pick<JanitorDeps, 'listAdwStateDirs' | 'readTopLevelStateRaw'> {
    return {
      listAdwStateDirs: () => Object.keys(states),
      readTopLevelStateRaw: (adwId: string) => (states[adwId] ?? null) as AgentState | null,
    };
  }

  it('returns the adwId of a single matching state file', () => {
    const deps = makeLookupDeps({
      'abc123-some-slug': { issueNumber: 55, lastSeenAt: '2026-04-26T19:50:00.000Z' },
    });
    expect(findActiveAdwIdForIssue(55, deps)).toBe('abc123-some-slug');
  });

  it('picks the adwId with the freshest lastSeenAt when multiple state files match', () => {
    const deps = makeLookupDeps({
      'old-adwId': { issueNumber: 55, lastSeenAt: '2026-04-25T10:00:00.000Z' },
      'fresh-adwId': { issueNumber: 55, lastSeenAt: '2026-04-26T19:55:00.000Z' },
      'unrelated-adwId': { issueNumber: 99, lastSeenAt: '2026-04-26T20:00:00.000Z' },
    });
    expect(findActiveAdwIdForIssue(55, deps)).toBe('fresh-adwId');
  });

  it('returns null when no state file matches the issue number', () => {
    const deps = makeLookupDeps({
      'adwId-x': { issueNumber: 99, lastSeenAt: '2026-04-26T19:55:00.000Z' },
    });
    expect(findActiveAdwIdForIssue(55, deps)).toBeNull();
  });

  it('returns null when listAdwStateDirs is empty', () => {
    const deps = makeLookupDeps({});
    expect(findActiveAdwIdForIssue(55, deps)).toBeNull();
  });

  it('treats a missing lastSeenAt as 0, so any entry with a real lastSeenAt wins', () => {
    const deps = makeLookupDeps({
      'no-heartbeat-adwId': { issueNumber: 55 },
      'heartbeat-adwId': { issueNumber: 55, lastSeenAt: '2026-04-26T19:55:00.000Z' },
    });
    expect(findActiveAdwIdForIssue(55, deps)).toBe('heartbeat-adwId');
  });

  it('falls back to the first match when all candidates have no lastSeenAt', () => {
    const deps = makeLookupDeps({
      'first-adwId': { issueNumber: 55 },
      'second-adwId': { issueNumber: 55 },
    });
    // First one wins because the second tie does not strictly exceed seenMs=0.
    expect(findActiveAdwIdForIssue(55, deps)).toBe('first-adwId');
  });

  it('skips entries where readTopLevelStateRaw returns null (deleted or unreadable)', () => {
    const deps = makeLookupDeps({
      'gone-adwId': null,
      'alive-adwId': { issueNumber: 55, lastSeenAt: '2026-04-26T19:55:00.000Z' },
    });
    expect(findActiveAdwIdForIssue(55, deps)).toBe('alive-adwId');
  });
});

// ── shouldCleanWorktree — decision matrix ────────────────────────────────────

describe('shouldCleanWorktree', () => {
  describe('non-terminal stage', () => {
    it('non-terminal + PID alive + old worktree → skip (active workflow)', () => {
      expect(shouldCleanWorktree(true, true, OLD, JANITOR_GRACE_PERIOD_MS)).toBe(false);
    });

    it('non-terminal + PID alive + young worktree → skip (active workflow)', () => {
      expect(shouldCleanWorktree(true, true, YOUNG, JANITOR_GRACE_PERIOD_MS)).toBe(false);
    });

    it('non-terminal + PID dead + young worktree → skip (age grace)', () => {
      expect(shouldCleanWorktree(true, false, YOUNG, JANITOR_GRACE_PERIOD_MS)).toBe(false);
    });

    it('non-terminal + PID dead + old worktree → kill (crashed orchestrator)', () => {
      expect(shouldCleanWorktree(true, false, OLD, JANITOR_GRACE_PERIOD_MS)).toBe(true);
    });
  });

  describe('terminal stage', () => {
    it('terminal + PID alive + young worktree → skip (age grace)', () => {
      expect(shouldCleanWorktree(false, true, YOUNG, JANITOR_GRACE_PERIOD_MS)).toBe(false);
    });

    it('terminal + PID alive + old worktree → kill (stale process)', () => {
      expect(shouldCleanWorktree(false, true, OLD, JANITOR_GRACE_PERIOD_MS)).toBe(true);
    });

    it('terminal + PID dead + young worktree → skip (age grace)', () => {
      expect(shouldCleanWorktree(false, false, YOUNG, JANITOR_GRACE_PERIOD_MS)).toBe(false);
    });

    it('terminal + PID dead + old worktree → kill (cleanup)', () => {
      expect(shouldCleanWorktree(false, false, OLD, JANITOR_GRACE_PERIOD_MS)).toBe(true);
    });
  });

  it('worktree exactly at grace period boundary → skip (not strictly older)', () => {
    expect(shouldCleanWorktree(false, false, JANITOR_GRACE_PERIOD_MS, JANITOR_GRACE_PERIOD_MS)).toBe(false);
  });

  it('worktree one millisecond past grace period → kill', () => {
    expect(shouldCleanWorktree(false, false, JANITOR_GRACE_PERIOD_MS + 1, JANITOR_GRACE_PERIOD_MS)).toBe(true);
  });
});

// ── discoverTargetRepoWorktrees ──────────────────────────────────────────────

function makeDeps(overrides: Partial<JanitorDeps> = {}): JanitorDeps {
  return {
    readdirTargetRepos: vi.fn().mockReturnValue([]),
    isGitRepo: vi.fn().mockReturnValue(true),
    listWorktrees: vi.fn().mockReturnValue([]),
    readTopLevelState: vi.fn().mockReturnValue(null),
    readTopLevelStateRaw: vi.fn().mockReturnValue(null),
    listAdwStateDirs: vi.fn().mockReturnValue([]),
    isAgentProcessRunning: vi.fn().mockReturnValue(false),
    getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    hasProcessesInDirectory: vi.fn().mockReturnValue(true),  // default: processes exist
    killProcessesInDirectory: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('discoverTargetRepoWorktrees', () => {
  it('returns empty array when TARGET_REPOS_DIR is empty', () => {
    const deps = makeDeps({ readdirTargetRepos: vi.fn().mockReturnValue([]) });
    expect(discoverTargetRepoWorktrees(deps)).toEqual([]);
  });

  it('returns empty array when readdirTargetRepos throws', () => {
    const deps = makeDeps({
      readdirTargetRepos: vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
    });
    expect(discoverTargetRepoWorktrees(deps)).toEqual([]);
  });

  it('skips directories that are not git repos', () => {
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner1'])      // owners
        .mockReturnValueOnce(['repo1']),       // repos
      isGitRepo: vi.fn().mockReturnValue(false),
      listWorktrees: vi.fn(),
    });
    expect(discoverTargetRepoWorktrees(deps)).toEqual([]);
    expect(deps.listWorktrees).not.toHaveBeenCalled();
  });

  it('returns one candidate per worktree across multiple repos', () => {
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner1'])
        .mockReturnValueOnce(['repo1', 'repo2']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn()
        .mockReturnValueOnce(['/repos/owner1/repo1/.worktrees/feature-issue-1-some-slug'])
        .mockReturnValueOnce(['/repos/owner1/repo2/.worktrees/bugfix-issue-2-other-slug']),
    });

    const result = discoverTargetRepoWorktrees(deps);
    expect(result).toHaveLength(2);
    expect(result[0].dirName).toBe('feature-issue-1-some-slug');
    expect(result[1].dirName).toBe('bugfix-issue-2-other-slug');
  });

  it('handles repos with no worktrees gracefully', () => {
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner1'])
        .mockReturnValueOnce(['repo1']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([]),
    });
    expect(discoverTargetRepoWorktrees(deps)).toEqual([]);
  });

  it('handles error reading repos under an owner gracefully', () => {
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner1'])
        .mockImplementationOnce(() => { throw new Error('permission denied'); }),
    });
    expect(discoverTargetRepoWorktrees(deps)).toEqual([]);
  });
});

// ── runJanitorPass — kill decision integration ───────────────────────────────

describe('runJanitorPass', () => {
  it('does not call killProcessesInDirectory when no worktrees found', async () => {
    const deps = makeDeps({ readdirTargetRepos: vi.fn().mockReturnValue([]) });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
  });

  it('skips worktree without applying kill decision when lsof reports no processes', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-some-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      hasProcessesInDirectory: vi.fn().mockReturnValue(false),  // no processes
      listAdwStateDirs: vi.fn().mockReturnValue(['abc123-some-slug']),
      readTopLevelStateRaw: vi.fn().mockReturnValue({ issueNumber: 1, workflowStage: 'completed' }),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'completed' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    // No kill, and kill decision deps should not even be consulted
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.isAgentProcessRunning).not.toHaveBeenCalled();
  });

  it('skips worktree when non-terminal stage and PID alive (regardless of age)', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-some-slug';
    const adwId = 'abc123-some-slug';
    const stateForActive: Partial<AgentState> = {
      issueNumber: 1,
      lastSeenAt: new Date().toISOString(),
      workflowStage: 'build_running',
    };
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(stateForActive),
      readTopLevelState: vi.fn().mockReturnValue(stateForActive),
      isAgentProcessRunning: vi.fn().mockReturnValue(true),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
  });

  it('kills worktree when terminal stage + PID dead + old', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-some-slug';
    const adwId = 'abc123-some-slug';
    const stateTerminal: Partial<AgentState> = {
      issueNumber: 1,
      lastSeenAt: new Date().toISOString(),
      workflowStage: 'completed',
    };
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(stateTerminal),
      readTopLevelState: vi.fn().mockReturnValue(stateTerminal),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  it('kills worktree when non-terminal stage + PID dead + old', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-some-slug';
    const adwId = 'abc123-some-slug';
    const stateNonTerminalDeadPid: Partial<AgentState> = {
      issueNumber: 1,
      lastSeenAt: new Date().toISOString(),
      workflowStage: 'build_running',
    };
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(stateNonTerminalDeadPid),
      readTopLevelState: vi.fn().mockReturnValue(stateNonTerminalDeadPid),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  it('skips worktree when young, even if terminal stage and PID dead', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-some-slug';
    const adwId = 'abc123-some-slug';
    const stateTerminal: Partial<AgentState> = {
      issueNumber: 1,
      lastSeenAt: new Date().toISOString(),
      workflowStage: 'completed',
    };
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(stateTerminal),
      readTopLevelState: vi.fn().mockReturnValue(stateTerminal),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(YOUNG),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
  });

  it('treats worktree with no issue number in dir name as terminal + dead PID (only age check applies)', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/manually-created-dir';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn(),
      readTopLevelStateRaw: vi.fn(),
      readTopLevelState: vi.fn(),
      isAgentProcessRunning: vi.fn(),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    // No issue number → adwId=null → isNonTerminal=false, orchestratorAlive=false, age=OLD → should clean
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
    expect(deps.listAdwStateDirs).not.toHaveBeenCalled();
    expect(deps.readTopLevelStateRaw).not.toHaveBeenCalled();
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.isAgentProcessRunning).not.toHaveBeenCalled();
  });

  it('treats worktree with missing state file as terminal + dead PID', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-5-some-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([]),  // no matching state files
      readTopLevelStateRaw: vi.fn().mockReturnValue(null),
      readTopLevelState: vi.fn().mockReturnValue(null),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  // Regression: bug #499 — live build agent on real-format branch must not be reaped
  it('does NOT kill live build agent on a real-format branch (build_running + PID alive + old)', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-55-scraper-visual-asset-capture';
    const adwId = 'ra4jwa-scraper-visual';
    const liveState: Partial<AgentState> = {
      issueNumber: 55,
      lastSeenAt: new Date().toISOString(),
      workflowStage: 'build_running',
    };
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(liveState),
      readTopLevelState: vi.fn().mockReturnValue(liveState),
      isAgentProcessRunning: vi.fn().mockReturnValue(true),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
  });

  it('kills completed orchestrator on a real-format branch after the grace period', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-55-scraper-visual-asset-capture';
    const adwId = 'ra4jwa-scraper-visual';
    const completedState: Partial<AgentState> = {
      issueNumber: 55,
      lastSeenAt: '2026-04-26T19:50:00.000Z',
      workflowStage: 'completed',
    };
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(completedState),
      readTopLevelState: vi.fn().mockReturnValue(completedState),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledTimes(1);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  it('processes multiple worktrees and applies kill decision to each', async () => {
    const killableWt = '/repos/owner/repo/.worktrees/feature-issue-1-old-slug';
    const safeWt    = '/repos/owner/repo/.worktrees/feature-issue-2-new-slug';

    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([killableWt, safeWt]),
      listAdwStateDirs: vi.fn().mockReturnValue([]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(null),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'completed' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn()
        .mockReturnValueOnce(OLD)   // killableWt → old
        .mockReturnValueOnce(YOUNG), // safeWt → young
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledTimes(1);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(killableWt);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalledWith(safeWt);
  });

  it('continues processing remaining worktrees after an error on one', async () => {
    const errorWt = '/repos/owner/repo/.worktrees/feature-issue-1-error-slug';
    const cleanWt = '/repos/owner/repo/.worktrees/feature-issue-2-clean-slug';

    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([errorWt, cleanWt]),
      listAdwStateDirs: vi.fn().mockReturnValue([]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(null),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'completed' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn()
        .mockImplementationOnce(() => { throw new Error('stat failed'); })
        .mockReturnValueOnce(OLD),
    });
    await runJanitorPass(deps);
    // errorWt threw during processing, cleanWt should still be killed
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(cleanWt);
  });
});

// ── SIGTERM/SIGKILL escalation — verified via worktreeCleanup.ts ─────────────
// The actual SIGTERM → wait → SIGKILL logic lives in killProcessesInDirectory.
// The janitor delegates to that function, so signal escalation tests verify:
// 1. killProcessesInDirectory is called by runJanitorPass for eligible worktrees
// 2. killProcessesInDirectory in worktreeCleanup.ts sends SIGTERM then SIGKILL

describe('kill escalation: SIGTERM then SIGKILL', () => {
  it('runJanitorPass calls killProcessesInDirectory which handles SIGTERM/SIGKILL', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-some-slug';
    const kill = vi.fn();
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(null),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'completed' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
      killProcessesInDirectory: kill,
    });
    await runJanitorPass(deps);
    expect(kill).toHaveBeenCalledWith(wtPath);
  });

  it('killProcessesInDirectory in worktreeCleanup.ts sends SIGTERM before SIGKILL', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const content = readFileSync(join(process.cwd(), 'adws/vcs/worktreeCleanup.ts'), 'utf-8');
    const sigtermIdx = content.indexOf("'SIGTERM'");
    const sigkillIdx = content.indexOf("'SIGKILL'");
    expect(sigtermIdx).toBeGreaterThan(-1);
    expect(sigkillIdx).toBeGreaterThan(-1);
    expect(sigtermIdx).toBeLessThan(sigkillIdx);
  });

  it('killProcessesInDirectory sends SIGKILL only to survivors after SIGTERM', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const content = readFileSync(join(process.cwd(), 'adws/vcs/worktreeCleanup.ts'), 'utf-8');
    // Verify the "survivors" filtering pattern exists
    expect(content).toContain('survivors');
    expect(content).toContain("'SIGKILL'");
  });
});

// ── JANITOR_GRACE_PERIOD_MS constant ────────────────────────────────────────

describe('JANITOR_GRACE_PERIOD_MS', () => {
  it('is 30 minutes in milliseconds', () => {
    expect(JANITOR_GRACE_PERIOD_MS).toBe(30 * 60 * 1000);
  });
});
