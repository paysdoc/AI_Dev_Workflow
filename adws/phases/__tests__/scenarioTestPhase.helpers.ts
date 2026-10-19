import { APPLICATION_TYPE_PROFILES, Platform, type ApplicationProfile } from '../../core/applicationType';
import { TEST_DEVICE_SOURCE } from '../../core/__tests__/fixtures/recordingDeviceHost';
import { parseConditionalDocs } from '../../core/conditionalDocsRegistry';
import type { HealthyDevServerConfig, HealthyDevServerOutcome } from '../../core/devServerLifecycle';
import { HostTool } from '../../core/deviceCommands';
import type { DeviceEnvironment, DeviceFailure, DeviceOutcome, DeviceRequest } from '../../core/deviceLifecycle';
import { parseDeviceSourceSections, type DeviceSourceSections } from '../../core/deviceSourceConfig';
import type { ParkEvidence } from '../../forge/parkComment';
import type { ScenarioTestPhaseDeps } from '../scenarioTestPhase';
import type { WorkflowConfig } from '../workflowInit';

export const passingProof = {
  tagResults: [
    { tag: '@adw-{issueNumber}', resolvedTag: '@adw-42', severity: 'blocker' as const, optional: false, passed: true, output: 'ok', exitCode: 0, skipped: false },
    { tag: '@regression', resolvedTag: '@regression', severity: 'blocker' as const, optional: true, passed: true, output: 'ok', exitCode: 0, skipped: false },
  ],
  hasBlockerFailures: false,
  perIssueImages: [],
  resultsFilePath: '/agents/test-id/scenario-test/scenario_proof.md',
  artifactsDir: '/agents/test-id/scenario-test/artifacts',
};

export const failingProof = {
  tagResults: [
    { tag: '@adw-{issueNumber}', resolvedTag: '@adw-42', severity: 'blocker' as const, optional: false, passed: false, output: 'FAILED', exitCode: 1, skipped: false },
  ],
  hasBlockerFailures: true,
  perIssueImages: [],
  resultsFilePath: '/agents/test-id/scenario-test/scenario_proof.md',
  artifactsDir: '/agents/test-id/scenario-test/artifacts',
};

export function makeConfig(overrides: {
  scenariosMd?: string;
  runScenariosByTag?: string;
  startDevServer?: string;
  healthCheckPath?: string;
  /** What `.adw/scenarios.md` names as the scenario directory; defaults to `features`. */
  scenarioDirectory?: string;
  /** Defaults to the cli profile; null leaves the config without one. */
  applicationProfile?: ApplicationProfile | null;
  /** Defaults to no section set. */
  deviceSources?: DeviceSourceSections;
} = {}): WorkflowConfig {
  const applicationProfile = overrides.applicationProfile === undefined ? APPLICATION_TYPE_PROFILES.cli : overrides.applicationProfile;
  return {
    issueNumber: 42,
    adwId: 'test-id',
    issue: { body: 'issue body', number: 42, title: 'Test', state: 'OPEN', author: { login: 'user', isBot: false }, assignees: [], labels: [], comments: [], createdAt: '', updatedAt: '', url: '' },
    issueType: '/feature' as const,
    worktreePath: '/worktrees/test',
    defaultBranch: 'main',
    logsDir: '/logs',
    orchestratorStatePath: '/state.json',
    orchestratorName: 'sdlc',
    recoveryState: { isRecovery: false, adwId: null, branchName: null },
    ctx: {} as unknown as WorkflowConfig['ctx'],
    branchName: 'feature-42-test',
    applicationUrl: 'http://localhost:4567',
    topLevelStatePath: '/agents/test-id/state.json',
    ...(applicationProfile === null ? {} : { applicationProfile }),
    projectConfig: {
      commands: {
        packageManager: 'bun',
        installDeps: 'bun install',
        runLinter: 'bun run lint',
        typeCheck: 'bunx tsc --noEmit',
        runTests: 'bun run test',
        runBuild: 'bun run build',
        startDevServer: overrides.startDevServer ?? 'N/A',
        healthCheckPath: overrides.healthCheckPath ?? '/',
        prepareApp: 'N/A',
        additionalTypeChecks: '',
        libraryInstall: 'bun add',
        scriptExecution: 'bunx tsx',
        runScenariosByTag: overrides.runScenariosByTag ?? 'bunx cucumber-js --tags {tag}',
        runRegressionScenarios: 'bunx cucumber-js --tags @regression',
      },
      projectMd: '',
      conditionalDocsMd: '',
      conditionalDocs: parseConditionalDocs(''),
      hasAdwDir: true,
      providers: { codeHost: 'github', issueTracker: 'github' },
      scenarios: { scenarioDirectory: overrides.scenarioDirectory ?? 'features', runByTag: 'bunx cucumber-js --tags {tag}', runRegression: '', stepDefDirectory: 'features/step_definitions', bddFramework: '' },
      scenariosMd: overrides.scenariosMd ?? 'some scenario content',
      applicationType: 'cli',
      deviceSources: overrides.deviceSources ?? parseDeviceSourceSections(''),
    },
  } as unknown as WorkflowConfig;
}

