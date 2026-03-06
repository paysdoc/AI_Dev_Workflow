/**
 * Plan Agent - Generates implementation plans from GitHub issues.
 * Uses slash commands from .claude/commands/ for consistent prompt templates.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GitHubIssue, IssueClassSlashCommand, PRDetails, PRReviewComment, getModelForCommand, getEffortForCommand, log } from '../core';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';
import { isAdwComment, extractActionableContent } from '../github/workflowCommentsBase';

/**
 * Formats issue context as arguments for plan commands.
 * Filters out ADW bot comments and surfaces actionable comment content prominently.
 */
export function formatIssueContextAsArgs(issue: GitHubIssue): string {
  const humanComments = issue.comments.filter(c => !isAdwComment(c.body));

  const latestActionableContent = [...issue.comments]
    .reverse()
    .reduce<string | null>((found, c) => found ?? extractActionableContent(c.body), null);

  const commentsSection = humanComments.length > 0
    ? humanComments
        .map(c => `**${c.author.login}** (${c.createdAt}):\n${c.body}`)
        .join('\n\n---\n\n')
    : 'No comments.';

  const actionableSection = latestActionableContent
    ? `\n\n### Actionable Comment\n${latestActionableContent}`
    : '';

  return `## GitHub Issue #${issue.number}
**Title:** ${issue.title}
**State:** ${issue.state}
**Author:** ${issue.author.login}
**Labels:** ${issue.labels.map(l => l.name).join(', ') || 'none'}
**Created:** ${issue.createdAt}

### Description
${issue.body || 'No description provided.'}${actionableSection}

### Comments
${commentsSection}`;
}

/**
 * Finds the actual plan file path for an issue.
 * Plan files follow the naming convention: issue-{number}-adw-{adwId}-sdlc_planner-{descriptiveName}.md
 * Falls back to legacy naming: issue-{number}-plan.md
 */
