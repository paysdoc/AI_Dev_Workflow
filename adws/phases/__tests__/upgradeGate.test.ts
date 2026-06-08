import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldTriggerUpgrade,
  addDependencyToBody,
  runUpgradeGate,
  type UpgradeGateDeps,
  type UpgradeGateParams,
} from '../upgradeGate';
import { BoardStatus } from '../../providers/types';
import type { RepoInfo } from '../../github/githubApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_INFO: RepoInfo = { owner: 'acme', repo: 'myrepo' };
const CURRENT_HASH = 'deadbeef1234';
const STORED_HASH = 'oldcafe5678';
const BRANCH = `adw-upgrade-${CURRENT_HASH}`;
const UPG_NUMBER = 99;

function makeParams(overrides: Partial<UpgradeGateParams> = {}): UpgradeGateParams {
  return {
    issueNumber: 42,
    issueBody: 'Some issue body',
    worktreePath: '/tmp/worktree',
    frameworkRepoRoot: '/tmp/framework',
    repoInfo: REPO_INFO,
    targetRepoArgs: ['--target-repo', 'acme/myrepo'],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<UpgradeGateDeps> = {}): UpgradeGateDeps {
  return {
    computeFrameworkHash: vi.fn().mockReturnValue(CURRENT_HASH),
    readAdwVersion: vi.fn().mockReturnValue(CURRENT_HASH),
    claimUpgrade: vi.fn().mockResolvedValue({ won: true, branch: BRANCH }),
    createIssue: vi.fn().mockReturnValue(UPG_NUMBER),
    applyLabel: vi.fn(),
    updateIssueBody: vi.fn(),
    findOpenUpgradeIssue: vi.fn().mockReturnValue(null),
    spawnUpgradeOrchestrator: vi.fn(),
    moveToStatus: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...overrides,
  };
}

// ── shouldTriggerUpgrade — pure ───────────────────────────────────────────────

describe('shouldTriggerUpgrade', () => {
  it('returns true when storedVersion is null (first bootstrap)', () => {
    expect(shouldTriggerUpgrade(CURRENT_HASH, null)).toBe(true);
  });

  it('returns false when hashes are equal', () => {
    expect(shouldTriggerUpgrade(CURRENT_HASH, CURRENT_HASH)).toBe(false);
  });

  it('returns true when hashes differ', () => {
    expect(shouldTriggerUpgrade(CURRENT_HASH, STORED_HASH)).toBe(true);
  });
});

// ── addDependencyToBody — pure ────────────────────────────────────────────────

describe('addDependencyToBody', () => {
  it('appends a new ## Blocked by section when body has none', () => {
    const result = addDependencyToBody('Some body text', 99);
    expect(result).toContain('## Blocked by');
    expect(result).toContain('- #99');
  });

  it('inserts bullet into existing ## Blocked by section without adding second heading', () => {
    const body = 'Intro\n\n## Blocked by\n\n- #10\n';
    const result = addDependencyToBody(body, 99);
    const headingCount = (result.match(/^## Blocked by/im) ?? []).length;
    expect(headingCount).toBe(1);
    expect(result).toContain('- #99');
    expect(result).toContain('- #10');
  });

  it('is idempotent when the reference already exists', () => {
    const body = 'Intro\n\n## Blocked by\n\n- #99\n';
    const result = addDependencyToBody(body, 99);
    expect(result).toBe(body);
  });

  it('recognises ## Dependencies heading', () => {
    const body = 'Text\n\n## Dependencies\n\n- #5\n';
    const result = addDependencyToBody(body, 99);
    expect(result).toContain('- #99');
    expect((result.match(/^## /im) ?? []).length).toBe(1);
  });

  it('recognises ## Depends on heading', () => {
    const body = 'Text\n\n## Depends on\n\n- #5\n';
    const result = addDependencyToBody(body, 99);
    expect(result).toContain('- #99');
    expect((result.match(/^## /im) ?? []).length).toBe(1);
  });
});

// ── runUpgradeGate — orchestration ────────────────────────────────────────────

describe('runUpgradeGate — proceed (hash match)', () => {
  it('returns proceed and does not call claimUpgrade', async () => {
    const deps = makeDeps({ readAdwVersion: vi.fn().mockReturnValue(CURRENT_HASH) });
    const outcome = await runUpgradeGate(makeParams(), deps);
    expect(outcome.action).toBe('proceed');
    expect(deps.claimUpgrade).not.toHaveBeenCalled();
  });
});

describe('runUpgradeGate — winner path', () => {
  let deps: UpgradeGateDeps;

  beforeEach(() => {
    deps = makeDeps({
      readAdwVersion: vi.fn().mockReturnValue(null),
      claimUpgrade: vi.fn().mockResolvedValue({ won: true, branch: BRANCH }),
    });
  });

  it('calls createIssue', async () => {
    await runUpgradeGate(makeParams(), deps);
    expect(deps.createIssue).toHaveBeenCalledOnce();
  });

  it('applies adw:upgrade label to the new issue', async () => {
    await runUpgradeGate(makeParams(), deps);
    expect(deps.applyLabel).toHaveBeenCalledWith(UPG_NUMBER, 'adw:upgrade', REPO_INFO);
  });

  it('spawns the upgrade orchestrator', async () => {
    const targetRepoArgs = ['--target-repo', 'acme/myrepo'];
    await runUpgradeGate(makeParams({ targetRepoArgs }), deps);
    expect(deps.spawnUpgradeOrchestrator).toHaveBeenCalledWith(UPG_NUMBER, targetRepoArgs);
  });

  it('calls updateIssueBody with a body containing the UPG reference', async () => {
    await runUpgradeGate(makeParams({ issueBody: 'Original body' }), deps);
    expect(deps.updateIssueBody).toHaveBeenCalledOnce();
    const [, updatedBody] = vi.mocked(deps.updateIssueBody).mock.calls[0];
    expect(updatedBody).toContain(`#${UPG_NUMBER}`);
  });

  it('calls moveToStatus with Todo', async () => {
    await runUpgradeGate(makeParams(), deps);
    expect(deps.moveToStatus).toHaveBeenCalledWith(42, BoardStatus.Todo);
  });

  it('returns parked winner outcome', async () => {
    const outcome = await runUpgradeGate(makeParams(), deps);
    expect(outcome).toMatchObject({ action: 'parked', role: 'winner', upgradeIssueNumber: UPG_NUMBER });
  });
});

describe('runUpgradeGate — loser path (issue resolvable via claim)', () => {
  let deps: UpgradeGateDeps;

  beforeEach(() => {
    deps = makeDeps({
      readAdwVersion: vi.fn().mockReturnValue(STORED_HASH),
      claimUpgrade: vi.fn().mockResolvedValue({
        won: false,
        existingIssueNumber: UPG_NUMBER,
        existingBranch: BRANCH,
      }),
    });
  });

  it('does not call createIssue or spawnUpgradeOrchestrator', async () => {
    await runUpgradeGate(makeParams(), deps);
    expect(deps.createIssue).not.toHaveBeenCalled();
    expect(deps.spawnUpgradeOrchestrator).not.toHaveBeenCalled();
  });

  it('registers dependency on existing UPG issue', async () => {
    await runUpgradeGate(makeParams({ issueBody: 'Original' }), deps);
    expect(deps.updateIssueBody).toHaveBeenCalledOnce();
    const [, body] = vi.mocked(deps.updateIssueBody).mock.calls[0];
    expect(body).toContain(`#${UPG_NUMBER}`);
  });

  it('calls moveToStatus with Todo', async () => {
    await runUpgradeGate(makeParams(), deps);
    expect(deps.moveToStatus).toHaveBeenCalledWith(42, BoardStatus.Todo);
  });

  it('returns parked loser outcome with correct upgradeIssueNumber', async () => {
    const outcome = await runUpgradeGate(makeParams(), deps);
    expect(outcome).toMatchObject({ action: 'parked', role: 'loser', upgradeIssueNumber: UPG_NUMBER });
  });
});

describe('runUpgradeGate — loser path (fallback to findOpenUpgradeIssue)', () => {
  it('registers dependency on fallback issue when existingIssueNumber is null', async () => {
    const FALLBACK = 77;
    const deps = makeDeps({
      readAdwVersion: vi.fn().mockReturnValue(STORED_HASH),
      claimUpgrade: vi.fn().mockResolvedValue({
        won: false,
        existingIssueNumber: null,
        existingBranch: BRANCH,
      }),
      findOpenUpgradeIssue: vi.fn().mockReturnValue(FALLBACK),
    });
    const outcome = await runUpgradeGate(makeParams({ issueBody: 'Body' }), deps);
    expect(deps.updateIssueBody).toHaveBeenCalledOnce();
    const [, body] = vi.mocked(deps.updateIssueBody).mock.calls[0];
    expect(body).toContain(`#${FALLBACK}`);
    expect(outcome).toMatchObject({ action: 'parked', role: 'loser', upgradeIssueNumber: FALLBACK });
  });
});

describe('runUpgradeGate — loser path (unresolved race: no issue found)', () => {
  it('parks without body edit when no UPG issue is found', async () => {
    const deps = makeDeps({
      readAdwVersion: vi.fn().mockReturnValue(STORED_HASH),
      claimUpgrade: vi.fn().mockResolvedValue({
        won: false,
        existingIssueNumber: null,
        existingBranch: BRANCH,
      }),
      findOpenUpgradeIssue: vi.fn().mockReturnValue(null),
    });
    const outcome = await runUpgradeGate(makeParams(), deps);
    expect(deps.updateIssueBody).not.toHaveBeenCalled();
    expect(deps.moveToStatus).toHaveBeenCalledWith(42, BoardStatus.Todo);
    expect(outcome).toMatchObject({ action: 'parked', role: 'loser', upgradeIssueNumber: null });
  });
});
