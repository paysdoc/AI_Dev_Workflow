import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { runPerIssueScenarioSweep } from '../perIssueScenarioSweep';
import type { StepUsageOutcome } from '../perIssueSweepStepUsage';
import type { UnusedStepIssueSpec } from '../../core/unusedStepIssueBody';
import { daysAgo, fakeTarget, loggedLines, sweepDeps, unusedStepsReport, usage, usageReport, type FakeTarget, type FakeTargetOptions } from './fixtures/perIssueSweepDeps';

const STALE = 'features/per-issue/feature-70.feature';
const FRESH = 'features/per-issue/feature-71.feature';
const ORDERS = 'features/step_definitions/orders.steps.ts';
const MERGED = { 70: daysAgo(20), 71: daysAgo(2) };
const REPORT = usageReport(
  usage(ORDERS, 3, 'an order is placed', [STALE]),
  usage(ORDERS, 5, 'the order is accepted', [FRESH]),
  usage(ORDERS, 9, 'an order is refunded'),
);

const targets: FakeTarget[] = [];

function target(options: Partial<FakeTargetOptions> = {}): FakeTarget {
  const created = fakeTarget({ tracked: [STALE, FRESH, ORDERS], mergedAt: MERGED, ...options });
  targets.push(created);
  return created;
}

afterEach(() => {
  targets.splice(0).forEach((created) => created.cleanup());
});

function bodiesOf(repo: FakeTarget): string[] {
  return repo.tracker.issues.map((issue) => issue.body);
}

