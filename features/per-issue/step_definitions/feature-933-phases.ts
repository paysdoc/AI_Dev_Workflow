/**
 * How each phase of feature-933 is driven: the state its commit needs in the worktree, and the real
 * phase function that makes the commit. Every one of them commits through the Claude CLI's `/commit`
 * (`runCommitAgent`), so the identity on the commit is the one the phase handed the agent's
 * environment. No driver calls `runCommitAgent` itself: its callers are what is under test.
 */

import * as path from 'path';

import { getPlanFilePath } from '../../../adws/agents/planAgent.ts';
import type { ReviewIssue } from '../../../adws/agents/reviewAgent.ts';
import { executeAlignmentPhase } from '../../../adws/phases/alignmentPhase.ts';
import { executeBuildPhase } from '../../../adws/phases/buildPhase.ts';
import { executeDocumentPhase } from '../../../adws/phases/documentPhase.ts';
import { executePlanPhase } from '../../../adws/phases/planPhase.ts';
import { executePRPhase } from '../../../adws/phases/prPhase.ts';
import { executePRReviewCommitPushPhase, type PRReviewWorkflowConfig } from '../../../adws/phases/prReviewPhase.ts';
import { executeReviewPatchCycle } from '../../../adws/phases/reviewPhase.ts';
import { executeScenarioFixPhase } from '../../../adws/phases/scenarioFixPhase.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';

import { commitWorktreeFiles, writeWorktreeFile, type Workflow933 } from './feature-933-workflow.ts';

export interface PhaseDriver {
  /** Puts the worktree in the state the phase's commit needs. */
  prepare(workflow: Workflow933): void;
  /** Runs the real phase function. */
  run(workflow: Workflow933): Promise<unknown>;
}

const PATCH_BLOCKER: ReviewIssue = {
  reviewIssueNumber: 1,
  issueDescription: 'The change is not applied yet.',
  issueResolution: 'Apply the change.',
  issueSeverity: 'blocker',
  remediationStrategy: 'patch',
};

function nothingToPrepare(): void {}

function planFile(workflow: Workflow933): string {
  return getPlanFilePath(workflow.issueNumber, workflow.worktreePath);
}

function planText(workflow: Workflow933): string {
  return `# Plan for issue ${workflow.issueNumber}\n\nChange one file.\n`;
}

function scenarioFile(workflow: Workflow933): string {
  return `features/per-issue/feature-${workflow.issueNumber}.feature`;
}

function scenarioText(workflow: Workflow933): string {
  return `@adw-${workflow.issueNumber}\nFeature: Scenario for issue ${workflow.issueNumber}\n\n  Scenario: Nothing changes\n    Given nothing\n`;
}

function leaveUncommittedChange(workflow: Workflow933): void {
  writeWorktreeFile(workflow, 'src/uncommitted-change.ts', 'export const uncommitted = true;\n');
}

function failingScenarioProof(workflow: Workflow933): ScenarioProofResult {
  const tag = `@adw-${workflow.issueNumber}`;
  return {
    tagResults: [{ tag, resolvedTag: tag, severity: 'blocker', optional: false, passed: false, output: 'One scenario failed.', exitCode: 1, skipped: false }],
    hasBlockerFailures: true,
    resultsFilePath: path.join(workflow.logsDir, 'scenario_proof.md'),
    artifactsDir: path.join(workflow.logsDir, 'proof'),
  };
}

/** The PR-review configuration whose source branch is the worktree's own branch. */
function prReviewConfig(workflow: Workflow933): PRReviewWorkflowConfig {
  const { config, issueNumber, adwId, branchName } = workflow;
  return {
    base: config,
    prNumber: issueNumber,
    prDetails: {
      number: issueNumber,
      title: 'Address the review comments',
      body: 'Applies the requested changes.',
      sourceBranch: branchName,
      targetBranch: config.defaultBranch,
      url: config.issue.url.replace('/issues/', '/pull/'),
      linkedIssueNumber: issueNumber,
      state: 'OPEN',
    },
    unaddressedComments: [],
    ctx: { issueNumber, adwId, prNumber: issueNumber, reviewComments: 0, branchName },
  };
}

const DRIVERS: ReadonlyArray<readonly [string, PhaseDriver]> = [
  ['plan', {
    prepare: workflow => writeWorktreeFile(workflow, planFile(workflow), planText(workflow)),
    run: workflow => executePlanPhase(workflow.config),
  }],
  ['alignment', {
    prepare: workflow => commitWorktreeFiles(workflow, {
      [planFile(workflow)]: planText(workflow),
      [scenarioFile(workflow)]: scenarioText(workflow),
    }),
    run: workflow => executeAlignmentPhase(workflow.config),
  }],
  ['build', {
    prepare: workflow => commitWorktreeFiles(workflow, { [planFile(workflow)]: planText(workflow) }),
    run: workflow => executeBuildPhase(workflow.config),
  }],
  ['document', {
    prepare: nothingToPrepare,
    run: workflow => executeDocumentPhase(workflow.config),
  }],
  ['review', {
    prepare: nothingToPrepare,
    run: workflow => executeReviewPatchCycle(workflow.config, [PATCH_BLOCKER]),
  }],
  ['scenario fix', {
    prepare: nothingToPrepare,
    run: workflow => executeScenarioFixPhase(workflow.config, failingScenarioProof(workflow)),
  }],
  ['PR', {
    prepare: leaveUncommittedChange,
    run: workflow => executePRPhase(workflow.config),
  }],
  ['PR review', {
    prepare: leaveUncommittedChange,
    run: workflow => executePRReviewCommitPushPhase(prReviewConfig(workflow)),
  }],
];

const DRIVERS_BY_PHASE = new Map(DRIVERS);

export function driverFor(phase: string): PhaseDriver {
  const driver = DRIVERS_BY_PHASE.get(phase);
  if (!driver) {
    throw new Error(`Unknown phase "${phase}". The commit scenarios drive: ${[...DRIVERS_BY_PHASE.keys()].join(', ')}`);
  }
  return driver;
}
