import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthRequiredError, AgentTimeoutError } from '../../types/agentTypes';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({ pid: 1234, unref: vi.fn() }),
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

vi.mock('../../core/processKill', () => ({
  killProcessGroup: vi.fn(),
}));

vi.mock('../../core/agentTimeouts', () => ({
  getAgentTimeoutForPhase: vi.fn().mockReturnValue(100), // 100ms watchdog for fast tests
}));

import { spawn, execSync } from 'child_process';
import { killProcessGroup } from '../../core/processKill';
import { handleAgentProcess } from '../agentProcessHandler';
import { runClaudeAgentWithCommand } from '../claudeAgent';

const mockSpawn = vi.mocked(spawn);
const mockExecSync = vi.mocked(execSync);
const mockHandleAgentProcess = vi.mocked(handleAgentProcess);
const mockKillProcessGroup = vi.mocked(killProcessGroup);

const BASE_RESULT = {
  success: true,
  output: 'ok',
  sessionId: 'sess-1',
  totalCostUsd: 0.01,
  modelUsage: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default pid on the spawn mock so watchdog can reference it
  mockSpawn.mockReturnValue({ pid: 1234, unref: vi.fn() } as unknown as ReturnType<typeof spawn>);
});

describe('runClaudeAgentWithCommand — watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws AgentTimeoutError when the watchdog fires before the process closes', async () => {
    // handleAgentProcess yields indefinitely until we resolve it manually
    let resolveHandler!: (r: typeof BASE_RESULT) => void;
    mockHandleAgentProcess.mockReturnValueOnce(
      new Promise<typeof BASE_RESULT>(res => { resolveHandler = res; })
    );

    const agentPromise = runClaudeAgentWithCommand('/feature', 'args', 'step-def-agent', '/tmp/out.jsonl');

    // Fire the watchdog (100ms mock timeout)
    vi.advanceTimersByTime(101);

    // Simulate the 'close' event arriving after the kill (handleAgentProcess resolves)
    resolveHandler({ ...BASE_RESULT, success: true });

    await expect(agentPromise).rejects.toThrow(AgentTimeoutError);
  });

  it('includes agentName, phaseName, and timeoutMs on AgentTimeoutError', async () => {
    let resolveHandler!: (r: typeof BASE_RESULT) => void;
    mockHandleAgentProcess.mockReturnValueOnce(
      new Promise<typeof BASE_RESULT>(res => { resolveHandler = res; })
    );

    const agentPromise = runClaudeAgentWithCommand(
      '/feature', 'args', 'step-def-agent', '/tmp/out.jsonl',
      'sonnet', undefined, undefined, undefined, undefined, undefined, 'step-def'
    );

    vi.advanceTimersByTime(101);
    resolveHandler({ ...BASE_RESULT, success: true });

    let err: unknown;
    try { await agentPromise; } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AgentTimeoutError);
    const te = err as AgentTimeoutError;
    expect(te.agentName).toBe('step-def-agent');
    expect(te.phaseName).toBe('step-def');
    expect(te.timeoutMs).toBe(100);
  });

  it('calls killProcessGroup on the claude pid when the watchdog fires', async () => {
    let resolveHandler!: (r: typeof BASE_RESULT) => void;
    mockHandleAgentProcess.mockReturnValueOnce(
      new Promise<typeof BASE_RESULT>(res => { resolveHandler = res; })
    );

    const agentPromise = runClaudeAgentWithCommand('/feature', 'args', 'step-def-agent', '/tmp/out.jsonl');

    vi.advanceTimersByTime(101);
    expect(mockKillProcessGroup).toHaveBeenCalledWith(1234, 5_000);

    resolveHandler({ ...BASE_RESULT, success: true });
    await expect(agentPromise).rejects.toThrow(AgentTimeoutError);
  });

  it('does NOT throw AgentTimeoutError when handleAgentProcess resolves before the watchdog', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    const result = await runClaudeAgentWithCommand('/feature', 'args', 'plan-agent', '/tmp/out.jsonl');

    // Watchdog timer should have been cleared — advance time past it to confirm no error
    vi.advanceTimersByTime(200);

    expect(result.success).toBe(true);
    expect(mockKillProcessGroup).not.toHaveBeenCalled();
  });

  it('spawns the child process with detached: true so the process group can be killed', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/feature', 'args', 'plan-agent', '/tmp/out.jsonl');

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ detached: true }),
    );
  });
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
