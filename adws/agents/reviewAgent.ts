/**
 * Passive judge: reads scenario_proof.md artifact, calls a single agent,
 * returns reviewIssues + passed. Does not run tests, start a dev server, or
 * take screenshots.
 */

import * as path from 'path';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';
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

/** Args: adwId ($0), specFile ($1), agentName ($2), scenarioProofPath ($3 if provided) */
export function formatReviewArgs(
  adwId: string,
  specFile: string,
  agentName: string,
  scenarioProofPath?: string,
): string[] {
  return scenarioProofPath
    ? [adwId, specFile, agentName, scenarioProofPath]
    : [adwId, specFile, agentName];
}

export async function runReviewAgent(
  adwId: string,
  specFile: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  scenarioProofPath?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
): Promise<ReviewAgentResult> {
  const args = formatReviewArgs(adwId, specFile, 'Review', scenarioProofPath);

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
