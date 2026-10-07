/**
 * The WorkflowConfig a surface row runs a phase under. It is built as initializeWorkflow builds it,
 * minus everything that needs a launch boundary: no GitHub App, no credentials, no clone and no
 * network. It stands on the worktree G11 made, the issue G4 seeded and the mock forge.
 */

import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import type { Issue } from '@paysdoc/devplatform';

import { executeAlignmentPhase } from '../../../adws/phases/alignmentPhase.ts';
import { executeBuildPhase } from '../../../adws/phases/buildPhase.ts';
import { executeDiffEvaluationPhase } from '../../../adws/phases/diffEvaluationPhase.ts';
import { executeDocumentPhase } from '../../../adws/phases/documentPhase.ts';
import { executeInstallPhase } from '../../../adws/phases/installPhase.ts';
import { executePlanPhase } from '../../../adws/phases/planPhase.ts';
import { executePlanValidationPhase } from '../../../adws/phases/planValidationPhase.ts';
import { executePRPhase } from '../../../adws/phases/prPhase.ts';
import { executePRReviewBuildPhase, executePRReviewCommitPushPhase, executePRReviewPlanPhase } from '../../../adws/phases/prReviewPhase.ts';
import type { PRReviewWorkflowConfig } from '../../../adws/phases/prReviewPhase.ts';
import { executeReviewPhase } from '../../../adws/phases/reviewPhase.ts';
import { executeScenarioFixPhase } from '../../../adws/phases/scenarioFixPhase.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';
import { executeScenarioTestPhase } from '../../../adws/phases/scenarioTestPhase.ts';
import { executeUnitTestPhase } from '../../../adws/phases/unitTestPhase.ts';
import { declaredApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';
import type { PRReviewWorkflowContext } from '../../../adws/forge/workflowCommentsPR.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import {
  AgentStateManager,
  OrchestratorId,
  detectRecoveryState,
  getProcessStartTime,
  loadProjectConfig,
  readAdwYmlConfig,
  type IssueClassSlashCommand,
  type OrchestratorIdType,
} from '../../../adws/core/index.ts';
import { deriveOrchestratorScript } from '../../../adws/core/orchestratorNames.ts';
import type { PhaseFn } from '../../../adws/core/phaseRunner.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';
import { HARNESS_GIT_IDENTITY } from './fixtureWorktree.ts';
import { SURFACE_REPO, mockForgeProviders } from './mockForgeProviders.ts';
import { seededIssue, seededPullRequest, seededReviewComments } from './seededRecords.ts';

export interface PhaseDefinition {
  readonly fn: PhaseFn;
  /** The name the production orchestrator passes to `runPhase`; absent where it passes none, so no stage is written. */
  readonly phaseName?: string;
}

export interface OrchestratorDefinition {
  readonly id: OrchestratorIdType;
  readonly issueType: IssueClassSlashCommand;
  readonly phases: Readonly<Record<string, PhaseDefinition>>;
}

/** adwPrReview hands the build phase the plan phase's output, and the build row runs without the plan phase. */
export const REVISION_PLAN = '1. Rename the helper as the review comment asks.';

/** `base` is the harness config itself, as the PR-review phases read it from `config.base`. The pull request is the one G-S2 seeded. */
function prReviewWorkflowConfig(base: WorkflowConfig): PRReviewWorkflowConfig {
  const prDetails = seededPullRequest();
  assert.strictEqual(
    prDetails.sourceBranch,
    base.branchName,
    `The pull request is open on the branch "${prDetails.sourceBranch}", but the worktree is on "${base.branchName}". Production checks out the pull request's branch, and a mismatch would push a branch the worktree is not on`,
  );
  const unaddressedComments = seededReviewComments(prDetails.number);
  const ctx: PRReviewWorkflowContext = {
    issueNumber: base.issueNumber,
    adwId: base.adwId,
    prNumber: prDetails.number,
    reviewComments: unaddressedComments.length,
    branchName: prDetails.sourceBranch,
  };
  return { base, prNumber: prDetails.number, prDetails, unaddressedComments, ctx };
}

// Orchestrators pass the review the proof path of the scenario run before it, and an empty one when no proof preceded it, as here.
const reviewWithoutProof: PhaseFn = (config) => executeReviewPhase(config, '');