describe('runPerIssueScenarioSweep — the unused step definition chore', () => {
  it('files exactly one chore issue listing, with file and line, each definition that no remaining feature file uses once the batch has landed', async () => {
    const repo = target();

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: REPORT }));

    expect(removed).toEqual([STALE]);
    expect(repo.tracker.issues).toHaveLength(1);
    const [issue] = repo.tracker.issues;
    expect(issue.labels).toEqual(['adw:chore']);
    expect(issue.body).toContain('`features/step_definitions/orders.steps.ts:3` — `an order is placed`');
    expect(issue.body).toContain('`features/step_definitions/orders.steps.ts:9` — `an order is refunded`');
    expect(issue.body).not.toContain('the order is accepted');
    expect(issue.body).toContain('dry run on `main`');
  });

  it('files none on a second pass while that issue is open', async () => {
    const repo = target();
    const secondLog = vi.fn();

    await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: REPORT }));
    await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: REPORT, log: secondLog }));

    expect(repo.tracker.issues).toHaveLength(1);
    expect(loggedLines(secondLog).some((line) => line.includes(`removal issue #${repo.tracker.issues[0].number} is still open — not filing another`))).toBe(true);
  });

  it('files no issue when every definition is still used', async () => {
    const repo = target();
    const log = vi.fn();

    await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: usageReport(usage(ORDERS, 5, 'the order is accepted', [FRESH, STALE])), log }));

    expect(repo.tracker.issues).toEqual([]);
    expect(log).toHaveBeenCalledWith('perIssueScenarioSweep: no unused step definitions', 'info');
  });

  it("files no issue for definitions outside the configured step-definition directories, such as node_modules or the Regression Suite's own step definitions", async () => {
    const repo = target();
    const log = vi.fn();
    const readStepUsage = usageReport(usage('node_modules/@acme/steps/index.js', 4, 'a vendored step'), usage('features/regression/step_definitions/regression.steps.ts', 8, 'a regression-only step'));

    await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage, log }));

    expect(repo.tracker.issues).toEqual([]);
    expect(log).toHaveBeenCalledWith('perIssueScenarioSweep: no unused step definitions', 'info');
  });

  it('counts a definition used by a stale feature whose removal did not land as used', async () => {
    const repo = target();

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: REPORT, persistRemoval: async () => [] }));

    expect(removed).toEqual([]);
    expect(bodiesOf(repo)).toHaveLength(1);
    expect(bodiesOf(repo)[0]).toContain(`${ORDERS}:9`);
    expect(bodiesOf(repo)[0]).not.toContain(`${ORDERS}:3`);
  });

  it('lists no definition from a step file the batch removed whole', async () => {
    const stale = 'features/per-issue/feature-72.feature';
    const wholeFile = 'features/step_definitions/feature-72.steps.ts';
    const repo = target({ tracked: [stale, wholeFile, ORDERS], mergedAt: { 72: daysAgo(30) } });
    const readStepUsage = usageReport(usage(wholeFile, 3, 'issue 72 has started', [stale]), usage(wholeFile, 6, 'issue 72 is never asked for'), usage(ORDERS, 3, 'an order is placed', [stale]));

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage }));

    expect(removed).toEqual([stale, wholeFile]);
    expect(bodiesOf(repo)).toHaveLength(1);
    expect(bodiesOf(repo)[0]).toContain(`${ORDERS}:3`);
    expect(bodiesOf(repo)[0]).not.toContain(`${wholeFile}:`);
  });

  it('runs the unused step pass when nothing is stale, after an open sweep PR blocked the removal, and when the gate cleared nothing', async () => {
    const cases: readonly [string, FakeTarget, Parameters<typeof sweepDeps>[1]][] = [
      ['nothing stale', target({ mergedAt: { 70: daysAgo(2), 71: daysAgo(2) } }), {}],
      ['open sweep PR', target({ openSweepPr: true }), {}],
      ['gate cleared nothing', target(), { gateRemoval: async () => null }],
    ];

    for (const [name, repo, overrides] of cases) {
      const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: REPORT, ...overrides }));

      expect(removed, name).toEqual([]);
      expect(bodiesOf(repo), name).toHaveLength(1);
      expect(bodiesOf(repo)[0], name).toContain(`${ORDERS}:9`);
      expect(bodiesOf(repo)[0], name).not.toContain(`${ORDERS}:3`);
    }
  });

  it('logs that finding unused step definitions is not supported for the framework, still removes the stale feature files and files no issue', async () => {
    for (const [framework, shown] of [['behave', '"behave"'], ['', '"(none declared)"']]) {
      const repo = target();
      const log = vi.fn();

      const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: async () => ({ kind: 'not_supported', framework }), log }));

      expect(removed).toEqual([STALE]);
      expect(log).toHaveBeenCalledWith(`perIssueScenarioSweep: finding unused step definitions is not supported for BDD framework ${shown} — skipped`, 'info');
      expect(repo.tracker.issues).toEqual([]);
      expect(repo.tracker.listIssues).not.toHaveBeenCalled();
    }
  });

  it('logs an unavailable usage report at warn, still removes what it may, and files no issue', async () => {
    const inside = 'features/per-issue/step_definitions/feature-70.steps.ts';
    const repo = target({ tracked: [STALE, inside, ORDERS] });
    const log = vi.fn();
    const readStepUsage = async (): Promise<StepUsageOutcome> => ({ kind: 'unavailable', detail: 'the dry run wrote no usage report (exit 1)' });

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage, log }));

    expect(removed).toEqual([STALE, inside]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('the dry run wrote no usage report (exit 1)'), 'warn');
    expect(repo.tracker.issues).toEqual([]);
  });

  it('still returns the landed paths when the step usage read or the issue filing throws', async () => {
    const throwingRead = target();
    const readLog = vi.fn();
    const readStepUsage = async (): Promise<StepUsageOutcome> => {
      throw new Error('dry run exploded');
    };
    expect(await runPerIssueScenarioSweep(sweepDeps(throwingRead, { readStepUsage, log: readLog }))).toEqual([STALE]);
    expect(readLog).toHaveBeenCalledWith(expect.stringContaining('dry run exploded'), 'warn');

    const throwingFile = target();
    const fileLog = vi.fn();
    const fileRemovalIssue = (): number => {
      throw new Error('forge down');
    };
    expect(await runPerIssueScenarioSweep(sweepDeps(throwingFile, { readStepUsage: REPORT, fileRemovalIssue, log: fileLog }))).toEqual([STALE]);
    expect(fileLog).toHaveBeenCalledWith(expect.stringContaining('forge down'), 'error');
  });

  it('files one chore issue for an unused-steps report, listing its definitions in the step-definition directories with file and line, and naming the framework', async () => {
    const repo = target();
    const readStepUsage = unusedStepsReport(
      'playwright-bdd',
      { file: ORDERS, line: 9, pattern: 'an order is refunded' },
      { file: ORDERS, line: 12, pattern: '^an order is lost$' },
      { file: 'node_modules/@acme/steps/index.js', line: 4, pattern: 'a vendored step' },
      { file: 'unknown', line: 0, pattern: 'a library step' },
    );

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage }));

    expect(removed).toEqual([STALE]);
    expect(repo.tracker.issues).toHaveLength(1);
    const [issue] = repo.tracker.issues;
    expect(issue.labels).toEqual(['adw:chore']);
    expect(issue.body).toContain(`\`${ORDERS}:9\` — \`an order is refunded\``);
    expect(issue.body).toContain(`\`${ORDERS}:12\` — \`^an order is lost$\``);
    expect(issue.body).toContain('playwright-bdd dry run on `main`');
    for (const left of ['a vendored step', 'a library step']) expect(issue.body).not.toContain(left);
  });

  it('files no chore issue when the unused-steps report lists nothing, and still removes the stale feature files', async () => {
    const repo = target();
    const log = vi.fn();

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage: unusedStepsReport('cucumber-jvm'), log }));

    expect(removed).toEqual([STALE]);
    expect(repo.tracker.issues).toEqual([]);
    expect(log).toHaveBeenCalledWith('perIssueScenarioSweep: no unused step definitions', 'info');
  });

  it("keeps a stale issue's step file outside the per-issue directory and lists no definition from a step file the batch removed, with an unused-steps report", async () => {
    const inside = 'features/per-issue/step_definitions/feature-70.steps.ts';
    const outside = 'features/step_definitions/feature-70.steps.ts';
    const repo = target({ tracked: [STALE, FRESH, ORDERS, inside, outside] });
    const readStepUsage = unusedStepsReport(
      'playwright-bdd',
      { file: inside, line: 3, pattern: 'issue 70 has started' },
      { file: outside, line: 5, pattern: 'issue 70 is reported' },
      { file: ORDERS, line: 9, pattern: 'an order is refunded' },
    );

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage }));

    expect(removed).toEqual([STALE, inside]);
    expect(bodiesOf(repo)).toHaveLength(1);
    expect(bodiesOf(repo)[0]).not.toContain(`${inside}:`);
    expect(bodiesOf(repo)[0]).toContain(`\`${outside}:5\` — \`issue 70 is reported\``);
    expect(bodiesOf(repo)[0]).toContain(`\`${ORDERS}:9\` — \`an order is refunded\``);
  });

  it('runs the dry run and files the issue while the sweep worktree exists, and tears the worktree down after them', async () => {
    const repo = target();
    const seen: string[] = [];
    const teardownSoFar = (): string => `removeWorktree ${repo.ctx.removeWorktree.mock.calls.length}, deleteRemoteBranch ${repo.ctx.deleteRemoteBranch.mock.calls.length}`;
    const readStepUsage = async (): Promise<StepUsageOutcome> => {
      seen.push(`read with ${teardownSoFar()}`);
      return REPORT();
    };
    const fileRemovalIssue = (_spec: UnusedStepIssueSpec): number => {
      seen.push(`file with ${teardownSoFar()}`);
      return 5;
    };

    await runPerIssueScenarioSweep(sweepDeps(repo, { readStepUsage, fileRemovalIssue }));

    expect(seen).toEqual(['read with removeWorktree 1, deleteRemoteBranch 0', 'file with removeWorktree 1, deleteRemoteBranch 0']);
    expect(repo.ctx.removeWorktree).toHaveBeenCalledTimes(2);
    expect(repo.ctx.deleteRemoteBranch).toHaveBeenCalledTimes(1);
  });
});
