import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthRequiredError, AgentTimeoutError, RateLimitError } from '../../types/agentTypes';

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
  // A fresh object per call: the spawn adds keys to the environment it is given.
  buildClaudeLaunchEnv: vi.fn(() => ({ LAUNCH_ENV: 'shared' })),
  resolveClaudeCodePath: vi.fn().mockReturnValue('/usr/bin/claude'),
  clearClaudeCodePathCache: vi.fn(),
  // Default: no injection — matches today's behaviour so pre-existing tests are unaffected.
  resolveGuardrailsDecisionForSpawn: vi.fn().mockResolvedValue({ inject: false }),
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
import { buildClaudeLaunchEnv, resolveGuardrailsDecisionForSpawn } from '../../core';
import { handleAgentProcess } from '../agentProcessHandler';
import { runClaudeAgentWithCommand, type AgentLaunchContext } from '../claudeAgent';

const mockSpawn = vi.mocked(spawn);
const mockExecSync = vi.mocked(execSync);
const mockHandleAgentProcess = vi.mocked(handleAgentProcess);
const mockKillProcessGroup = vi.mocked(killProcessGroup);
const mockBuildClaudeLaunchEnv = vi.mocked(buildClaudeLaunchEnv);

function spawnEnvOf(call: readonly unknown[]): NodeJS.ProcessEnv {
  const options = call[2] as { env: NodeJS.ProcessEnv };
  return options.env;
}
const mockResolveGuardrailsDecision = vi.mocked(resolveGuardrailsDecisionForSpawn);

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

    const agentPromise = runClaudeAgentWithCommand('/feature', 'args', 'step-def-agent', '/tmp/out.jsonl', 'sonnet');

    // Fire the watchdog (100ms mock timeout). Async variant: the gate check
    // (resolveGuardrailsDecision) awaits a microtask before spawn()/the
    // watchdog setTimeout are even registered, so advancing must flush that too.
    await vi.advanceTimersByTimeAsync(101);

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

    await vi.advanceTimersByTimeAsync(101);
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

    const agentPromise = runClaudeAgentWithCommand('/feature', 'args', 'step-def-agent', '/tmp/out.jsonl', 'sonnet');

    await vi.advanceTimersByTimeAsync(101);
    expect(mockKillProcessGroup).toHaveBeenCalledWith(1234, 5_000);

    resolveHandler({ ...BASE_RESULT, success: true });
    await expect(agentPromise).rejects.toThrow(AgentTimeoutError);
  });

  it('does NOT throw AgentTimeoutError when handleAgentProcess resolves before the watchdog', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    const result = await runClaudeAgentWithCommand('/feature', 'args', 'plan-agent', '/tmp/out.jsonl', 'sonnet');

    // Watchdog timer should have been cleared — advance time past it to confirm no error
    vi.advanceTimersByTime(200);

    expect(result.success).toBe(true);
    expect(mockKillProcessGroup).not.toHaveBeenCalled();
  });

  it('spawns the child process with detached: true so the process group can be killed', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/feature', 'args', 'plan-agent', '/tmp/out.jsonl', 'sonnet');

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ detached: true }),
    );
  });
});

