import { APPLICATION_TYPE_PROFILES, type ApplicationProfile } from '../../core/applicationType';
import { parseConditionalDocs } from '../../core/conditionalDocsRegistry';
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
      reviewProofMd: '',
      hasAdwDir: true,
      providers: { codeHost: 'github', issueTracker: 'github' },
      scenarios: { scenarioDirectory: overrides.scenarioDirectory ?? 'features', runByTag: 'bunx cucumber-js --tags {tag}', runRegression: '', stepDefDirectory: 'features/step_definitions', bddFramework: '' },
      scenariosMd: overrides.scenariosMd ?? 'some scenario content',
      reviewProofConfig: {
        tags: [
          { tag: '@adw-{issueNumber}', severity: 'blocker', optional: false },
          { tag: '@regression', severity: 'blocker', optional: true },
        ],
        supplementaryChecks: [],
      },
      applicationType: 'cli',
    },
  } as unknown as WorkflowConfig;
}