/** What the scenario test phase leaves over the fixture once step definitions exist: the fenced scenario command exits 127 with nothing on stdout, so the regression tag fails. */
function failedRegressionProof(adwId: string): ScenarioProofResult {
  const proofDirectory = join(AGENTS_STATE_DIR, adwId, 'scenario-test');
  return {
    tagResults: [
      { tag: '@regression', resolvedTag: '@regression', severity: 'blocker', optional: false, passed: false, output: '', exitCode: 127, skipped: false },
    ],
    hasBlockerFailures: true,
    perIssueImages: [],
    resultsFilePath: join(proofDirectory, 'scenario_proof.md'),
    artifactsDir: join(proofDirectory, 'artifacts'),
  };
}

// The scenario test-and-fix loop hands the fix phase only a proof with a failed blocker tag.
const fixFailedRegressionProof: PhaseFn = (config) => executeScenarioFixPhase(config, failedRegressionProof(config.adwId));

const ORCHESTRATORS: Readonly<Record<string, OrchestratorDefinition>> = {
  plan: { id: OrchestratorId.Plan, issueType: '/feature', phases: { plan: { fn: executePlanPhase } } },
  build: {
    id: OrchestratorId.Build,
    issueType: '/feature',
    phases: { install: { fn: executeInstallPhase, phaseName: 'install' }, build: { fn: executeBuildPhase, phaseName: 'build' } },
  },
  test: { id: OrchestratorId.Test, issueType: '/feature', phases: { 'unit test': { fn: executeUnitTestPhase, phaseName: 'test' } } },
  chore: {
    id: OrchestratorId.Chore,
    issueType: '/chore',
    phases: {
      plan: { fn: executePlanPhase },
      build: { fn: executeBuildPhase },
      review: { fn: reviewWithoutProof },
      'diff evaluation': { fn: executeDiffEvaluationPhase },
    },
  },
  sdlc: {
    id: OrchestratorId.Sdlc,
    issueType: '/feature',
    phases: {
      alignment: { fn: executeAlignmentPhase },
      'scenario test': { fn: executeScenarioTestPhase },
      'scenario fix': { fn: fixFailedRegressionProof },
      review: { fn: reviewWithoutProof },
    },
  },
  patch: {
    id: OrchestratorId.Patch,
    issueType: '/feature',
    phases: { build: { fn: executeBuildPhase, phaseName: 'build' }, pr: { fn: executePRPhase, phaseName: 'pr' } },
  },
  'pr-review': {
    id: OrchestratorId.PrReview,
    issueType: '/pr_review',
    phases: {
      pr_review_plan: { fn: (config) => executePRReviewPlanPhase(prReviewWorkflowConfig(config)), phaseName: 'pr_review_plan' },
      pr_review_build: { fn: (config) => executePRReviewBuildPhase(prReviewWorkflowConfig(config), REVISION_PLAN), phaseName: 'pr_review_build' },
      pr_review_commit_push: { fn: (config) => executePRReviewCommitPushPhase(prReviewWorkflowConfig(config)), phaseName: 'pr_review_commit_push' },
    },
  },
  'plan-build-document': { id: OrchestratorId.PlanBuildDocument, issueType: '/feature', phases: { document: { fn: executeDocumentPhase } } },
};

// No orchestrator in adws/*.tsx runs these. A row drives one with no phase name, under adwSdlc's identity, the pipeline plan validation was written for.
const DIRECT_PHASES: Readonly<Record<string, PhaseDefinition>> = {
  'plan validation': { fn: executePlanValidationPhase },
};

export const DIRECT_PHASE_ORCHESTRATOR = 'sdlc';

/** `agents/<adwId>/` holds real workflows' state too, so the harness clears only the directories of adwIds made up for surface rows. */
const SURFACE_ADW_ID = /^surface-[a-z0-9-]+$/;

export function orchestratorDefinition(orchestratorName: string): OrchestratorDefinition {
  const definition = ORCHESTRATORS[orchestratorName];
  assert.ok(definition, `Unknown orchestrator "${orchestratorName}". The surface harness drives: ${Object.keys(ORCHESTRATORS).join(', ')}`);
  return definition;
}

export function phaseDefinition(orchestratorName: string, phase: string): PhaseDefinition {
  const { phases } = orchestratorDefinition(orchestratorName);
  const definition = phases[phase];
  assert.ok(definition, `Unknown phase "${phase}" of the "${orchestratorName}" orchestrator. The surface harness drives: ${Object.keys(phases).join(', ')}`);
  return definition;
}

