import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { BaseScenarioOutcome } from '../../core/regressionTriage';
import { BASE_RERUN_TAG } from '../baseScenarioRerun';
import {
  ALPHA_FEATURE,
  BETA_FEATURE,
  CANCEL_RESETS,
  FAILING,
  FEATURE_FILES,
  INSTALL_COMMAND,
  PASSING,
  RETRY_REARMS_ALPHA,
  RETRY_REARMS_BETA,
  RUN_BY_TAG_COMMAND,
  buildRerunIn,
  executionLogIn,
  fakeInstall,
  fakeScenarioRunner,
  fakeWorktree,
  junit,
  readFeatureFiles,
  reportBaselineDir,
  setUpRerunFixture,
  tearDownRerunFixture,
  type RerunFixture,
} from './baseScenarioRerun.helpers';

let fixture: RerunFixture;

beforeEach(() => {
  fixture = setUpRerunFixture();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  tearDownRerunFixture(fixture);
});

const buildRerun = (runner: ReturnType<typeof fakeScenarioRunner>, overrides: Parameters<typeof buildRerunIn>[2] = {}) =>
  buildRerunIn(fixture, runner, overrides);

const executionLog = (): string => executionLogIn(fixture);

describe('the base scenario re-run — runs just that scenario', () => {
  it('runs the base branch’s own command once, for the re-run tag, in the base checkout', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    await buildRerun(runner)(CANCEL_RESETS);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toMatchObject({ command: RUN_BY_TAG_COMMAND, tag: BASE_RERUN_TAG, cwd: fixture.checkout.path });
  });

  it('has tagged only that scenario while it runs, directly above its keyword line', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    await buildRerun(runner)(CANCEL_RESETS);

    const seen = runner.calls[0]?.featureFiles ?? {};
    expect(seen['features/regression/a.feature']).toContain('  @adw-base-rerun\n  Scenario: Cancel resets');
    expect(seen['features/regression/a.feature']?.match(/@adw-base-rerun/g)).toHaveLength(1);
    expect(seen['features/per-issue/feature-9.feature']).toBe(BETA_FEATURE);
  });

  it('leaves every feature file as it found it', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    await buildRerun(runner)(CANCEL_RESETS);

    expect(readFeatureFiles(fixture.checkout.path)).toEqual(FEATURE_FILES);
  });

  it('leaves every feature file as it found it when the run throws, and reports the scenario as not run', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);
    const throwing = { ...runner, run: async () => { throw new Error('runner crashed'); } };

    const outcome = await buildRerun(throwing)(CANCEL_RESETS);

    expect(outcome).toBe(BaseScenarioOutcome.NotRun);
    expect(readFeatureFiles(fixture.checkout.path)).toEqual(FEATURE_FILES);
    expect(executionLog()).toContain('runner crashed');
  });

  it('writes its report and proof files under the run’s baseline directory', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    await buildRerun(runner)(CANCEL_RESETS);

    const env = runner.calls[0]?.env ?? {};
    expect(env.ADW_JUNIT_REPORT_PATH?.startsWith(`${reportBaselineDir()}${path.sep}`)).toBe(true);
    expect(env.ADW_PROOF_DIR?.startsWith(reportBaselineDir())).toBe(true);
  });
});

