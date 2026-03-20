#!/usr/bin/env bunx tsx
/**
 * ADW Plan & Build - Plan+Build+Test+PR Orchestrator (no review)
 *
 * Usage: bunx tsx adws/adwPlanBuild.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase: classify issue, create branch, run plan agent, commit plan
 * 3. Build Phase: run build agent, commit implementation
 * 4. Test Phase: optionally run unit tests (unit only)
 * 5. PR Phase: create pull request
 * 6. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import { mergeModelUsageMaps, persistTokenCounts, parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, computeDisplayTokens, RUNNING_TOKENS } from './core';
import {
  initializeWorkflow,
  executePlanPhase,
  executeBuildPhase,
  executeTestPhase,
  executePRPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import { commitPhasesCostData } from './phases/phaseCostCommit';

/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwPlanBuild.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.PlanBuild, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  let totalCostUsd = 0;
  let totalModelUsage = {};

  try {
    const planResult = await executePlanPhase(config);
    totalCostUsd += planResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, planResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, planResult.phaseCostRecords);

    config.totalModelUsage = totalModelUsage;
    const buildResult = await executeBuildPhase(config);
    totalCostUsd += buildResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, buildResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, buildResult.phaseCostRecords);

    config.totalModelUsage = totalModelUsage;
    const testResult = await executeTestPhase(config);
    totalCostUsd += testResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, testResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, testResult.phaseCostRecords);

    config.totalModelUsage = totalModelUsage;
    const prResult = await executePRPhase(config);
    totalCostUsd += prResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, prResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, prResult.phaseCostRecords);

    await completeWorkflow(config, totalCostUsd, {
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
    }, totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
}

main();
