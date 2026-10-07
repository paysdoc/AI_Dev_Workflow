/**
 * The workflow the feature-994 scenarios run the real scenario test phase, the real review phase and the real proof publish phase
 * over: a throwaway worktree whose ".adw/" is written as `adw_init` writes it, a recording issue tracker and code host, a recording
 * screenshot store installed in place of R2, and the stand-in scenario runner and review agent. No hooks and no steps.
 */

import assert from 'assert';
import * as fs from 'fs';
import type { CodeHost, IssueTracker, RepoContext } from '@paysdoc/devplatform';

import { AgentStateManager, detectRecoveryState } from '../../../adws/core/index.ts';
import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';
import type { WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import { declaredApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';
import { executeProofPublishPhase } from '../../../adws/phases/proofPublishPhase.ts';
import { executeReviewPhase } from '../../../adws/phases/reviewPhase.ts';
import { executeScenarioTestPhase } from '../../../adws/phases/scenarioTestPhase.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { setProofUploaderForTesting } from '../../../adws/proof/proofUploader.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { REPO_ID, createScreenshotStore } from './feature-937-world.ts';
import { freshAdwFiles, setRunScenariosByTag, writeAdwFiles } from './feature-992-adw-files.ts';
import { activateStandInAgent, deactivateStandInAgent, scriptVerdict } from './feature-994-agent.ts';
import type { RepositoryType } from './feature-994-names.ts';
import { createRunner, withRunnerOnPath, writeScript } from './feature-994-runner.ts';
import { buildScript, writeWorktreeFile } from './feature-994-scenarios.ts';
import { makeDirectory, requireStore, requireType, requireWorkflow, s } from './feature-994-world.ts';

function recordingIssueTracker(): Pick<IssueTracker, 'commentOnIssue' | 'fetchLabels'> {
  return {
    commentOnIssue: (number, body) => { s.issueComments.push({ number, body }); },
    fetchLabels: () => [],
  };
}

// Only the comment on a pull request is expected of the code host; any other call is a no-op.
function recordingCodeHost(): CodeHost {
  return new Proxy({} as CodeHost, {
    get: (_target, operation) => {
      if (operation === 'then') return undefined;
      if (operation === 'commentOnPullRequest') return (number: number, body: string) => { s.pullRequestComments.push({ number, body }); };
      return () => undefined;
    },
  });
}

// The scenario test phase only runs when the repository has step definitions where its runner looks for them.
function stepDefinitionFile(type: RepositoryType): string {
  return type === 'web' ? 'features/steps/steps.ts' : 'features/step_definitions/steps.ts';
}

function workflowConfig(issueNumber: number, adwId: string, worktreePath: string, logsDir: string): WorkflowConfig {
  const repoContext = {
    issueTracker: recordingIssueTracker(),
    codeHost: recordingCodeHost(),
    cwd: worktreePath,
    repoId: REPO_ID,
  } as unknown as RepoContext;
  const ctx: WorkflowContext = { issueNumber, adwId, issueType: '/feature' };

  return {
    issueNumber,
    adwId,
    issue: {
      id: String(issueNumber),
      number: issueNumber,
      title: `Per-issue scenario images scenario ${issueNumber}`,
      body: 'A change whose scenarios leave images.',
      state: 'open',
      author: 'tester',
      labels: [],
      comments: [],
      createdAt: new Date(0).toISOString(),
      url: `https://github.com/${REPO_ID.owner}/${REPO_ID.repo}/issues/${issueNumber}`,
    },
    issueType: '/feature',
    worktreePath,
    defaultBranch: 'main',
    logsDir,
    orchestratorStatePath: AgentStateManager.initializeState(adwId, 'orchestrator'),
    orchestratorName: 'orchestrator',
    recoveryState: detectRecoveryState([]),
    ctx,
    branchName: `feature-issue-${issueNumber}-per-issue-images`,
    applicationUrl: 'http://localhost:0',
    targetRepo: undefined,
    repoContext,
    adwYmlConfig: { hitl: false, unitTests: false },
    topLevelStatePath: '',
    gitContext: undefined,
  } as unknown as WorkflowConfig;
}

export function createWorkflow(issueNumber: number, type: RepositoryType): void {
  const adwId = `bdd994-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  s.adwIds.push(adwId);
  s.type = type;
  s.issueNumber = issueNumber;
  s.worktreePath = makeDirectory('adw-994-worktree-');
  s.runner = createRunner();
  s.store = createScreenshotStore();
  writeWorktreeFile(stepDefinitionFile(type), "// The repository's step definitions.\n");

  const config = workflowConfig(issueNumber, adwId, s.worktreePath, makeDirectory('adw-994-logs-'));
  s.workflow = { config, adwId, issueNumber, worktreePath: s.worktreePath };
}

/** Writes the worktree's ".adw/" as `adw_init` would have, and reads the configuration back, as `initializeWorkflow` does. */
function prepareWorkflow(): void {
  const { config, worktreePath } = requireWorkflow();
  const files = freshAdwFiles(requireType());
  if (s.runner && requireType() === 'cli') setRunScenariosByTag(files, `"${s.runner.scenarioCommand}" {tag}`);
  writeAdwFiles(worktreePath, files);
  s.adwFiles.forEach((content, file) => writeWorktreeFile(file, content));

  const projectConfig = loadProjectConfig(worktreePath);
  const applicationProfile = declaredApplicationProfile(projectConfig);
  assert.ok(applicationProfile, `The worktree's ".adw/project.md" declares no application type ADW knows: ${JSON.stringify(projectConfig.applicationType)}`);
  config.projectConfig = projectConfig;
  config.applicationProfile = applicationProfile;
}

export async function runScenarioTests(world: RegressionWorld): Promise<void> {
  const { config } = requireWorkflow();
  assert.ok(s.runner, 'Expected the stand-in scenario runner to have been installed');
  prepareWorkflow();
  writeScript(s.runner, buildScript());

  const { scenarioProof } = await withRunnerOnPath(s.runner, () => executeScenarioTestPhase(config));
  assert.ok(scenarioProof, 'Expected the scenario test phase to have run the scenarios of the repository');
  s.proof = scenarioProof;
  world.scenarioProofResult = scenarioProof;
}

// The last verdict repeats: "on every later review" is the verdict of the review after the last one the scenario names.
function verdictOfReview(reviewNumber: number): string | null {
  assert.ok(s.verdicts.length > 0, 'Expected the stand-in review agent to have been told how to judge the reviews');
  return s.verdicts[Math.min(reviewNumber, s.verdicts.length) - 1];
}

/** The proof is read as the review agent is handed it, before the next scenario run resets the proof directory. */
async function reviewProof(): Promise<void> {
  const { config, worktreePath } = requireWorkflow();
  assert.ok(s.proof, 'Expected the scenario test phase to have left a proof for the review phase to judge');
  s.reviewed.push({ path: s.proof.resultsFilePath, content: fs.readFileSync(s.proof.resultsFilePath, 'utf-8') });
  scriptVerdict(worktreePath, verdictOfReview(s.reviewed.length));
  await executeReviewPhase(config, s.proof.resultsFilePath);
}

/** The screenshot store and the review agent stand in for R2 and for Claude, for the run only. */
export async function runScenarioTestsThenReview(world: RegressionWorld): Promise<void> {
  setProofUploaderForTesting(requireStore().uploader);
  activateStandInAgent();
  try {
    await runScenarioTests(world);
    await reviewProof();
  } finally {
    deactivateStandInAgent();
    setProofUploaderForTesting(null);
  }
}

export async function publishProofOnPullRequest(pullRequestNumber: number): Promise<void> {
  const { config } = requireWorkflow();
  config.ctx.prUrl = `https://github.com/${REPO_ID.owner}/${REPO_ID.repo}/pull/${pullRequestNumber}`;
  setProofUploaderForTesting(requireStore().uploader);
  try {
    await executeProofPublishPhase(config);
  } finally {
    setProofUploaderForTesting(null);
  }
}