describe('runClaudeAgentWithCommand — rate-limit facts (#907)', () => {
  it('throws a RateLimitError carrying rateLimitType/resetsAt from the handler result', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      rateLimited: true,
      rateLimitType: 'five_hour',
      resetsAt: 1790081400,
      output: 'rate limited',
    });

    let thrownError: unknown;
    try {
      await runClaudeAgentWithCommand('/feature', 'args', 'plan-agent', '/tmp/out.jsonl', 'sonnet');
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(RateLimitError);
    const rateLimitError = thrownError as RateLimitError;
    expect(rateLimitError.phaseName).toBe('plan-agent');
    expect(rateLimitError.rateLimitType).toBe('five_hour');
    expect(rateLimitError.resetsAt).toBe(1790081400);
  });

  it('throws a RateLimitError with both facts undefined when the handler result carries none', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      rateLimited: true,
      output: 'rate limited',
    });

    let thrownError: unknown;
    try {
      await runClaudeAgentWithCommand('/feature', 'args', 'plan-agent', '/tmp/out.jsonl', 'sonnet');
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(RateLimitError);
    const rateLimitError = thrownError as RateLimitError;
    expect(rateLimitError.rateLimitType).toBeUndefined();
    expect(rateLimitError.resetsAt).toBeUndefined();
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
      runClaudeAgentWithCommand('/feature', 'args', 'my-agent', '/tmp/out.jsonl', 'sonnet')
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
      await runClaudeAgentWithCommand('/feature', 'args', 'orchestrator', '/tmp/out.jsonl', 'sonnet');
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AuthRequiredError);
    expect((thrownError as AuthRequiredError).agentName).toBe('orchestrator');
  });

  it('throws AuthRequiredError when retry also returns authExpired=true (loggedIn=true path)', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      authExpired: true,
    });
    // execSync reports logged in (so we proceed to retry)
    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify({ loggedIn: true, email: 'user@test.com', subscriptionType: 'pro' }))
    );
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: false,
      authExpired: true,
    });

    await expect(
      runClaudeAgentWithCommand('/feature', 'args', 'build-agent', '/tmp/out.jsonl', 'sonnet')
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
      runClaudeAgentWithCommand('/feature', 'args', 'test-agent', '/tmp/out.jsonl', 'sonnet')
    ).rejects.toThrow(AuthRequiredError);
  });

  it('returns result without throwing when first call succeeds (no authExpired)', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({
      ...BASE_RESULT,
      success: true,
    });

    const result = await runClaudeAgentWithCommand(
      '/feature', 'args', 'plan-agent', '/tmp/out.jsonl', 'sonnet'
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('ok');
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

describe('runClaudeAgentWithCommand — launch environment', () => {
  it('builds the environment from the caller\'s subprocessEnv overlay', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });
    const overlay = { GH_TOKEN: 'token-acme', GIT_AUTHOR_NAME: 'bot' };

    await runClaudeAgentWithCommand(
      '/implement', 'args', 'build-agent', '/tmp/out.jsonl',
      'sonnet', undefined, undefined, undefined, undefined, undefined, undefined,
      overlay,
    );

    expect(mockBuildClaudeLaunchEnv).toHaveBeenCalledTimes(1);
    expect(mockBuildClaudeLaunchEnv).toHaveBeenCalledWith(overlay);
  });

  it('builds the environment from an empty overlay when subprocessEnv is omitted', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/commit', 'args', 'commit-agent', '/tmp/out.jsonl', 'sonnet');

    expect(mockBuildClaudeLaunchEnv).toHaveBeenCalledWith({});
  });

  it('spawns the agent with the environment the builder returned', async () => {
    mockBuildClaudeLaunchEnv.mockReturnValueOnce({ LAUNCH_ENV: 'sentinel' });
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/feature', 'args', 'Plan', '/tmp/out.jsonl', 'sonnet');

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ LAUNCH_ENV: 'sentinel' }) }),
    );
  });

  it('never assigns to process.env — the environment is a new object', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    const before = process.env.GH_TOKEN;

    await runClaudeAgentWithCommand(
      '/implement', 'args', 'build-agent', '/tmp/out.jsonl',
      'sonnet', undefined, undefined, undefined, undefined, undefined, undefined,
      { GH_TOKEN: 'injected-token' },
    );

    expect(process.env.GH_TOKEN).toBe(before);
  });

  describe('the launch identity', () => {
    const BOT_IDENTITY = {
      GIT_AUTHOR_NAME: 'paysdoc-adw[bot]',
      GIT_AUTHOR_EMAIL: '3112553+paysdoc-adw[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'paysdoc-adw[bot]',
      GIT_COMMITTER_EMAIL: '3112553+paysdoc-adw[bot]@users.noreply.github.com',
    };

    function launchContextWithIdentity(): AgentLaunchContext {
      return {
        selfHost: true,
        adwId: 'adw-identity-1',
        gitContext: {
          mainRepoPath: vi.fn(),
          commandEnv: () => ({ GH_TOKEN: 'installation-token', UNRELATED: 'from-command-env', ...BOT_IDENTITY }),
        },
      };
    }

    async function launchOverlayOf(subprocessEnv?: NodeJS.ProcessEnv, launchContext?: AgentLaunchContext): Promise<NodeJS.ProcessEnv | undefined> {
      mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });
      await runClaudeAgentWithCommand(
        '/commit', 'args', 'commit-agent', '/tmp/out.jsonl',
        'sonnet', undefined, undefined, undefined, undefined, undefined, undefined,
        subprocessEnv, launchContext,
      );
      return mockBuildClaudeLaunchEnv.mock.calls[0][0];
    }

    it('reaches the launch environment from the launch context, and its credential does not', async () => {
      const overlay = await launchOverlayOf(undefined, launchContextWithIdentity());

      expect(overlay).toEqual(BOT_IDENTITY);
    });

    it('yields to an explicit subprocessEnv', async () => {
      const overlay = await launchOverlayOf({ GIT_AUTHOR_NAME: 'explicit-author', GH_TOKEN: 'token-acme' }, launchContextWithIdentity());

      expect(overlay).toEqual({ ...BOT_IDENTITY, GIT_AUTHOR_NAME: 'explicit-author', GH_TOKEN: 'token-acme' });
    });

    it('adds no identity when the launch context carries no gitContext', async () => {
      const overlay = await launchOverlayOf(undefined, { selfHost: true, adwId: 'adw-identity-1' });

      expect(overlay).toEqual({});
    });
  });

  it('hands the same environment to the first spawn and to the ENOENT retry spawn', async () => {
    mockHandleAgentProcess
      .mockResolvedValueOnce({ ...BASE_RESULT, success: false, output: 'spawn ENOENT' })
      .mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/feature', 'args', 'Plan', '/tmp/out.jsonl', 'sonnet');

    const launchEnv = mockBuildClaudeLaunchEnv.mock.results[0].value;
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    for (const call of mockSpawn.mock.calls) {
      expect(spawnEnvOf(call)).toBe(launchEnv);
    }
  });

  it('runs the auth-status check and the auth retry spawn under the environment of the first spawn', async () => {
    vi.useFakeTimers();
    mockHandleAgentProcess
      .mockResolvedValueOnce({ ...BASE_RESULT, success: false, authExpired: true })
      .mockResolvedValueOnce({ ...BASE_RESULT, success: true });
    mockExecSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ loggedIn: true, email: 'user@test.com' })));

    const agentPromise = runClaudeAgentWithCommand('/feature', 'args', 'Plan', '/tmp/out.jsonl', 'sonnet');
    await vi.advanceTimersByTimeAsync(2500);
    await agentPromise;
    vi.useRealTimers();

    const launchEnv = mockBuildClaudeLaunchEnv.mock.results[0].value;
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('auth status --json'),
      expect.objectContaining({ env: launchEnv }),
    );
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    for (const call of mockSpawn.mock.calls) {
      expect(spawnEnvOf(call)).toBe(launchEnv);
    }
  });
});

