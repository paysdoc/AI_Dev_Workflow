/**
 * Document phase execution for workflows.
 * Uses the /document skill via a Claude agent.
 */

import {
  log,
  AgentStateManager,
  type ModelUsageMap,
  emptyModelUsageMap,
} from '../core';
import {
  postWorkflowComment,
  pushBranch,
} from '../github';
import {
  getPlanFilePath,
  runDocumentAgent,
  runCommitAgent,
} from '../agents';
import type { WorkflowConfig } from './workflowLifecycle';

/**
 * Executes the Document phase: generate feature documentation.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 *
 * @param config - Workflow configuration
 * @param screenshotsDir - Optional directory containing review screenshots
 */
export async function executeDocumentPhase(
  config: WorkflowConfig,
  screenshotsDir?: string,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { orchestratorStatePath, adwId, issueNumber, issueType, issue, ctx, worktreePath, logsDir, repoInfo, branchName } = config;

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log('Phase: Document', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting document phase');

  postWorkflowComment(issueNumber, 'document_running', ctx, repoInfo);

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  const documentAgentStatePath = AgentStateManager.initializeState(adwId, 'document-agent', orchestratorStatePath);
  AgentStateManager.writeState(documentAgentStatePath, {
    adwId,
    issueNumber,
    agentName: 'document-agent',
    execution: AgentStateManager.createExecutionState('running'),
  });

  const result = await runDocumentAgent(
    adwId,
    logsDir,
    specFile,
    screenshotsDir,
    documentAgentStatePath,
    worktreePath,
    issue.body,
  );

  costUsd = result.totalCostUsd || 0;
  if (result.modelUsage) modelUsage = result.modelUsage;

  if (!result.success) {
    AgentStateManager.writeState(documentAgentStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        result.output,
      ),
    });
    const errorMsg = `Document Agent failed: ${result.output}`;
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    postWorkflowComment(issueNumber, 'document_failed', ctx, repoInfo);
    throw new Error(errorMsg);
  }

  AgentStateManager.writeState(documentAgentStatePath, {
    output: result.output.substring(0, 1000),
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState('running'),
      true,
    ),
  });

  // Commit documentation
  await runCommitAgent('document-agent', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);

  // Push documentation commit to remote
  pushBranch(branchName, worktreePath);

  AgentStateManager.appendLog(orchestratorStatePath, `Documentation created: ${result.docPath}`);
  postWorkflowComment(issueNumber, 'document_completed', ctx, repoInfo);
  log('Document phase completed', 'success');

  return { costUsd, modelUsage };
}
