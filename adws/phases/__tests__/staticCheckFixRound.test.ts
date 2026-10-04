import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CheckStatus, StaticCheckName, type CheckVerdict } from '../../core/checkRunner';
import { buildCommitPrefix } from '../../agents/gitAgent';
import type { TestResult } from '../../agents/testAgent';
import type { AgentResult } from '../../types/agentTypes';
import { RateLimitError } from '../../types/agentTypes';
import {
  MAX_FIX_PROMPT_OUTPUT_CHARS,
  buildStaticCheckFixRoundPort,
  toStaticCheckFailure,
  type StaticCheckFixRoundDeps,
} from '../staticCheckFixRound';
import type { WorkflowConfig } from '../workflowInit';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function failing(check: StaticCheckName, command: string, output: string, exitCode: number | null = 1): CheckVerdict {
  return { check, command, status: CheckStatus.Failed, exitCode, output };
}

const LINT = failing(StaticCheckName.Lint, 'bun run lint', 'src/app.ts: 2 problems\n');
const BUILD = failing(StaticCheckName.Build, 'bun run build', "error: Could not resolve './missing'\n", 2);

function makeConfig(): WorkflowConfig {
  return {
    issueNumber: 989,
    adwId: 'static-check-fix-round-test',
    issue: { number: 989, title: 'Fix loop', body: 'issue body' },
    issueType: '/feature',
    worktreePath: '/worktrees/fix-round',
    branchName: 'feature-issue-989-fix-loop',
    logsDir: tempDir('adw-fix-round-logs-'),
    orchestratorStatePath: tempDir('adw-fix-round-state-'),
  } as unknown as WorkflowConfig;
}

interface Harness {
  readonly deps: StaticCheckFixRoundDeps;
  readonly calls: string[];
  readonly agentInputs: TestResult[];
  readonly agentArguments: unknown[][];
}

interface HarnessOptions {
  readonly heads?: readonly string[];
  readonly commitResult?: boolean;
  readonly diffs?: readonly string[];
  readonly agent?: () => Promise<AgentResult>;
  readonly failOn?: Readonly<Partial<Record<'pushBranch' | 'commitChanges' | 'diff' | 'fetchAndResetToRemote', Error>>>;
}

