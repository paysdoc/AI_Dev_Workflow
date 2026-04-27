/**
 * When step definitions for @regression scenarios.
 *
 * Execution pattern: subprocess (W1, W10, W11) and phase-import (W2–W9, W12).
 *
 * Vocabulary phrases: W1–W12 (see features/regression/vocabulary.md).
 */

import { When } from '@cucumber/cucumber';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import type { RegressionWorld } from './world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

/** Builds the env overlay for subprocess invocations, merging harness env vars. */
function buildSubprocessEnv(world: RegressionWorld): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...world.harnessEnv,
  };
}

/** Spawns an orchestrator subprocess and captures the exit code in World. */
function spawnOrchestrator(
  world: RegressionWorld,
  orchestratorFile: string,
  adwId: string,
  issueNumber: number,
): void {
  const result = spawnSync(
    'bun',
    [resolve(ROOT, `adws/${orchestratorFile}`), adwId, String(issueNumber)],
    {
      env: buildSubprocessEnv(world),
      encoding: 'utf-8',
      timeout: 30_000,
    },
  );
  world.lastExitCode = result.status ?? -1;
}

// ---------------------------------------------------------------------------
// Orchestrator name → file map
// ---------------------------------------------------------------------------

const ORCHESTRATOR_FILES: Record<string, string> = {
  sdlc: 'adwSdlc.tsx',
  plan: 'adwPlan.tsx',
  build: 'adwBuild.tsx',
  test: 'adwTest.tsx',
  review: 'adwReview.tsx',
  merge: 'adwMerge.tsx',
  chore: 'adwChore.tsx',
  patch: 'adwPatch.tsx',
  init: 'adwInit.tsx',
  'pr-review': 'adwPrReview.tsx',
  document: 'adwDocument.tsx',
};

// ---------------------------------------------------------------------------
// W1: orchestrator invoked with adwId and issue
// ---------------------------------------------------------------------------

When(
  'the {string} orchestrator is invoked with adwId {string} and issue {int}',
  function (this: RegressionWorld, orchestratorName: string, adwId: string, issueNumber: number) {
    const file = ORCHESTRATOR_FILES[orchestratorName.toLowerCase()];
    assert.ok(
      file,
      `Unknown orchestrator name: "${orchestratorName}". Known names: ${Object.keys(ORCHESTRATOR_FILES).join(', ')}`,
    );
    spawnOrchestrator(this, file, adwId, issueNumber);
  },
);

// ---------------------------------------------------------------------------
// W2: plan phase executed with config
// ---------------------------------------------------------------------------

When(
  'the plan phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    // Phase-import pattern: import executePlanPhase and call it with a mocked
    // WorkflowConfig. The mock context provides the GitHub API URL.
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executePlanPhase } = await import(resolve(ROOT, 'adws/phases/planPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executePlanPhase(config);
  },
);

// ---------------------------------------------------------------------------
// W3: build phase executed with config
// ---------------------------------------------------------------------------

When(
  'the build phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeBuildPhase } = await import(resolve(ROOT, 'adws/phases/buildPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeBuildPhase(config);
  },
);

// ---------------------------------------------------------------------------
// W4: review phase executed with config
// ---------------------------------------------------------------------------

When(
  'the review phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeReviewPhase } = await import(resolve(ROOT, 'adws/phases/reviewPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeReviewPhase(config);
  },
);

// ---------------------------------------------------------------------------
// W5: PR phase executed with config
// ---------------------------------------------------------------------------

When(
  'the PR phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executePRPhase } = await import(resolve(ROOT, 'adws/phases/prPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executePRPhase(config);
  },
);

// ---------------------------------------------------------------------------
// W6: auto-merge phase executed with config
// ---------------------------------------------------------------------------

When(
  'the auto-merge phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeAutoMergePhase } = await import(resolve(ROOT, 'adws/phases/autoMergePhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeAutoMergePhase(config);
  },
);

// ---------------------------------------------------------------------------
// W7: document phase executed with config
// ---------------------------------------------------------------------------

When(
  'the document phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeDocumentPhase } = await import(resolve(ROOT, 'adws/phases/documentPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeDocumentPhase(config);
  },
);

// ---------------------------------------------------------------------------
// W8: install phase executed with config
// ---------------------------------------------------------------------------

When(
  'the install phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeInstallPhase } = await import(resolve(ROOT, 'adws/phases/installPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeInstallPhase(config);
  },
);

// ---------------------------------------------------------------------------
// W9: workflow initialised with config
// ---------------------------------------------------------------------------

When(
  'the workflow is initialised with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { initializeWorkflow } = await import(resolve(ROOT, 'adws/phases/workflowInit.ts'));
    const partialConfig = { mockGithubApiUrl: this.mockContext.serverUrl };
    await initializeWorkflow(partialConfig as Parameters<typeof initializeWorkflow>[0]);
  },
);

// ---------------------------------------------------------------------------
// W10: cron probe runs once
// ---------------------------------------------------------------------------

When(
  'the cron probe runs once',
  function (this: RegressionWorld) {
    const result = spawnSync(
      'bun',
      [resolve(ROOT, 'adws/adwSdlc.tsx'), '--cron'],
      {
        env: buildSubprocessEnv(this),
        encoding: 'utf-8',
        timeout: 30_000,
      },
    );
    this.lastExitCode = result.status ?? -1;
  },
);

// ---------------------------------------------------------------------------
// W11: webhook handler receives event for issue
// ---------------------------------------------------------------------------

When(
  'the webhook handler receives a {string} event for issue {int}',
  async function (this: RegressionWorld, eventType: string, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    // Simulate webhook delivery by POST-ing a synthetic payload to the SDLC
    // orchestrator. In the test harness this is routed through the mock server.
    const payload = JSON.stringify({ action: eventType, issue: { number: issueNumber } });
    await fetch(`${this.mockContext.serverUrl}/_mock/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues' },
      body: payload,
    });
  },
);

// ---------------------------------------------------------------------------
// W12: KPI phase executed with config
// ---------------------------------------------------------------------------

When(
  'the KPI phase is executed with config {string}',
  async function (this: RegressionWorld, _configLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');

    const { executeKpiPhase } = await import(resolve(ROOT, 'adws/phases/kpiPhase.ts'));
    const config = buildMockedWorkflowConfig(this, _configLabel);
    await executeKpiPhase(config);
  },
);

// ---------------------------------------------------------------------------
// Shared helper — builds a minimal mocked WorkflowConfig
// ---------------------------------------------------------------------------

function buildMockedWorkflowConfig(world: RegressionWorld, _label: string): Record<string, unknown> {
  return {
    mockGithubApiUrl: world.mockContext?.serverUrl ?? '',
    worktreePath: world.worktreePaths.values().next().value ?? process.cwd(),
    env: buildSubprocessEnv(world),
  };
}
