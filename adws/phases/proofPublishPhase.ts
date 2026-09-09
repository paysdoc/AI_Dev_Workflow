/**
 * Proof publish phase: harvests BDD screenshots, uploads to R2, and posts
 * a proof comment to the pull request.
 *
 * Non-fatal — any error is logged and swallowed; the workflow continues.
 */

import { log, emptyModelUsageMap, type ModelUsageMap } from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { extractPrNumber } from '../adwBuildHelpers';
import { publishPrProof } from '../proof/prProofPublisher';
import type { WorkflowConfig } from './workflowInit';

/**
 * Executes the proof publish phase: posts a BDD proof comment to the PR
 * with a JUnit summary and any harvested screenshot URLs.
 *
 * Returns immediately with zero cost when ctx.scenarioProof or ctx.prUrl are absent.
 */
export async function executeProofPublishPhase(
  config: WorkflowConfig,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { adwId, issueNumber, orchestratorStatePath, ctx, repoContext } = config;
  const phaseStartTime = Date.now();
  const modelUsage = emptyModelUsageMap();

  log('Phase: Proof Publish', 'info');

  if (!repoContext) {
    log('Proof publish phase: no repo context — skipping proof comment', 'info');
    return { costUsd: 0, modelUsage, phaseCostRecords: [] };
  }

  try {
    const scenarioProof = ctx.scenarioProof;
    const prNumber = extractPrNumber(ctx.prUrl);

    await publishPrProof({
      artifactsDir: scenarioProof?.artifactsDir,
      scenarioProof,
      prNumber,
      repoInfo: repoContext.repoId,
      adwId,
      commenter: (n, body) => repoContext.codeHost.commentOnPullRequest(n, body),
    });
  } catch (err) {
    log(`Proof publish phase: unexpected error — ${err}`, 'warn');
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'proofPublish',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  void orchestratorStatePath;

  return { costUsd: 0, modelUsage, phaseCostRecords };
}
