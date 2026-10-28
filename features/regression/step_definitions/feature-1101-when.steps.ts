/**
 * The Whens of the in-process feature-1101 scenarios: the merge orchestrator runs once, for real, over the real git repository
 * the Givens built (feature-1100-run.ts); and the recovery of a parked workflow, where the retry handler is the production one
 * and the resumed SDLC run is stood in for by its effects on `origin` and in the state file. The real resumed run is the
 * subprocess scenario's.
 */

import { When } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { handleRetryDirective, type RetryHandlerDeps } from '../../../adws/triggers/retryHandler.ts';
import { runMergeOrchestrator } from '../../regression/step_definitions/feature-1100-run.ts';
import { branchTipOnOrigin, commitOnBranch } from './feature-1101-repo.ts';
import { fixPathFor } from './feature-1101-standin.ts';
import { assertNamesThe, requireWorkflow } from './feature-1101-world.ts';

const RE_ARMED = 'phase_timeout';

/** A re-arm of a human-gated park writes the state and spawns nothing: the cron's next poll takes the workflow over. */
function retryDeps(): RetryHandlerDeps {
  const spawnsNothing = (): never => {
    throw new Error('Expected a "## Retry" on a human-gated workflow to re-arm it without spawning, locking or commenting');
  };
  return {
    readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    findPauseQueueEntry: spawnsNothing,
    removeFromPauseQueue: spawnsNothing,
    acquireIssueSpawnLock: spawnsNothing,
    releaseIssueSpawnLock: spawnsNothing,
    spawnDetached: spawnsNothing,
    postStageComment: spawnsNothing,
    targetRepoArgs: [],
  };
}

When('adwMerge runs for the workflow {string}', { timeout: 180_000 }, async function (adwId: string) {
  const workflow = requireWorkflow();
  assertNamesThe('adwId', workflow.adwId, adwId);
  workflow.runs.push({ branchTipBefore: branchTipOnOrigin(workflow) });
  await runMergeOrchestrator(workflow);
});

When(
  '{string} resumes the workflow {string}, whose resumed run pushes a fix for the scenario {string} to the branch {string} and ends at {string}',
  function (directive: string, adwId: string, scenario: string, branch: string, endStage: string) {
    const workflow = requireWorkflow();
    assertNamesThe('adwId', workflow.adwId, adwId);
    assertNamesThe('head branch', workflow.headBranch, branch);

    const issueComments = workflow.forge.comments.filter((comment) => comment.issueNumber === workflow.issueNumber);
    const rearmed = handleRetryDirective(workflow.issueNumber, [...issueComments, { body: directive }], retryDeps());
    assert.ok(rearmed, `Expected "${directive}" to re-arm the workflow "${adwId}", but the retry handler did nothing`);
    assert.strictEqual(AgentStateManager.readTopLevelState(adwId)?.workflowStage, RE_ARMED, `Expected "${directive}" to leave the workflow at "${RE_ARMED}"`);

    commitOnBranch(workflow.repo, branch, { [fixPathFor(scenario)]: `The fix for "${scenario}".\n` }, `Fix the scenario ${scenario}`);
    AgentStateManager.writeTopLevelState(adwId, { workflowStage: endStage });
  },
);
