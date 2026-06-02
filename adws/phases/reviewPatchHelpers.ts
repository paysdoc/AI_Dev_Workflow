import {
  log,
  AgentStateManager,
  emptyModelUsageMap,
  mergeModelUsageMaps,
  type ModelUsageMap,
} from '../core';
import { runPatchAgent } from '../agents/patchAgent';
import { runRefactorAgent } from '../agents/refactorAgent';
import { runBuildAgent } from '../agents/buildAgent';
import type { ReviewIssue } from '../agents/reviewAgent';
import type { WorkflowConfig } from './workflowInit';

export interface PatchCtx {
  adwId: string;
  logsDir: string;
  specFile: string;
  worktreePath: string;
  issue: WorkflowConfig['issue'];
  orchestratorStatePath: string;
}

export interface RefactorCtx {
  adwId: string;
  logsDir: string;
  worktreePath: string;
  issue: WorkflowConfig['issue'];
  orchestratorStatePath: string;
}

export async function applyPatchBlocker(
  blocker: ReviewIssue,
  ctx: PatchCtx,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { adwId, logsDir, specFile, worktreePath, issue, orchestratorStatePath } = ctx;

  log(`Patching blocker #${blocker.reviewIssueNumber}: ${blocker.issueDescription}`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Patching blocker #${blocker.reviewIssueNumber}`);

  const patchStatePath = AgentStateManager.initializeState(adwId, 'patch-agent', orchestratorStatePath);
  const patchResult = await runPatchAgent(adwId, blocker, logsDir, specFile, undefined, patchStatePath, worktreePath, issue.body);

  let costUsd = patchResult.totalCostUsd || 0;
  let modelUsage = patchResult.modelUsage ?? emptyModelUsageMap();

  const patchMsg = patchResult.success
    ? `Patched blocker #${blocker.reviewIssueNumber}`
    : `Patch failed for blocker #${blocker.reviewIssueNumber}`;
  log(patchMsg, patchResult.success ? 'success' : 'error');
  AgentStateManager.appendLog(orchestratorStatePath, patchMsg);

  if (patchResult.success) {
    const buildStatePath = AgentStateManager.initializeState(adwId, 'build-agent', orchestratorStatePath);
    const buildResult = await runBuildAgent(issue, logsDir, patchResult.output, undefined, buildStatePath, worktreePath);

    costUsd += buildResult.totalCostUsd || 0;
    if (buildResult.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, buildResult.modelUsage);
    }

    const buildMsg = buildResult.success
      ? `Built patch for blocker #${blocker.reviewIssueNumber}`
      : `Build failed for blocker #${blocker.reviewIssueNumber}`;
    log(buildMsg, buildResult.success ? 'success' : 'error');
    AgentStateManager.appendLog(orchestratorStatePath, buildMsg);
  }

  return { costUsd, modelUsage };
}

export async function applyRefactorBlockers(
  blockers: ReviewIssue[],
  ctx: RefactorCtx,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { adwId, logsDir, worktreePath, issue, orchestratorStatePath } = ctx;
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  // Reviewer is contracted to consolidate violations into one blocker; if more
  // than one arrives, process each in sequence as a defensive measure.
  if (blockers.length > 1) {
    log(`Warning: ${blockers.length} refactor blockers received; expected 1 consolidated blocker`, 'warn');
  }

  for (const blocker of blockers) {
    log(`Refactoring blocker #${blocker.reviewIssueNumber}: ${blocker.issueDescription}`, 'info');
    AgentStateManager.appendLog(orchestratorStatePath, `Refactoring blocker #${blocker.reviewIssueNumber}`);

    const refactorStatePath = AgentStateManager.initializeState(adwId, 'refactor-agent', orchestratorStatePath);
    const refactorResult = await runRefactorAgent(adwId, blocker, logsDir, refactorStatePath, worktreePath, issue.body);

    costUsd += refactorResult.totalCostUsd || 0;
    if (refactorResult.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, refactorResult.modelUsage);
    }

    const refactorMsg = refactorResult.success
      ? `Refactored blocker #${blocker.reviewIssueNumber}`
      : `Refactor failed for blocker #${blocker.reviewIssueNumber}`;
    log(refactorMsg, refactorResult.success ? 'success' : 'error');
    AgentStateManager.appendLog(orchestratorStatePath, refactorMsg);

    const buildStatePath = AgentStateManager.initializeState(adwId, 'build-agent', orchestratorStatePath);
    const buildResult = await runBuildAgent(issue, logsDir, refactorResult.output, undefined, buildStatePath, worktreePath);

    costUsd += buildResult.totalCostUsd || 0;
    if (buildResult.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, buildResult.modelUsage);
    }

    const buildMsg = buildResult.success
      ? `Built refactor for blocker #${blocker.reviewIssueNumber}`
      : `Build failed after refactor for blocker #${blocker.reviewIssueNumber}`;
    log(buildMsg, buildResult.success ? 'success' : 'error');
    AgentStateManager.appendLog(orchestratorStatePath, buildMsg);
  }

  return { costUsd, modelUsage };
}
