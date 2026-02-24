#!/usr/bin/env npx tsx
/**
 * ADW Plan - AI Developer Workflow Planning Phase
 *
 * Usage: npx tsx adws/adwPlan.tsx <github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]
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

import { type IssueClassSlashCommand, persistTokenCounts, parseTargetRepoArgs } from './core';
import {
  initializeWorkflow,
  executePlanPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';

/**
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/adwPlan.tsx <github-issueNumber> [adw-id] [--cwd <path>] [--issue-type <type>]');
  console.error('');
  console.error('Options:');
  console.error('  --cwd <path>         Working directory for git operations (worktree path)');
  console.error('  --issue-type <type>  Pre-classified issue type (skips classification step)');
  console.error('                       Valid values: /feature, /bug, /chore, /pr_review');
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
  providedAdwId: string | null;
  cwd: string | null;
  providedIssueType: IssueClassSlashCommand | null;
} {
  if (args.length < 1) {
    printUsageAndExit();
  }

  // Parse --cwd option
  let cwd: string | null = null;
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1 && args[cwdIndex + 1]) {
    cwd = args[cwdIndex + 1];
    args.splice(cwdIndex, 2);
  }

  // Parse --issue-type option
  let providedIssueType: IssueClassSlashCommand | null = null;
  const issueTypeIndex = args.indexOf('--issue-type');
  if (issueTypeIndex !== -1 && args[issueTypeIndex + 1]) {
    const typeValue = args[issueTypeIndex + 1];
    const validTypes: IssueClassSlashCommand[] = ['/feature', '/bug', '/chore', '/pr_review'];
    if (validTypes.includes(typeValue as IssueClassSlashCommand)) {
      providedIssueType = typeValue as IssueClassSlashCommand;
    } else {
      console.error(`Invalid issue type: ${typeValue}. Valid values: ${validTypes.join(', ')}`);
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
 * Main planning workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, providedAdwId, cwd, providedIssueType } = parseArguments(args);
  const adwId = providedAdwId || null;

  const config = await initializeWorkflow(issueNumber, adwId, 'plan-orchestrator', {
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
