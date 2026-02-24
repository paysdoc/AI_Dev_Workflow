#!/usr/bin/env npx tsx
/**
 * ADW Patch - AI Developer Workflow Direct Patch
 *
 * Usage: npx tsx adws/adwPatch.tsx <issueNumber> [adw-id] [--cwd <path>]
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
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/adwPatch.tsx <issueNumber> [adw-id] [--cwd <path>]');
  console.error('');
  console.error('Creates a direct patch from a GitHub issue without a full plan cycle.');
  console.error('');
  console.error('Options:');
  console.error('  --cwd <path>  Working directory for patch operations (worktree path)');
  console.error('');
  console.error('Environment Requirements:');
  console.error('  ANTHROPIC_API_KEY  - Anthropic API key');
  console.error('  CLAUDE_CODE_PATH   - Path to Claude CLI (default: /usr/local/bin/claude)');
  console.error('  GITHUB_PAT         - (Optional) GitHub Personal Access Token');
  process.exit(1);
}

/**
 * Parses and validates command line arguments.
 */
function parseArguments(args: string[]): {
  issueNumber: number;
  adwId: string | null;
  cwd: string | null;
} {
  if (args.includes('--help') || args.includes('-h')) {
    printUsageAndExit();
  }

  // Parse --cwd option
  let cwd: string | null = null;
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1 && args[cwdIndex + 1]) {
    cwd = args[cwdIndex + 1];
    args.splice(cwdIndex, 2);
  }

  if (args.length < 1) {
    printUsageAndExit();
  }

  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${args[0]}`);
    process.exit(1);
  }

  const adwId = args[1] || null;

  return { issueNumber, adwId, cwd };
}

/**
 * Main patch workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  parseTargetRepoArgs(args);
  const { issueNumber, adwId: providedAdwId, cwd } = parseArguments(args);

  // Fetch issue
  log('Fetching GitHub issue...', 'info');
  const issue = await fetchGitHubIssue(issueNumber);
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

  const orchestratorStatePath = AgentStateManager.initializeState(adwId, 'patch-orchestrator');

  const initialState: Partial<AgentState> = {
    adwId,
    issueNumber,
    branchName,
    agentName: 'patch-orchestrator',
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
    await runCommitAgent('patch-orchestrator', issueType, JSON.stringify(issue), logsDir, undefined, cwd || undefined);
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
