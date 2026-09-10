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
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  getPlanFilePath,
  runDocumentAgent,
  runCommitAgent,
} from '../agents';
import type { WorkflowConfig } from './workflowInit';
import { executeDocsPostWriteSelfCheck, buildDefaultDocsSelfCheckDeps } from './docsSelfCheck';
import { requireWorkflowGitContext } from './workflowRepoIdentity';

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
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { orchestratorStatePath, adwId, issueNumber, issueType, issue, ctx, worktreePath, logsDir, repoContext, branchName } = config;
  const phaseStartTime = Date.now();
  const gitCtx = requireWorkflowGitContext(config);

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log('Phase: Document', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting document phase');

  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'document_running', ctx);
  }

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
    gitCtx.commandEnv(),
    { selfHost: !repoContext, adwId, gitContext: gitCtx },
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
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'document_failed', ctx);
    }
    throw new Error(errorMsg);
  }

  AgentStateManager.writeState(documentAgentStatePath, {
    output: result.output.substring(0, 1000),
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState('running'),
      true,
    ),
  });

  // Post-write self-check — non-fatal; never fails the document phase. Skipped
  // (not ad-hoc constructed) when no repoContext is available, matching how the
  // other migrated phases handle a missing boundary-minted provider set.
  if (repoContext) {
    try {
      const selfCheck = executeDocsPostWriteSelfCheck(
        { worktreePath, producedDocPaths: [result.docPath] },
        buildDefaultDocsSelfCheckDeps(repoContext.issueTracker),
      );
      AgentStateManager.appendLog(
        orchestratorStatePath,
        `Docs self-check: ${selfCheck.flags.bloat.length} bloat, ${selfCheck.flags.regrowth.length} regrowth flag(s); routed ${selfCheck.routed.length} refactor follow-up(s)`,
      );
    } catch (e) {
      log(`Docs post-write self-check failed (non-fatal): ${e}`, 'warn');
    }
  }

  // Commit documentation
  await runCommitAgent('document-agent', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body, gitCtx.commandEnv(), { selfHost: !repoContext, adwId, gitContext: gitCtx });

  // Push documentation commit to remote
  gitCtx.pushBranch(branchName, worktreePath);

  AgentStateManager.appendLog(orchestratorStatePath, `Documentation created: ${result.docPath}`);
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'document_completed', ctx);
  }
  log('Document phase completed', 'success');

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'document',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
