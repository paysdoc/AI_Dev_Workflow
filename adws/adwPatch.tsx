#!/usr/bin/env bunx tsx
/**
 * ADW Patch - AI Developer Workflow Direct Patch
 *
 * Usage: bunx tsx adws/adwPatch.tsx <issueNumber> [adw-id] [--cwd <path>]
 *
 * Workflow:
 * 1. Fetch GitHub issue
 * 2. Generate a patch plan using the /patch skill
 * 3. Implement the patch using the build agent
 * 4. Commit changes
 * 5. Create pull request
 *
 * This is a streamlined workflow for direct patches from issues,
 * skipping the full planning cycle.
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import {
  log,
  setLogAdwId,
  generateAdwId,
  ensureLogsDirectory,
  AgentStateManager,
  type AgentState,
  mergeModelUsageMaps,
  persistTokenCounts,
  parseTargetRepoArgs,
  parseOrchestratorArguments,
  OrchestratorId,
} from './core';
import {
  fetchGitHubIssue,
  getCurrentBranch,
  inferIssueTypeFromBranch,
} from './github';
import {
  runPatchAgent,
  runBuildAgent,
  runCommitAgent,
  runPullRequestAgent,
  getPlanFilePath,
  type ReviewIssue,
} from './agents';

/**
 * Main patch workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { owner, repo } = parseTargetRepoArgs(args) || { owner: '', repo: '' };
  const { issueNumber, adwId: providedAdwId, cwd } = parseOrchestratorArguments(args, {
    scriptName: 'adwPatch.tsx',
    usagePattern: '<issueNumber> [adw-id] [--cwd <path>]',
    supportsIssueType: false,
  });

  // Fetch issue
  log('Fetching GitHub issue...', 'info');
  const issue = await fetchGitHubIssue(issueNumber, { owner, repo });
  log(`Fetched issue: ${issue.title}`, 'success');

  const adwId = providedAdwId || generateAdwId(issue.title);
  setLogAdwId(adwId);
  const logsDir = ensureLogsDirectory(adwId);
  const branchName = getCurrentBranch(cwd || undefined);
  const issueType = inferIssueTypeFromBranch(branchName);

  log('===================================', 'info');
  log('ADW Patch Workflow', 'info');
  log(`Issue: #${issueNumber} - ${issue.title}`, 'info');
  log(`ADW ID: ${adwId}`, 'info');
  log(`Branch: ${branchName}`, 'info');
  log(`Logs: ${logsDir}`, 'info');
  if (cwd) {
    log(`Working directory: ${cwd}`, 'info');
  }
  log('===================================', 'info');

  const orchestratorStatePath = AgentStateManager.initializeState(adwId, OrchestratorId.Patch);

  const initialState: Partial<AgentState> = {
    adwId,
    issueNumber,
    branchName,
    agentName: OrchestratorId.Patch,
    execution: AgentStateManager.createExecutionState('running'),
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, `Starting ADW Patch workflow for issue #${issueNumber}`);

  let totalCostUsd = 0;
  let totalModelUsage = {};

  try {
    // Step 1: Generate patch plan using the /patch skill
    log('Running Patch Agent...', 'info');
    const reviewIssue: ReviewIssue = {
      reviewIssueNumber: issueNumber,
      screenshotPath: '',
      issueDescription: `${issue.title}\n\n${issue.body}`,
      issueResolution: `Resolve issue #${issueNumber} as described`,
      issueSeverity: 'blocker',
    };

    const specPath = getPlanFilePath(issueNumber, cwd || undefined);

    const patchResult = await runPatchAgent(
      adwId,
      reviewIssue,
      logsDir,
      specPath,
      undefined,
      undefined,
      cwd || undefined,
    );

    totalCostUsd += patchResult.totalCostUsd || 0;
    if (patchResult.modelUsage) {
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, patchResult.modelUsage);
    }

    if (!patchResult.success) {
      throw new Error(`Patch Agent failed: ${patchResult.output}`);
    }

    AgentStateManager.appendLog(orchestratorStatePath, 'Patch plan created');
    persistTokenCounts(orchestratorStatePath, totalCostUsd, totalModelUsage);

    // Step 2: Implement the patch using the build agent
    log('Running Build Agent...', 'info');
    const buildResult = await runBuildAgent(issue, logsDir, patchResult.output, undefined, undefined, cwd || undefined);

    totalCostUsd += buildResult.totalCostUsd || 0;
    if (buildResult.modelUsage) {
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, buildResult.modelUsage);
    }

    if (!buildResult.success) {
      throw new Error(`Build Agent failed: ${buildResult.output}`);
    }

    AgentStateManager.appendLog(orchestratorStatePath, 'Patch implementation completed');
    persistTokenCounts(orchestratorStatePath, totalCostUsd, totalModelUsage);

    // Step 3: Commit changes
    log('Committing changes...', 'info');
    await runCommitAgent(OrchestratorId.Patch, issueType, JSON.stringify(issue), logsDir, undefined, cwd || undefined);
    AgentStateManager.appendLog(orchestratorStatePath, 'Changes committed');

    // Step 4: Create PR
    log('Creating Pull Request...', 'info');
    const planFile = getPlanFilePath(issueNumber, cwd || undefined);
    const prResult = await runPullRequestAgent(
      branchName,
      JSON.stringify(issue),
      planFile,
      adwId,
      logsDir,
      undefined,
      cwd || undefined,
    );

    totalCostUsd += prResult.totalCostUsd || 0;
    if (prResult.modelUsage) {
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, prResult.modelUsage);
    }
    persistTokenCounts(orchestratorStatePath, totalCostUsd, totalModelUsage);

    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true,
      ),
      metadata: { totalCostUsd, prUrl: prResult.prUrl },
    });
    AgentStateManager.appendLog(orchestratorStatePath, 'Patch workflow completed successfully');

    log('===================================', 'info');
    log('ADW Patch workflow completed!', 'success');
    log(`Issue: #${issueNumber} - ${issue.title}`, 'info');
    log(`ADW ID: ${adwId}`, 'info');
    if (prResult.prUrl) {
      log(`PR: ${prResult.prUrl}`, 'info');
    }
    log(`Logs: ${logsDir}`, 'info');
    if (totalCostUsd > 0) {
      log(`Cost: $${totalCostUsd.toFixed(4)}`, 'info');
    }
    log('===================================', 'info');
  } catch (error) {
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        String(error),
      ),
    });
    AgentStateManager.appendLog(orchestratorStatePath, `Patch workflow failed: ${error}`);
    log(`Patch workflow failed: ${error}`, 'error');
    process.exit(1);
  }
}

main();
