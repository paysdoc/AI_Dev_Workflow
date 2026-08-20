import { describe, it, expect, vi } from 'vitest';
import { executeDepauditSetup, type DepauditSetupDeps } from '../phases/depauditSetup';
import type { WorkflowConfig } from '../phases/workflowInit';
import type { CodeHost } from '../providers/types';

vi.mock('../github', () => ({
  getRepoInfo: vi.fn().mockReturnValue({ owner: 'fallback-owner', repo: 'fallback-repo' }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    worktreePath: '/tmp/fixture',
    targetRepo: { owner: 'acme', repo: 'fixture-target', cloneUrl: 'https://github.com/acme/fixture-target.git' },
    issueNumber: 1,
    adwId: 'test-adw-id',
    issue: { number: 1, title: 'test', body: '', state: 'OPEN', author: 'tester', labels: [], createdAt: '', comments: [], actionableComment: null },
    issueType: '/chore',
    defaultBranch: 'main',
    logsDir: '/tmp/logs',
    orchestratorStatePath: '/tmp/state.json',
    orchestratorName: 'adw-init' as WorkflowConfig['orchestratorName'],
    recoveryState: { isRecovery: false },
    ctx: {} as WorkflowConfig['ctx'],
    branchName: 'test-branch',
    applicationUrl: '',
    projectConfig: {} as WorkflowConfig['projectConfig'],
    topLevelStatePath: '/tmp/top-state.json',
    repoContext: undefined,
    ...overrides,
  } as unknown as WorkflowConfig;
}

function makeCodeHost(overrides: Partial<CodeHost> = {}): CodeHost {
  return {
    setSecret: vi.fn(),
    ...overrides,
  } as unknown as CodeHost;
}

function makeRepoContext(codeHost: CodeHost, owner = 'acme', repo = 'fixture-target'): WorkflowConfig['repoContext'] {
  return { codeHost, issueTracker: {}, repoId: { owner, repo, platform: 'github' }, cwd: '/tmp/fixture' } as unknown as WorkflowConfig['repoContext'];
}

function makeDeps(overrides: Partial<DepauditSetupDeps> = {}): DepauditSetupDeps {
  return {
    execWithRetry: vi.fn().mockReturnValue(''),
    log: vi.fn(),
    getEnv: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executeDepauditSetup — depaudit setup invocation', () => {
  it('invokes depaudit setup with config.worktreePath as cwd', async () => {
    const config = makeConfig();
    const deps = makeDeps();

    await executeDepauditSetup(config, deps);

    const firstCall = (deps.execWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toBe('depaudit setup');
    expect(firstCall[1]).toMatchObject({ cwd: '/tmp/fixture' });
  });

  it('does not throw when depaudit setup binary is missing', async () => {
    const config = makeConfig();
    const deps = makeDeps({
      execWithRetry: vi.fn().mockImplementationOnce(() => { throw new Error('command not found: depaudit'); }),
    });

    const result = await executeDepauditSetup(config, deps);

    expect(result.success).toBe(true);
    expect(result.warnings.some(w => w.includes('depaudit setup failed'))).toBe(true);
  });
});

describe('executeDepauditSetup — SOCKET_API_TOKEN propagation', () => {
  it('codeHost.setSecret is called with SOCKET_API_TOKEN when env is present', async () => {
    const codeHost = makeCodeHost();
    const config = makeConfig({ repoContext: makeRepoContext(codeHost) });
    const deps = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SOCKET_API_TOKEN' ? 'sktsec_abc' : undefined),
    });

    await executeDepauditSetup(config, deps);

    expect(codeHost.setSecret).toHaveBeenCalledWith('SOCKET_API_TOKEN', 'sktsec_abc');
  });

  it('skippedSecrets includes SOCKET_API_TOKEN when env is unset', async () => {
    const codeHost = makeCodeHost();
    const config = makeConfig({ repoContext: makeRepoContext(codeHost) });
    const deps = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SLACK_WEBHOOK_URL' ? 'https://hooks.slack.com/test' : undefined),
    });

    const result = await executeDepauditSetup(config, deps);

    expect(result.skippedSecrets).toContain('SOCKET_API_TOKEN');
    expect(codeHost.setSecret).not.toHaveBeenCalledWith('SOCKET_API_TOKEN', expect.anything());
  });

  it('warnings array contains SOCKET_API_TOKEN skip message when unset', async () => {
    const config = makeConfig();
    const deps = makeDeps();

    const result = await executeDepauditSetup(config, deps);

    expect(result.warnings.some(w => w.includes('SOCKET_API_TOKEN') && w.includes('not set'))).toBe(true);
  });
});

