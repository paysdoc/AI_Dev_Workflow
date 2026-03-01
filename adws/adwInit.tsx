#!/usr/bin/env npx tsx
/**
 * ADW Init - Initialize .adw/ Project Configuration
 *
 * Usage: npx tsx adws/adwInit.tsx <github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state
 * 2. Run /adw_init slash command to generate .adw/ config files
 * 3. Commit the generated files
 * 4. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import { type IssueClassSlashCommand, VALID_ISSUE_TYPES, persistTokenCounts, parseTargetRepoArgs, log, type ModelUsageMap, emptyModelUsageMap, mergeModelUsageMaps } from './core';
import { runClaudeAgentWithCommand } from './agents/claudeAgent';
import { commitChanges } from './github';
import {
  initializeWorkflow,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';

/**
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/adwInit.tsx <github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]');
  console.error('');
  console.error('Options:');
  console.error('  --cwd <path>         Working directory for git operations (worktree path)');
  console.error('  --issue-type <type>  Pre-classified issue type (skips classification step)');
  console.error(`                       Valid values: ${VALID_ISSUE_TYPES.join(', ')}`);
  process.exit(1);
}

/**
 * Parses and validates command line arguments.
 */
function parseArguments(args: string[]): {
  issueNumber: number;
  providedAdwId: string | null;
  cwd: string | null;
  providedIssueType: IssueClassSlashCommand | null;
} {
  if (args.length < 1) {
    printUsageAndExit();
  }

  let cwd: string | null = null;
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1 && args[cwdIndex + 1]) {
    cwd = args[cwdIndex + 1];
    args.splice(cwdIndex, 2);
  }

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

  const providedAdwId = args[1] || null;

  return { issueNumber, providedAdwId, cwd, providedIssueType };
}

/**
 * Main ADW init workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, providedAdwId, cwd, providedIssueType } = parseArguments(args);
  const adwId = providedAdwId || null;

  const config = await initializeWorkflow(issueNumber, adwId, 'init-orchestrator', {
    cwd: cwd || undefined,
    issueType: providedIssueType || '/chore',
    targetRepo: targetRepo || undefined,
  });

  let totalModelUsage: ModelUsageMap = emptyModelUsageMap();
  let totalCostUsd = 0;

  try {
    // Run the /adw_init slash command
    log('Phase: ADW Init', 'info');
    const issueJson = JSON.stringify({
      number: config.issue.number,
      title: config.issue.title,
      body: config.issue.body,
    });

    const result = await runClaudeAgentWithCommand(
      '/adw_init',
      `${config.issueNumber} ${config.adwId} ${issueJson}`,
      'adw-init',
      `${config.logsDir}/adw-init.jsonl`,
      'sonnet',
      undefined, // onProgress
      undefined, // statePath
      config.worktreePath,
    );

    if (result.modelUsage) {
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, result.modelUsage);
    }
    totalCostUsd += result.totalCostUsd ?? 0;

    if (!result.success) {
      throw new Error('ADW init command failed');
    }

    log('ADW init completed, committing files...', 'info');

    // Commit the generated .adw/ files
    commitChanges(
      'chore: initialize .adw/ project configuration',
      config.worktreePath,
    );

    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    await completeWorkflow(config, totalCostUsd, undefined, totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
}

main();
