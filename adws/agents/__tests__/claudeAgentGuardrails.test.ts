import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('../agentProcessHandler', () => ({
  handleAgentProcess: vi.fn(),
}));

vi.mock('../../core/localRepoIdentity', () => ({ readLocalRepoIdentity: vi.fn() }));

import { spawn } from 'child_process';
import { Platform } from '@paysdoc/devplatform';
import type { GitContext } from '@paysdoc/devplatform/git';
import { clearClaudeCodePathCache, REPO_ROOT } from '../../core/environment';
import { setGuardrailsGateDepsForTesting } from '../../core/guardrailsGate';
import { buildGuardrailsSettings, resolveHookLogDir } from '../../core/guardrailsPayload';
import { readLocalRepoIdentity } from '../../core/localRepoIdentity';
import { resetFrameworkIdentityMemo } from '../../core/selfHostLaunch';
import { workflowLaunchContext } from '../../phases/workflowRepoIdentity';
import { handleAgentProcess } from '../agentProcessHandler';
import { runClaudeAgentWithCommand, type AgentLaunchContext } from '../claudeAgent';

const mockSpawn = vi.mocked(spawn);
const probeGuardrails = vi.fn(async () => ({ ok: true }));
const originalClaudeCodePath = process.env.CLAUDE_CODE_PATH;
const worktrees: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawn.mockReturnValue({ pid: 1234, unref: vi.fn() } as unknown as ReturnType<typeof spawn>);
  vi.mocked(handleAgentProcess).mockResolvedValue({ success: true, output: 'ok', sessionId: 'sess-1', totalCostUsd: 0.01, modelUsage: {} });
  // An existing absolute file, so resolving the CLI path never shells out.
  process.env.CLAUDE_CODE_PATH = process.execPath;
  clearClaudeCodePathCache();
  setGuardrailsGateDepsForTesting({ probeGuardrails, notifySlack: vi.fn(async () => undefined), getEnv: () => undefined });
  resetFrameworkIdentityMemo();
  vi.mocked(readLocalRepoIdentity).mockReturnValue({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub });
});

afterEach(() => {
  setGuardrailsGateDepsForTesting(null);
  if (originalClaudeCodePath === undefined) delete process.env.CLAUDE_CODE_PATH;
  else process.env.CLAUDE_CODE_PATH = originalClaudeCodePath;
  clearClaudeCodePathCache();
  worktrees.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function makeWorktree(adwYml?: string): string {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-guardrails-worktree-'));
  worktrees.push(worktree);
  if (adwYml === undefined) return worktree;
  fs.mkdirSync(path.join(worktree, '.github'));
  fs.writeFileSync(path.join(worktree, '.github', 'adw.yml'), adwYml, 'utf-8');
  return worktree;
}

async function startAgent(cwd: string, launchContext: AgentLaunchContext): Promise<void> {
  await runClaudeAgentWithCommand(
    '/commit', 'args', 'guardrails-agent', path.join(os.tmpdir(), 'adw-guardrails-agent.jsonl'),
    'sonnet', undefined, undefined, undefined, cwd, undefined, undefined, undefined, launchContext,
  );
}

/** `commandEnv` is what the spawn reads the git identity overlay from. */
function targetGitContext(owner: string, repo: string): GitContext {
  return { selfHost: false, owner, repo, commandEnv: () => ({}) } as unknown as GitContext;
}

function spawned(): { argv: readonly string[]; env: NodeJS.ProcessEnv } {
  const [, argv, options] = mockSpawn.mock.calls[0] as unknown as [string, readonly string[], { env: NodeJS.ProcessEnv }];
  return { argv, env: options.env };
}

function expectInjected(worktree: string, adwId: string): void {
  const { argv, env } = spawned();
  const flagIndex = argv.indexOf('--settings');
  expect(flagIndex).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(argv[flagIndex + 1] ?? '')).toEqual(buildGuardrailsSettings({ frameworkRepoRoot: REPO_ROOT }));
  expect(env['CLAUDE_HOOKS_LOG_DIR']).toBe(resolveHookLogDir(adwId));
  expect(path.relative(worktree, env['CLAUDE_HOOKS_LOG_DIR'] ?? '')).toMatch(/^\.\./);
}

describe('runClaudeAgentWithCommand — guardrails for every target repository', () => {
  it('injects the guardrail settings when the target repository has no .github/adw.yml', async () => {
    const worktree = makeWorktree();

    await startAgent(worktree, { selfHost: false, adwId: 'adw-no-file' });

    expectInjected(worktree, 'adw-no-file');
    expect(probeGuardrails).toHaveBeenCalled();
  });

  it.each(['guardrails: false', 'guardrails: true', 'guardrails: maybe'])(
    'injects the guardrail settings when .github/adw.yml still holds a leftover "%s"',
    async (leftover) => {
      const worktree = makeWorktree(`unitTests: true\n${leftover}\n`);

      await startAgent(worktree, { selfHost: false, adwId: 'adw-leftover' });

      expectInjected(worktree, 'adw-leftover');
    },
  );

  it('starts a self-host agent without --settings or CLAUDE_HOOKS_LOG_DIR and never runs the probe', async () => {
    const worktree = makeWorktree();

    await startAgent(worktree, { selfHost: true, adwId: 'adw-self-host' });

    const { argv, env } = spawned();
    expect(argv).not.toContain('--settings');
    expect(env['CLAUDE_HOOKS_LOG_DIR']).toBeUndefined();
    expect(probeGuardrails).not.toHaveBeenCalled();
  });
});

describe("runClaudeAgentWithCommand — a --target-repo launch for the framework's own repository", () => {
  it('starts the agent without --settings or CLAUDE_HOOKS_LOG_DIR and never runs the probe', async () => {
    const worktree = makeWorktree();
    const gitContext = targetGitContext('paysdoc', 'AI_Dev_Workflow');

    await startAgent(worktree, workflowLaunchContext({ adwId: 'adw-framework-target', gitContext }));

    const { argv, env } = spawned();
    expect(argv).not.toContain('--settings');
    expect(env['CLAUDE_HOOKS_LOG_DIR']).toBeUndefined();
    expect(probeGuardrails).not.toHaveBeenCalled();
  });

  it('still injects the guardrail settings for any other --target-repo repository', async () => {
    const worktree = makeWorktree();
    const gitContext = targetGitContext('acme', 'widgets');

    await startAgent(worktree, workflowLaunchContext({ adwId: 'adw-other-target', gitContext }));

    expectInjected(worktree, 'adw-other-target');
  });
});
