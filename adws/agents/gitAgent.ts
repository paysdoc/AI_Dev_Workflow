/**
 * Git Agent - Branch name generation and commit operations via Claude skills.
 * Uses /generate_branch_name and /commit slash commands from .claude/commands/
 */

import * as path from 'path';
import { GitHubIssue, IssueClassSlashCommand, log, getModelForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';

/**
 * Formats structured args for the /generate_branch_name skill.
 */
export function formatBranchNameArgs(
  issueClass: IssueClassSlashCommand,
  issue: GitHubIssue
): string[] {
  return [issueClass, JSON.stringify(issue)];
}

/**
 * Validates and sanitizes a git branch name.
 * Strips invalid characters, enforces max length, and ensures the result is non-empty.
 */
export function validateBranchName(name: string): string {
  let sanitized = name.trim();

  // Remove characters invalid in git branch names or dangerous in shell contexts
  sanitized = sanitized.replace(/[~^:*?[\]@{}\\`]/g, '');
  sanitized = sanitized.replace(/\.\./g, '');
  sanitized = sanitized.replace(/\s+/g, '-');

  // Enforce max length of 100 characters, ensuring no trailing dash
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100).replace(/-$/, '');
  }

  if (!sanitized) {
    throw new Error('Branch name is empty after validation');
  }

  return sanitized;
}

/**
 * Extracts the branch name from the agent's output.
 * The skill returns ONLY the branch name.
 */
export function extractBranchNameFromOutput(output: string): string {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  const rawName = lines[lines.length - 1].trim().replace(/^`+|`+$/g, '');
  return validateBranchName(rawName);
}

/**
 * Runs the /generate_branch_name skill to generate a branch name.
 * This agent only generates the name string — it does NOT run any git operations.
 * Branch creation happens in the orchestrator via worktree operations.
 *
 * @param issueType - Issue classification slash command
 * @param issue - GitHub issue details
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory
 */
export async function runGenerateBranchNameAgent(
  issueType: IssueClassSlashCommand,
  issue: GitHubIssue,
  logsDir: string,
  statePath?: string,
): Promise<AgentResult & { branchName: string }> {
  const args = formatBranchNameArgs(issueType, issue);
  const outputFile = path.join(logsDir, 'branchName-agent.jsonl');

  log('Branch Name Agent starting:', 'info');
  log(`  Issue: #${issue.number} - ${issue.title}`, 'info');
  log(`  Issue type: ${issueType}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/generate_branch_name',
    args,
    'Branch Name',
    outputFile,
    getModelForCommand('/generate_branch_name', issue.body),
    undefined,
    statePath,
  );

  const branchName = extractBranchNameFromOutput(result.output);
  log(`Branch name generated: ${branchName}`, 'success');

  return { ...result, branchName };
}

/**
 * Formats structured args for the /commit skill.
 */
export function formatCommitArgs(
  agentName: string,
  issueClass: string,
  issueContext: string
): string[] {
  return [agentName, issueClass, issueContext];
}

/**
 * Extracts the commit message from the agent's output.
 * The skill returns ONLY the commit message.
 */
export function extractCommitMessageFromOutput(output: string): string {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  return lines[lines.length - 1].trim();
}

/**
 * Runs the /commit skill to stage and commit changes.
 *
 * @param agentName - Name of the agent making the commit
 * @param issueClass - Issue classification string
 * @param issueContext - Issue JSON or PR details JSON
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory (worktree path)
 */
export async function runCommitAgent(
  agentName: string,
  issueClass: string,
  issueContext: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult & { commitMessage: string }> {
  const args = formatCommitArgs(agentName, issueClass, issueContext);
  const outputFile = path.join(logsDir, 'commit-agent.jsonl');

  log('Commit Agent starting:', 'info');
  log(`  Agent name: ${agentName}`, 'info');
  log(`  Issue class: ${issueClass}`, 'info');
  if (cwd) log(`  CWD: ${cwd}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/commit',
    args,
    'Commit',
    outputFile,
    getModelForCommand('/commit', issueBody),
    undefined,
    statePath,
    cwd
  );

  const commitMessage = extractCommitMessageFromOutput(result.output);
  log(`Commit message: ${commitMessage}`, 'success');

  return { ...result, commitMessage };
}
