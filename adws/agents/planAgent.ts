import * as fs from 'fs';
import * as path from 'path';
import { IssueClassSlashCommand, getModelForCommand, getEffortForCommand, log } from '../core';
import type { Issue, PullRequest, ReviewComment } from '@paysdoc/devplatform';
import { runClaudeAgentWithCommand, AgentResult, AgentLaunchContext } from './claudeAgent';
import { isAdwComment, extractActionableContent } from '../core/workflowCommentParsing';

export function formatIssueContextAsArgs(issue: Issue): string {
  const humanComments = issue.comments.filter(c => !isAdwComment(c.body));

  const latestActionableContent = [...issue.comments]
    .reverse()
    .reduce<string | null>((found, c) => found ?? extractActionableContent(c.body), null);

  const commentsSection = humanComments.length > 0
    ? humanComments
        .map(c => `**${c.author}** (${c.createdAt}):\n${c.body}`)
        .join('\n\n---\n\n')
    : 'No comments.';

  const actionableSection = latestActionableContent
    ? `\n\n### Actionable Comment\n${latestActionableContent}`
    : '';

  return `## GitHub Issue #${issue.number}
**Title:** ${issue.title}
**State:** ${issue.state}
**Author:** ${issue.author}
**Labels:** ${issue.labels.join(', ') || 'none'}
**Created:** ${issue.createdAt}

### Description
${issue.body || 'No description provided.'}${actionableSection}

### Comments
${commentsSection}`;
}

function findPlanFile(issueNumber: number, worktreePath?: string): string | null {
  const specsDir = worktreePath ? path.join(worktreePath, 'specs') : 'specs';

  try {
    const files = fs.readdirSync(specsDir);

    const pattern = new RegExp(`^issue-${issueNumber}-adw-.*-sdlc_planner-.*\\.md$`);
    const matchingFile = files.find(file => pattern.test(file));
    if (matchingFile) {
      return path.join('specs', matchingFile);
    }

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

export function getPlanFilePath(issueNumber: number, worktreePath?: string): string {
  const foundPath = findPlanFile(issueNumber, worktreePath);
  if (foundPath) {
    return foundPath;
  }
  return `specs/issue-${issueNumber}-plan.md`;
}

/** Returns true if the file exists and has content. */
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

export function readPlanFile(issueNumber: number, worktreePath?: string): string | null {
  const planPath = getPlanFilePath(issueNumber, worktreePath);
  const fullPath = worktreePath ? path.join(worktreePath, planPath) : planPath;
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/** The plan agent sometimes swaps $1 (issueNumber) and $2 (adwId), producing `issue-{adwId}-adw-{issueNumber}-...` instead of `issue-{issueNumber}-adw-{adwId}-...`. */
export function correctPlanFileNaming(issueNumber: number, worktreePath?: string): string | null {
  const specsDir = worktreePath ? path.join(worktreePath, 'specs') : 'specs';

  try {
    const files = fs.readdirSync(specsDir);

    const correctPattern = new RegExp(`^issue-${issueNumber}-adw-.*-sdlc_planner-.*\\.md$`);
    if (files.some(file => correctPattern.test(file))) return null;

    const swappedPattern = new RegExp(`^issue-(.+)-adw-${issueNumber}-sdlc_planner-(.+\\.md)$`);
    const swappedFile = files.find(file => swappedPattern.test(file));
    if (swappedFile) {
      const match = swappedFile.match(swappedPattern)!;
      const swappedAdwId = match[1];
      const descriptivePart = match[2];
      const correctedName = `issue-${issueNumber}-adw-${swappedAdwId}-sdlc_planner-${descriptivePart}`;
      const oldPath = path.join(specsDir, swappedFile);
      const newPath = path.join(specsDir, correctedName);
      fs.renameSync(oldPath, newPath);
      log(`Plan file renamed: ${swappedFile} → ${correctedName} (corrected swapped issueNumber/adwId)`, 'warn');
      return path.join('specs', correctedName);
    }
  } catch {
    // specs directory doesn't exist or other error
  }

  return null;
}

export type PrReviewPullRequest = Pick<PullRequest, 'number' | 'title' | 'url' | 'sourceBranch'>;

function formatPrReviewComments(comments: readonly ReviewComment[]): string {
  return comments
    .map(c => {
      const location = c.path
        ? `**File:** \`${c.path}\`${c.line ? ` (line ${c.line})` : ''}`
        : '**General comment**';
      return `${location}\n**Author:** ${c.author}\n**Comment:** ${c.body}`;
    })
    .join('\n\n---\n\n');
}

function formatPrReviewContextAsArgs(
  pr: PrReviewPullRequest,
  comments: readonly ReviewComment[],
  existingPlanContent: string
): string {
  const commentsSection = formatPrReviewComments(comments);

  return `## PR #${pr.number}: ${pr.title}
**URL:** ${pr.url}
**Branch:** ${pr.sourceBranch}

## Original Implementation Plan
${existingPlanContent}

## PR Review Comments to Address
${commentsSection}`;
}

export async function runPrReviewPlanAgent(
  pr: PrReviewPullRequest,
  comments: readonly ReviewComment[],
  existingPlanContent: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  contextPreamble?: string,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult> {
  const args = formatPrReviewContextAsArgs(pr, comments, existingPlanContent);
  const outputFile = path.join(logsDir, 'pr-review-plan-agent.jsonl');

  return runClaudeAgentWithCommand('/pr_review', args, 'PR Review Plan', outputFile, getModelForCommand('/pr_review', issueBody), getEffortForCommand('/pr_review', issueBody), undefined, statePath, cwd, contextPreamble, undefined, undefined, launchContext);
}

export async function runPlanAgent(
  issue: Issue,
  logsDir: string,
  issueType: IssueClassSlashCommand = '/feature',
  statePath?: string,
  cwd?: string,
  adwId?: string,
  contextPreamble?: string,
  launchContext?: AgentLaunchContext,
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
    author: issue.author,
    labels: issue.labels,
    createdAt: issue.createdAt,
    comments: humanComments.map(c => ({
      author: c.author,
      createdAt: c.createdAt,
      body: c.body,
    })),
    actionableComment: latestActionableContent,
  });
  const args = [String(issue.number), adwId || 'adw-unknown', issueJson];
  const outputFile = path.join(logsDir, 'plan-agent.jsonl');

  return runClaudeAgentWithCommand(issueType, args, 'Plan', outputFile, getModelForCommand(issueType, issue.body), getEffortForCommand(issueType, issue.body), undefined, statePath, cwd, contextPreamble, undefined, undefined, launchContext);
}
