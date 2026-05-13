import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AuthRequiredError } from '../../types/agentTypes';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
  execSync: vi.fn(),
}));

vi.mock('../agentProcessHandler', () => ({
  handleAgentProcess: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  AgentStateManager: { appendLog: vi.fn(), writeState: vi.fn() },
  getSafeSubprocessEnv: vi.fn().mockReturnValue({}),
  resolveClaudeCodePath: vi.fn().mockReturnValue('/usr/bin/claude'),
  clearClaudeCodePathCache: vi.fn(),
}));

vi.mock('../../vcs/worktreeOperations', () => ({ getMainRepoPath: vi.fn() }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { execSync } from 'child_process';
import { handleAgentProcess } from '../agentProcessHandler';
import { runClaudeAgentWithCommand } from '../claudeAgent';

const mockExecSync = vi.mocked(execSync);
const mockHandleAgentProcess = vi.mocked(handleAgentProcess);

const BASE_RESULT = {
  success: true,
  output: 'ok',
  sessionId: 'sess-1',
  totalCostUsd: 0.01,
  modelUsage: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runClaudeAgentWithCommand — auth retry logic', () => {
  it('throws AuthRequiredError when handleAgentProcess returns authExpired and execSync returns loggedIn=false', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      authExpired: true,
    });
    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify({ loggedIn: false }))
    );

    await expect(
      runClaudeAgentWithCommand('/feature', 'args', 'my-agent', '/tmp/out.jsonl')
    ).rejects.toThrow(AuthRequiredError);
  });

  it('includes the agentName in AuthRequiredError when loggedIn=false', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      authExpired: true,
    });
    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify({ loggedIn: false }))
    );

    let thrownError: unknown;
    try {
      await runClaudeAgentWithCommand('/feature', 'args', 'orchestrator', '/tmp/out.jsonl');
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AuthRequiredError);
    expect((thrownError as AuthRequiredError).agentName).toBe('orchestrator');
  });

  it('throws AuthRequiredError when retry also returns authExpired=true (loggedIn=true path)', async () => {
    // First call: authExpired
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      authExpired: true,
    });
    // execSync reports logged in (so we proceed to retry)
    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify({ loggedIn: true, email: 'user@test.com', subscriptionType: 'pro' }))
    );
    // Retry also fails with authExpired
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      authExpired: true,
    });

    await expect(
      runClaudeAgentWithCommand('/feature', 'args', 'build-agent', '/tmp/out.jsonl')
    ).rejects.toThrow(AuthRequiredError);
  });

  it('throws AuthRequiredError when execSync throws', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      authExpired: true,
    });
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('spawn claude ENOENT');
    });

    await expect(
      runClaudeAgentWithCommand('/feature', 'args', 'test-agent', '/tmp/out.jsonl')
    ).rejects.toThrow(AuthRequiredError);
  });

  it('returns result without throwing when first call succeeds (no authExpired)', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: true,
    });

    const result = await runClaudeAgentWithCommand(
      '/feature', 'args', 'plan-agent', '/tmp/out.jsonl'
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('ok');
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