export function directPhaseDefinition(phase: string): PhaseDefinition {
  const definition = DIRECT_PHASES[phase];
  assert.ok(definition, `Unknown direct phase "${phase}". No orchestrator runs: ${Object.keys(DIRECT_PHASES).join(', ')}`);
  return definition;
}

function removeOnCleanup(world: RegressionWorld, path: string): void {
  world.cleanup.push(() => rmSync(path, { recursive: true, force: true }));
}

/** Every git call a phase makes names the worktree as its cwd, and none reaches a remote. */
function gitContextFor(base: string): GitContext {
  const { name, email } = HARNESS_GIT_IDENTITY;
  return new GitContext({
    owner: SURFACE_REPO.owner,
    repo: SURFACE_REPO.repo,
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('mock-token'),
    gitIdentity: { authorName: name, authorEmail: email, committerName: name, committerEmail: email },
    frameworkRepoRoot: base,
    targetReposDir: base,
  });
}

/** Written as `initializeWorkflow` writes it, so a phase that records a stage starts from the stage production starts from. */
function writeInitialTopLevelState(adwId: string, issue: Issue, orchestratorId: OrchestratorIdType, branchName: string): void {
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: issue.number,
    workflowStage: 'starting',
    orchestratorScript: deriveOrchestratorScript(orchestratorId),
    repoIdentity: { owner: SURFACE_REPO.owner, repo: SURFACE_REPO.repo },
    branchName,
    pid: process.pid,
    pidStartedAt: getProcessStartTime(process.pid) ?? undefined,
    lastSeenAt: new Date().toISOString(),
  });
}

/** `launch` is what an orchestrator contributes to its config, so a run no orchestrator makes can name an id of its own. */
export function buildConfigFor(world: RegressionWorld, adwId: string, launch: Pick<OrchestratorDefinition, 'id' | 'issueType'>): WorkflowConfig {
  const { id, issueType } = launch;
  const worktreePath = world.worktreePaths.get(adwId);
  assert.ok(worktreePath, `No worktree is registered for adwId "${adwId}": G11 must initialise it first`);
  assert.match(adwId, SURFACE_ADW_ID, `Only a surface adwId (surface-…) may be run in-process, since its agents/<adwId>/ directory is cleared; got "${adwId}"`);
  const issue = seededIssue();

  // A top-level state left behind marks the phase completed, and runPhase would skip it.
  const stateDirectory = join(AGENTS_STATE_DIR, adwId);
  rmSync(stateDirectory, { recursive: true, force: true });
  removeOnCleanup(world, stateDirectory);

  const logsDir = mkdtempSync(join(tmpdir(), `adw-logs-${adwId}-`));
  removeOnCleanup(world, logsDir);

  const gitContext = gitContextFor(dirname(worktreePath));
  const branchName = gitContext.getCurrentBranch(worktreePath);
  const orchestratorStatePath = AgentStateManager.initializeState(adwId, id);
  writeInitialTopLevelState(adwId, issue, id, branchName);

  const projectConfig = loadProjectConfig(worktreePath);
  const applicationProfile = declaredApplicationProfile(projectConfig);
  assert.ok(applicationProfile, `The fixture's .adw/project.md declares no application type ADW knows (it declares ${JSON.stringify(projectConfig.applicationType)}), and initializeWorkflow would have parked the run`);

  return {
    issueNumber: issue.number,
    adwId,
    issue,
    issueType,
    worktreePath,
    defaultBranch: 'main',
    logsDir,
    orchestratorStatePath,
    orchestratorName: id,
    recoveryState: detectRecoveryState([]),
    ctx: { issueNumber: issue.number, adwId, issueType },
    branchName,
    applicationUrl: 'http://localhost:0',
    repoContext: mockForgeProviders(SURFACE_REPO, worktreePath),
    projectConfig,
    applicationProfile,
    adwYmlConfig: readAdwYmlConfig(worktreePath),
    topLevelStatePath: AgentStateManager.getTopLevelStatePath(adwId),
    gitContext,
  };
}

export function buildPhaseConfig(world: RegressionWorld, adwId: string, orchestratorName: string): WorkflowConfig {
  return buildConfigFor(world, adwId, orchestratorDefinition(orchestratorName));
}
