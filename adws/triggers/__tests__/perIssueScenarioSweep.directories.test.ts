import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { runPerIssueScenarioSweep } from '../perIssueScenarioSweep';
import type { StepUsageOutcome } from '../perIssueSweepStepUsage';
import type { UnusedStepIssueSpec } from '../../core/unusedStepIssueBody';
import {
  committedPaths,
  daysAgo,
  fakeTarget,
  loggedLines,
  scenariosMd,
  sweepDeps,
  usage,
  usageReport,
  type FakeTarget,
  type FakeTargetOptions,
} from './fixtures/perIssueSweepDeps';

const E2E_CONFIG = scenariosMd({ 'Per-Issue Scenario Directory': 'e2e/per-issue/', 'Step Def Directory': 'e2e/steps', 'BDD Framework': 'cucumber-js' });
const notSupported = async (): Promise<StepUsageOutcome> => ({ kind: 'not_supported', framework: 'cucumber-jvm' });
const unavailable = async (): Promise<StepUsageOutcome> => ({ kind: 'unavailable', detail: 'the dry run wrote no usage report (exit 1)' });

const targets: FakeTarget[] = [];

function target(options: FakeTargetOptions): FakeTarget {
  const created = fakeTarget(options);
  targets.push(created);
  return created;
}

afterEach(() => {
  targets.splice(0).forEach((created) => created.cleanup());
});

