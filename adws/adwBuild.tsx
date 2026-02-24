#!/usr/bin/env npx tsx
/**
 * ADW Build - AI Developer Workflow Implementation Phase
 *
 * Usage: npx tsx adws/adwBuild.tsx <github-issueNumber> [adw-id]
 *
 * Workflow:
 * 1. Fetch GitHub issue details
 * 2. Verify plan file exists
 * 3. Infer issue type from current branch
 * 4. Run Build Agent: Implement the solution
 * 5. Commit the implementation
 * 6. Create PR with full context
 *
 * Prerequisites:
 * - Must be on a feature/bugfix/chore branch created by adwPlan.tsx
 * - Plan file must exist at specs/issue-{number}.md
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  log,
  setLogAdwId,
  generateAdwId,
  ensureLogsDirectory,
  IssueClassSlashCommand,
  AgentStateManager,
  AgentState,
  shouldExecuteStage,
  hasUncommittedChanges,
  getNextStage,
  persistTokenCounts,
  parseTargetRepoArgs,
} from './core';
import {
  fetchGitHubIssue,
  postWorkflowComment,
  WorkflowContext,
  detectRecoveryState,
  getCurrentBranch,
  inferIssueTypeFromBranch,
} from './github';
import {
  runBuildAgent,
  runCommitAgent,
  getPlanFilePath,
  planFileExists,
  ProgressCallback,
  ProgressInfo,
} from './agents';
import { parseArguments, printBuildSummary } from './adwBuildHelpers';

// Re-export for any external consumers
export { printUsageAndExit, parseArguments, printBuildSummary } from './adwBuildHelpers';

/**
 * Main build workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, providedAdwId, cwd } = parseArguments(args);

  log(`Starting ADW Build workflow`, 'info');
  log(`Issue: #${issueNumber}`, 'info');
  if (cwd) {
    log(`Working directory: ${cwd}`, 'info');
  }

  // Step 1: Fetch GitHub issue
  log('Fetching GitHub issue...', 'info');
  const issue = await fetchGitHubIssue(issueNumber);
  log(`Fetched issue: ${issue.title}`, 'success');

  // Step 2: Determine ADW ID
  const adwId = providedAdwId || generateAdwId(issue.title);
  setLogAdwId(adwId);
  const logsDir = ensureLogsDirectory(adwId);
  log(`ADW ID: ${adwId}`, 'info');
  log(`Logs: ${logsDir}`, 'info');

  // Step 3: Verify current branch and plan file
  const branchName = getCurrentBranch(cwd || undefined);
  log(`Current branch: ${branchName}`, 'info');

  const planPath = getPlanFilePath(issueNumber, cwd || undefined);
  if (!planFileExists(issueNumber, cwd || undefined)) {
    log(`Plan file not found: ${planPath}`, 'error');
    log('Run adwPlan.tsx first to generate the plan.', 'error');
    process.exit(1);
  }

  // Read plan content
  const fullPlanPath = cwd ? path.join(cwd, planPath) : planPath;
  let planContent: string;
  try {
    planContent = fs.readFileSync(fullPlanPath, 'utf-8');
    log(`Plan loaded from: ${fullPlanPath}`, 'success');
  } catch (error) {
    log(`Cannot read plan file at ${fullPlanPath}: ${error}`, 'error');
    process.exit(1);
  }

  // Step 4: Infer issue type from branch name
  const issueType: IssueClassSlashCommand = inferIssueTypeFromBranch(branchName);
  log(`Issue type (from branch): ${issueType}`, 'info');

  // Initialize orchestrator state
  const orchestratorStatePath = AgentStateManager.initializeState(adwId, 'build-orchestrator');
  log(`State: ${orchestratorStatePath}`, 'info');

  const initialState: Partial<AgentState> = {
    adwId,
    issueNumber,
    branchName,
    issueClass: issueType,
    planFile: planPath,
    agentName: 'build-orchestrator',
    execution: AgentStateManager.createExecutionState('running'),
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, `Starting ADW Build workflow for issue #${issueNumber}`);

  // Detect recovery state from existing comments
  const recoveryState = detectRecoveryState(issue.comments);

  // Initialize workflow context
  const ctx: WorkflowContext = {
    issueNumber,
    adwId,
    branchName,
    planPath,
    issueType,
  };

  // Handle recovery mode
  if (recoveryState.canResume && recoveryState.lastCompletedStage) {
    log(`Recovery mode active: last completed stage was '${recoveryState.lastCompletedStage}'`, 'info');

    if (hasUncommittedChanges()) {
      log('Warning: There are uncommitted changes in the working directory', 'info');
    }

    if (recoveryState.prUrl) ctx.prUrl = recoveryState.prUrl;

    const nextStage = getNextStage(recoveryState.lastCompletedStage);
    ctx.resumeFrom = nextStage;
    postWorkflowComment(issueNumber, 'resuming', ctx);
  }

  try {
    let buildCostUsd = 0;

    // Step 5: Run Build Agent
    if (shouldExecuteStage('implemented', recoveryState)) {
      postWorkflowComment(issueNumber, 'implementing', ctx);
      log('Running Build Agent...', 'info');

      const buildAgentStatePath = AgentStateManager.initializeState(adwId, 'build-agent', orchestratorStatePath);
      AgentStateManager.writeState(buildAgentStatePath, {
        adwId,
        issueNumber,
        branchName,
        planFile: planPath,
        issueClass: issueType,
        agentName: 'build-agent',
        parentAgent: 'build-orchestrator',
        execution: AgentStateManager.createExecutionState('running'),
      });

      // Track progress and post periodic updates
      let lastProgressUpdate = Date.now();
      const PROGRESS_UPDATE_INTERVAL_MS = 60000;

      const buildProgressCallback: ProgressCallback = (info: ProgressInfo) => {
        ctx.buildProgress = {
          turnCount: info.turnCount || 0,
          toolCount: info.toolCount || 0,
          lastToolName: info.toolName,
          lastText: info.text,
        };

        if (info.type === 'tool_use') {
          log(`  [Turn ${info.turnCount}] Tool: ${info.toolName}`, 'info');
        }

        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL_MS) {
          postWorkflowComment(issueNumber, 'build_progress', ctx);
          lastProgressUpdate = now;
        }
      };

      const buildResult = await runBuildAgent(issue, logsDir, planContent, buildProgressCallback, buildAgentStatePath);

      if (!buildResult.success) {
        AgentStateManager.writeState(buildAgentStatePath, {
          execution: AgentStateManager.completeExecution(
            AgentStateManager.createExecutionState('running'),
            false,
            buildResult.output
          ),
        });
        throw new Error(`Build Agent failed: ${buildResult.output}`);
      }

      AgentStateManager.writeState(buildAgentStatePath, {
        output: buildResult.output.substring(0, 1000),
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          true
        ),
      });

      AgentStateManager.appendLog(orchestratorStatePath, 'Build completed');

      ctx.buildOutput = buildResult.output;
      buildCostUsd = buildResult.totalCostUsd || 0;
      persistTokenCounts(orchestratorStatePath, buildCostUsd, buildResult.modelUsage ?? {});
      postWorkflowComment(issueNumber, 'implemented', ctx);
    } else {
      log('Skipping Build Agent (already completed)', 'info');
    }

    // Step 6: Commit implementation
    if (shouldExecuteStage('implementation_committing', recoveryState)) {
      postWorkflowComment(issueNumber, 'implementation_committing', ctx);
      await runCommitAgent('build-orchestrator', issueType, JSON.stringify(issue), logsDir, undefined, cwd || undefined);
    } else {
      log('Skipping implementation commit (already completed)', 'info');
    }

    // Note: PR creation and workflow completion are handled by adwPlanBuildTest.tsx
    // after tests pass successfully

    // Update final orchestrator state
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true
      ),
      metadata: {
        totalCostUsd: buildCostUsd,
      },
    });
    AgentStateManager.appendLog(orchestratorStatePath, 'Build phase completed successfully');

    // Print summary (no PR URL - PR is created by orchestrator after tests pass)
    printBuildSummary(
      issueNumber,
      issue.title,
      branchName,
      logsDir,
      '',
      buildCostUsd
    );

  } catch (error) {
    ctx.errorMessage = String(error);
    postWorkflowComment(issueNumber, 'error', ctx);

    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        String(error)
      ),
    });
    AgentStateManager.appendLog(orchestratorStatePath, `Build workflow failed: ${error}`);

    log(`Build workflow failed: ${error}`, 'error');
    process.exit(1);
  }
}

main();
