import { describe, it, expect, vi } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions, ExecFn } from '../gitContext/types';
import { executeDepauditSetup, type DepauditSetupDeps } from '../phases/depauditSetup';
import type { WorkflowConfig } from '../phases/workflowInit';

vi.mock('../github', () => ({
  getRepoInfo: vi.fn().mockReturnValue({ owner: 'fallback-owner', repo: 'fallback-repo' }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'fixture-target',
    selfHost: false,
    token: 'gh-token-test',
    gitIdentity: {
      authorName: 'ADW Bot',
      authorEmail: 'bot@adw.dev',
      committerName: 'ADW Bot',
      committerEmail: 'bot@adw.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

interface SpyCall {
  command: string;
  input?: string;
}

function makeCtxSpy(
  opts: Partial<GitContextOptions> = {},
): { ctx: GitContext; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, input: options.input });
    return '';
  };
  return { ctx: new GitContext(validOptions(opts), { exec }), calls };
}

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

function makeDeps(
  overrides: Partial<DepauditSetupDeps> & { ctxCalls?: SpyCall[]; ctxExec?: ExecFn } = {},
): { deps: DepauditSetupDeps; ctxCalls: SpyCall[] } {
  const { ctxCalls: externalCalls, ctxExec: externalExec, ...rest } = overrides;
  const calls: SpyCall[] = externalCalls ?? [];
  const exec: ExecFn = externalExec ?? ((command, options) => {
    calls.push({ command, input: options.input });
    return '';
  });
  const spyCtx = new GitContext(validOptions(), { exec });
  const deps: DepauditSetupDeps = {
    execWithRetry: vi.fn().mockReturnValue(''),
    log: vi.fn(),
    getEnv: vi.fn().mockReturnValue(undefined),
    gitContextForRepo: () => spyCtx,
    ...rest,
  };
  return { deps, ctxCalls: calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executeDepauditSetup — depaudit setup invocation', () => {
  it('invokes depaudit setup with config.worktreePath as cwd', async () => {
    const config = makeConfig();
    const { deps } = makeDeps();

    await executeDepauditSetup(config, deps);

    const firstCall = (deps.execWithRetry as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toBe('depaudit setup');
    expect(firstCall[1]).toMatchObject({ cwd: '/tmp/fixture' });
  });

  it('does not throw when depaudit setup binary is missing', async () => {
    const config = makeConfig();
    const { deps } = makeDeps({
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
    const { deps, ctxCalls } = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SOCKET_API_TOKEN' ? 'sktsec_abc' : undefined),
    });

    await executeDepauditSetup(config, deps);

    const secretCall = ctxCalls.find(c => c.command.includes('SOCKET_API_TOKEN'));
    expect(secretCall).toBeDefined();
    expect(secretCall!.command).toMatch(/gh secret set SOCKET_API_TOKEN --repo acme\/fixture-target/);
    expect(secretCall!.input).toBe('sktsec_abc');
  });

  it('skippedSecrets includes SOCKET_API_TOKEN when env is unset', async () => {
    const config = makeConfig();
    const { deps, ctxCalls } = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SLACK_WEBHOOK_URL' ? 'https://hooks.slack.com/test' : undefined),
    });

    const result = await executeDepauditSetup(config, deps);

    expect(result.skippedSecrets).toContain('SOCKET_API_TOKEN');
    const socketCall = ctxCalls.find(c => c.command.includes('SOCKET_API_TOKEN'));
    expect(socketCall).toBeUndefined();
  });

  it('warnings array contains SOCKET_API_TOKEN skip message when unset', async () => {
    const config = makeConfig();
    const { deps } = makeDeps();

    const result = await executeDepauditSetup(config, deps);

    expect(result.warnings.some(w => w.includes('SOCKET_API_TOKEN') && w.includes('not set'))).toBe(true);
  });
});

describe('executeDepauditSetup — SLACK_WEBHOOK_URL propagation', () => {
  it('gh secret set is called with SLACK_WEBHOOK_URL when env is present', async () => {
    const config = makeConfig();
    const { deps, ctxCalls } = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SLACK_WEBHOOK_URL' ? 'https://hooks.slack.com/test' : undefined),
    });

    await executeDepauditSetup(config, deps);

    const secretCall = ctxCalls.find(c => c.command.includes('SLACK_WEBHOOK_URL'));
    expect(secretCall).toBeDefined();
    expect(secretCall!.command).toMatch(/gh secret set SLACK_WEBHOOK_URL --repo acme\/fixture-target/);
    expect(secretCall!.input).toBe('https://hooks.slack.com/test');
  });

  it('skippedSecrets includes SLACK_WEBHOOK_URL when env is unset', async () => {
    const config = makeConfig();
    const { deps } = makeDeps({
      getEnv: vi.fn().mockImplementation((n: string) => n === 'SOCKET_API_TOKEN' ? 'sktsec_abc' : undefined),
    });

    const result = await executeDepauditSetup(config, deps);

    expect(result.skippedSecrets).toContain('SLACK_WEBHOOK_URL');
  });
});

describe('executeDepauditSetup — missing env vars', () => {
  it('does not throw when both env vars are unset', async () => {
    const config = makeConfig();
    const { deps } = makeDeps();

    await expect(executeDepauditSetup(config, deps)).resolves.toMatchObject({ success: true });
  });

  it('does not throw when gh secret set fails', async () => {
    const config = makeConfig();
    const failExec: ExecFn = (command) => {
      if (command.includes('gh secret set')) throw new Error('HTTP 403');
      return '';
    };
    const failCtx = new GitContext(validOptions(), { exec: failExec });
    const { deps } = makeDeps();
    (deps as { gitContextForRepo: (r: unknown) => GitContext }).gitContextForRepo = () => failCtx;
    (deps as { getEnv: (n: string) => string | undefined }).getEnv = () => 'some-value';

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
    const { ctx, calls } = makeCtxSpy({ owner: 'fallback-owner', repo: 'fallback-repo' });
    const { deps } = makeDeps({
      getEnv: vi.fn().mockReturnValue('some-value'),
    });
    (deps as { gitContextForRepo: (r: unknown) => GitContext }).gitContextForRepo = () => ctx;

    await executeDepauditSetup(config, deps);

    const secretCalls = calls.filter(c => c.command.includes('gh secret set'));
    expect(secretCalls.length).toBeGreaterThan(0);
    expect(secretCalls[0].command).toMatch(/--repo fallback-owner\/fallback-repo/);
  });
});