describe('runClaudeAgentWithCommand — guardrails --settings injection (#762)', () => {
  it('passes selfHost/worktreePath/adwId derived from launchContext + cwd to the gate', async () => {
    mockResolveGuardrailsDecision.mockResolvedValueOnce({ inject: false });
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand(
      '/implement', 'args', 'build-agent', '/tmp/out.jsonl',
      'sonnet', undefined, undefined, undefined, '/worktrees/target-repo', undefined, undefined, undefined,
      { selfHost: false, adwId: 'adw-guard-1' },
    );

    expect(mockResolveGuardrailsDecision).toHaveBeenCalledWith(
      { selfHost: false, worktreePath: '/worktrees/target-repo', adwId: 'adw-guard-1' },
    );
  });

  it('defaults to selfHost: true and adwId: "" when launchContext is omitted (fail-safe)', async () => {
    mockResolveGuardrailsDecision.mockResolvedValueOnce({ inject: false });
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/implement', 'args', 'build-agent', '/tmp/out.jsonl', 'sonnet');

    expect(mockResolveGuardrailsDecision).toHaveBeenCalledWith(
      { selfHost: true, worktreePath: process.cwd(), adwId: '' },
    );
  });

  it('unshifts --settings and sets an absolute CLAUDE_HOOKS_LOG_DIR when the gate injects', async () => {
    const settingsJson = JSON.stringify({ permissions: { deny: ['Bash(rm -rf:*)'] }, hooks: {} });
    mockResolveGuardrailsDecision.mockResolvedValueOnce({
      inject: true,
      settingsJson,
      hookLogDir: '/Users/adw/agents/adw-guard-1/hook-logs',
    });
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand(
      '/implement', 'args', 'build-agent', '/tmp/out.jsonl',
      'sonnet', undefined, undefined, undefined, '/worktrees/target-repo', undefined, undefined, undefined,
      { selfHost: false, adwId: 'adw-guard-1' },
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['--settings', settingsJson]),
      expect.objectContaining({
        env: expect.objectContaining({ CLAUDE_HOOKS_LOG_DIR: '/Users/adw/agents/adw-guard-1/hook-logs' }),
      }),
    );
  });

  it('a target run receiving inject: true carries --settings; a self-host run does not', async () => {
    mockResolveGuardrailsDecision.mockResolvedValueOnce({ inject: false });
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand(
      '/implement', 'args', 'build-agent', '/tmp/out.jsonl',
      'sonnet', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { selfHost: true, adwId: 'adw-self-1' },
    );

    const [, cliArgs] = mockSpawn.mock.calls[0]!;
    expect(cliArgs).not.toContain('--settings');
  });

  it('does not set CLAUDE_HOOKS_LOG_DIR when the gate withholds injection', async () => {
    mockResolveGuardrailsDecision.mockResolvedValueOnce({ inject: false });
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/implement', 'args', 'build-agent', '/tmp/out.jsonl', 'sonnet');

    const [, , spawnOptions] = mockSpawn.mock.calls[0]!;
    expect((spawnOptions as { env: NodeJS.ProcessEnv }).env['CLAUDE_HOOKS_LOG_DIR']).toBeUndefined();
  });

  it('carries the injected --settings flag through the ENOENT retry spawn as well', async () => {
    const settingsJson = JSON.stringify({ permissions: { deny: [] }, hooks: {} });
    mockResolveGuardrailsDecision.mockResolvedValueOnce({
      inject: true,
      settingsJson,
      hookLogDir: '/agents/adw-guard-1/hook-logs',
    });
    mockHandleAgentProcess
      .mockResolvedValueOnce({ ...BASE_RESULT, success: false, output: 'spawn claude ENOENT' })
      .mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand(
      '/implement', 'args', 'build-agent', '/tmp/out.jsonl',
      'sonnet', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { selfHost: false, adwId: 'adw-guard-1' },
    );

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    for (const call of mockSpawn.mock.calls) {
      expect(call[1]).toEqual(expect.arrayContaining(['--settings', settingsJson]));
    }
  });
});

