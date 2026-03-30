#!/usr/bin/env bunx tsx
/**
 * ADW Init - Initialize .adw/ Project Configuration
 *
 * Usage: bunx tsx adws/adwInit.tsx <github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state
 * 2. Run /adw_init slash command to generate .adw/ config files
 * 3. Commit the generated files
 * 4. PR Phase: create pull request
 * 5. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, log, OrchestratorId } from './core';
import { createPhaseCostRecords, PhaseCostStatus } from './cost';
import { CostTracker, runPhase, type PhaseResult } from './core/phaseRunner';
import { runClaudeAgentWithCommand, RateLimitError } from './agents/claudeAgent';
import { commitChanges } from './vcs';
import {
  type WorkflowConfig,
  initializeWorkflow,
  executePRPhase,
  completeWorkflow,
  handleWorkflowError,
  handleRateLimitPause,
  copyTargetSkillsAndCommands,
} from './workflowPhases';

async function executeInitPhase(config: WorkflowConfig): Promise<PhaseResult> {
  log('Phase: ADW Init', 'info');
  const issueJson = JSON.stringify({
    number: config.issue.number,
    title: config.issue.title,
    body: config.issue.body,
  });

  const result = await runClaudeAgentWithCommand(
    '/adw_init',
    [String(config.issueNumber), config.adwId, issueJson],
    'adw-init',
    `${config.logsDir}/adw-init.jsonl`,
    'sonnet',
    undefined, // effort
    undefined, // onProgress
    undefined, // statePath
    config.worktreePath, // cwd - run in target repo worktree
  );

  if (!result.success) {
    throw new Error('ADW init command failed');
  }

  log('ADW init completed, copying target skills and commands...', 'info');
  copyTargetSkillsAndCommands(config.worktreePath);

  log('Committing files...', 'info');
  commitChanges(
    'chore: initialize .adw/ config with target skills and commands',
    config.worktreePath,
  );

  const costUsd = result.totalCostUsd ?? 0;
  const modelUsage = result.modelUsage ?? {};
  const phaseCostRecords = createPhaseCostRecords({
    workflowId: config.adwId,
    issueNumber: config.issueNumber,
    phase: 'init',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: 0,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}

/**
 * Main ADW init workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, cwd, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwInit.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]',
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Init, {
    cwd: cwd || undefined,
    issueType: providedIssueType || '/chore',
    targetRepo: targetRepo || undefined,
    repoId,
  });

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInitPhase, 'init');
    log('Phase: PR Creation', 'info');
    await runPhase(config, tracker, executePRPhase, 'pr');
    await completeWorkflow(config, tracker.totalCostUsd, undefined, tracker.totalModelUsage);
  } catch (error) {
    if (error instanceof RateLimitError) {
      handleRateLimitPause(config, 'init', 'rate_limited', tracker.totalCostUsd, tracker.totalModelUsage);
    }
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
