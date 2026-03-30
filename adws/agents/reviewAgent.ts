/**
 * Review Agent - Reviews implemented features against their spec files.
 * Uses the /review slash command from .claude/commands/review.md
 */

import * as path from 'path';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult } from './claudeAgent';
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

export const reviewResultSchema: Record<string, unknown> = {
  type: 'object',
  required: ['success', 'reviewSummary', 'reviewIssues', 'screenshots'],
  properties: {
    success: { type: 'boolean' },
    reviewSummary: { type: 'string' },
    reviewIssues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reviewIssueNumber', 'screenshotPath', 'issueDescription', 'issueResolution', 'issueSeverity'],
        properties: {
          reviewIssueNumber: { type: 'number' },
          screenshotPath: { type: 'string' },
          issueDescription: { type: 'string' },
          issueResolution: { type: 'string' },
          issueSeverity: { type: 'string', enum: ['skippable', 'tech-debt', 'blocker'] },
        },
      },
    },
    screenshots: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Extracts ReviewResult from raw agent output.
 * Returns a structured error if the output cannot be parsed.
 */
function extractReviewResult(output: string): ExtractionResult<ReviewResult> {
  const parsed = extractJson<ReviewResult>(output);
  if (!parsed || typeof parsed.success !== 'boolean') {
    return {
      success: false,
      error: 'Review agent output missing required "success" boolean field',
    };
  }
  return { success: true, data: parsed };
}

/**
 * Formats structured args for the /review skill.
 */
export function formatReviewArgs(
  adwId: string,
  specFile: string,
  agentName: string,
  applicationUrl?: string,
  scenarioProofPath?: string,
): string[] {
  if (scenarioProofPath) {
    // $5 requires $4 to be present — use empty string for applicationUrl if absent
    return [adwId, specFile, agentName, applicationUrl ?? '', scenarioProofPath];
  }
  return applicationUrl
    ? [adwId, specFile, agentName, applicationUrl]
    : [adwId, specFile, agentName];
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
 * @param issueBody - Optional issue body for fast/cheap model selection
 * @param agentIndex - Optional index for parallel execution (1, 2, 3, etc.)
 */
export async function runReviewAgent(
  adwId: string,
  specFile: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  applicationUrl?: string,
  issueBody?: string,
  agentIndex?: number,
  scenarioProofPath?: string,
): Promise<ReviewAgentResult> {
  const displayName = agentIndex !== undefined ? `Review #${agentIndex}` : 'Review';
  const logFileName = agentIndex !== undefined ? `review-agent-${agentIndex}.jsonl` : 'review-agent.jsonl';

  const args = formatReviewArgs(adwId, specFile, displayName, applicationUrl, scenarioProofPath);

  const reviewAgentConfig: CommandAgentConfig<ReviewResult> = {
    command: '/review',
    agentName: displayName,
    outputFileName: path.basename(logFileName),
    extractOutput: extractReviewResult,
    outputSchema: reviewResultSchema,
  };

  const result = await runCommandAgent(reviewAgentConfig, {
    args,
    logsDir,
    issueBody,
    statePath,
    cwd,
  });

  const reviewResult = result.parsed;
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
