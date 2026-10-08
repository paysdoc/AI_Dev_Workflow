/**
 * The agents named in feature-929 and, for the §3 rows, how each is driven: the way the phase
 * that owns it calls it. The review-patch build agent is driven through the review phase's own
 * patch path (`applyPatchBlocker`), never through `runBuildAgent` directly.
 */

import { AgentStateManager } from '../../../adws/core/index.ts';
import { RunnerMode } from '../../../adws/core/applicationType.ts';
import { getPlanFilePath, runPlanAgent } from '../../../adws/agents/planAgent.ts';
import { runStepDefAgent } from '../../../adws/agents/stepDefAgent.ts';
import { runReviewAgent, type ReviewIssue } from '../../../adws/agents/reviewAgent.ts';
import { runResolveScenarioAgent } from '../../../adws/agents/testAgent.ts';
import { runDocumentAgent } from '../../../adws/agents/documentAgent.ts';
import { runPrReviewBuildAgent } from '../../../adws/agents/buildAgent.ts';
import { buildReviewPromptContext } from '../../../adws/phases/reviewPromptContext.ts';
import { applyPatchBlocker } from '../../../adws/phases/reviewPatchHelpers.ts';
import { requireWorkflowGitContext } from '../../../adws/phases/workflowRepoIdentity.ts';
import type { AgentIdentifier } from '../../../adws/types/agentTypes.ts';
import type { Workflow929 } from '../../regression/step_definitions/feature-929-workflow.ts';

/** Longest first, so the one parameter type never lets a shorter name shadow a longer one. */
export const AGENT_NAMES = [
  'review-patch build agent',
  'scenario-resolution agent',
  'test-resolution agent',
  'step-definition agent',
  'PR review build agent',
  'build agent',
  'review agent',
  'document agent',
  'test agent',
  'plan agent',
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/** The slash command each agent runs, which is how the throwaway CLI tells the agents apart. */
export const AGENT_COMMANDS: Record<AgentName, string> = {
  'review-patch build agent': '/implement',
  'scenario-resolution agent': '/resolve_failed_scenario',
  'test-resolution agent': '/resolve_failed_test',
  'step-definition agent': '/generate_step_definitions',
  'PR review build agent': '/implement',
  'build agent': '/implement',
  'review agent': '/review',
  'document agent': '/document',
  'test agent': '/test',
  'plan agent': '/bug',
};

/** The phase each runner-driven agent belongs to, as the §3 Examples name it. */
export const AGENT_PHASES: Partial<Record<AgentName, string>> = {
  'plan agent': 'plan',
  'step-definition agent': 'step definition',
  'review agent': 'review',
  'review-patch build agent': 'review',
  'scenario-resolution agent': 'scenario fix',
  'document agent': 'document',
  'PR review build agent': 'PR review',
};

const PATCH_BLOCKER: ReviewIssue = {
  reviewIssueNumber: 1,
  issueDescription: 'The patch for this blocker is not applied yet.',
  issueResolution: 'Apply the patch.',
  issueSeverity: 'blocker',
  remediationStrategy: 'patch',
};

type Driver = (workflow: Workflow929) => Promise<unknown>;

function statePathOf(workflow: Workflow929, agent: AgentIdentifier): string {
  return AgentStateManager.initializeState(workflow.adwId, agent, workflow.config.orchestratorStatePath);
}

function launchContextOf(workflow: Workflow929): { selfHost: boolean; adwId: string; gitContext: ReturnType<typeof requireWorkflowGitContext> } {
  const gitContext = requireWorkflowGitContext(workflow.config);
  return { selfHost: gitContext.selfHost, adwId: workflow.adwId, gitContext };
}

const DRIVERS: Partial<Record<AgentName, Driver>> = {
  'plan agent': workflow => {
    const { config } = workflow;
    return runPlanAgent(config.issue, config.logsDir, '/bug', statePathOf(workflow, 'plan-agent'), config.worktreePath, workflow.adwId, undefined, launchContextOf(workflow));
  },
  'step-definition agent': workflow => {
    const { config } = workflow;
    return runStepDefAgent(workflow.issueNumber, workflow.adwId, RunnerMode.Descriptor, config.logsDir, statePathOf(workflow, 'step-def-agent'), config.worktreePath, config.issue.body, undefined, launchContextOf(workflow));
  },
  'review agent': workflow => {
    const { config } = workflow;
    const specFile = getPlanFilePath(workflow.issueNumber, config.worktreePath);
    const subprocessEnv = requireWorkflowGitContext(config).commandEnv();
    return runReviewAgent(workflow.adwId, specFile, buildReviewPromptContext(config), config.logsDir, statePathOf(workflow, 'review-agent'), config.worktreePath, config.issue.body, undefined, subprocessEnv, launchContextOf(workflow));
  },
  'review-patch build agent': workflow => {
    const { config } = workflow;
    return applyPatchBlocker(PATCH_BLOCKER, {
      adwId: workflow.adwId,
      logsDir: config.logsDir,
      specFile: getPlanFilePath(workflow.issueNumber, config.worktreePath),
      worktreePath: config.worktreePath,
      issue: config.issue,
      orchestratorStatePath: config.orchestratorStatePath,
      subprocessEnv: requireWorkflowGitContext(config).commandEnv(),
      launchContext: launchContextOf(workflow),
    });
  },
  'scenario-resolution agent': workflow => {
    const { config } = workflow;
    const failedScenario = { testName: '@adw-929', status: 'failed' as const, error: 'The scenario failed.' };
    return runResolveScenarioAgent(failedScenario, config.logsDir, statePathOf(workflow, 'scenario-fix'), config.worktreePath, config.applicationUrl, config.issue.body, launchContextOf(workflow));
  },
  'document agent': workflow => {
    const { config } = workflow;
    const specFile = getPlanFilePath(workflow.issueNumber, config.worktreePath);
    const subprocessEnv = requireWorkflowGitContext(config).commandEnv();
    return runDocumentAgent(workflow.adwId, config.logsDir, specFile, undefined, statePathOf(workflow, 'document-agent'), config.worktreePath, config.issue.body, subprocessEnv, launchContextOf(workflow));
  },
  'PR review build agent': workflow => {
    const { config } = workflow;
    const pr = { number: workflow.issueNumber, title: 'Address the review comments', url: config.issue.url, sourceBranch: config.branchName };
    const subprocessEnv = requireWorkflowGitContext(config).commandEnv();
    return runPrReviewBuildAgent(pr, 'Apply the requested change.', config.logsDir, undefined, statePathOf(workflow, 'pr-review-build-agent'), config.worktreePath, config.issue.body, subprocessEnv, launchContextOf(workflow));
  },
};

/** Runs the agent the way its phase does; rejects for agents a phase function drives instead. */
export function driveAgent(agent: AgentName, workflow: Workflow929): Promise<unknown> {
  const driver = DRIVERS[agent];
  if (!driver) return Promise.reject(new Error(`The ${agent} is driven through its phase function, not through a runner`));
  return driver(workflow);
}