describe('executeDepauditSetup — SLACK_WEBHOOK_URL propagation', () => {
  it('codeHost.setSecret is called with SLACK_WEBHOOK_URL when env is present', async () => {
    const codeHost = makeCodeHost();
    const config = makeConfig({ repoContext: makeRepoContext(codeHost) });
    const deps = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SLACK_WEBHOOK_URL' ? 'https://hooks.slack.com/test' : undefined),
    });

    await executeDepauditSetup(config, deps);

    expect(codeHost.setSecret).toHaveBeenCalledWith('SLACK_WEBHOOK_URL', 'https://hooks.slack.com/test');
  });

  it('skippedSecrets includes SLACK_WEBHOOK_URL when env is unset', async () => {
    const codeHost = makeCodeHost();
    const config = makeConfig({ repoContext: makeRepoContext(codeHost) });
    const deps = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SOCKET_API_TOKEN' ? 'sktsec_abc' : undefined),
    });

    const result = await executeDepauditSetup(config, deps);

    expect(result.skippedSecrets).toContain('SLACK_WEBHOOK_URL');
  });
});

describe('executeDepauditSetup — missing env vars', () => {
  it('does not throw when both env vars are unset', async () => {
    const config = makeConfig();
    const deps = makeDeps();

    await expect(executeDepauditSetup(config, deps)).resolves.toMatchObject({ success: true });
  });

  it('does not throw when codeHost.setSecret fails', async () => {
    const codeHost = makeCodeHost({ setSecret: vi.fn(() => { throw new Error('HTTP 403'); }) });
    const config = makeConfig({ repoContext: makeRepoContext(codeHost) });
    const deps = makeDeps({ getEnv: () => 'some-value' });

    const result = await executeDepauditSetup(config, deps);

    expect(result.success).toBe(true);
    expect(result.warnings.some(w => w.includes('HTTP 403') || w.includes('Failed to set'))).toBe(true);
  });
});

describe('executeDepauditSetup — no repo context', () => {
  it('skips both secrets with a warning when config.repoContext is absent', async () => {
    const config = makeConfig({ repoContext: undefined });
    const deps = makeDeps({ getEnv: () => 'some-value' });

    const result = await executeDepauditSetup(config, deps);

    expect(result.success).toBe(true);
    expect(result.skippedSecrets).toEqual(['SOCKET_API_TOKEN', 'SLACK_WEBHOOK_URL']);
    expect(result.warnings.some(w => w.includes('SOCKET_API_TOKEN') && w.includes('no repo context'))).toBe(true);
  });
});

describe('executeDepauditSetup — getRepoInfo fallback', () => {
  it('uses getRepoInfo fallback for the success log message when config.targetRepo is undefined', async () => {
    const { getRepoInfo } = await import('../github');
    (getRepoInfo as ReturnType<typeof vi.fn>).mockReturnValue({ owner: 'fallback-owner', repo: 'fallback-repo' });

    const codeHost = makeCodeHost();
    const config = makeConfig({ targetRepo: undefined, repoContext: makeRepoContext(codeHost, 'fallback-owner', 'fallback-repo') });
    const logSpy = vi.fn();
    const deps = makeDeps({ getEnv: vi.fn().mockReturnValue('some-value'), log: logSpy });

    await executeDepauditSetup(config, deps);

    expect(codeHost.setSecret).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fallback-owner/fallback-repo'), 'success');
  });
});
