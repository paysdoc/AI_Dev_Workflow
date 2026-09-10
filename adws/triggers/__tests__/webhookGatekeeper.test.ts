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
const { spawnMock, evaluateCandidateMock, releaseIssueSpawnLockMock, isAdwRunningForIssueMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ unref: () => {} })),
  evaluateCandidateMock: vi.fn(),
  releaseIssueSpawnLockMock: vi.fn(),
  isAdwRunningForIssueMock: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('child_process', () => ({ spawn: spawnMock }));
vi.mock('../issueDependencies', () => ({ parseDependencies: vi.fn() }));
vi.mock('../../forge/workflowCommentsBase', () => ({ isAdwRunningForIssue: isAdwRunningForIssueMock }));
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

import { classifyAndSpawnWorkflow, closeAbandonedDependents } from '../webhookGatekeeper';
import { parseDependencies } from '../issueDependencies';
import { Platform } from '../../providers/types';
import type { LaunchBoundary } from '../../core';
import type { IssueTracker } from '../../providers/types';

const REPO_INFO = { owner: 'acme', repo: 'target', platform: Platform.GitHub };
const TARGET_ARGS = ['--target-repo', 'acme/target'];

function spawnedScripts(): string[] {
  return (spawnMock.mock.calls as unknown as unknown[][]).flatMap((call) => (call[1] as string[]) ?? []);
}

function makeBoundary(overrides: Partial<Pick<IssueTracker, 'fetchLabels' | 'listIssues' | 'closeIssue' | 'applyLabel' | 'fetchIssue'>> = {}): LaunchBoundary {
  const issueTracker = {
    fetchLabels: vi.fn(() => [] as readonly string[]),
    listIssues: vi.fn(() => []),
    closeIssue: vi.fn(async () => true),
    applyLabel: vi.fn(),
    fetchIssue: vi.fn(),
    ...overrides,
  } as unknown as IssueTracker;
  return { repoId: REPO_INFO, providers: { issueTracker } } as unknown as LaunchBoundary;
}

describe('classifyAndSpawnWorkflow — adw:upgrade short-circuit (Bug C′)', () => {
  beforeEach(() => {
    spawnMock.mockClear();
    evaluateCandidateMock.mockClear();
    releaseIssueSpawnLockMock.mockClear();
  });

  it('routes an adw:upgrade issue to adwUpgrade.tsx and never calls evaluateCandidate', async () => {
    const boundary = makeBoundary({ fetchLabels: vi.fn(() => ['adw:upgrade']) });

    await classifyAndSpawnWorkflow(132, boundary, TARGET_ARGS);

    expect(boundary.providers.issueTracker.fetchLabels).toHaveBeenCalledWith(132);
    expect(spawnedScripts().some((a) => a.endsWith('adws/adwUpgrade.tsx'))).toBe(true);
    expect(spawnedScripts()).toContain('132');
    expect(evaluateCandidateMock).not.toHaveBeenCalled();
    expect(releaseIssueSpawnLockMock).toHaveBeenCalledWith(REPO_INFO, 132);
  });

  it('does NOT spawn a normal workflow script for an adw:upgrade issue', async () => {
    const boundary = makeBoundary({ fetchLabels: vi.fn(() => ['adw:upgrade']) });

    await classifyAndSpawnWorkflow(132, boundary, TARGET_ARGS);

    expect(spawnedScripts().some((a) => a.endsWith('adws/adwChore.tsx'))).toBe(false);
    expect(spawnedScripts().some((a) => a.endsWith('adws/adwSdlc.tsx'))).toBe(false);
  });

  it('falls through to evaluateCandidate for a non-upgrade issue', async () => {
    const boundary = makeBoundary({ fetchLabels: vi.fn(() => []) });
    evaluateCandidateMock.mockReturnValue({ kind: 'skip_terminal', terminalStage: 'completed' });

    await classifyAndSpawnWorkflow(200, boundary, TARGET_ARGS);

    expect(evaluateCandidateMock).toHaveBeenCalledTimes(1);
    expect(spawnedScripts().some((a) => a.endsWith('adws/adwUpgrade.tsx'))).toBe(false);
  });
});

describe('closeAbandonedDependents — tracker routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseDependencies).mockReturnValue([]);
  });

  it('calls tracker.listIssues with number+body fields', async () => {
    const tracker = { listIssues: vi.fn(() => []), closeIssue: vi.fn(async () => true) } as unknown as Pick<IssueTracker, 'listIssues' | 'closeIssue'>;

    await closeAbandonedDependents(7, tracker);

    expect(tracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'body'], limit: 100 });
  });

  it('does not throw when listIssues throws', async () => {
    const tracker = {
      listIssues: vi.fn(() => { throw new Error('gh failed'); }),
      closeIssue: vi.fn(async () => true),
    } as unknown as Pick<IssueTracker, 'listIssues' | 'closeIssue'>;

    await expect(closeAbandonedDependents(7, tracker)).resolves.not.toThrow();
  });
});
