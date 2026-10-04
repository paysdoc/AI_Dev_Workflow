import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildCommitPrefix } from '../../agents/gitAgent';
import { RateLimitError } from '../../types/agentTypes';
import { buildStaticCheckFixRoundPort, toStaticCheckFailure } from '../staticCheckFixRound';
import { BUILD, LINT, harness, makeConfig, removeTempDirs } from './staticCheckFixRound.helpers';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDirs();
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
