/**
 * Proof publish phase: harvests BDD screenshots, uploads to R2, and posts
 * a proof comment to the pull request.
 *
 * Non-fatal — any error is logged and swallowed; the workflow continues.
 */

import { log, emptyModelUsageMap, type ModelUsageMap } from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { extractPrNumber } from '../adwBuildHelpers';
import { getRepoInfo } from '../github/githubApi';
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

  try {
    const scenarioProof = ctx.scenarioProof;
    const prNumber = extractPrNumber(ctx.prUrl);

    const repoInfo = repoContext?.repoId ?? getRepoInfo();

    await publishPrProof({
      artifactsDir: scenarioProof?.artifactsDir,
      scenarioProof,
      prNumber,
      repoInfo,
      adwId,
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
