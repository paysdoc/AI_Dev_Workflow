/**
 * Passive judge: the agent is handed the spec, the scenario proof, the per-issue images and the guidance section
 * for the repository's application type, and returns reviewIssues + passed. Neither ADW nor the agent runs a check here.
 */

import * as path from 'path';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';
import { formatReviewArgs, type ReviewPromptContext } from './reviewPromptArgs';
import { extractJson } from '../core/jsonParser';

/** Matches the JSON output structure defined in .claude/commands/review.md */
export interface ReviewIssue {
  reviewIssueNumber: number;
  issueDescription: string;
  issueResolution: string;
  issueSeverity: 'skippable' | 'tech-debt' | 'blocker';
  remediationStrategy?: 'refactor' | 'patch';
}

/** Matches the JSON output structure defined in .claude/commands/review.md */
export interface ReviewResult {
  success: boolean;
  reviewSummary: string;
  reviewIssues: ReviewIssue[];
  screenshots: string[];
}

export interface ReviewAgentResult extends AgentResult {
  reviewResult: ReviewResult | null;
  /** Whether the review passed (no blocker issues) */
  passed: boolean;
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
        required: ['reviewIssueNumber', 'issueDescription', 'issueResolution', 'issueSeverity'],
        properties: {
          reviewIssueNumber: { type: 'number' },
          issueDescription: { type: 'string' },
          issueResolution: { type: 'string' },
          issueSeverity: { type: 'string', enum: ['skippable', 'tech-debt', 'blocker'] },
          remediationStrategy: { type: 'string', enum: ['refactor', 'patch'] },
        },
      },
    },
    screenshots: { type: 'array', items: { type: 'string' } },
  },
};

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

export async function runReviewAgent(
  adwId: string,
  specFile: string,
  context: ReviewPromptContext,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  scenarioProofPath?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
): Promise<ReviewAgentResult> {
  const args = formatReviewArgs(adwId, specFile, 'Review', scenarioProofPath, context);

  const reviewAgentConfig: CommandAgentConfig<ReviewResult> = {
    command: '/review',
    agentName: 'Review',
    outputFileName: path.basename('review-agent.jsonl'),
    extractOutput: extractReviewResult,
    outputSchema: reviewResultSchema,
  };

  const result = await runCommandAgent(reviewAgentConfig, {
    args,
    logsDir,
    issueBody,
    statePath,
    cwd,
    subprocessEnv,
    launchContext,
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