function findPlanFile(issueNumber: number, worktreePath?: string): string | null {
  const specsDir = worktreePath ? path.join(worktreePath, 'specs') : 'specs';

  try {
    const files = fs.readdirSync(specsDir);

    // Look for new naming convention: issue-{number}-adw-{adwId}-sdlc_planner-*.md
    for (const file of files) {
      const pattern = new RegExp(`^issue-${issueNumber}-adw-.*-sdlc_planner-.*\\.md$`);
      if (pattern.test(file)) {
        return path.join('specs', file);
      }
    }

    // Fall back to legacy naming: issue-{number}-plan.md
    const legacyPath = `specs/issue-${issueNumber}-plan.md`;
    const fullLegacyPath = worktreePath ? path.join(worktreePath, legacyPath) : legacyPath;
    try {
      fs.statSync(fullLegacyPath);
      return legacyPath;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Gets the path to the plan file for an issue.
 * Returns the actual plan file path if it exists, otherwise returns the legacy path.
 * @param issueNumber - The issue number to find the plan file for
 * @param worktreePath - Optional worktree path to locate the plan file in.
 */
export function getPlanFilePath(issueNumber: number, worktreePath?: string): string {
  const foundPath = findPlanFile(issueNumber, worktreePath);
  if (foundPath) {
    return foundPath;
  }
  // Fall back to legacy naming if no file is found
  return `specs/issue-${issueNumber}-plan.md`;
}

/**
 * Checks if the plan file exists for an issue.
 * Returns true if the file exists and has content.
 * @param issueNumber - The issue number to check for
 * @param worktreePath - Optional worktree path to locate the plan file in.
 */
export function planFileExists(issueNumber: number, worktreePath?: string): boolean {
  const planPath = getPlanFilePath(issueNumber, worktreePath);
  const fullPath = worktreePath ? path.join(worktreePath, planPath) : planPath;
  try {
    const stats = fs.statSync(fullPath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * Reads the plan file content for an issue.
 * Returns the file content string on success, or null on any error.
 * @param issueNumber - The issue number to read the plan for
 * @param worktreePath - Optional worktree path to locate the plan file in.
 */
export function readPlanFile(issueNumber: number, worktreePath?: string): string | null {
  const planPath = getPlanFilePath(issueNumber, worktreePath);
  const fullPath = worktreePath ? path.join(worktreePath, planPath) : planPath;
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Detects and corrects plan files with swapped issueNumber/adwId in the filename.
 * The plan agent sometimes swaps $1 (issueNumber) and $2 (adwId), producing
 * `issue-{adwId}-adw-{issueNumber}-...` instead of `issue-{issueNumber}-adw-{adwId}-...`.
 * This function detects and renames such files to the correct convention.
 *
 * @returns The corrected relative path if a rename was performed, or null if no correction was needed.
 */
export function correctPlanFileNaming(issueNumber: number, worktreePath?: string): string | null {
  const specsDir = worktreePath ? path.join(worktreePath, 'specs') : 'specs';

  try {
    const files = fs.readdirSync(specsDir);

    // Already correctly named? No correction needed.
    const correctPattern = new RegExp(`^issue-${issueNumber}-adw-.*-sdlc_planner-.*\\.md$`);
    for (const file of files) {
      if (correctPattern.test(file)) return null;
    }

    // Look for swapped naming: adwId placed in issue- position, issueNumber placed in adw- position
    const swappedPattern = new RegExp(`^issue-(.+)-adw-${issueNumber}-sdlc_planner-(.+\\.md)$`);
    for (const file of files) {
      const match = file.match(swappedPattern);
      if (match) {
        const swappedAdwId = match[1];
        const descriptivePart = match[2];
        const correctedName = `issue-${issueNumber}-adw-${swappedAdwId}-sdlc_planner-${descriptivePart}`;
        const oldPath = path.join(specsDir, file);
        const newPath = path.join(specsDir, correctedName);
        fs.renameSync(oldPath, newPath);
        log(`Plan file renamed: ${file} → ${correctedName} (corrected swapped issueNumber/adwId)`, 'warn');
        return path.join('specs', correctedName);
      }
    }
  } catch {
    // specs directory doesn't exist or other error
  }

  return null;
}

/**
 * Formats PR review comments for inclusion in a prompt.
 */
function formatPrReviewComments(comments: PRReviewComment[]): string {
  return comments
    .map(c => {
      const location = c.path
        ? `**File:** \`${c.path}\`${c.line ? ` (line ${c.line})` : ''}`
        : '**General comment**';
      return `${location}\n**Author:** ${c.author.login}\n**Comment:** ${c.body}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Formats PR review context as arguments for the /pr_review command.
 */
function formatPrReviewContextAsArgs(
  prDetails: PRDetails,
  comments: PRReviewComment[],
  existingPlanContent: string
): string {
  const commentsSection = formatPrReviewComments(comments);

  return `## PR #${prDetails.number}: ${prDetails.title}
**URL:** ${prDetails.url}
**Branch:** ${prDetails.headBranch}

## Original Implementation Plan
${existingPlanContent}

## PR Review Comments to Address
${commentsSection}`;
}

/**
 * Runs the Plan Agent to create a revision plan for PR review comments.
 * Uses the /pr_review slash command from .claude/commands/pr_review.md
 *
 * @param prDetails - PR details including number, title, branch, etc.
 * @param comments - PR review comments to address
 * @param existingPlanContent - Existing plan content or PR body for context
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runPrReviewPlanAgent(
  prDetails: PRDetails,
  comments: PRReviewComment[],
  existingPlanContent: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult> {
  const args = formatPrReviewContextAsArgs(prDetails, comments, existingPlanContent);
  const outputFile = path.join(logsDir, 'pr-review-plan-agent.jsonl');

  return runClaudeAgentWithCommand('/pr_review', args, 'PR Review Plan', outputFile, getModelForCommand('/pr_review', issueBody), getEffortForCommand('/pr_review', issueBody), undefined, statePath, cwd);
}

/**
 * Runs the Plan Agent to generate an implementation plan.
 * Uses the appropriate slash command (/feature, /bug, /chore, /pr_review) based on issue type.
 *
 * @param issue - GitHub issue to generate a plan for
 * @param logsDir - Directory to write agent logs
 * @param issueType - Type of issue (determines which slash command to use)
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 * @param adwId - Optional ADW workflow ID for plan file naming
 */
export async function runPlanAgent(
  issue: GitHubIssue,
  logsDir: string,
  issueType: IssueClassSlashCommand = '/feature',
  statePath?: string,
  cwd?: string,
  adwId?: string
): Promise<AgentResult> {
  const humanComments = issue.comments.filter(c => !isAdwComment(c.body));

  const latestActionableContent = [...issue.comments]
    .reverse()
    .reduce<string | null>((found, c) => found ?? extractActionableContent(c.body), null);

  const issueJson = JSON.stringify({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    author: issue.author.login,
    labels: issue.labels.map(l => l.name),
    createdAt: issue.createdAt,
    comments: humanComments.map(c => ({
      author: c.author.login,
      createdAt: c.createdAt,
      body: c.body,
    })),
    actionableComment: latestActionableContent,
  });
  const args = [String(issue.number), adwId || 'adw-unknown', issueJson];
  const outputFile = path.join(logsDir, 'plan-agent.jsonl');

  // Use the issueType directly as the command (e.g., '/feature', '/bug', '/chore', '/pr_review')
  return runClaudeAgentWithCommand(issueType, args, 'Plan', outputFile, getModelForCommand(issueType, issue.body), getEffortForCommand(issueType, issue.body), undefined, statePath, cwd);
}
