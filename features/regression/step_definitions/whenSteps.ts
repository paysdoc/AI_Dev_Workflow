import { When } from '@cucumber/cucumber';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import assert from 'assert';
import { runCronProbe, runOrchestrator, runWorkflowInit } from '../support/subprocessDrivers.ts';
import type { RegressionWorld } from './world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

function buildSubprocessEnv(world: RegressionWorld): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...world.harnessEnv,
  };
}

// Pending without the subprocess harness, so a scenario outside `@regression and (@subprocess or @webhook)` never passes by doing nothing.
When(
  'the {string} orchestrator is invoked with adwId {string} and issue {int}',
  { timeout: 150_000 },
  async function (this: RegressionWorld, orchestratorName: string, adwId: string, issueNumber: number) {
    if (!this.subprocess) return 'pending';
    await runOrchestrator(this, orchestratorName, adwId, issueNumber);
  },
);

When(
  'the plan phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive phases
    // against a fully-stubbed GitHub App + Claude pipeline.
    /*
    // Phase-import pattern: import executePlanPhase and call it with a mocked
    // WorkflowConfig. The mock context provides the GitHub API URL.
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executePlanPhase } = await import(resolve(ROOT, 'adws/phases/planPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executePlanPhase(config);
    */
  },
);

When(
  'the build phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive phases
    // against a fully-stubbed GitHub App + Claude pipeline.
    /*
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeBuildPhase } = await import(resolve(ROOT, 'adws/phases/buildPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeBuildPhase(config);
    */
  },
);

When(
  'the review phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive phases
    // against a fully-stubbed GitHub App + Claude pipeline.
    /*
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeReviewPhase } = await import(resolve(ROOT, 'adws/phases/reviewPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeReviewPhase(config);
    */
  },
);

When(
  'the PR phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive phases
    // against a fully-stubbed GitHub App + Claude pipeline.
    /*
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executePRPhase } = await import(resolve(ROOT, 'adws/phases/prPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executePRPhase(config);
    */
  },
);

When(
  'the auto-merge phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive phases
    // against a fully-stubbed GitHub App + Claude pipeline.
    /*
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeAutoMergePhase } = await import(resolve(ROOT, 'adws/phases/autoMergePhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeAutoMergePhase(config);
    */
  },
);

When(
  'the document phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive phases
    // against a fully-stubbed GitHub App + Claude pipeline.
    /*
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeDocumentPhase } = await import(resolve(ROOT, 'adws/phases/documentPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeDocumentPhase(config);
    */
  },
);

When(
  'the install phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive phases
    // against a fully-stubbed GitHub App + Claude pipeline.
    /*
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeInstallPhase } = await import(resolve(ROOT, 'adws/phases/installPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeInstallPhase(config);
    */
  },
);

// Pending without the subprocess harness, for the reason W1 is.
When(
  'the workflow is initialised with config {string}',
  { timeout: 60_000 },
  async function (this: RegressionWorld, configLabel: string) {
    if (!this.subprocess) return 'pending';
    await runWorkflowInit(this, configLabel);
  },
);

// Pending without the subprocess harness, for the reason W1 is. Records no exit code: the harness kills the cron.
When(
  'the cron probe runs once',
  { timeout: 90_000 },
  async function (this: RegressionWorld) {
    if (!this.subprocess) return 'pending';
    await runCronProbe(this);
  },
);

When(
  'the webhook handler receives a {string} event for issue {int}',
  async function (this: RegressionWorld, _eventType: string, _issueNumber: number) {
    return 'pending';
    // ISSUE-3-CUTOVER: existing body below is intentionally preserved for the cutover
    // patch; remove the `return 'pending';` line above when the harness can drive a real
    // orchestrator subprocess to completion under 30s with state-file artefact emission.
    /*
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    // Simulate webhook delivery by POST-ing a synthetic payload to the SDLC
    // orchestrator. In the test harness this is routed through the mock server.
    const payload = JSON.stringify({ action: _eventType, issue: { number: _issueNumber } });
    await fetch(`${this.mockContext.serverUrl}/_mock/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues' },
      body: payload,
    });
    */
  },
);

// A bare `/` is alternation in a cucumber expression, so it is escaped.
When(
  'the git\\/gh guard is run across the repository',
  function (this: RegressionWorld) {
    try {
      const stdout = execFileSync('bunx', ['tsx', 'adws/checkGitGhGuard.ts'], { cwd: ROOT, encoding: 'utf-8' });
      this.gitGhGuardResult = { exitCode: 0, output: stdout };
    } catch (err) {
      const e = err as { status?: number | null; stdout?: string; stderr?: string };
      this.gitGhGuardResult = { exitCode: e.status ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
    }
  },
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildMockedWorkflowConfig(world: RegressionWorld, _label: string): Record<string, unknown> {
  return {
    mockGithubApiUrl: world.mockContext?.serverUrl ?? '',
    worktreePath: world.worktreePaths.values().next().value ?? process.cwd(),
    env: buildSubprocessEnv(world),
  };
}
