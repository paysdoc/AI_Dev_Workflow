import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AGENTS_STATE_DIR } from '../../core/config';
import { DevServerStartStatus } from '../../core/devServerFailure';
import { rerunScenariosOnMergedBranch } from '../postMergeScenarioRerun';
import { RUN, adwId, harness, projectWith, proofOf, tagResult, useRerunSandbox, type Harness } from './postMergeScenarioRerun.helpers';

useRerunSandbox();

describe('rerunScenariosOnMergedBranch — the scenario test phase', () => {
  it('runs it once, with everything the phase reads from a workflow config', async () => {
    const project = projectWith();
    const h = harness(project);

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(h.runScenarioTests).toHaveBeenCalledTimes(1);
    const config = h.runScenarioTests.mock.calls[0][0];
    expect(config).toMatchObject({
      adwId,
      issueNumber: 1101,
      worktreePath: RUN.worktreePath,
      logsDir: RUN.logsDir,
      applicationUrl: 'http://localhost:4321',
      projectConfig: project,
      orchestratorStatePath: path.join(AGENTS_STATE_DIR, adwId, 'merge-orchestrator'),
      ctx: { issueNumber: 1101, adwId },
    });
    expect(config.applicationProfile).toMatchObject({ platforms: [] });
  });

  it('creates the state directory of the merge orchestrator for the phase’s execution log', async () => {
    const h = harness();

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(fs.statSync(path.join(AGENTS_STATE_DIR, adwId, 'merge-orchestrator')).isDirectory()).toBe(true);
  });

  it('hands the phase an issue tracker, so that a device that does not boot is parked with a comment', async () => {
    const h = harness();

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    const { repoContext } = h.runScenarioTests.mock.calls[0][0];
    repoContext.issueTracker.commentOnIssue(1101, 'parked');
    expect(h.commentOnIssue).toHaveBeenCalledWith(1101, 'parked');
  });

  it('allocates the port the application URL names', async () => {
    const h = harness();
    h.allocatePort.mockResolvedValueOnce(5099);

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(h.runScenarioTests.mock.calls[0][0].applicationUrl).toBe('http://localhost:5099');
  });
});

describe('rerunScenariosOnMergedBranch — the verdict', () => {
  it('is green when the proof has no blocker failure', async () => {
    const h = harness(projectWith(), proofOf(tagResult({ passed: true })));

    expect(await rerunScenariosOnMergedBranch(RUN, h.deps)).toEqual({ kind: 'green' });
  });

  it('is green when the phase produced no proof', async () => {
    const h = harness(projectWith(), undefined);

    expect(await rerunScenariosOnMergedBranch(RUN, h.deps)).toEqual({ kind: 'green' });
  });

  it('is red with the failed cases of the proof', async () => {
    const proof = proofOf(
      tagResult({
        tag: '@adw-{issueNumber}',
        resolvedTag: '@adw-1101',
        passed: false,
        exitCode: 1,
        cases: [{ name: 'Orders over the limit are refused', classname: 'Orders', status: 'failed', failureMessage: 'expected status 422, got 201', attachments: [] }],
      }),
    );
    const h = harness(projectWith(), proof);

    expect(await rerunScenariosOnMergedBranch(RUN, h.deps)).toEqual({
      kind: 'red',
      failures: [{ title: '@adw-1101 Orders: Orders over the limit are refused', detail: 'expected status 422, got 201' }],
    });
  });

  it('is red with the start command and output when the dev server did not start', async () => {
    const h = harness();
    h.runScenarioTests.mockResolvedValueOnce({
      scenarioProof: undefined,
      devServer: { status: DevServerStartStatus.Failed, command: 'bun run dev', healthUrl: 'http://localhost:4321/', output: 'port in use' },
    });

    expect(await rerunScenariosOnMergedBranch(RUN, h.deps)).toEqual({
      kind: 'red',
      failures: [{ title: 'dev server did not start: bun run dev', detail: 'port in use' }],
    });
  });

  it('writes the title and the whole detail of each failure to the log, which the park comment points to', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
    const proof = proofOf(tagResult({ passed: false, exitCode: 1, cases: [{ name: 'Orders are accepted', classname: 'Orders', status: 'failed', failureMessage: 'x'.repeat(5000), attachments: [] }] }));
    const h = harness(projectWith(), proof);

    await rerunScenariosOnMergedBranch(RUN, h.deps);

    const text = logged.join('\n');
    expect(text).toContain('Post-merge scenario re-run:');
    expect(text).toContain('@regression Orders: Orders are accepted');
    expect(text).toContain('x'.repeat(5000));
  });
});

describe('rerunScenariosOnMergedBranch — never throws', () => {
  const dependencies: ReadonlyArray<[string, (h: Harness) => void]> = [
    ['loading the project config', (h) => h.loadProjectConfig.mockImplementation(() => { throw new Error('boom'); })],
    ['an install', (h) => h.runProcess.mockRejectedValue(new Error('boom'))],
    ['allocating the port', (h) => h.allocatePort.mockRejectedValue(new Error('boom'))],
    ['the scenario test phase', (h) => h.runScenarioTests.mockRejectedValue(new Error('boom'))],
  ];

  it.each(dependencies)('turns a failure of %s into a red verdict', async (_what, breakIt) => {
    const h = harness();
    breakIt(h);

    const verdict = await rerunScenariosOnMergedBranch(RUN, h.deps);

    expect(verdict).toEqual({ kind: 'red', failures: [{ title: 'scenario re-run', detail: 'Error: boom' }] });
  });
});
