#!/usr/bin/env bunx tsx
/**
 * ADW Plan - AI Developer Workflow Planning Phase
 *
 * Usage: bunx tsx adws/adwPlan.tsx <github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase: classify issue, create branch, run plan agent, commit plan
 * 3. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import { persistTokenCounts, parseTargetRepoArgs, parseOrchestratorArguments, OrchestratorId } from './core';
import {
  initializeWorkflow,
  executePlanPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';

/**
 * Main planning workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, cwd, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwPlan.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]',
  });

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Plan, {
    cwd: cwd || undefined,
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
  });

  try {
    const planResult = await executePlanPhase(config);
    persistTokenCounts(config.orchestratorStatePath, planResult.costUsd, planResult.modelUsage);
    await completeWorkflow(config, planResult.costUsd, undefined, planResult.modelUsage);
  } catch (error) {
    handleWorkflowError(config, error);
  }
}

main();
