#!/usr/bin/env npx tsx
/**
 * ADW Plan, Build, Test & Review - Plan+Build+Test+PR+Review Orchestrator
 *
 * Usage: npx tsx adws/adwPlanBuildTestReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase: classify issue, create branch, run plan agent, commit plan
 * 3. Build Phase: run build agent, commit implementation
 * 4. Test Phase: run unit tests with retry, run E2E tests with retry
 * 5. PR Phase: create pull request (only if all tests pass)
 * 6. Review Phase: review implementation against spec, patch blockers, retry
 * 7. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { type IssueClassSlashCommand, VALID_ISSUE_TYPES, mergeModelUsageMaps, persistTokenCounts, parseTargetRepoArgs } from './core';
import {
  initializeWorkflow,
  executePlanPhase,
  executeBuildPhase,
  executeTestPhase,
  executePRPhase,
  executeReviewPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';

/**
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/adwPlanBuildTestReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]');
  console.error('');
  console.error('This orchestrator runs the complete Plan+Build+Test+PR+Review workflow.');
  console.error('');
  console.error('Options:');
  console.error('  --issue-type <type>  Pre-classified issue type (skips classification step)');
  console.error(`                       Valid values: ${VALID_ISSUE_TYPES.join(', ')}`);
  console.error('');
  console.error('Environment Requirements:');
  console.error('  ANTHROPIC_API_KEY           - Anthropic API key');
  console.error('  CLAUDE_CODE_PATH            - Path to Claude CLI (default: /usr/local/bin/claude)');
  console.error('  GITHUB_PAT                  - (Optional) GitHub Personal Access Token');
  console.error('  MAX_TEST_RETRY_ATTEMPTS     - Maximum retry attempts for tests (default: 5)');
  console.error('  MAX_REVIEW_RETRY_ATTEMPTS   - Maximum retry attempts for review (default: 3)');
  process.exit(1);
}

/**
 * Parses and validates command line arguments.
 */
function parseArguments(args: string[]): {
  issueNumber: number;
  adwId: string | null;
  providedIssueType: IssueClassSlashCommand | null;
} {
  if (args.length < 1) {
    printUsageAndExit();
  }

  // Parse --issue-type option
  let providedIssueType: IssueClassSlashCommand | null = null;
  const issueTypeIndex = args.indexOf('--issue-type');
  if (issueTypeIndex !== -1 && args[issueTypeIndex + 1]) {
    const typeValue = args[issueTypeIndex + 1];
    if (VALID_ISSUE_TYPES.includes(typeValue as IssueClassSlashCommand)) {
      providedIssueType = typeValue as IssueClassSlashCommand;
    } else {
      console.error(`Invalid issue type: ${typeValue}. Valid values: ${VALID_ISSUE_TYPES.join(', ')}`);
      process.exit(1);
    }
    args.splice(issueTypeIndex, 2);
  }

  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${args[0]}`);
    process.exit(1);
  }

  const adwId = args[1] || null;

  return { issueNumber, adwId, providedIssueType };
}

/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseArguments(args);

  const config = await initializeWorkflow(issueNumber, adwId, 'plan-build-test-review-orchestrator', {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
  });

  let totalCostUsd = 0;
  let totalModelUsage = {};

  try {
    const planResult = await executePlanPhase(config);
    totalCostUsd += planResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, planResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);

    const buildResult = await executeBuildPhase(config);
    totalCostUsd += buildResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, buildResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);

    const testResult = await executeTestPhase(config);
    totalCostUsd += testResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, testResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);

    const prResult = await executePRPhase(config);
    totalCostUsd += prResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, prResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);

    const reviewResult = await executeReviewPhase(config);
    totalCostUsd += reviewResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, reviewResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);

    await completeWorkflow(config, totalCostUsd, {
      unitTestsPassed: testResult.unitTestsPassed,
      e2eTestsPassed: testResult.e2eTestsPassed,
      totalTestRetries: testResult.totalRetries,
      reviewPassed: reviewResult.reviewPassed,
      totalReviewRetries: reviewResult.totalRetries,
    }, totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
}

main();