const AGENT_RESULT: AgentResult = {
  success: true,
  output: '',
  totalCostUsd: 0.5,
  modelUsage: { 'model-a': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
};

function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const agentInputs: TestResult[] = [];
  const agentArguments: unknown[][] = [];
  const heads = [...(options.heads ?? ['aaaaaaa'])];
  const diffs = [...(options.diffs ?? ['diff --git a/src/a.ts b/src/a.ts'])];
  const failIf = (name: keyof NonNullable<HarnessOptions['failOn']>): void => {
    const failure = options.failOn?.[name];
    if (failure) throw failure;
  };

  const deps: StaticCheckFixRoundDeps = {
    git: {
      headShort: (cwd) => {
        calls.push(`headShort ${String(cwd)}`);
        return heads.length > 1 ? (heads.shift() as string) : heads[0];
      },
      pushBranch: (branch, cwd) => {
        calls.push(`pushBranch ${branch} ${cwd}`);
        failIf('pushBranch');
      },
      commitChanges: (message, cwd) => {
        calls.push(`commitChanges ${message} @ ${cwd}`);
        failIf('commitChanges');
        return options.commitResult ?? true;
      },
      diff: (range, cwd) => {
        calls.push(`diff ${range} @ ${cwd}`);
        failIf('diff');
        return diffs.length > 1 ? (diffs.shift() as string) : diffs[0];
      },
      fetchAndResetToRemote: (branch, cwd) => {
        calls.push(`fetchAndResetToRemote ${branch} ${cwd}`);
        failIf('fetchAndResetToRemote');
      },
    },
    runResolveTestAgent: async (...args: unknown[]) => {
      calls.push('agent');
      agentInputs.push(args[0] as TestResult);
      agentArguments.push(args);
      return options.agent ? options.agent() : AGENT_RESULT;
    },
  };
  return { deps, calls, agentInputs, agentArguments };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('toStaticCheckFailure — the one input of a round’s agent run', () => {
  it('names the round in the test name, and is a failed test', () => {
    const failure = toStaticCheckFailure([LINT], 3);

    expect(failure.test_name).toBe('static-checks-round-3');
    expect(failure.passed).toBe(false);
  });

  it('lists the command of each failing check, one per line', () => {
    expect(toStaticCheckFailure([LINT, BUILD], 1).execution_command).toBe('bun run lint\nbun run build');
  });

  it('names the failing checks in the purpose, and says that each passes on exit 0', () => {
    const purpose = toStaticCheckFailure([LINT, BUILD], 1).test_purpose;

    expect(purpose).toContain('lint');
    expect(purpose).toContain('build');
    expect(purpose).toMatch(/exits? (with code )?0/);
  });

  it('holds one section per failing check, in check order, with its name, command, exit code and output', () => {
    const error = toStaticCheckFailure([LINT, BUILD], 1).error ?? '';

    expect(error.indexOf('lint')).toBeGreaterThan(-1);
    expect(error.indexOf('build')).toBeGreaterThan(error.indexOf('lint'));
    expect(error).toContain('Command: bun run lint');
    expect(error).toContain('Exit code: 1');
    expect(error).toContain('src/app.ts: 2 problems');
    expect(error).toContain('Command: bun run build');
    expect(error).toContain('Exit code: 2');
    expect(error).toContain("error: Could not resolve './missing'");
  });

  it('says "none" for a check that has no exit code', () => {
    const error = toStaticCheckFailure([failing(StaticCheckName.TypeCheck, 'bunx tsc --noEmit', 'Terminated', null)], 1).error ?? '';

    expect(error).toContain('Exit code: none');
  });

  it('says that a check printed nothing when it printed nothing', () => {
    const error = toStaticCheckFailure([failing(StaticCheckName.Lint, 'bun run lint', '')], 1).error ?? '';

    expect(error).toContain('(no output)');
  });

  it('cuts an output longer than the cap, and tells the agent to run the command for the rest', () => {
    const output = `${'x'.repeat(MAX_FIX_PROMPT_OUTPUT_CHARS)}TAIL-THAT-IS-CUT`;
    const error = toStaticCheckFailure([failing(StaticCheckName.Lint, 'bun run lint', output)], 1).error ?? '';

    expect(error).toContain('x'.repeat(MAX_FIX_PROMPT_OUTPUT_CHARS));
    expect(error).not.toContain('TAIL-THAT-IS-CUT');
    expect(error).toContain(`output cut after ${MAX_FIX_PROMPT_OUTPUT_CHARS} characters; run the command to see the rest`);
  });

  it('passes an output that fits unchanged', () => {
    const output = 'y'.repeat(MAX_FIX_PROMPT_OUTPUT_CHARS);
    const error = toStaticCheckFailure([failing(StaticCheckName.Lint, 'bun run lint', output)], 1).error ?? '';

    expect(error).toContain(output);
    expect(error).not.toContain('output cut after');
  });
});

describe('buildStaticCheckFixRoundPort — fix', () => {
  it('records the base, publishes it, runs the agent once, commits what the round changed, then diffs from the base', async () => {
    const { deps, calls } = harness({ heads: ['abc1234'], diffs: ['THE DIFF'] });
    const config = makeConfig();

    const result = await buildStaticCheckFixRoundPort(config, deps).fix([LINT, BUILD], 1);

    expect(calls[0]).toBe('headShort /worktrees/fix-round');
    expect(calls[1]).toBe('pushBranch feature-issue-989-fix-loop /worktrees/fix-round');
    expect(calls[2]).toBe('agent');
    expect(calls[3]).toMatch(/^commitChanges .* @ \/worktrees\/fix-round$/);
    expect(calls[4]).toBe('diff --no-renames abc1234 HEAD @ /worktrees/fix-round');
    expect(calls).toHaveLength(5);
    expect(result.diff).toBe('THE DIFF');
  });

  it('returns the agent’s cost and model usage', async () => {
    const { deps } = harness();

    const result = await buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1);

    expect(result.costUsd).toBe(0.5);
    expect(result.modelUsage['model-a'].costUSD).toBe(0.5);
  });

  it('counts a missing cost as zero', async () => {
    const { deps } = harness({ agent: async () => ({ success: true, output: '' }) });

    const result = await buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1);

    expect(result.costUsd).toBe(0);
    expect(result.modelUsage).toEqual({});
  });

  it('runs one agent for a round with two failing checks, and hands it both', async () => {
    const { deps, calls, agentInputs } = harness();

    await buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT, BUILD], 2);

    expect(calls.filter(call => call === 'agent')).toHaveLength(1);
    expect(agentInputs).toEqual([toStaticCheckFailure([LINT, BUILD], 2)]);
  });

  it('hands the agent the logs directory, a state path of its own, the worktree, the issue body and the launch context', async () => {
    const { deps, agentArguments } = harness();
    const config = makeConfig();

    await buildStaticCheckFixRoundPort(config, deps).fix([LINT], 1);

    const [, logsDir, statePath, cwd, issueBody, launchContext] = agentArguments[0];
    expect(logsDir).toBe(config.logsDir);
    expect(statePath).toBe(path.join(config.orchestratorStatePath, 'static-check-fix-agent'));
    expect(fs.existsSync(statePath as string)).toBe(true);
    expect(cwd).toBe('/worktrees/fix-round');
    expect(issueBody).toBe('issue body');
    expect(launchContext).toMatchObject({ adwId: 'static-check-fix-round-test' });
  });

  it('commits with the prefix of the static-check fix agent and names the round and the failing checks', async () => {
    const { deps, calls } = harness();

    await buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT, BUILD], 4);

    const message = calls.find(call => call.startsWith('commitChanges'))?.replace(/^commitChanges /, '').replace(/ @ .*$/, '') ?? '';
    expect(message.startsWith(`${buildCommitPrefix('static-check-fix-agent', '/feature')}: `)).toBe(true);
    expect(message).toContain('round 4');
    expect(message).toContain('lint');
    expect(message).toContain('build');
  });

  it('writes a commit message that the shell the commit goes through cannot take apart', async () => {
    const { deps, calls } = harness();

    await buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT, BUILD], 4);

    const message = calls.find(call => call.startsWith('commitChanges')) ?? '';
    expect(message).not.toMatch(/[`$\\"]/);
  });

  it('returns an empty diff when the round changed nothing', async () => {
    const { deps } = harness({ commitResult: false, diffs: [''] });

    const result = await buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1);

    expect(result.diff).toBe('');
  });

  it('carries on when the agent reports that it failed, since the guard judges whatever it changed', async () => {
    const { deps, calls } = harness({ agent: async () => ({ success: false, output: 'agent exited 1' }) });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).resolves.toMatchObject({ diff: expect.any(String) });
    expect(calls.some(call => call.startsWith('commitChanges'))).toBe(true);
  });

  it('records each round’s own base', async () => {
    const { deps, calls } = harness({ heads: ['1111111', '2222222'] });
    const port = buildStaticCheckFixRoundPort(makeConfig(), deps);

    await port.fix([LINT], 1);
    await port.fix([LINT], 2);

    expect(calls.filter(call => call.startsWith('diff'))).toEqual([
      'diff --no-renames 1111111 HEAD @ /worktrees/fix-round',
      'diff --no-renames 2222222 HEAD @ /worktrees/fix-round',
    ]);
  });
});

describe('buildStaticCheckFixRoundPort — a round the agent never finishes', () => {
  it('commits what the round left behind, resets to the remote, and rethrows the error of the agent', async () => {
    const error = new RateLimitError('test');
    const { deps, calls } = harness({ agent: async () => { throw error; } });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).rejects.toBe(error);

    const afterAgent = calls.slice(calls.indexOf('agent') + 1);
    expect(afterAgent[0]).toMatch(/^commitChanges /);
    expect(afterAgent[1]).toBe('fetchAndResetToRemote feature-issue-989-fix-loop /worktrees/fix-round');
    expect(afterAgent.some(call => call.startsWith('diff'))).toBe(false);
  });

  it('commits first so that the reset removes the files the round created, which a reset alone would leave', async () => {
    const { deps, calls } = harness({ agent: async () => { throw new Error('agent died'); } });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).rejects.toThrow('agent died');

    expect(calls.findIndex(call => call.startsWith('commitChanges'))).toBeLessThan(calls.findIndex(call => call.startsWith('fetchAndResetToRemote')));
  });

  it('logs a reset that fails and still rethrows the original error', async () => {
    const original = new Error('agent died');
    const { deps } = harness({ agent: async () => { throw original; }, failOn: { fetchAndResetToRemote: new Error('network is down') } });
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).rejects.toBe(original);

    expect(logged.join('\n')).toContain('network is down');
  });

  it('logs a commit that fails, still resets, and still rethrows the original error', async () => {
    const original = new Error('agent died');
    const { deps, calls } = harness({ agent: async () => { throw original; }, failOn: { commitChanges: new Error('hook rejected the commit') } });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).rejects.toBe(original);

    expect(calls.some(call => call.startsWith('fetchAndResetToRemote'))).toBe(true);
  });

  it('logs a head that is not the base after the reset, and still rethrows the original error', async () => {
    const original = new Error('agent died');
    const { deps } = harness({ heads: ['aaaaaaa', 'ccccccc'], agent: async () => { throw original; } });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).rejects.toBe(original);
  });

  it.each([
    ['the commit', { commitChanges: new Error('hook rejected the commit') }],
    ['the diff', { diff: new Error('ambiguous argument') }],
  ] as const)('resets a round whose %s failed after the agent ran, and rethrows that failure', async (_step, failOn) => {
    const { deps, calls } = harness({ failOn });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).rejects.toThrow(Object.values(failOn)[0].message);

    expect(calls.some(call => call.startsWith('fetchAndResetToRemote'))).toBe(true);
  });

  it('does not reset a round that failed before the agent ran', async () => {
    const { deps, calls } = harness({ failOn: { pushBranch: new Error('push rejected') } });

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).fix([LINT], 1)).rejects.toThrow('push rejected');

    expect(calls).not.toContain('agent');
    expect(calls.some(call => call.startsWith('fetchAndResetToRemote'))).toBe(false);
  });
});

describe('buildStaticCheckFixRoundPort — keep', () => {
  it('pushes the branch, so that the remote is what the round left', async () => {
    const { deps, calls } = harness();
    const port = buildStaticCheckFixRoundPort(makeConfig(), deps);
    await port.fix([LINT], 1);
    calls.length = 0;

    await port.keep(1);

    expect(calls).toEqual(['pushBranch feature-issue-989-fix-loop /worktrees/fix-round']);
  });
});

describe('buildStaticCheckFixRoundPort — discard', () => {
  it('resets the worktree to the remote, then checks that it is back at the round’s base', async () => {
    const { deps, calls } = harness({ heads: ['abc1234'] });
    const port = buildStaticCheckFixRoundPort(makeConfig(), deps);
    await port.fix([LINT], 1);
    calls.length = 0;

    await port.discard(1);

    expect(calls).toEqual(['fetchAndResetToRemote feature-issue-989-fix-loop /worktrees/fix-round', 'headShort /worktrees/fix-round']);
  });

  it('fails closed when the head is not the round’s base after the reset, naming the branch and both commits', async () => {
    const { deps } = harness({ heads: ['abc1234', 'def5678'] });
    const port = buildStaticCheckFixRoundPort(makeConfig(), deps);
    await port.fix([LINT], 1);

    await expect(port.discard(1)).rejects.toThrow(/feature-issue-989-fix-loop.*def5678.*abc1234|feature-issue-989-fix-loop.*abc1234.*def5678/s);
  });

  it('takes two spellings of one commit for the same commit', async () => {
    const { deps } = harness({ heads: ['abc1234', 'abc12345'] });
    const port = buildStaticCheckFixRoundPort(makeConfig(), deps);
    await port.fix([LINT], 1);

    await expect(port.discard(1)).resolves.toBeUndefined();
  });

  it('lets the error of a reset that fails propagate', async () => {
    const { deps } = harness({ failOn: { fetchAndResetToRemote: new Error('network is down') } });
    const port = buildStaticCheckFixRoundPort(makeConfig(), deps);
    await port.fix([LINT], 1);

    await expect(port.discard(1)).rejects.toThrow('network is down');
  });

  it('refuses to discard a round it never started', async () => {
    const { deps } = harness();

    await expect(buildStaticCheckFixRoundPort(makeConfig(), deps).discard(7)).rejects.toThrow(/round 7/);
  });
});
