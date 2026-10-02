/**
 * The workflow a scenario seeds, and the process that stands in for its orchestrator in each of
 * the states the rows need: died in `starting`, died holding the spawn lock, alive and still
 * starting up, alive and heartbeating, and the cron's own pid on the lock.
 *
 * The seeded workflow is what a run leaves in the top-level state, written through
 * `AgentStateManager.writeTopLevelState`, with the issue seeded in the recording tracker long
 * enough ago that the cron's grace period never applies.
 */

import { Given, When } from '@cucumber/cucumber';
import assert from 'assert';
import { Platform, type IssueComment, type RepoIdentifier } from '@paysdoc/devplatform';

import { splitRepo } from './feature-796.steps.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { acquireIssueSpawnLock, readSpawnLockRecord } from '../../../adws/triggers/spawnGate.ts';
import { requireBoundary, requireFixture, staleTimestamp } from './feature-932-world.ts';
import { fireOnceBetweenFilterAndDecision, useBenignGitContext } from './feature-959-boundary.ts';
import { recordStage, recordStarting, takeSpawnLock, tenMinutesAgo, type StartupShape } from './feature-959-orchestrator.ts';
import { killOrchestratorProcess, startOrchestratorProcess, type OrchestratorProcess } from './feature-959-processes.ts';
import { requireWorkflow, s, type Workflow } from './feature-959-world.ts';

const MINUTE_MS = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

function seedIssue(issueNumber: number, adwId: string): void {
  const fixture = requireFixture();
  fixture.issueCreatedAts.set(issueNumber, staleTimestamp());
  fixture.issueUpdatedAts.set(issueNumber, staleTimestamp());
  const comment: IssueComment = {
    id: `adw-id-comment-${adwId}`,
    body: `**ADW ID:** \`${adwId}\``,
    author: 'adw-bot[bot]',
    createdAt: staleTimestamp(),
  };
  fixture.issueComments.set(issueNumber, [...(fixture.issueComments.get(issueNumber) ?? []), comment]);
}

/** The process that stands in for the workflow's orchestrator; every one started is killed in `After`. */
async function standInOrchestrator(workflow: Workflow): Promise<OrchestratorProcess> {
  const owner = await startOrchestratorProcess();
  s.processes.push(owner);
  workflow.process = owner;
  return owner;
}

async function startingThenDies(workflow: Workflow, shape: StartupShape): Promise<void> {
  const owner = await standInOrchestrator(workflow);
  recordStarting(workflow, owner, shape);
  await killOrchestratorProcess(owner);
}

Given(
  'issue {int} has an ADW workflow under adwId {string} that runs {string}, whose last run stopped at {string} half an hour ago',
  function (issueNumber: number, adwId: string, script: string, stage: string) {
    const { repoId } = useBenignGitContext();
    seedIssue(issueNumber, adwId);
    const workflow: Workflow = {
      adwId,
      issueNumber,
      script,
      branchName: `bugfix-issue-${issueNumber}-fixture-959`,
      repoIdentity: { owner: repoId.owner, repo: repoId.repo },
      process: null,
    };
    s.workflows.set(adwId, workflow);
    s.usedAdwIds.add(adwId);
    s.issues.add(issueNumber);

    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber,
      workflowStage: stage,
      orchestratorScript: script,
      repoIdentity: workflow.repoIdentity,
      branchName: workflow.branchName,
      lastSeenAt: minutesAgo(30),
      phases: { plan: { status: 'completed', startedAt: minutesAgo(35), completedAt: minutesAgo(31) } },
    });
  },
);

Given(
  'a relaunched orchestrator for workflow {string} recorded "starting" and died before its first phase',
  async function (adwId: string) {
    await startingThenDies(requireWorkflow(adwId), 'fixed');
  },
);

When(
  'the orchestrator the cron relaunched for workflow {string} records "starting" exactly as #935\'s relaunched orchestrator did, and dies before its first phase',
  async function (adwId: string) {
    await startingThenDies(requireWorkflow(adwId), 'as-935');
  },
);

Given(
  'the orchestrator of workflow {string} died at workflowStage {string} ten minutes ago, leaving the issue\'s spawn lock behind',
  async function (adwId: string, stage: string) {
    const workflow = requireWorkflow(adwId);
    const owner = await standInOrchestrator(workflow);
    recordStarting(workflow, owner, 'fixed');
    recordStage(workflow, stage, tenMinutesAgo());
    takeSpawnLock(requireBoundary().repoId, workflow, owner);
    await killOrchestratorProcess(owner);
  },
);

Given(
  'a relaunched orchestrator for workflow {string} is alive and still starting up, past recording "starting" but before its first phase',
  async function (adwId: string) {
    const workflow = requireWorkflow(adwId);
    recordStarting(workflow, await standInOrchestrator(workflow), 'fixed');
  },
);

Given(
  'a relaunched orchestrator for workflow {string} is alive and records "starting" between the cron\'s filtering of the issue and its takeover decision',
  async function (adwId: string) {
    const workflow = requireWorkflow(adwId);
    const owner = await standInOrchestrator(workflow);
    fireOnceBetweenFilterAndDecision(() => recordStarting(workflow, owner, 'fixed'));
  },
);

Given(
  'the orchestrator of workflow {string} is alive at workflowStage {string}, holding the issue\'s spawn lock and heartbeating',
  async function (adwId: string, stage: string) {
    const workflow = requireWorkflow(adwId);
    const owner = await standInOrchestrator(workflow);
    recordStarting(workflow, owner, 'fixed');
    recordStage(workflow, stage, new Date());
    takeSpawnLock(requireBoundary().repoId, workflow, owner);
  },
);

Given(
  'the cron\'s own process holds the spawn lock for issue {int} in the repository {string}',
  function (issueNumber: number, repoFullName: string) {
    const repoId: RepoIdentifier = { ...splitRepo(repoFullName), platform: Platform.GitHub };
    s.issues.add(issueNumber);
    // A poll that took a workflow over has already left this lock under this pid, so the step must be idempotent.
    if (readSpawnLockRecord(repoId, issueNumber)?.pid === process.pid) return;
    assert.ok(
      acquireIssueSpawnLock(repoId, issueNumber, process.pid),
      `Expected the cron's own process to take the spawn lock for ${repoFullName}#${issueNumber}`,
    );
  },
);
