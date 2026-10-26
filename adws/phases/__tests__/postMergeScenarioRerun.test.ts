import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AGENTS_STATE_DIR } from '../../core/config';
import { ADW_PLAYWRIGHT_INSTALL_COMMAND } from '../../core/adwPlaywrightProject';
import { getDefaultProjectConfig } from '../../core/projectConfig';
import { buildPostMergeRerunDeps, rerunScenariosOnMergedBranch } from '../postMergeScenarioRerun';
import { RUN, adwId, harness, projectWith, useRerunSandbox } from './postMergeScenarioRerun.helpers';

useRerunSandbox();

describe('rerunScenariosOnMergedBranch — when there is nothing to re-run', () => {
  it('reads the project config of the merged worktree', async () => {
    const h = harness();

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(h.loadProjectConfig).toHaveBeenCalledWith(RUN.worktreePath);
  });

  it('is green without a side effect when no scenarios are configured', async () => {
    const h = harness(projectWith({ scenariosMd: '  \n' }));

    const verdict = await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(verdict).toEqual({ kind: 'green' });
    expect(h.runProcess).not.toHaveBeenCalled();
    expect(h.allocatePort).not.toHaveBeenCalled();
    expect(h.runScenarioTests).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(AGENTS_STATE_DIR, adwId))).toBe(false);
  });

  it('is green without a side effect for a repository that has no .adw directory at all', async () => {
    const h = harness(getDefaultProjectConfig());

    expect(await rerunScenariosOnMergedBranch(RUN, h.deps)).toEqual({ kind: 'green' });
    expect(h.runProcess).not.toHaveBeenCalled();
    expect(h.runScenarioTests).not.toHaveBeenCalled();
  });

  it('is green, with no install, when the scenario runner is N/A', async () => {
    const h = harness(projectWith({ runScenariosByTag: 'N/A' }));

    expect(await rerunScenariosOnMergedBranch(RUN, h.deps)).toEqual({ kind: 'green' });
    expect(h.runProcess).not.toHaveBeenCalled();
    expect(h.allocatePort).not.toHaveBeenCalled();
    expect(h.runScenarioTests).not.toHaveBeenCalled();
  });
});

describe('rerunScenariosOnMergedBranch — the application type', () => {
  it.each([
    ['missing', null],
    ['unknown', 'desktop'],
  ])('is red, naming ## Application Type, when it is %s on the merged branch, and runs nothing', async (_what, applicationType) => {
    const h = harness(projectWith({ applicationType }));

    const verdict = await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(verdict).toMatchObject({ kind: 'red', failures: [{ title: 'application type' }] });
    const detail = verdict.kind === 'red' ? verdict.failures[0].detail : '';
    expect(detail).toContain('## Application Type');
    expect(detail).toContain('.adw/project.md');
    expect(h.runProcess).not.toHaveBeenCalled();
    expect(h.runScenarioTests).not.toHaveBeenCalled();
  });
});

describe('rerunScenariosOnMergedBranch — installing what the merged-in commits may have added', () => {
  it('runs the repository’s install command in the worktree before the scenarios', async () => {
    const h = harness(projectWith({ installDeps: 'bun install' }));

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(h.runProcess).toHaveBeenCalledTimes(1);
    expect(h.runProcess).toHaveBeenCalledWith('bun install', RUN.worktreePath);
    expect(h.runProcess.mock.invocationCallOrder[0]).toBeLessThan(h.runScenarioTests.mock.invocationCallOrder[0]);
  });

  it('runs the scenario runner’s install command after the repository’s', async () => {
    const h = harness(projectWith({ applicationType: 'web', installDeps: 'bun install' }));

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(h.runProcess.mock.calls).toEqual([
      ['bun install', RUN.worktreePath],
      [ADW_PLAYWRIGHT_INSTALL_COMMAND, RUN.worktreePath],
    ]);
  });

  it.each(['N/A', 'n/a', '  '])('skips a repository install command written as %j', async (installDeps) => {
    const h = harness(projectWith({ installDeps }));

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(h.runProcess).not.toHaveBeenCalled();
    expect(h.runScenarioTests).toHaveBeenCalledTimes(1);
  });

  it('is red with the command, the exit code and the output when an install fails, and runs no scenario', async () => {
    const h = harness(projectWith({ applicationType: 'web' }));
    h.runProcess.mockResolvedValueOnce({ exitCode: 1, output: 'error: could not resolve "jszip"' });

    const verdict = await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(verdict).toEqual({
      kind: 'red',
      failures: [{ title: 'install failed: bun install (exit 1)', detail: 'error: could not resolve "jszip"' }],
    });
    expect(h.runProcess).toHaveBeenCalledTimes(1);
    expect(h.allocatePort).not.toHaveBeenCalled();
    expect(h.runScenarioTests).not.toHaveBeenCalled();
  });

  it('says that an install that did not exit had no exit code', async () => {
    const h = harness();
    h.runProcess.mockResolvedValueOnce({ exitCode: null, output: 'spawn failed' });

    const verdict = await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(verdict).toMatchObject({ kind: 'red', failures: [{ title: 'install failed: bun install (exit none)', detail: 'spawn failed' }] });
  });
});

describe('buildPostMergeRerunDeps', () => {
  it('hands the issue tracker to the re-run and wires the production ports', () => {
    const issueTracker = { commentOnIssue: vi.fn() };

    const deps = buildPostMergeRerunDeps(issueTracker);

    expect(deps.issueTracker).toBe(issueTracker);
    expect(typeof deps.loadProjectConfig).toBe('function');
    expect(typeof deps.runProcess).toBe('function');
    expect(typeof deps.allocatePort).toBe('function');
    expect(typeof deps.runScenarioTests).toBe('function');
  });
});
