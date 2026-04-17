import { describe, it, expect, vi } from 'vitest';
import { executeDepauditSetup, type DepauditSetupDeps } from '../phases/depauditSetup';
import type { WorkflowConfig } from '../phases/workflowInit';

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
  it('gh secret set is called with SOCKET_API_TOKEN when env is present', async () => {
    const config = makeConfig();
    const deps = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SOCKET_API_TOKEN' ? 'sktsec_abc' : undefined),
    });

    await executeDepauditSetup(config, deps);

    const calls = (deps.execWithRetry as ReturnType<typeof vi.fn>).mock.calls;
    const secretCall = calls.find((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SOCKET_API_TOKEN'));
    expect(secretCall).toBeDefined();
    expect(secretCall![0]).toMatch(/gh secret set SOCKET_API_TOKEN --repo acme\/fixture-target/);
    expect(secretCall![1]).toMatchObject({ input: 'sktsec_abc' });
  });

  it('skippedSecrets includes SOCKET_API_TOKEN when env is unset', async () => {
    const config = makeConfig();
    const deps = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SLACK_WEBHOOK_URL' ? 'https://hooks.slack.com/test' : undefined),
    });

    const result = await executeDepauditSetup(config, deps);

    expect(result.skippedSecrets).toContain('SOCKET_API_TOKEN');
    const calls = (deps.execWithRetry as ReturnType<typeof vi.fn>).mock.calls;
    const socketCall = calls.find((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SOCKET_API_TOKEN'));
    expect(socketCall).toBeUndefined();
  });

  it('warnings array contains SOCKET_API_TOKEN skip message when unset', async () => {
    const config = makeConfig();
    const deps = makeDeps();

    const result = await executeDepauditSetup(config, deps);

    expect(result.warnings.some(w => w.includes('SOCKET_API_TOKEN') && w.includes('not set'))).toBe(true);
  });
});

describe('executeDepauditSetup — SLACK_WEBHOOK_URL propagation', () => {
  it('gh secret set is called with SLACK_WEBHOOK_URL when env is present', async () => {
    const config = makeConfig();
    const deps = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SLACK_WEBHOOK_URL' ? 'https://hooks.slack.com/test' : undefined),
    });

    await executeDepauditSetup(config, deps);

    const calls = (deps.execWithRetry as ReturnType<typeof vi.fn>).mock.calls;
    const secretCall = calls.find((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SLACK_WEBHOOK_URL'));
    expect(secretCall).toBeDefined();
    expect(secretCall![0]).toMatch(/gh secret set SLACK_WEBHOOK_URL --repo acme\/fixture-target/);
    expect(secretCall![1]).toMatchObject({ input: 'https://hooks.slack.com/test' });
  });

  it('skippedSecrets includes SLACK_WEBHOOK_URL when env is unset', async () => {
    const config = makeConfig();
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

  it('does not throw when gh secret set fails', async () => {
    const config = makeConfig();
    const deps = makeDeps({
      execWithRetry: vi.fn()
        .mockReturnValueOnce('')  // depaudit setup succeeds
        .mockImplementationOnce(() => { throw new Error('HTTP 403'); }),  // first secret fails
      getEnv: vi.fn().mockReturnValue('some-value'),
    });

    const result = await executeDepauditSetup(config, deps);

    expect(result.success).toBe(true);
    expect(result.warnings.some(w => w.includes('HTTP 403') || w.includes('Failed to set'))).toBe(true);
  });
});

describe('executeDepauditSetup — getRepoInfo fallback', () => {
  it('uses getRepoInfo fallback when config.targetRepo is undefined', async () => {
    const { getRepoInfo } = await import('../github');
    (getRepoInfo as ReturnType<typeof vi.fn>).mockReturnValue({ owner: 'fallback-owner', repo: 'fallback-repo' });

    const config = makeConfig({ targetRepo: undefined });
    const deps = makeDeps({
      getEnv: vi.fn().mockReturnValue('some-value'),
    });

    await executeDepauditSetup(config, deps);

    const calls = (deps.execWithRetry as ReturnType<typeof vi.fn>).mock.calls;
    const secretCalls = calls.filter((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('gh secret set'));
    expect(secretCalls.length).toBeGreaterThan(0);
    expect(secretCalls[0][0]).toMatch(/--repo fallback-owner\/fallback-repo/);
  });
});
