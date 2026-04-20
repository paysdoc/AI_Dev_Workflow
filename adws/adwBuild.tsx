#!/usr/bin/env bunx tsx
/**
 * ADW Build - AI Developer Workflow Implementation Phase
 *
 * Usage: bunx tsx adws/adwBuild.tsx <github-issueNumber> [adw-id] [--issue-type <type>] [--cwd <path>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Verify plan file exists at specs/issue-{number}-plan.md
 * 3. Build Phase: run build agent, commit implementation
 * 4. Finalize: update state, post completion comment
 *
 * Prerequisites:
 * - Plan file must exist at specs/issue-{number}-plan.md in the worktree
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import * as path from 'path';
import * as fs from 'fs';
import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, log } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executeBuildPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import { getPlanFilePath } from './agents';
import { acquireOrchestratorLock, releaseOrchestratorLock } from './phases/orchestratorLock';

/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType, cwd } = parseOrchestratorArguments(args, {
    scriptName: 'adwBuild.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>] [--cwd <path>]',
    supportsCwd: true,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Build, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
    cwd: cwd || undefined,
  });

  // Verify plan file exists before starting — must remain before acquire
  const planPath = path.join(config.worktreePath, getPlanFilePath(issueNumber, config.worktreePath));
  if (!fs.existsSync(planPath)) {
    handleWorkflowError(config, `Plan file not found at ${planPath}. Run adwPlan.tsx first to generate the plan.`);
  }

  if (!acquireOrchestratorLock(config)) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase, 'install');
    await runPhase(config, tracker, executeBuildPhase, 'build');

    await completeWorkflow(config, tracker.totalCostUsd, {}, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  } finally {
    releaseOrchestratorLock(config);
  }
}

main();
