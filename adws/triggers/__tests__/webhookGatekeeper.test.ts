/**
 * Tests for the adw:upgrade short-circuit in classifyAndSpawnWorkflow (Bug C′).
 *
 * The #UPG tracking issue carries the adw:upgrade label. It must be routed directly to
 * adwUpgrade.tsx and must NEVER reach evaluateCandidate / the normal classifier — otherwise
 * the classifier reads its title, mislabels it as a chore, and re-enters the upgrade gate on
 * the issue that represents the upgrade itself (loop/crash/runaway).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above the module body, so any mock fns they reference must
// be created via vi.hoisted (also hoisted) rather than as plain top-level consts.
const { spawnMock, issueHasLabelMock, evaluateCandidateMock, releaseIssueSpawnLockMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ unref: () => {} })),
  issueHasLabelMock: vi.fn(),
  evaluateCandidateMock: vi.fn(),
  releaseIssueSpawnLockMock: vi.fn(),
}));

vi.mock('child_process', () => ({ spawn: spawnMock }));
vi.mock('../../github/gitContextFactory', () => ({ gitContextForRepo: vi.fn() }));
vi.mock('../issueDependencies', () => ({ parseDependencies: vi.fn() }));
vi.mock('./issueEligibility', () => ({ checkIssueEligibility: vi.fn() }));
vi.mock('../../github/issueApi', () => ({ issueHasLabel: issueHasLabelMock, closeIssue: vi.fn() }));
vi.mock('../../github/labelManager', () => ({
  ADW_UPGRADE_LABEL: 'adw:upgrade',
  applyLabel: vi.fn(),
  issueTypeToAdwLabel: vi.fn(),
}));
vi.mock('../../github', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'acme', repo: 'target' })),
  isAdwRunningForIssue: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('../takeoverHandler', () => ({ evaluateCandidate: evaluateCandidateMock }));
vi.mock('../spawnGate', () => ({ releaseIssueSpawnLock: releaseIssueSpawnLockMock }));
vi.mock('../../core/authGate', () => ({ readAuthGate: vi.fn(() => null) }));
vi.mock('../../core', () => ({
  log: vi.fn(),
  generateAdwId: vi.fn(() => 'gen-adw-id'),
  REPO_ROOT: '/repo',
  LOGS_DIR: '/logs',
}));
vi.mock('../../core/issueClassifier', () => ({
  classifyIssueForTrigger: vi.fn(() => Promise.resolve({ issueType: '/chore', success: true, adwId: undefined })),
  getWorkflowScript: vi.fn(() => 'adws/adwChore.tsx'),
}));
vi.mock('../../core/agentState', () => ({
  AgentStateManager: { readTopLevelState: vi.fn(() => null) },
}));

import { classifyAndSpawnWorkflow, handleIssueClosedDependencyUnblock, closeAbandonedDependents } from '../webhookGatekeeper';
import { gitContextForRepo } from '../../github/gitContextFactory';
import { parseDependencies } from '../issueDependencies';

const REPO_INFO = { owner: 'acme', repo: 'target' };
const TARGET_ARGS = ['--target-repo', 'acme/target'];

function spawnedScripts(): string[] {
  return (spawnMock.mock.calls as unknown as unknown[][]).flatMap((call) => (call[1] as string[]) ?? []);
}

describe('classifyAndSpawnWorkflow — adw:upgrade short-circuit (Bug C′)', () => {
  beforeEach(() => {
    spawnMock.mockClear();
    evaluateCandidateMock.mockClear();
    releaseIssueSpawnLockMock.mockClear();
    issueHasLabelMock.mockReset();
  });

  it('routes an adw:upgrade issue to adwUpgrade.tsx and never calls evaluateCandidate', async () => {
    issueHasLabelMock.mockReturnValue(true);

    await classifyAndSpawnWorkflow(132, REPO_INFO, TARGET_ARGS);

    expect(issueHasLabelMock).toHaveBeenCalledWith(132, 'adw:upgrade', REPO_INFO);
    expect(spawnedScripts().some((a) => a.endsWith('adws/adwUpgrade.tsx'))).toBe(true);
    expect(spawnedScripts()).toContain('132');
    expect(evaluateCandidateMock).not.toHaveBeenCalled();
    expect(releaseIssueSpawnLockMock).toHaveBeenCalledWith(REPO_INFO, 132);
  });

  it('does NOT spawn a normal workflow script for an adw:upgrade issue', async () => {
    issueHasLabelMock.mockReturnValue(true);

    await classifyAndSpawnWorkflow(132, REPO_INFO, TARGET_ARGS);

    expect(spawnedScripts().some((a) => a.endsWith('adws/adwChore.tsx'))).toBe(false);
    expect(spawnedScripts().some((a) => a.endsWith('adws/adwSdlc.tsx'))).toBe(false);
  });

  it('falls through to evaluateCandidate for a non-upgrade issue', async () => {
    issueHasLabelMock.mockReturnValue(false);
    evaluateCandidateMock.mockReturnValue({ kind: 'skip_terminal', terminalStage: 'completed' });

    await classifyAndSpawnWorkflow(200, REPO_INFO, TARGET_ARGS);

    expect(evaluateCandidateMock).toHaveBeenCalledTimes(1);
    expect(spawnedScripts().some((a) => a.endsWith('adws/adwUpgrade.tsx'))).toBe(false);
  });
});

// ── handleIssueClosedDependencyUnblock — routes through gitContextForRepo ────

describe('handleIssueClosedDependencyUnblock — listOpenIssues routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseDependencies).mockReturnValue([]);
  });

  it('uses the passed gitContext when provided (prefers it over factory)', async () => {
    const issues = [{ number: 10, body: 'Blocked by #5' }];
    const mockCtx = { listOpenIssues: vi.fn(() => JSON.stringify(issues)) };
    vi.mocked(parseDependencies).mockReturnValue([5]);

    await handleIssueClosedDependencyUnblock(5, REPO_INFO, [], mockCtx as never);

    expect(mockCtx.listOpenIssues).toHaveBeenCalledWith({ fields: ['number', 'body'], limit: 100 });
    expect(gitContextForRepo).not.toHaveBeenCalled();
  });

  it('falls back to gitContextForRepo when no gitContext is passed', async () => {
    const issues: unknown[] = [];
    const mockCtx = { listOpenIssues: vi.fn(() => JSON.stringify(issues)) };
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    await handleIssueClosedDependencyUnblock(5, REPO_INFO, []);

    expect(gitContextForRepo).toHaveBeenCalledWith(REPO_INFO);
    expect(mockCtx.listOpenIssues).toHaveBeenCalledWith({ fields: ['number', 'body'], limit: 100 });
  });

  it('does not throw on listOpenIssues error', async () => {
    vi.mocked(gitContextForRepo).mockReturnValue({ listOpenIssues: vi.fn(() => { throw new Error('gh failed'); }) } as never);

    await expect(handleIssueClosedDependencyUnblock(5, REPO_INFO, [])).resolves.not.toThrow();
  });
});

describe('closeAbandonedDependents — listOpenIssues routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseDependencies).mockReturnValue([]);
  });

  it('calls listOpenIssues with number+body fields via gitContextForRepo', async () => {
    const issues: unknown[] = [];
    const mockCtx = { listOpenIssues: vi.fn(() => JSON.stringify(issues)) };
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    await closeAbandonedDependents(7, REPO_INFO);

    expect(gitContextForRepo).toHaveBeenCalledWith(REPO_INFO);
    expect(mockCtx.listOpenIssues).toHaveBeenCalledWith({ fields: ['number', 'body'], limit: 100 });
  });

  it('does not throw on listOpenIssues error', async () => {
    vi.mocked(gitContextForRepo).mockReturnValue({ listOpenIssues: vi.fn(() => { throw new Error('gh failed'); }) } as never);

    await expect(closeAbandonedDependents(7, REPO_INFO)).resolves.not.toThrow();
  });
});
