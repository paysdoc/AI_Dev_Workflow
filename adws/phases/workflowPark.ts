import { log, AgentStateManager } from '../core';
import { buildParkComment, type ParkEvidence } from '../forge/parkComment';
import type { WorkflowConfig } from './workflowInit';

type ParkConfig = Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext'>;

/** A comment that cannot be posted never stops the park: the state is what `## Retry` acts on. */
function postParkComment(config: ParkConfig, evidence: ParkEvidence): void {
  const { adwId, issueNumber, repoContext } = config;
  if (!repoContext) return;
  try {
    repoContext.issueTracker.commentOnIssue(issueNumber, buildParkComment(adwId, evidence));
  } catch (error) {
    log(`Failed to post the park comment on issue #${issueNumber}: ${error}`, 'error');
  }
}

/**
 * A deliberate stop that is neither a failure nor a pause: the workflow waits for a person, and `## Retry`
 * re-arms it. The board and the labels stay as they are, as with the other human-gated parks.
 */
export function parkWorkflow(config: ParkConfig, evidence: ParkEvidence): never {
  const message = `Workflow parked as human_gated: ${evidence.reason}`;
  log(message, 'warn');
  AgentStateManager.appendLog(config.orchestratorStatePath, message);
  // Written before the comment is posted: whoever sees the comment and then reads the state must find it.
  AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'human_gated' });
  postParkComment(config, evidence);
  process.exit(0);
}
