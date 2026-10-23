/**
 * Runs a feature-990 workflow as a real orchestrator process through the regression suite's subprocess harness: the
 * `gh` shadow answers the forge, the git mock turns fetch and push into no-ops, and the Claude CLI stub answers each
 * agent from the scenario's manifest, behind a wrapper that records every start. The device tools lead the process's
 * `PATH` as stand-ins (feature-990-devices.ts), so that a repository with platforms reaches no real SDK. What the process
 * posted is then handed to the recording tracker of feature-796, which the steps shared with feature-989 read, and the
 * workflow of feature-988's world is pointed at its adwId.
 */

import assert from 'assert';
import { mkdirSync, writeFileSync } from 'fs';
import { delimiter, dirname, join } from 'path';

import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import type { MockContext } from '../../../test/mocks/types.ts';
import { STUB_MANIFEST_MARKER } from '../../../test/mocks/stubMarker.ts';
import { harnessNameForStem, orchestratorArgv } from '../../regression/support/harnessOrchestrators.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { claimAdwId, claimIssue, requireHarness } from '../../regression/support/subprocessHarness.ts';
import { findRealBunx, harnessEnv, runThroughHarness } from '../../regression/support/subprocessRun.ts';

import { world796 } from '../../regression/step_definitions/feature-796.steps.ts';
import { s as state988 } from '../../regression/step_definitions/feature-988-world.ts';
import { writeDeviceTools } from './feature-990-devices.ts';
import { buildManifest } from './feature-990-manifest.ts';
import { writeScripts } from './feature-990-scripts.ts';
import { buildTarget } from './feature-990-target.ts';
import { BASE_BRANCH, requireScratch, requireWorkflowSetup, requireWorld, s, type RunRecord } from './feature-990-world.ts';
import { CLAUDE_CLI_STUB } from '../../regression/support/claudeCliStub.ts';

/**
 * A start that fails waits out the dev-server lifecycle's three 20 s probes, and a workflow that never gets its server
 * to start makes three starts: nine probes, three minutes, before it has done anything else. That outlasts the harness's
 * two-minute default.
 */
export const RUN_TIMEOUT_MS = 330_000;
export const STEP_TIMEOUT_MS = 340_000;

const ISSUE_AGE_MS = 60 * 60_000;

export async function describeWorkflow(orchestrator: string, issue: number, adwId = `throwaway${issue}-bdd990`): Promise<void> {
  const world = requireWorld();
  claimAdwId(world, adwId);
  claimIssue(world, issue);
  s.workflow = { orchestrator, harnessName: harnessNameForStem(orchestrator), issue, adwId };
  state988.workflow = { config: { adwId, issueNumber: issue } as unknown as WorkflowConfig, issueNumber: issue, adwId, worktreePath: '', logsDir: '' };
  await seedIssue(issue);
}

function requireMock(): MockContext {
  const { mockContext } = requireWorld();
  assert.ok(mockContext, 'Expected a Before hook to have set up the mock infrastructure');
  return mockContext;
}

async function seedIssue(issue: number): Promise<void> {
  const mockContext = requireMock();
  const aWhileAgo = new Date(Date.now() - ISSUE_AGE_MS).toISOString();
  await mockContext.setState({
    issues: {
      [String(issue)]: {
        number: issue,
        title: `Check the base branch before any work (${issue})`,
        state: 'open',
        body: 'A workflow checks the base branch before it does any work on an issue.',
        user: { login: 'test-user' },
        labels: [{ name: 'adw:feature' }],
        created_at: aWhileAgo,
        updated_at: aWhileAgo,
      },
    },
  });
  const world = requireWorld();
  world.harnessEnv = { ...world.harnessEnv, GH_HOST: mockContext.serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: mockContext.serverUrl };
}

/** What the process posted since the last run, handed to the tracker that `commentsOn` reads. */
function handPostedCommentsToTracker(issue: number): void {
  const posted = getMockServerState().comments[String(issue)] ?? [];
  const alreadyHanded = s.syncedComments.get(issue) ?? 0;
  posted.slice(alreadyHanded).forEach((comment) => {
    const body = (comment as { body?: unknown }).body;
    world796().activeCallLog.push({ operation: 'commentOnIssue', args: [issue, typeof body === 'string' ? body : ''] });
  });
  s.syncedComments.set(issue, posted.length);
}

export async function runWorkflow(): Promise<RunRecord> {
  const workflow = requireWorkflowSetup();
  const world = requireWorld();
  const harness = requireHarness(world);
  const scratch = requireScratch();

  buildTarget();
  writeScripts(scratch, { stubPath: CLAUDE_CLI_STUB, requiresServer: s.requiresServer, scenarios: s.scenarios, buildFailure: s.buildFailure });
  const deviceTools = writeDeviceTools(scratch);
  const { manifest, payloads } = buildManifest(workflow.issue, workflow.adwId, scratch.answersDir);
  payloads.forEach((contents, file) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  });
  writeFileSync(join(harness.targetReposDir, STUB_MANIFEST_MARKER), JSON.stringify(manifest));

  const startedAt = Date.now();
  const result = await runThroughHarness(
    world,
    {
      command: findRealBunx(),
      args: ['tsx', ...orchestratorArgv(workflow.harnessName, workflow.adwId, workflow.issue, SURFACE_REPO)],
      timeoutMs: RUN_TIMEOUT_MS,
      label: `The "${workflow.orchestrator}" orchestrator`,
      env: { CLAUDE_CODE_PATH: scratch.recorderScript, PATH: [deviceTools, harnessEnv(world, harness).PATH].filter(Boolean).join(delimiter) },
    },
    { recordsExitCode: true, defaultBranch: BASE_BRANCH },
  );
  const record: RunRecord = { exitCode: result.exitCode, output: result.output, startedAt, endedAt: Date.now() };
  s.runs.push(record);
  handPostedCommentsToTracker(workflow.issue);
  return record;
}