describe('the base scenario re-run — what it reports', () => {
  it('reports Failed when the scenario fails on the base branch', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => FAILING);

    expect(await buildRerun(runner)(CANCEL_RESETS)).toBe(BaseScenarioOutcome.Failed);
  });

  it('reports Passed when the scenario passes on the base branch', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    expect(await buildRerun(runner)(CANCEL_RESETS)).toBe(BaseScenarioOutcome.Passed);
  });

  it('reports NotRun when the report holds no test case', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => junit());

    expect(await buildRerun(runner)(CANCEL_RESETS)).toBe(BaseScenarioOutcome.NotRun);
  });

  it('reports NotRun when the run wrote no report', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => null);

    expect(await buildRerun(runner)(CANCEL_RESETS)).toBe(BaseScenarioOutcome.NotRun);
  });

  it('reports NotRun, without starting the runner, for a scenario the base branch does not have', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    const outcome = await buildRerun(runner)({ name: 'A scenario only the change has', feature: 'Alpha' });

    expect(outcome).toBe(BaseScenarioOutcome.NotRun);
    expect(runner.calls).toHaveLength(0);
    expect(executionLog()).toContain('A scenario only the change has');
  });

  it('reports NotRun when the base branch cannot be checked out', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);
    const worktree = fakeWorktree(fixture.checkout, () => { throw new Error('fetch failed'); });

    const outcome = await buildRerun(runner, { baseWorktree: worktree })(CANCEL_RESETS);

    expect(outcome).toBe(BaseScenarioOutcome.NotRun);
    expect(runner.calls).toHaveLength(0);
    expect(executionLog()).toContain('fetch failed');
  });
});

describe('the base scenario re-run — finding the scenario', () => {
  it('tags the scenario of the feature the report names, not one of the same name in another feature', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);
    const rerun = buildRerun(runner);

    await rerun(RETRY_REARMS_ALPHA);
    await rerun(RETRY_REARMS_BETA);

    const [alphaRun, betaRun] = runner.calls;
    expect(alphaRun?.featureFiles['features/regression/a.feature']).toContain('  @adw-base-rerun\n  Scenario: Retry rearms');
    expect(alphaRun?.featureFiles['features/per-issue/feature-9.feature']).toBe(BETA_FEATURE);
    expect(betaRun?.featureFiles['features/per-issue/feature-9.feature']).toContain('  @adw-base-rerun\n  Scenario: Retry rearms');
    expect(betaRun?.featureFiles['features/regression/a.feature']).toBe(ALPHA_FEATURE);
  });

  it('finds a scenario by the long name cucumber-js gives a scenario in a rule', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    await buildRerun(runner)({ name: 'Directives - Cancel resets', feature: 'Alpha' });

    expect(runner.calls[0]?.featureFiles['features/regression/a.feature']).toContain('  @adw-base-rerun\n  Scenario: Cancel resets');
  });

  it('finds a scenario named in the report of another runner by the feature at the end of its classname', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    await buildRerun(runner)({ name: 'Cancel resets', feature: 'features.regression.Alpha' });

    expect(runner.calls).toHaveLength(1);
  });

  it('finds the scenario in any feature when the report names none', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);

    await buildRerun(runner)({ name: 'Cancel resets' });

    expect(runner.calls).toHaveLength(1);
  });
});

describe('the base scenario re-run — install and memoization', () => {
  it('installs the dependencies of the base checkout once, however many scenarios it re-runs', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);
    const install = fakeInstall();
    const rerun = buildRerun(runner, { runProcess: install.runProcess });

    await rerun(CANCEL_RESETS);
    await rerun(RETRY_REARMS_ALPHA);

    expect(install.commands).toEqual([INSTALL_COMMAND]);
  });

  it('reports every scenario as not run, with a warning, when the install fails', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);
    const install = fakeInstall({ exitCode: 1, output: 'E404 no such package' });
    const rerun = buildRerun(runner, { runProcess: install.runProcess });

    expect(await rerun(CANCEL_RESETS)).toBe(BaseScenarioOutcome.NotRun);
    expect(await rerun(RETRY_REARMS_ALPHA)).toBe(BaseScenarioOutcome.NotRun);

    expect(runner.calls).toHaveLength(0);
    expect(install.commands).toEqual([INSTALL_COMMAND]);
    expect(executionLog()).toContain('E404 no such package');
  });

  it('runs a scenario it has already classified only once', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => FAILING);
    const rerun = buildRerun(runner);

    const first = await rerun(CANCEL_RESETS);
    const second = await rerun(CANCEL_RESETS);

    expect(first).toBe(BaseScenarioOutcome.Failed);
    expect(second).toBe(BaseScenarioOutcome.Failed);
    expect(runner.calls).toHaveLength(1);
  });
});
