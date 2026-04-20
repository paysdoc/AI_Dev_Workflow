/**
 * Git Agent - Branch name generation and commit operations via Claude skills.
 * Uses /generate_branch_name and /commit slash commands from .claude/commands/
 */

import * as path from 'path';
import { GitHubIssue, IssueClassSlashCommand, log, getModelForCommand, getEffortForCommand, commitPrefixMap } from '../core';
import { generateBranchName, validateSlug } from '../vcs/branchOperations';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';

/**
 * Formats structured args for the /generate_branch_name skill.
 * The prompt now accepts only the issue JSON — the issueClass is no longer
 * passed because the LLM no longer assembles the prefix.
 */
export function formatBranchNameArgs(
  issueClass: IssueClassSlashCommand,
  issue: GitHubIssue
): string[] {
  void issueClass;
  return [JSON.stringify(issue)];
}

/**
 * Extracts the raw slug from the agent's output.
 * The skill returns ONLY the slug — strips whitespace and backticks.
 */
export function extractSlugFromOutput(output: string): string {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  const rawSlug = lines[lines.length - 1].trim().replace(/^`+|`+$/g, '');
  return validateSlug(rawSlug);
}

/** @deprecated Use extractSlugFromOutput. Kept as an alias until all callers are updated. */
export const extractBranchNameFromOutput = extractSlugFromOutput;

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
    getEffortForCommand('/generate_branch_name', issue.body),
    undefined,
    statePath,
  );

  const slug = extractSlugFromOutput(result.output);
  const branchName = generateBranchName(issue.number, slug, issueType);
  log(`Branch name generated: ${branchName}`, 'success');

  return { ...result, branchName };
}

/**
 * Maps an issueClass slash command to a clean commit keyword.
 * e.g., '/feature' -> 'feat', '/bug' -> 'fix'
 */
export function mapIssueClassToKeyword(issueClass: string): string {
  const mapped = commitPrefixMap[issueClass as IssueClassSlashCommand];
  if (mapped) {
    return mapped.replace(/:$/, '');
  }
  return issueClass.replace(/^\//, '');
}

/**
 * Builds the commit message prefix from agent name and issue class.
 * e.g., ('build-agent', '/feature') -> 'build-agent: feat'
 */
export function buildCommitPrefix(agentName: string, issueClass: string): string {
  const keyword = mapIssueClassToKeyword(issueClass);
  return `${agentName}: ${keyword}`;
}

/**
 * Formats structured args for the /commit skill.
 */
export function formatCommitArgs(
  agentName: string,
  issueClass: string,
  issueContext: string
): string[] {
  const prefix = buildCommitPrefix(agentName, issueClass);
  return [prefix, issueContext];
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
 * Validates that a commit message starts with the expected prefix.
 * If not, strips any malformed prefix and prepends the correct one.
 */
export function validateCommitMessage(message: string, expectedPrefix: string): string {
  const trimmed = message.trim();
  const expectedStart = `${expectedPrefix}: `;

  if (trimmed.startsWith(expectedStart)) {
    return trimmed;
  }

  // Strip known malformed prefix patterns:
  // - /feature: feat: msg  -> msg (two-segment prefix)
  // - /bug: #126: msg      -> msg (two-segment prefix)
  // - agent: keyword: msg  -> msg (wrong agent/keyword, two-segment)
  // - feat: msg            -> msg (single-segment prefix)
  // Try two-segment first, then single-segment
  let stripped = trimmed.replace(/^[\w/.-]+:\s*[\w#.-]+:\s*/, '');
  if (stripped === trimmed) {
    stripped = trimmed.replace(/^[\w/.-]+:\s*/, '');
  }

  // If stripping removed nothing, the message is just a description
  const description = stripped || trimmed;

  return `${expectedPrefix}: ${description}`;
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
    getEffortForCommand('/commit', issueBody),
    undefined,
    statePath,
    cwd
  );

  if (!result.success) {
    throw new Error(`Commit agent '${agentName}' failed: ${result.output.slice(0, 200)}`);
  }

  const rawMessage = extractCommitMessageFromOutput(result.output);
  const expectedPrefix = buildCommitPrefix(agentName, issueClass);
  const commitMessage = validateCommitMessage(rawMessage, expectedPrefix);
  log(`Commit message: ${commitMessage}`, 'success');

  return { ...result, commitMessage };
}
