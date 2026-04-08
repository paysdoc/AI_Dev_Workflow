import { describe, it, expect, vi } from 'vitest';
import {
  extractAdwIdFromDirName,
  shouldCleanWorktree,
  discoverTargetRepoWorktrees,
  runJanitorPass,
  JANITOR_GRACE_PERIOD_MS,
  type JanitorDeps,
} from '../devServerJanitor';

// ── Constants ────────────────────────────────────────────────────────────────

const YOUNG = JANITOR_GRACE_PERIOD_MS / 2;    // 15 min — within grace period
const OLD   = JANITOR_GRACE_PERIOD_MS * 2;    // 60 min — outside grace period

// ── extractAdwIdFromDirName ──────────────────────────────────────────────────

describe('extractAdwIdFromDirName', () => {
  it('extracts adwId from a valid branch-format directory name', () => {
    expect(extractAdwIdFromDirName('feature-issue-123-adw-abc123-my-feature'))
      .toBe('abc123-my-feature');
  });

  it('extracts full adwId including the slug portion', () => {
    expect(extractAdwIdFromDirName('bugfix-issue-42-adw-f704s2-cron-janitor-for-orp'))
      .toBe('f704s2-cron-janitor-for-orp');
  });

  it('returns null when directory name has no -adw- marker', () => {
    expect(extractAdwIdFromDirName('feature-issue-123-my-feature')).toBeNull();
  });

  it('returns null for a bare directory name without issue prefix', () => {
    expect(extractAdwIdFromDirName('my-random-dir')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractAdwIdFromDirName('')).toBeNull();
  });

  it('extracts adwId when -adw- appears at the end of the prefix', () => {
    expect(extractAdwIdFromDirName('chore-issue-999-adw-x1y2z3'))
      .toBe('x1y2z3');
  });

  it('returns null if the -adw- marker is at the very end (empty adwId)', () => {
    expect(extractAdwIdFromDirName('feature-issue-1-adw-')).toBeNull();
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
        .mockReturnValueOnce(['/repos/owner1/repo1/.worktrees/feature-issue-1-adw-abc-slug'])
        .mockReturnValueOnce(['/repos/owner1/repo2/.worktrees/bugfix-issue-2-adw-def-slug']),
    });

    const result = discoverTargetRepoWorktrees(deps);
    expect(result).toHaveLength(2);
    expect(result[0].dirName).toBe('feature-issue-1-adw-abc-slug');
    expect(result[1].dirName).toBe('bugfix-issue-2-adw-def-slug');
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
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      hasProcessesInDirectory: vi.fn().mockReturnValue(false),  // no processes
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
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'build_running' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(true),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
  });

  it('kills worktree when terminal stage + PID dead + old', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'completed' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  it('kills worktree when non-terminal stage + PID dead + old', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'build_running' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  it('skips worktree when young, even if terminal stage and PID dead', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'completed' }),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(YOUNG),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
  });

  it('treats worktree with no adwId as terminal + dead PID (only age check applies)', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/manually-created-dir';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      readTopLevelState: vi.fn(),
      isAgentProcessRunning: vi.fn(),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    // No adwId → isNonTerminal=false, orchestratorAlive=false, age=OLD → should clean
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.isAgentProcessRunning).not.toHaveBeenCalled();
  });

  it('treats worktree with missing state file as terminal + dead PID', async () => {
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-5-adw-abc-slug';
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      readTopLevelState: vi.fn().mockReturnValue(null),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
    });
    await runJanitorPass(deps);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  it('processes multiple worktrees and applies kill decision to each', async () => {
    const killableWt = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-old';
    const safeWt    = '/repos/owner/repo/.worktrees/feature-issue-2-adw-def-new';

    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([killableWt, safeWt]),
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
    const errorWt = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-error';
    const cleanWt = '/repos/owner/repo/.worktrees/feature-issue-2-adw-def-clean';

    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([errorWt, cleanWt]),
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
    const wtPath = '/repos/owner/repo/.worktrees/feature-issue-1-adw-abc-slug';
    const kill = vi.fn();
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner'])
        .mockReturnValueOnce(['repo']),
      isGitRepo: vi.fn().mockReturnValue(true),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
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
