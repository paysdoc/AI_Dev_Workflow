import type { IssueTracker } from '@paysdoc/devplatform';
import { log, AgentStateManager } from '../core';
import { buildParkComment, parkStage, type ParkEvidence, type ParkStage } from '../forge/parkComment';
import type { AgentState } from '../types/agentTypes';
import type { WorkflowConfig } from './workflowInit';

/** What a park reads of a workflow: a full `WorkflowConfig` satisfies it, and so does what a run without one can assemble. */
export type ParkConfig = Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorStatePath'> & {
  readonly repoContext?: { readonly issueTracker: Pick<IssueTracker, 'commentOnIssue'> };
};

export interface ParkRecorder {
  writeTopLevelState(adwId: string, state: Partial<AgentState>): void;
  commentOnIssue(issueNumber: number, body: string): void;
}

/**
 * The park without the exit, for a caller whose run ends in its own way. The state is written before the comment is posted:
 * whoever sees the comment and then reads the state must find it. A comment that cannot be posted never stops the park, since
 * the state is what `## Retry` acts on.
 */
export function recordPark(adwId: string, issueNumber: number, evidence: ParkEvidence, recorder: ParkRecorder): ParkStage {
  const stage = parkStage(evidence.reason);
  log(`Workflow parked as ${stage}: ${evidence.reason}`, 'warn');
  recorder.writeTopLevelState(adwId, { workflowStage: stage, parkReason: evidence.reason });
  try {
    recorder.commentOnIssue(issueNumber, buildParkComment(adwId, evidence));
  } catch (error) {
    log(`Failed to post the park comment on issue #${issueNumber}: ${error}`, 'error');
  }
  return stage;
}

/**
 * A deliberate stop that is neither a failure nor a pause: the workflow waits for a person, and `## Retry`
 * re-arms it. The board and the labels stay as they are, as with the other human-gated parks.
 */
export function parkWorkflow(config: ParkConfig, evidence: ParkEvidence): never {
  const { adwId, issueNumber, orchestratorStatePath, repoContext } = config;
  AgentStateManager.appendLog(orchestratorStatePath, `Workflow parked as ${parkStage(evidence.reason)}: ${evidence.reason}`);
  recordPark(adwId, issueNumber, evidence, {
    writeTopLevelState: (id, state) => AgentStateManager.writeTopLevelState(id, state),
    commentOnIssue: (number, body) => repoContext?.issueTracker.commentOnIssue(number, body),
  });
  process.exit(0);
}
