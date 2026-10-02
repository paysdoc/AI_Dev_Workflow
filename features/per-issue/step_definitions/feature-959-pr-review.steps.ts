/**
 * The PR-review row. `adwPrReview.tsx` needs a live code host, so the PR review here is this
 * process: the step runs the real `initializePRReviewWorkflow` against the recording boundary, then
 * holds the lifecycle the script wraps its phases in (spawn lock and heartbeat) until `After` ends
 * it. The PR review reuses the issue's adwId, so what the SDLC run left in the state is exactly what
 * the real startup finds and has to replace.
 *
 * The recorded owner is this process, so `lastSeenAt` must stay fresh: the poll's hung-orchestrator
 * sweep SIGKILLs a live owner whose heartbeat is stale, and that owner would be the test run.
 */

import { Given } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { runWithOrchestratorLifecycle } from '../../../adws/phases/orchestratorLock.ts';
import { initializePRReviewWorkflow } from '../../../adws/phases/prReviewPhase.ts';
import { requireFixture } from './feature-932-world.ts';
import { useBenignGitContext } from './feature-959-boundary.ts';
import { recordStage } from './feature-959-orchestrator.ts';
import { killOrchestratorProcess, startOrchestratorProcess } from './feature-959-processes.ts';
import { requireWorkflow, s } from './feature-959-world.ts';

Given('the SDLC run of workflow {string} has exited, leaving its pid in the state', async function (adwId: string) {
  requireWorkflow(adwId);
  const owner = await startOrchestratorProcess();
  s.processes.push(owner);
  await killOrchestratorProcess(owner);
  AgentStateManager.writeTopLevelState(adwId, { pid: owner.pid, pidStartedAt: owner.startToken });
});

Given(
  'a PR review of workflow {string} has started up on the issue\'s pull request and has stood at workflowStage {string} for ten minutes',
  async function (adwId: string, stage: string) {
    const workflow = requireWorkflow(adwId);
    const boundary = useBenignGitContext();
    const prNumber = workflow.issueNumber;
    const fixture = requireFixture();
    fixture.prByBranch.set(workflow.branchName, { number: prNumber, state: 'OPEN', sourceBranch: workflow.branchName, targetBranch: 'main', labels: [] });
    fixture.prLinkedIssue.set(prNumber, workflow.issueNumber);

    // The seeded plan phase keeps the empty comment list from exiting, and the fixture's PR state defaults to OPEN.
    const config = await initializePRReviewWorkflow(prNumber, adwId, boundary);
    // adwPrReview.tsx's own top-level write, which follows the startup.
    AgentStateManager.writeTopLevelState(adwId, { orchestratorScript: 'adws/adwPrReview.tsx' });

    // The lock is free here, so a refusal resolves the lifecycle with false at once and fails the step.
    let signalStarted: (started: boolean) => void = () => {};
    const started = new Promise<boolean>((resolve) => { signalStarted = resolve; });
    const lifecycle = runWithOrchestratorLifecycle(config.base, () => {
      signalStarted(true);
      return new Promise<void>((resolve) => { s.releasePrReview = resolve; });
    });
    s.prReview = lifecycle;
    assert.ok(await Promise.race([started, lifecycle]), `Expected the PR review of workflow ${adwId} to take the issue's spawn lock`);

    recordStage(workflow, stage, new Date());
  },
);
