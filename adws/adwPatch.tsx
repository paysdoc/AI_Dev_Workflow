#!/usr/bin/env bunx tsx
/**
 * ADW Patch - AI Developer Workflow Direct Patch
 *
 * Usage: bunx tsx adws/adwPatch.tsx <issueNumber> [adw-id] [--cwd <path>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Patch Phase: generate patch plan using the /patch skill, write to spec file
 * 3. Build Phase: run build agent, commit implementation
 * 4. PR Phase: create pull request
 * 5. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import type { PhaseResult } from './core/phaseRunner';
import type { ModelUsageMap } from './cost';
import {
  initializeWorkflow,
  executeInstallPhase,
  executeBuildPhase,
  executePRPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import type { WorkflowConfig } from './phases';
import { runPatchAgent, getPlanFilePath, type ReviewIssue } from './agents';

/**
 * Executes the Patch planning phase: runs the /patch skill and writes output to the spec file.
 * This makes executeBuildPhase usable in the standard pipeline (it reads from the spec file).
 */
async function executePatchPhase(config: WorkflowConfig): Promise<PhaseResult> {
  const { adwId, issueNumber, issue, logsDir, worktreePath, orchestratorStatePath } = config;

  const reviewIssue: ReviewIssue = {
    reviewIssueNumber: issueNumber,
    screenshotPath: '',
    issueDescription: `${issue.title}\n\n${issue.body}`,
    issueResolution: `Resolve issue #${issueNumber} as described`,
    issueSeverity: 'blocker',
  };

  const specPath = getPlanFilePath(issueNumber, worktreePath);

  const patchResult = await runPatchAgent(
    adwId,
    reviewIssue,
    logsDir,
    specPath,
    undefined,
    orchestratorStatePath,
    worktreePath,
  );

  if (!patchResult.success) {
    throw new Error(`Patch Agent failed: ${patchResult.output}`);
  }

  // Write the patch plan to the spec file so executeBuildPhase can read it
  const fullSpecPath = path.join(worktreePath, specPath);
  fs.mkdirSync(path.dirname(fullSpecPath), { recursive: true });
  fs.writeFileSync(fullSpecPath, patchResult.output, 'utf-8');

  return {
    costUsd: patchResult.totalCostUsd ?? 0,
    modelUsage: (patchResult.modelUsage ?? {}) as ModelUsageMap,
  };
}

/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, cwd } = parseOrchestratorArguments(args, {
    scriptName: 'adwPatch.tsx',
    usagePattern: '<issueNumber> [adw-id] [--cwd <path>]',
    supportsIssueType: false,
    supportsCwd: true,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Patch, {
    targetRepo: targetRepo || undefined,
    repoId,
    cwd: cwd || undefined,
  });

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase, 'install');
    await runPhase(config, tracker, executePatchPhase, 'patch');
    await runPhase(config, tracker, executeBuildPhase, 'build');
    await runPhase(config, tracker, executePRPhase, 'pr');

    await completeWorkflow(config, tracker.totalCostUsd, {}, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
