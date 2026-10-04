import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildStaticCheckFixRoundPort } from '../staticCheckFixRound';
import { LINT, harness, makeConfig, removeTempDirs } from './staticCheckFixRound.helpers';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDirs();
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
