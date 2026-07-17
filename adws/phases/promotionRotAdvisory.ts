/**
 * Promotion rot/reuse advisory.
 *
 * On a `regression-promotion` PR, runs the promote-regression-vocabulary
 * analysis over the promoted scenario's phrases and posts the per-phrase
 * reuse/rot verdicts as a single PR comment. Advisory only — it never
 * blocks, gates, or crashes the workflow; any failure degrades to a logged
 * warning.
 *
 * Split into two layers:
 *  - `runPromotionRotAdvisory` — pure orchestration over injected deps, no
 *    direct GitHub/agent I/O, so the production behaviour can be driven
 *    directly in tests without a full WorkflowConfig or a mock GitHub server.
 *  - `executePromotionRotAdvisory` — the WorkflowConfig-level adapter wired
 *    into the SDLC pipeline, which supplies real deps (the rot analysis
 *    agent, repoContext's PR commenter). Lives alongside reviewPhase.ts
 *    (re-exported from there) to keep reviewPhase.ts under the 300-line
 *    guideline; must run after executePRPhase since ctx.prUrl/ctx.prNumber
 *    do not exist earlier in the pipeline.
 */

import { log, emptyModelUsageMap, mergeModelUsageMaps, type ModelUsageMap, type LogLevel } from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { hasRegressionPromotionLabel } from '../github/labelManager';
import { extractPrNumber } from '../adwBuildHelpers';
import { parsePromotesMarker } from '../core/promotionReconcileLink';
import { runRotAnalysisAgent, type RotVerdict } from '../agents/rotAnalysisAgent';
import { formatRotAdvisoryComment } from './rotAdvisoryFormat';
import type { WorkflowConfig } from './workflowInit';

export interface PromotionRotAdvisoryContext {
  prNumber: number;
  labels: readonly { name: string }[];
  /** The promoted feature id (e.g. "feature-665") whose phrases are analysed. */
  feature: string;
}

export interface PromotionRotAdvisoryDeps {
  /** Runs the (fallible) reuse/rot analysis over the promoted feature's phrases. */
  analyze: (feature: string) => Promise<RotVerdict[]>;
  /** Posts the single advisory comment to the PR. */
  postComment: (prNumber: number, body: string) => void | Promise<void>;
  log?: (message: string, level?: LogLevel) => void;
}

/**
 * Runs the promotion rot/reuse advisory over the given context: gated on the
 * `regression-promotion` label, runs the injected analysis, formats one
 * comment, and posts it.
 *
 * Never throws. The label gate short-circuits before the analysis runs (an
 * ordinary PR incurs neither the comment nor the analysis cost). Any failure
 * once gated (analysis throw, comment-post error) degrades to a logged
 * warning with no comment posted — a fallible rot verdict must never block
 * the promotion.
 */
export async function runPromotionRotAdvisory(
  context: PromotionRotAdvisoryContext,
  deps: PromotionRotAdvisoryDeps,
): Promise<void> {
  const logger = deps.log ?? (() => { /* no-op */ });

  if (!hasRegressionPromotionLabel(context.labels)) {
    return;
  }

  try {
    const verdicts = await deps.analyze(context.feature);
    const body = formatRotAdvisoryComment(context.feature, verdicts);
    await deps.postComment(context.prNumber, body);
  } catch (err) {
    logger(`Promotion rot advisory: unexpected error — ${err}`, 'warn');
  }
}

/**
 * Executes the promotion rot/reuse advisory as a WorkflowConfig phase: on a
 * `regression-promotion` PR, runs the analysis and posts one PR comment.
 * Catch-total — always returns a valid zero/low-cost phase result and never
 * rejects, regardless of outcome.
 */
export async function executePromotionRotAdvisory(
  config: WorkflowConfig,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { adwId, issueNumber, issue, ctx, logsDir, worktreePath, repoContext } = config;
  const phaseStartTime = Date.now();
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log('Phase: Promotion Rot Advisory', 'info');

  const finish = (): { costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] } => ({
    costUsd,
    modelUsage,
    phaseCostRecords: createPhaseCostRecords({
      workflowId: adwId,
      issueNumber,
      phase: 'promotionRotAdvisory',
      status: PhaseCostStatus.Success,
      retryCount: 0,
      contextResetCount: 0,
      durationMs: Date.now() - phaseStartTime,
      modelUsage,
    }),
  });

  if (!hasRegressionPromotionLabel(issue.labels) || !repoContext) {
    return finish();
  }

  const prNumber = ctx.prNumber ?? extractPrNumber(ctx.prUrl);
  const feature = parsePromotesMarker(issue.body);

  if (!prNumber) {
    log('Promotion rot advisory: no PR number resolved — skipping', 'warn');
    return finish();
  }
  if (!feature) {
    log('Promotion rot advisory: no "Promotes:" marker found in issue body — skipping', 'warn');
    return finish();
  }

  try {
    await runPromotionRotAdvisory(
      { prNumber, labels: issue.labels, feature },
      {
        analyze: async (feat) => {
          const result = await runRotAnalysisAgent(feat, {
            logsDir,
            cwd: worktreePath,
            issueBody: issue.body,
            subprocessEnv: config.gitContext?.commandEnv(),
            phaseName: 'promotionRotAdvisory',
            launchContext: { selfHost: !repoContext, adwId },
          });
          costUsd += result.totalCostUsd || 0;
          modelUsage = mergeModelUsageMaps(modelUsage, result.modelUsage ?? emptyModelUsageMap());
          return result.parsed;
        },
        postComment: (n, body) => repoContext.codeHost.commentOnPullRequest(n, body),
        log,
      },
    );
  } catch (err) {
    log(`Promotion rot advisory: unexpected error — ${err}`, 'warn');
  }

  return finish();
}
