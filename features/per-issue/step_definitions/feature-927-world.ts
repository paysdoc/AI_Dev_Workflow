/**
 * State shared by the review-gate step files, rebuilt before every scenario. The recording issue
 * tracker and code host live here because every Then step reads what they recorded.
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { Platform } from '@paysdoc/devplatform';
import type { CodeHost, IssueTracker, RepoContext } from '@paysdoc/devplatform';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { OrchestratorId, type OrchestratorIdType } from '../../../adws/core/constants.ts';
import { deriveOrchestratorScript } from '../../../adws/core/orchestratorNames.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';

export type OrchestratorName = 'adwChore' | 'adwPlanBuildReview' | 'adwPlanBuildTestReview';

const ORCHESTRATOR_IDS: Readonly<Record<OrchestratorName, OrchestratorIdType>> = {
  adwChore: OrchestratorId.Chore,
  adwPlanBuildReview: OrchestratorId.PlanBuildReview,
  adwPlanBuildTestReview: OrchestratorId.PlanBuildTestReview,
};

const REPO_ID = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub } as const;
const FIRST_PULL_REQUEST_NUMBER = 101;

export interface ReviewVerdict {
  readonly passed: boolean;
  readonly blockers: number;
}

export interface RecordedComment {
  readonly issueNumber: number;
  readonly body: string;
}

export interface OpenedPullRequest {
  readonly issueNumber: number | undefined;
  readonly number: number;
}

export interface RunOutcome {
  readonly orchestrator: OrchestratorName;
  readonly resolved: boolean;
  readonly failure: string;
  readonly exitCodes: readonly number[];
}

export interface World927 {
  workflow: { readonly orchestrator: OrchestratorName; readonly config: WorkflowConfig } | null;
  labels: Map<number, readonly string[]>;
  diffEscalates: boolean | null;
  reviewScript: readonly ReviewVerdict[];
  phaseLog: string[];
  stageHistory: string[];
  comments: RecordedComment[];
  pullRequests: OpenedPullRequest[];
  approvals: number[];
  run: RunOutcome | null;
  adwIds: string[];
  worktrees: string[];
  restorers: Array<() => void>;
}

function freshWorld(): World927 {
  return {
    workflow: null,
    labels: new Map(),
    diffEscalates: null,
    reviewScript: [],
    phaseLog: [],
    stageHistory: [],
    comments: [],
    pullRequests: [],
    approvals: [],
    run: null,
    adwIds: [],
    worktrees: [],
    restorers: [],
  };
}

export const world: World927 = freshWorld();

export function resetWorld(): void {
  Object.assign(world, freshWorld());
}

export function toOrchestratorName(value: string): OrchestratorName {
  const known = Object.keys(ORCHESTRATOR_IDS);
  if (!known.includes(value)) {
    throw new Error(`Unknown orchestrator "${value}"; the review-gate scenarios drive: ${known.join(', ')}`);
  }
  return value as OrchestratorName;
}

function recordingIssueTracker(): Pick<IssueTracker, 'commentOnIssue' | 'fetchLabels' | 'moveToStatus'> {
  return {
    commentOnIssue: (issueNumber, body) => { world.comments.push({ issueNumber, body }); },
    fetchLabels: (issueNumber) => world.labels.get(issueNumber) ?? [],
    moveToStatus: async () => true,
  };
}

function recordingCodeHost(): Pick<CodeHost, 'getDefaultBranch' | 'createPullRequest' | 'approvePullRequest'> {
  return {
    getDefaultBranch: () => 'main',
    createPullRequest: (options) => {
      const number = FIRST_PULL_REQUEST_NUMBER + world.pullRequests.length;
      world.pullRequests.push({ issueNumber: options.linkedIssueNumber, number });
      return { url: `https://github.com/${REPO_ID.owner}/${REPO_ID.repo}/pull/${number}`, number };
    },
    approvePullRequest: (prNumber) => {
      world.approvals.push(prNumber);
      return { success: true };
    },
  };
}

function buildWorkflowConfig(
  orchestratorId: OrchestratorIdType,
  issueNumber: number,
  adwId: string,
  branchName: string,
  worktreePath: string,
): WorkflowConfig {
  const repoContext = {
    issueTracker: recordingIssueTracker(),
    codeHost: recordingCodeHost(),
    cwd: worktreePath,
    repoId: REPO_ID,
  } as unknown as RepoContext;
  return {
    issueNumber,
    adwId,
    orchestratorName: orchestratorId,
    worktreePath,
    branchName,
    defaultBranch: 'main',
    orchestratorStatePath: AgentStateManager.initializeState(adwId, orchestratorId),
    topLevelStatePath: AgentStateManager.getTopLevelStatePath(adwId),
    ctx: { issueNumber, adwId, branchName },
    repoContext,
  } as unknown as WorkflowConfig;
}

/** Writes the top-level state the way workflow initialisation does, so the stop path has a state to resume from. */
export function startWorkflow(orchestratorText: string, issueNumber: number, adwId: string, branchName: string): void {
  const orchestrator = toOrchestratorName(orchestratorText);
  const orchestratorId = ORCHESTRATOR_IDS[orchestrator];

  // A state file left by a crashed earlier run would let a stage assertion pass without this run writing it.
  fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  const worktreePath = fs.mkdtempSync(path.join(tmpdir(), `adw-927-worktree-${issueNumber}-`));
  world.adwIds.push(adwId);
  world.worktrees.push(worktreePath);

  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber,
    workflowStage: 'starting',
    branchName,
    orchestratorScript: deriveOrchestratorScript(orchestratorId),
  });

  const config = buildWorkflowConfig(orchestratorId, issueNumber, adwId, branchName, worktreePath);
  world.workflow = { orchestrator, config };
}

export function restoreRecorders(): void {
  world.restorers.splice(0).reverse().forEach(restore => restore());
}

export function removeScenarioArtefacts(): void {
  world.adwIds.forEach(adwId => fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true }));
  world.worktrees.forEach(worktree => fs.rmSync(worktree, { recursive: true, force: true }));
}
