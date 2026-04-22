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

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, log } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';

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
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Plan, {
    cwd: cwd || undefined,
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  if (!await runWithOrchestratorLifecycle(config, async () => {
    const tracker = new CostTracker();
    try {
      await runPhase(config, tracker, executeInstallPhase);
      await runPhase(config, tracker, executePlanPhase);
      await completeWorkflow(config, tracker.totalCostUsd, undefined, tracker.totalModelUsage);
    } catch (error) {
      handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
  })) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

main();
