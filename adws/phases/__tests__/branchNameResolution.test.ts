/**
 * Unit tests for branchNameResolution.ts
 *
 * Uses real AgentStateManager (atomic write path exercised) and vi.mock for the agent,
 * following the conventions in topLevelState.test.ts and gitAgent.test.ts.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../agents', () => ({
  runGenerateBranchNameAgent: vi.fn(),
}));

import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import {
  readPersistedBranchName,
  persistBranchName,
  _resolveWorkflowBranchNameForTest,
} from '../branchNameResolution';
import { runGenerateBranchNameAgent } from '../../agents';

const mockAgent = vi.mocked(runGenerateBranchNameAgent);

const BASE_ADW_ID = `test-bname-res-${Date.now()}`;

const baseAgentResult = {
  success: true,
  output: '',
  sessionId: 'test-session',
  totalCostUsd: 0,
  modelUsage: {},
};

const defaultArgs = {
  issueType: '/feature' as const,
  issue: {
    number: 1,
    title: 'Test issue',
    body: '',
    state: 'open',
    author: { login: 'test', isBot: false },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '',
    updatedAt: '',
    closedAt: null,
    url: '',
  },
  logsDir: '/tmp/test-logs',
  recoveryState: {
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
    canResume: false,
  },
};

function makeArgs(adwId: string) {
  return { adwId, ...defaultArgs };
}

function cleanupAdwId(adwId: string) {
  const dir = path.join(AGENTS_STATE_DIR, adwId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

describe('readPersistedBranchName', () => {
  const adwId = `${BASE_ADW_ID}-read`;

  afterEach(() => cleanupAdwId(adwId));

  it('returns undefined when no state file exists', () => {
    expect(readPersistedBranchName(adwId)).toBeUndefined();
  });

  it('returns the stored branchName', () => {
    AgentStateManager.writeTopLevelState(adwId, { branchName: 'feature-issue-1-slug' });
    expect(readPersistedBranchName(adwId)).toBe('feature-issue-1-slug');
  });
});

describe('persistBranchName', () => {
  const adwId = `${BASE_ADW_ID}-persist`;

  afterEach(() => cleanupAdwId(adwId));

  it('writes branchName into the top-level state file', () => {
    persistBranchName(adwId, 'feature-issue-1-my-slug');
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state?.branchName).toBe('feature-issue-1-my-slug');
  });

  it('merges without clobbering sibling fields', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 99 });
    persistBranchName(adwId, 'feature-issue-99-slug');
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state?.branchName).toBe('feature-issue-99-slug');
    expect(state?.adwId).toBe(adwId);
    expect(state?.issueNumber).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Deterministic fallback tests (criterion 1 & 4)
// ---------------------------------------------------------------------------

describe('_resolveWorkflowBranchNameForTest — deterministic identity fallback (criterion 1)', () => {
  const adwId = `${BASE_ADW_ID}-fallback`;

  afterEach(() => {
    cleanupAdwId(adwId);
    mockAgent.mockReset();
  });

  it('returns the existing branch found by the finder and does NOT call the agent', async () => {
    const existingBranch = 'feature-issue-1-existing-branch';
    const finderFn = vi.fn().mockReturnValue(existingBranch);

    const result = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent, finderFn);

    expect(result).toBe(existingBranch);
    expect(mockAgent).not.toHaveBeenCalled();
    expect(finderFn).toHaveBeenCalledWith('/feature', 1);
  });

  it('persists the finder-returned branch so subsequent calls skip the finder', async () => {
    const existingBranch = 'feature-issue-1-existing-branch';
    const finderFn = vi.fn().mockReturnValue(existingBranch);

    await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent, finderFn);

    expect(AgentStateManager.readTopLevelState(adwId)?.branchName).toBe(existingBranch);
  });

  it('calls the agent exactly once when the finder returns null', async () => {
    const branchName = 'feature-issue-1-llm-generated';
    mockAgent.mockResolvedValueOnce({ ...baseAgentResult, branchName });
    const finderFn = vi.fn().mockReturnValue(null);

    const result = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent, finderFn);

    expect(result).toBe(branchName);
    expect(mockAgent).toHaveBeenCalledTimes(1);
    expect(finderFn).toHaveBeenCalledTimes(1);
  });
});

describe('_resolveWorkflowBranchNameForTest — happy-path precedence (criterion 4)', () => {
  const adwId = `${BASE_ADW_ID}-happy`;

  afterEach(() => {
    cleanupAdwId(adwId);
    mockAgent.mockReset();
  });

  it('persisted state wins over finder — finder is NOT called', async () => {
    const persistedName = 'feature-issue-1-already-persisted';
    AgentStateManager.writeTopLevelState(adwId, { branchName: persistedName });
    const finderFn = vi.fn().mockReturnValue('feature-issue-1-fallback-branch');

    const result = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent, finderFn);

    expect(result).toBe(persistedName);
    expect(finderFn).not.toHaveBeenCalled();
    expect(mockAgent).not.toHaveBeenCalled();
  });

  it('recovery-comment branchName wins over finder — finder is NOT called', async () => {
    const recoveryBranch = 'feature-issue-1-from-recovery-comment';
    const args = {
      ...makeArgs(adwId),
      recoveryState: { ...makeArgs(adwId).recoveryState, branchName: recoveryBranch },
    };
    const finderFn = vi.fn().mockReturnValue('feature-issue-1-fallback-branch');

    const result = await _resolveWorkflowBranchNameForTest(args, mockAgent, finderFn);

    expect(result).toBe(recoveryBranch);
    expect(finderFn).not.toHaveBeenCalled();
    expect(mockAgent).not.toHaveBeenCalled();
  });
});

describe('_resolveWorkflowBranchNameForTest (resolveWorkflowBranchName core logic)', () => {
  beforeEach(() => {
    mockAgent.mockReset();
  });

  // Case 1: No persisted, no recovery → agent called once, result persisted
  describe('case 1: fresh run, no persisted state, no recovery', () => {
    const adwId = `${BASE_ADW_ID}-case1`;

    afterEach(() => cleanupAdwId(adwId));

    it('calls the agent once, returns the generated name, and persists it', async () => {
      const branchName = 'feature-issue-1-new-feature';
      mockAgent.mockResolvedValueOnce({ ...baseAgentResult, branchName });

      const result = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent);

      expect(result).toBe(branchName);
      expect(mockAgent).toHaveBeenCalledTimes(1);
      expect(AgentStateManager.readTopLevelState(adwId)?.branchName).toBe(branchName);
    });
  });

  // Case 2: Persisted name present → agent NOT called (criterion 1)
  describe('case 2: persisted name exists', () => {
    const adwId = `${BASE_ADW_ID}-case2`;

    afterEach(() => cleanupAdwId(adwId));

    it('returns the persisted name without calling the agent', async () => {
      const persistedName = 'feature-issue-1-already-persisted';
      AgentStateManager.writeTopLevelState(adwId, { branchName: persistedName });

      const result = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent);

      expect(result).toBe(persistedName);
      expect(mockAgent).not.toHaveBeenCalled();
    });
  });

  // Case 3: recoveryState.branchName present → agent NOT called, name persisted
  describe('case 3: recovery state has branchName', () => {
    const adwId = `${BASE_ADW_ID}-case3`;

    afterEach(() => cleanupAdwId(adwId));

    it('returns and persists the recovery name without calling the agent', async () => {
      const recoveryName = 'feature-issue-1-from-recovery';
      const args = {
        ...makeArgs(adwId),
        recoveryState: { ...makeArgs(adwId).recoveryState, branchName: recoveryName },
      };

      const result = await _resolveWorkflowBranchNameForTest(args, mockAgent);

      expect(result).toBe(recoveryName);
      expect(mockAgent).not.toHaveBeenCalled();
      expect(AgentStateManager.readTopLevelState(adwId)?.branchName).toBe(recoveryName);
    });
  });

  // Case 4: Two sequential calls, agent returns A then B → only one agent call
  describe('case 4: two calls, agent would diverge (resolver-level criterion 3)', () => {
    const adwId = `${BASE_ADW_ID}-case4`;

    afterEach(() => cleanupAdwId(adwId));

    it('agent is called exactly once across two sequential resolves', async () => {
      const nameA = 'feature-issue-1-slug-alpha';
      const nameB = 'feature-issue-1-slug-beta';
      mockAgent
        .mockResolvedValueOnce({ ...baseAgentResult, branchName: nameA })
        .mockResolvedValueOnce({ ...baseAgentResult, branchName: nameB });

      const result1 = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent);
      const result2 = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent);

      expect(result1).toBe(nameA);
      // Second call reuses persisted name A, never reaching the agent
      expect(result2).toBe(nameA);
      expect(mockAgent).toHaveBeenCalledTimes(1);
    });
  });

  // Case 5: Mismatch guard (criterion 2) — concurrent writer persists a different name
  describe('case 5: mismatch guard — concurrent write during agent call', () => {
    const adwId = `${BASE_ADW_ID}-case5`;

    afterEach(() => cleanupAdwId(adwId));

    it('throws a "Refusing to fork" error naming both branch names and the adwId', async () => {
      const concurrentlyPersistedName = 'feature-issue-1-concurrent-write';
      const agentResultName = 'feature-issue-1-from-agent';

      // Agent side-effect: writes a DIFFERENT branch name before returning its own result.
      // This simulates a concurrent writer persisting a name during the LLM call.
      mockAgent.mockImplementationOnce(async () => {
        AgentStateManager.writeTopLevelState(adwId, { branchName: concurrentlyPersistedName });
        return { ...baseAgentResult, branchName: agentResultName };
      });

      const error = await _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent).catch(e => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Refusing to fork/);
      expect((error as Error).message).toContain(concurrentlyPersistedName);
    });

    it('error message names the adwId', async () => {
      const concurrentlyPersistedName = 'feature-issue-1-concurrent';
      mockAgent.mockImplementationOnce(async () => {
        AgentStateManager.writeTopLevelState(adwId, { branchName: concurrentlyPersistedName });
        return { ...baseAgentResult, branchName: 'feature-issue-1-new' };
      });

      await expect(
        _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent),
      ).rejects.toThrow(adwId);
    });

    it('persisted state is unchanged after the guard throws', async () => {
      const concurrentlyPersistedName = 'feature-issue-1-original';
      mockAgent.mockImplementationOnce(async () => {
        AgentStateManager.writeTopLevelState(adwId, { branchName: concurrentlyPersistedName });
        return { ...baseAgentResult, branchName: 'feature-issue-1-different' };
      });

      await expect(
        _resolveWorkflowBranchNameForTest(makeArgs(adwId), mockAgent),
      ).rejects.toThrow();

      expect(AgentStateManager.readTopLevelState(adwId)?.branchName).toBe(concurrentlyPersistedName);
    });
  });
});
