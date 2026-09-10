/**
 * Build Agent - Implements solutions based on implementation plans.
 * Uses the /implement slash command from .claude/commands/implement.md
 * or /implement-tdd when BDD scenarios tagged @adw-{issueNumber} are present.
 */

import { log } from '../core';
import type { GitHubIssue } from '../providers/github/domain/issue';
import type { PrReviewPullRequest } from './planAgent';
import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult, ProgressCallback, AgentLaunchContext } from './claudeAgent';
import { findScenarioFiles } from './validationAgent';

const buildAgentConfig: CommandAgentConfig<void> = {
  command: '/implement',
  agentName: 'Build',
  outputFileName: 'build-agent.jsonl',
};

const buildAgentTddConfig: CommandAgentConfig<void> = {
  command: '/implement-tdd',
  agentName: 'Build',
  outputFileName: 'build-agent.jsonl',
};

const prReviewBuildAgentConfig: CommandAgentConfig<void> = {
  command: '/implement',
  agentName: 'PR Review Build',
  outputFileName: 'pr-review-build-agent.jsonl',
};

/**
 * Runs the Build Agent to implement PR review changes.
 * Uses the /implement slash command with the revision plan as arguments.
 *
 * @param prDetails - PR details including number, title, branch, etc.
 * @param revisionPlan - The revision plan to implement
 * @param logsDir - Directory to write agent logs
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 * @param issueBody - Optional issue body for model/effort selection
 */
export async function runPrReviewBuildAgent(
  pr: PrReviewPullRequest,
  revisionPlan: string,
  logsDir: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult> {
  const args = `## PR #${pr.number}: ${pr.title}
**URL:** ${pr.url}
**Branch:** ${pr.sourceBranch}

## Revision Plan
${revisionPlan}`;

  log(`PR Review Build Agent starting with arguments:`, 'info');
  log(`  PR: #${pr.number} - ${pr.title}`, 'info');
  log(`  Revision plan length: ${revisionPlan.length} characters`, 'info');

  return runCommandAgent(prReviewBuildAgentConfig, {
    args,
    logsDir,
    issueBody,
    onProgress,
    statePath,
    cwd,
    subprocessEnv,
    launchContext,
  });
}

/**
 * Runs the Build Agent to implement the solution.
 * Detects BDD scenario files tagged @adw-{issueNumber} in the worktree.
 * When scenarios are found, routes to /implement-tdd (TDD red-green-refactor mode)
 * and includes scenario file paths in the agent context.
 * Falls back to /implement when no scenarios are found.
 *
 * @param issue - GitHub issue to implement
 * @param logsDir - Directory to write agent logs
 * @param planContent - The implementation plan content
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent and scenario detection (defaults to process.cwd())
 */
export async function runBuildAgent(
  issue: GitHubIssue,
  logsDir: string,
  planContent: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult> {
  const worktreePath = cwd ?? process.cwd();
  const scenarioFiles = findScenarioFiles(issue.number, worktreePath);
  const useTdd = scenarioFiles.length > 0;

  log(`Build Agent mode: ${useTdd ? 'TDD (/implement-tdd)' : 'standard (/implement)'}`, 'info');
  if (useTdd) {
    log(`  Scenario files found: ${scenarioFiles.join(', ')}`, 'info');
  }
  log(`  Issue: #${issue.number} - ${issue.title}`, 'info');
  log(`  Issue URL: ${issue.url}`, 'info');
  log(`  Plan content length: ${planContent.length} characters`, 'info');

  const baseArgs = `## GitHub Issue #${issue.number}
**Title:** ${issue.title}
**URL:** ${issue.url}

## Implementation Plan
${planContent}`;

  const args = useTdd
    ? `${baseArgs}

## BDD Scenario Files
${scenarioFiles.join('\n')}`
    : baseArgs;

  return runCommandAgent(useTdd ? buildAgentTddConfig : buildAgentConfig, {
    args,
    logsDir,
    issueBody: issue.body,
    onProgress,
    statePath,
    cwd,
    subprocessEnv,
    launchContext,
  });
}