/** The lifecycle's answer: `'starts'` runs the work inside the server; `{ output }` is a start that never got a health answer. */
export type LifecycleBehaviour = 'starts' | { readonly output: string };

export function fakeLifecycle(behaviour: LifecycleBehaviour = 'starts'): {
  withHealthyDevServer: ScenarioTestPhaseDeps['withHealthyDevServer'];
  configs: HealthyDevServerConfig[];
} {
  const configs: HealthyDevServerConfig[] = [];
  const withHealthyDevServer = (async <T>(config: HealthyDevServerConfig, work: () => Promise<T>): Promise<HealthyDevServerOutcome<T>> => {
    configs.push(config);
    if (behaviour !== 'starts') return { started: false, output: behaviour.output };
    return { started: true, result: await work() };
  }) as ScenarioTestPhaseDeps['withHealthyDevServer'];
  return { withHealthyDevServer, configs };
}

export const EVERY_DEVICE_SOURCE: DeviceSourceSections = TEST_DEVICE_SOURCE;

export const STAND_IN_DEVICES: DeviceEnvironment = {
  ADW_ANDROID_AVD: 'adw-test-id',
  ADW_ANDROID_SERIAL: 'emulator-5580',
  ADW_IOS_UDID: '7C1B3A9E-2D4F-4E8A-B6C5-0F9E8D7A6B54',
};

/** The device lifecycle's answer: hands the work the stand-in devices, and notes when they exist in `events`. */
export function fakeDevices(events: string[] = []): {
  withDevices: ScenarioTestPhaseDeps['withDevices'];
  requests: DeviceRequest[];
} {
  const requests: DeviceRequest[] = [];
  const withDevices = (async <T>(request: DeviceRequest, work: (devices: DeviceEnvironment) => Promise<T>): Promise<DeviceOutcome<T>> => {
    requests.push(request);
    events.push('devices ready');
    try {
      return { kind: 'ready', result: await work(STAND_IN_DEVICES) };
    } finally {
      events.push('devices removed');
    }
  }) as ScenarioTestPhaseDeps['withDevices'];
  return { withDevices, requests };
}

export const BOOT_FAILED: DeviceFailure = {
  kind: 'boot_failed',
  platform: Platform.Android,
  attempts: 3,
  output: 'Attempt 1 of 3: The Android emulator "adw-test-id" (emulator-5580) exited before it was ready; its output is in /logs/android-emulator.log\nPANIC: Broken AVD system path',
};

export const TOOL_MISSING: DeviceFailure = {
  kind: 'tool_missing',
  platform: Platform.Ios,
  tool: HostTool.Simctl,
  output: 'Attempt 1 of 3: The iOS simulator "adw-test-id" could not be created: "xcrun simctl create" failed with no exit code: Error: spawn xcrun ENOENT\nError: spawn xcrun ENOENT',
};

/** The device lifecycle's answer when a device does not come up: the work never runs, and `events` notes the failure. */
export function failingDevices(failure: DeviceFailure, events: string[] = []): {
  withDevices: ScenarioTestPhaseDeps['withDevices'];
  requests: DeviceRequest[];
} {
  const requests: DeviceRequest[] = [];
  const withDevices = (async (request: DeviceRequest): Promise<DeviceFailure> => {
    requests.push(request);
    events.push('devices failed');
    return failure;
  }) as ScenarioTestPhaseDeps['withDevices'];
  return { withDevices, requests };
}

/** Stands in for a park, which never returns: the evidence is recorded, and `Parked` is thrown. */
export class Parked extends Error {}

export function recordingPark(events: string[] = []): { park: ScenarioTestPhaseDeps['park']; parked: ParkEvidence[] } {
  const parked: ParkEvidence[] = [];
  const park: ScenarioTestPhaseDeps['park'] = (_config, evidence) => {
    parked.push(evidence);
    events.push('parked');
    throw new Parked(`parked for ${evidence.reason}`);
  };
  return { park, parked };
}

/** A dev server that notes in `events` when it starts and stops around the work. */
export function recordingServer(events: string[]): ScenarioTestPhaseDeps['withHealthyDevServer'] {
  const { withHealthyDevServer } = fakeLifecycle();
  return (async (config, work) => {
    events.push('server started');
    try {
      return await withHealthyDevServer(config, work);
    } finally {
      events.push('server stopped');
    }
  }) as ScenarioTestPhaseDeps['withHealthyDevServer'];
}