describe('runPerIssueScenarioSweep — configured directories', () => {
  it("lists Per-Issue Scenarios from the per-issue directory of the target's .adw/scenarios.md", async () => {
    const tracked = ['e2e/per-issue/feature-10.feature', 'e2e/per-issue/README.md', 'features/per-issue/feature-11.feature'];
    const repo = target({ tracked, scenariosMd: E2E_CONFIG, mergedAt: { 10: daysAgo(20), 11: daysAgo(20) } });

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: usageReport() }));

    expect(removed).toEqual(['e2e/per-issue/feature-10.feature']);
    expect(repo.ctx.lsFiles).toHaveBeenCalledWith(repo.worktreePath, 'e2e/per-issue');
    expect(repo.ctx.lsFiles).not.toHaveBeenCalledWith(repo.worktreePath, 'features/per-issue');
  });

  it("lists issue-named step files from the configured step-definition directory and from the per-issue directory's step_definitions", async () => {
    const tracked = [
      'e2e/per-issue/feature-10.feature',
      'e2e/per-issue/step_definitions/feature-10-world.js',
      'e2e/steps/feature-10.steps.js',
      'e2e/steps/feature-12.steps.js',
      'e2e/steps/shared.steps.js',
    ];
    const repo = target({ tracked, scenariosMd: E2E_CONFIG, mergedAt: { 10: daysAgo(20) } });
    const readStepUsage = usageReport(usage('e2e/steps/feature-10.steps.js', 3, 'issue 10 has started', ['e2e/per-issue/feature-10.feature']));

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage }));

    expect(removed).toEqual(['e2e/per-issue/feature-10.feature', 'e2e/steps/feature-10.steps.js', 'e2e/per-issue/step_definitions/feature-10-world.js', 'e2e/steps/feature-12.steps.js']);
    expect(repo.ctx.lsFiles).toHaveBeenCalledWith(repo.worktreePath, 'e2e/steps');
    expect(repo.ctx.lsFiles).toHaveBeenCalledWith(repo.worktreePath, 'e2e/per-issue/step_definitions');
  });

  it('never lists a feature file under the regression directory, even when the per-issue directory contains it', async () => {
    const config = scenariosMd({ 'Per-Issue Scenario Directory': 'features/', 'Regression Scenario Directory': 'features/regression/', 'Step Def Directory': 'features/step_definitions' });
    const tracked = ['features/feature-20.feature', 'features/regression/feature-21.feature', 'features/regression/orders/feature-22.feature'];
    const repo = target({ tracked, scenariosMd: config, mergedAt: { 20: daysAgo(20), 21: daysAgo(20), 22: daysAgo(20) } });

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: usageReport() }));

    expect(removed).toEqual(['features/feature-20.feature']);
  });

  it('never treats a .feature file or a file under the regression directory as a step-definition file', async () => {
    const tracked = [
      'features/per-issue/feature-30.feature',
      'features/regression/feature-30.feature',
      'features/regression/step_definitions/feature-30.steps.ts',
      'features/steps/feature-30.steps.ts',
      'features/steps/feature-31.feature',
    ];
    const repo = target({ tracked, scenariosMd: scenariosMd({ 'Step Def Directory': 'features' }), mergedAt: { 30: daysAgo(20) } });

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: usageReport() }));

    expect(removed).toEqual(['features/per-issue/feature-30.feature', 'features/steps/feature-30.steps.ts']);
  });

  it("removes a stale issue's step file from a configured directory outside the per-issue directory when the usage report shows no remaining feature file uses it", async () => {
    const stale = 'features/per-issue/feature-40.feature';
    const stepFile = 'features/step_definitions/feature-40.steps.ts';
    const repo = target({ tracked: [stale, 'features/per-issue/feature-41.feature', stepFile], mergedAt: { 40: daysAgo(20), 41: daysAgo(2) } });
    const readStepUsage = usageReport(usage(stepFile, 3, 'issue 40 has started', [stale]), usage(stepFile, 5, 'issue 40 is never asked for'));

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage }));

    expect(removed).toEqual([stale, stepFile]);
    expect(committedPaths(repo)).toEqual([stale, stepFile]);
  });

  it("keeps a stale or orphaned issue's step file that a remaining feature file still uses, such as a promoted Regression Suite scenario's, and logs it", async () => {
    const stale = 'features/per-issue/feature-50.feature';
    const promoted = 'features/regression/promoted.feature';
    const sibling = 'features/step_definitions/feature-50.steps.ts';
    const orphan = 'features/step_definitions/feature-51.steps.ts';
    const repo = target({ tracked: [stale, promoted, sibling, orphan], mergedAt: { 50: daysAgo(20) } });
    const readStepUsage = usageReport(usage(sibling, 3, 'an order is placed', [stale, promoted]), usage(orphan, 3, 'the order is accepted', [promoted]));
    const log = vi.fn();

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage, log }));

    expect(removed).toEqual([stale]);
    const keeping = loggedLines(log).filter((line) => line.includes('a remaining feature file still uses'));
    expect(keeping).toHaveLength(1);
    expect(keeping[0]).toContain(sibling);
    expect(keeping[0]).toContain(orphan);
  });

  it('keeps step files outside the per-issue directory when no usage report is available, and removes those inside it as before', async () => {
    const stale = 'features/per-issue/feature-60.feature';
    const inside = 'features/per-issue/step_definitions/feature-60.steps.ts';
    const outside = 'features/step_definitions/feature-60.steps.ts';
    const outsideOrphan = 'features/step_definitions/feature-61.steps.ts';

    for (const readStepUsage of [notSupported, unavailable]) {
      const repo = target({ tracked: [stale, inside, outside, outsideOrphan], mergedAt: { 60: daysAgo(20) } });
      const log = vi.fn();

      const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage, log }));

      expect(removed).toEqual([stale, inside]);
      const keeping = loggedLines(log).filter((line) => line.includes('which no usage report could clear'));
      expect(keeping).toHaveLength(1);
      expect(keeping[0]).toContain(outside);
      expect(keeping[0]).toContain(outsideOrphan);
    }
  });

  it('reads the directories from the sweep worktree, and falls back to the defaults when no sweep worktree could be prepared', async () => {
    const configured = target({ tracked: [], scenariosMd: E2E_CONFIG });
    await runPerIssueScenarioSweep(sweepDeps(configured, { readStepUsage: usageReport() }));
    expect(configured.ctx.lsFiles).toHaveBeenCalledWith(configured.worktreePath, 'e2e/per-issue');

    const unprepared = target({ tracked: [], worktreeFails: true });
    const fileRemovalIssue = vi.fn((_spec: UnusedStepIssueSpec) => 7);
    await runPerIssueScenarioSweep(
      sweepDeps(unprepared, {
        listFeatures: () => [],
        listStepDefSiblings: () => [],
        listOrphanStepDefs: () => [],
        readStepUsage: usageReport(usage('features/step_definitions/orders.steps.ts', 3, 'an order is placed'), usage('e2e/steps/orders.steps.js', 3, 'an order is shipped')),
        listOpenRemovalIssues: () => [],
        fileRemovalIssue,
      }),
    );

    expect(unprepared.ctx.createWorktreeForNewBranch).toHaveBeenCalled();
    expect(fileRemovalIssue).toHaveBeenCalledTimes(1);
    const { body } = fileRemovalIssue.mock.calls[0][0];
    expect(body).toContain('`features/step_definitions/orders.steps.ts:3`');
    expect(body).not.toContain('e2e/steps');
    expect(body).not.toContain(' on `');
  });
});