describe('runClaudeAgentWithCommand — compaction kill opt-in', () => {
  const killOnCompactionArgs = (): boolean[] => mockHandleAgentProcess.mock.calls.map(call => call[6] as boolean);

  const runRestartingAgent = () => runClaudeAgentWithCommand(
    '/implement', 'args', 'build-agent', '/tmp/out.jsonl',
    'sonnet', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    true,
  );

  it('leaves an agent running through a compaction unless its caller restarts it', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runClaudeAgentWithCommand('/feature', 'args', 'Plan', '/tmp/out.jsonl', 'sonnet');

    expect(killOnCompactionArgs()).toEqual([false]);
  });

  it('asks for the kill on the first spawn when the caller restarts the agent', async () => {
    mockHandleAgentProcess.mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runRestartingAgent();

    expect(killOnCompactionArgs()).toEqual([true]);
  });

  it('keeps the request on the ENOENT retry spawn', async () => {
    mockHandleAgentProcess
      .mockResolvedValueOnce({ ...BASE_RESULT, success: false, output: 'spawn ENOENT' })
      .mockResolvedValueOnce({ ...BASE_RESULT, success: true });

    await runRestartingAgent();

    expect(killOnCompactionArgs()).toEqual([true, true]);
  });

  it('keeps the request on the auth retry spawn', async () => {
    vi.useFakeTimers();
    try {
      mockHandleAgentProcess
        .mockResolvedValueOnce({ ...BASE_RESULT, success: false, authExpired: true })
        .mockResolvedValueOnce({ ...BASE_RESULT, success: true });
      mockExecSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ loggedIn: true, email: 'user@test.com', subscriptionType: 'pro' })));

      const agentPromise = runRestartingAgent();
      await vi.advanceTimersByTimeAsync(2001);
      await agentPromise;
    } finally {
      vi.useRealTimers();
    }

    expect(killOnCompactionArgs()).toEqual([true, true]);
  });
});
