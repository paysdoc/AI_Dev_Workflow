#!/usr/bin/env bunx tsx
/**
 * ADW PR Review - AI Developer Workflow for PR Review Comments
 *
 * Usage: bunx tsx adws/adwPrReview.tsx <pr-number>
 *
 * Workflow:
 * 1. Initialize: fetch PR details, detect unaddressed comments, setup worktree, initialize state
 * 2. Plan Phase: read existing plan, run PR review plan agent
 * 3. Build Phase: run PR review build agent to implement revision plan
 * 4. Test Phase: run unit tests with retry, run E2E tests with retry
 * 5. Finalize: commit and push changes, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseTargetRepoArgs, buildRepoIdentifier, RUNNING_TOKENS, AgentStateManager, log } from './core';
import { RateLimitError } from './types/agentTypes';
import { mergeModelUsageMaps, persistTokenCounts, computeDisplayTokens, type ModelUsageMap } from './cost';
import {
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  executeStepDefPhase,
} from './workflowPhases';
import { runInstallAgent } from './agents';
import { extractInstallContext } from './phases';
import type { WorkflowConfig } from './phases';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const repoInfo = targetRepo ? { owner: targetRepo.owner, repo: targetRepo.repo } : undefined;
  const repoId = buildRepoIdentifier(targetRepo);

  if (args.length < 1) {
    console.error('Usage: bunx tsx adws/adwPrReview.tsx <pr-number>');
    process.exit(1);
  }

  const prNumber = parseInt(args[0], 10);
  if (isNaN(prNumber)) {
    console.error(`Invalid PR number: ${args[0]}`);
    process.exit(1);
  }

  const config = await initializePRReviewWorkflow(prNumber, null, repoInfo, repoId, targetRepo ?? undefined);

  let totalCostUsd = 0;
  let totalModelUsage: ModelUsageMap = {};

  try {
    // Run install phase inline (PRReviewWorkflowConfig is not compatible with executeInstallPhase)
    try {
      const installAgentStatePath = AgentStateManager.initializeState(config.adwId, 'install-agent', config.orchestratorStatePath);
      const installResult = await runInstallAgent(config.prNumber, config.adwId, config.logsDir, installAgentStatePath, config.worktreePath, config.prDetails.body);
      if (installResult.success) {
        const jsonlPath = path.join(config.logsDir, 'install-agent.jsonl');
        const contextString = extractInstallContext(jsonlPath);
        if (contextString) {
          const cacheDir = path.join('agents', config.adwId);
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(path.join(cacheDir, 'install_cache.md'), contextString, 'utf-8');
          config.installContext = contextString;
        }
        totalCostUsd += installResult.totalCostUsd ?? 0;
        if (installResult.modelUsage) totalModelUsage = mergeModelUsageMaps(totalModelUsage, installResult.modelUsage);
        persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
      }
    } catch (installError) {
      const msg = installError instanceof Error ? installError.message : String(installError);
      AgentStateManager.appendLog(config.orchestratorStatePath, `Install phase error (non-fatal): ${msg}`);
    }

    const planResult = await executePRReviewPlanPhase(config);
    totalCostUsd += planResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, planResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    config.totalModelUsage = totalModelUsage;
    const buildResult = await executePRReviewBuildPhase(config, planResult.planOutput);
    totalCostUsd += buildResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, buildResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    try {
      const stepDefConfig = {
        orchestratorStatePath: config.orchestratorStatePath,
        adwId: config.adwId,
        issueNumber: config.issueNumber ?? config.prNumber,
        issue: { body: config.prDetails.body },
        worktreePath: config.worktreePath,
        logsDir: config.logsDir,
        installContext: config.installContext,
        ctx: {},
        topLevelStatePath: '',
      } as unknown as WorkflowConfig;
      const stepDefResult = await executeStepDefPhase(stepDefConfig);
      totalCostUsd += stepDefResult.costUsd;
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, stepDefResult.modelUsage);
      persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    } catch (stepDefError) {
      const msg = stepDefError instanceof Error ? stepDefError.message : String(stepDefError);
      AgentStateManager.appendLog(config.orchestratorStatePath, `Step def phase error (non-fatal): ${msg}`);
    }

    config.totalModelUsage = totalModelUsage;
    const testResult = await executePRReviewTestPhase(config);
    totalCostUsd += testResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, testResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    await completePRReviewWorkflow(config, totalModelUsage);
  } catch (error) {
    if (error instanceof RateLimitError) {
      log(`PR Review workflow rate-limited at '${error.phaseName}'. Manual restart required once limit clears.`, 'warn');
      persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
      process.exit(0);
    }
    handlePRReviewWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
}

main();
