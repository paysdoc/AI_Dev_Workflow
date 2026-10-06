import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseScenarioOutcome } from '../../core/regressionTriage';
import { KILL_GRACE_MS, PROBE_INTERVAL_MS } from '../../core/devServerLifecycle';
import {
  CANCEL_RESETS,
  FAILING,
  PASSING,
  buildRerunIn,
  executionLogIn,
  fakeHealthyServer,
  fakeScenarioRunner,
  makeCheckout,
  setUpRerunFixture,
  tearDownRerunFixture,
  type RerunFixture,
} from './baseScenarioRerun.helpers';

let fixture: RerunFixture;

beforeEach(() => {
  fixture = setUpRerunFixture();
  fixture.checkout.cleanup();
  fixture.checkout = makeCheckout({ startDevServer: 'npm run dev -- --port {PORT}' });
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

describe('the base scenario re-run — where the base branch declares a dev server', () => {
  it('runs inside a dev server started on the base checkout, on the run’s port', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);
    const server = fakeHealthyServer();

    const outcome = await buildRerun(runner, { withHealthyDevServer: server.withHealthyDevServer })(CANCEL_RESETS);

    expect(outcome).toBe(BaseScenarioOutcome.Passed);
    expect(server.configs).toHaveLength(1);
    expect(server.configs[0]).toMatchObject({
      startCommand: 'npm run dev -- --port {PORT}',
      port: 4123,
      healthPath: '/health',
      cwd: fixture.checkout.path,
    });
    expect(runner.calls).toHaveLength(1);
  });

  it('waits until the run’s port is free before it starts the server', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => PASSING);
    const server = fakeHealthyServer();
    const probes: number[] = [];
    const busyTwice = vi.fn(async (port: number) => {
      probes.push(port);
      return probes.length > 2;
    });
    vi.useFakeTimers();

    const pending = buildRerun(runner, { withHealthyDevServer: server.withHealthyDevServer, isPortAvailable: busyTwice })(CANCEL_RESETS);
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 3);
    const outcome = await pending;

    expect(probes).toEqual([4123, 4123, 4123]);
    expect(outcome).toBe(BaseScenarioOutcome.Passed);
    expect(server.configs).toHaveLength(1);
  });

  it('reports the scenario as not run, and does not run it, when the server does not start', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => FAILING);
    const server = fakeHealthyServer(false);

    const outcome = await buildRerun(runner, { withHealthyDevServer: server.withHealthyDevServer })(CANCEL_RESETS);

    expect(outcome).toBe(BaseScenarioOutcome.NotRun);
    expect(runner.calls).toHaveLength(0);
    expect(executionLog()).toContain('Cannot find module');
  });

  it('reports the scenario as not run when the port stays busy', async () => {
    const runner = fakeScenarioRunner(fixture.checkout.path, () => FAILING);
    const server = fakeHealthyServer();
    vi.useFakeTimers();

    const pending = buildRerun(runner, { withHealthyDevServer: server.withHealthyDevServer, isPortAvailable: async () => false })(CANCEL_RESETS);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 2 + PROBE_INTERVAL_MS);
    const outcome = await pending;

    expect(outcome).toBe(BaseScenarioOutcome.NotRun);
    expect(server.configs).toHaveLength(0);
    expect(runner.calls).toHaveLength(0);
  });
});
