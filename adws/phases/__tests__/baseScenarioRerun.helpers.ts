import { vi, type Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BddScenarioResult } from '../../agents/bddScenarioRunner';
import type { ProcessOutcome } from '../../core/checkRunner';
import type { HealthyDevServerConfig, HealthyDevServerOutcome } from '../../core/devServerLifecycle';
import type { BaseCheckout } from '../baseWorktree';
import { buildBaseScenarioRerun, type BaseScenarioRerunDeps } from '../baseScenarioRerun';
import type { WorkflowConfig } from '../workflowInit';

export const ADW_ID = `base-rerun-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
export const APPLICATION_URL = 'http://localhost:4123';
export const INSTALL_COMMAND = 'install-deps';
export const RUN_BY_TAG_COMMAND = 'run-bdd --tags "@{tag}"';

export const ALPHA_FEATURE = [
  '@regression',
  'Feature: Alpha',
  '',
  '  Scenario: Cancel resets',
  '    Given a cart',
  '',
  '  Scenario: Retry rearms',
  '    Given a cart',
  '',
].join('\n');

export const BETA_FEATURE = ['Feature: Beta', '', '  Scenario: Retry rearms', '    Given a checkout', ''].join('\n');

export const FEATURE_FILES: Readonly<Record<string, string>> = {
  'features/regression/a.feature': ALPHA_FEATURE,
  'features/per-issue/feature-9.feature': BETA_FEATURE,
};

export const CANCEL_RESETS = { name: 'Cancel resets', feature: 'Alpha' };
export const RETRY_REARMS_ALPHA = { name: 'Retry rearms', feature: 'Alpha' };
export const RETRY_REARMS_BETA = { name: 'Retry rearms', feature: 'Beta' };

export interface RunCall {
  readonly command: string;
  readonly tag: string;
  readonly cwd: string | undefined;
  readonly env: Record<string, string> | undefined;
  readonly featureFiles: Readonly<Record<string, string>>;
}

export function junit(...cases: Array<{ classname: string; name: string; outcome: 'passed' | 'failed' }>): string {
  const body = cases
    .map(({ classname, name, outcome }) => {
      const failure = outcome === 'failed' ? '<failure message="assertion failed"/>' : '';
      return `<testcase classname="${classname}" name="${name}">${failure}</testcase>`;
    })
    .join('');
  return `<?xml version="1.0"?><testsuite name="cucumber-js" tests="${cases.length}">${body}</testsuite>`;
}

export const PASSING = junit({ classname: 'Alpha', name: 'Cancel resets', outcome: 'passed' });
export const FAILING = junit({ classname: 'Alpha', name: 'Cancel resets', outcome: 'failed' });

export function makeCheckout(options: { startDevServer?: string } = {}): BaseCheckout & { cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-base-rerun-'));
  fs.mkdirSync(path.join(dir, '.adw'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.adw', 'scenarios.md'), '## Scenario Directory\nfeatures/\n');
  fs.writeFileSync(
    path.join(dir, '.adw', 'commands.md'),
    [
      `## Install Dependencies\n${INSTALL_COMMAND}`,
      `## Run Scenarios by Tag\n${RUN_BY_TAG_COMMAND}`,
      `## Start Dev Server\n${options.startDevServer ?? 'N/A'}`,
      '## Health Check Path\n/health',
    ].join('\n\n'),
  );
  Object.entries(FEATURE_FILES).forEach(([relative, content]) => {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), content);
  });
  return { path: dir, baseBranch: 'trunk', commit: 'abc1234', cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function readFeatureFiles(checkoutPath: string): Record<string, string> {
  return Object.fromEntries(
    Object.keys(FEATURE_FILES).map(relative => [relative, fs.readFileSync(path.join(checkoutPath, relative), 'utf-8')]),
  );
}

export function fakeWorktree(checkout: BaseCheckout, ensure: () => BaseCheckout = () => checkout): { ensure: Mock<() => BaseCheckout>; remove: Mock<() => void> } {
  return { ensure: vi.fn(ensure), remove: vi.fn() };
}

export function makeConfig(statePath: string): WorkflowConfig {
  return { adwId: ADW_ID, issueNumber: 990, applicationUrl: APPLICATION_URL, orchestratorStatePath: statePath } as unknown as WorkflowConfig;
}

type ReportFor = (call: RunCall) => string | null;

/** Records every call with the feature files as they were when the call was made, then writes the scripted report. */
export function fakeScenarioRunner(checkoutPath: string, reportFor: ReportFor): { run: BaseScenarioRerunDeps['runScenariosByTag']; calls: RunCall[] } {
  const calls: RunCall[] = [];
  const run: BaseScenarioRerunDeps['runScenariosByTag'] = async (command, tag, cwd, env) => {
    const call: RunCall = { command, tag, cwd, env, featureFiles: readFeatureFiles(checkoutPath) };
    calls.push(call);
    const report = reportFor(call);
    const reportPath = env?.ADW_JUNIT_REPORT_PATH;
    if (report !== null && reportPath !== undefined) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, report);
    }
    return { allPassed: true, stdout: '', stderr: '', exitCode: 0 } satisfies BddScenarioResult;
  };
  return { run, calls };
}

export function fakeInstall(outcome: ProcessOutcome = { exitCode: 0, output: '' }): { runProcess: BaseScenarioRerunDeps['runProcess']; commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    runProcess: async (command) => {
      commands.push(command);
      return outcome;
    },
  };
}

export function fakeHealthyServer(startsHealthy = true): {
  withHealthyDevServer: BaseScenarioRerunDeps['withHealthyDevServer'];
  configs: HealthyDevServerConfig[];
} {
  const configs: HealthyDevServerConfig[] = [];
  const withHealthyDevServer = (async <T>(config: HealthyDevServerConfig, work: () => Promise<T>): Promise<HealthyDevServerOutcome<T>> => {
    configs.push(config);
    if (!startsHealthy) return { started: false, output: 'Error: Cannot find module' };
    return { started: true, result: await work() };
  }) as BaseScenarioRerunDeps['withHealthyDevServer'];
  return { withHealthyDevServer, configs };
}

export function reportBaselineDir(): string {
  return path.join(process.cwd(), 'agents', ADW_ID, 'baseline');
}

export interface RerunFixture {
  checkout: ReturnType<typeof makeCheckout>;
  readonly statePath: string;
}

export function setUpRerunFixture(): RerunFixture {
  return { checkout: makeCheckout(), statePath: fs.mkdtempSync(path.join(os.tmpdir(), 'adw-rerun-state-')) };
}

export function tearDownRerunFixture({ checkout, statePath }: RerunFixture): void {
  checkout.cleanup();
  fs.rmSync(statePath, { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'agents', ADW_ID), { recursive: true, force: true });
}

export function buildRerunIn(
  { checkout, statePath }: RerunFixture,
  runner: ReturnType<typeof fakeScenarioRunner>,
  overrides: Parameters<typeof buildBaseScenarioRerun>[1] = {},
): ReturnType<typeof buildBaseScenarioRerun> {
  return buildBaseScenarioRerun(makeConfig(statePath), {
    baseWorktree: fakeWorktree(checkout),
    runProcess: fakeInstall().runProcess,
    runScenariosByTag: runner.run,
    withHealthyDevServer: fakeHealthyServer().withHealthyDevServer,
    isPortAvailable: async () => true,
    ...overrides,
  });
}

export function executionLogIn({ statePath }: RerunFixture): string {
  return fs.readFileSync(path.join(statePath, 'execution.log'), 'utf-8');
}
