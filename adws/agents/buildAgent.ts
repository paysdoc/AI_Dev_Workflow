import { log } from '../core';
import type { Issue } from '@paysdoc/devplatform';
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

export async function runBuildAgent(
  issue: Issue,
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
