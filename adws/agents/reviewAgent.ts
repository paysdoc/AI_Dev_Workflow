/**
 * Review Agent - Reviews implemented features against their spec files.
 * Uses the /review slash command from .claude/commands/review.md
 */

import * as path from 'path';
import { getModelForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';
import { extractJson } from '../core/jsonParser';

/**
 * Individual review issue from the /review command.
 * Matches the JSON output structure defined in .claude/commands/review.md
 */
export interface ReviewIssue {
  reviewIssueNumber: number;
  screenshotPath: string;
  issueDescription: string;
  issueResolution: string;
  issueSeverity: 'skippable' | 'tech-debt' | 'blocker';
}

/**
 * Review result from the /review command.
 * Matches the JSON output structure defined in .claude/commands/review.md
 */
export interface ReviewResult {
  success: boolean;
  reviewSummary: string;
  reviewIssues: ReviewIssue[];
  screenshots: string[];
}

/**
 * Aggregated result from running the /review command.
 */
export interface ReviewAgentResult extends AgentResult {
  /** Parsed review result from the JSON output */
  reviewResult: ReviewResult | null;
  /** Whether the review passed (no blocker issues) */
  passed: boolean;
  /** Blocker issues that need patching */
  blockerIssues: ReviewIssue[];
}

/**
 * Runs the /review command and returns parsed review results.
 * Uses 'opus' model for complex reasoning.
 *
 * @param adwId - ADW session identifier
 * @param specFile - Path to the spec file to review against
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 * @param applicationUrl - Optional application URL for the dev server (e.g. http://localhost:12345)
 */
export async function runReviewAgent(
  adwId: string,
  specFile: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  applicationUrl?: string,
  issueBody?: string,
): Promise<ReviewAgentResult> {
  const agentName = 'review_agent';
  const outputFile = path.join(logsDir, 'review-agent.jsonl');

  // Format args as: adwId\nspec_file\nagent_name[\napplicationUrl]
  const args = applicationUrl
    ? `${adwId}\n${specFile}\n${agentName}\n${applicationUrl}`
    : `${adwId}\n${specFile}\n${agentName}`;

  const result = await runClaudeAgentWithCommand(
    '/review',
    args,
    'Review',
    outputFile,
    getModelForCommand('/review', issueBody),
    undefined,
    statePath,
    cwd
  );

  // Parse the review result from the output
  const reviewResult = extractJson<ReviewResult>(result.output);
  const blockerIssues = reviewResult?.reviewIssues?.filter(
    issue => issue.issueSeverity === 'blocker'
  ) ?? [];
  const passed = reviewResult?.success === true || blockerIssues.length === 0;

  return {
    ...result,
    reviewResult,
    passed,
    blockerIssues,
  };
}
