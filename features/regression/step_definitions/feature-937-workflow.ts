/**
 * The workflow the feature-937 scenarios run the real scenario test phase and the real review phase
 * over: a throwaway worktree of a `web` repository, a recording issue tracker, and a stand-in for the
 * Playwright run that leaves a fixed proof run, attached to the issue's scenario, instead of starting a browser.
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type { RepoContext } from '@paysdoc/devplatform';

import { AgentStateManager, detectRecoveryState } from '../../../adws/core/index.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { ADW_PLAYWRIGHT_PROJECT_DIR, ADW_PLAYWRIGHT_STEP_DEF_DIR } from '../../../adws/core/adwPlaywrightProject.ts';
import { APPLICATION_TYPE_PROFILES } from '../../../adws/core/applicationType.ts';
import { getDefaultProjectConfig, type ProjectConfig } from '../../../adws/core/projectConfig.ts';
import type { WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import { executeReviewPhase } from '../../../adws/phases/reviewPhase.ts';
import { executeScenarioTestPhase } from '../../../adws/phases/scenarioTestPhase.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { setProofUploaderForTesting } from '../../../adws/proof/proofUploader.ts';
import { activateStandInAgent, deactivateStandInAgent, scriptStandInVerdict } from './feature-937-agent.ts';
import { ISSUE_FEATURE_FILE, installStandInNpx, issueFeature, withStandInNpxOnPath } from './feature-937-runner.ts';
import {
  REPO_ID,
  fixtureBytes,
  recordingCodeHost,
  recordingIssueTracker,
  requireStore,
  requireWorkflow,
  world,
  type ProofRun,
  type ReviewOutcome,
  type ReviewWorkflow,
} from './feature-937-world.ts';

const SCENARIOS_MD = '# Scenarios\n\nThe BDD scenarios of the workflow\'s repository.\n';

// Only a `web` repository's per-issue scenarios yield images that count as evidence, so only there does the review comment show any.
function repositoryProjectConfig(): ProjectConfig {
  const defaults = getDefaultProjectConfig();
  return {
    ...defaults,
    applicationType: 'web',
    commands: { ...defaults.commands, startDevServer: 'N/A' },
    scenariosMd: SCENARIOS_MD,
  };
}

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), prefix));
  world.tempDirs.push(dir);
  return dir;
}

function writeWorktreeFile(worktreePath: string, relPath: string, content: string): void {
  const fullPath = path.join(worktreePath, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// The scenario test phase only runs when the repository has step definitions where its runner looks for them, and the run
// command installs the Playwright project unless the worktree already holds it, as it does once the unit-test phase has run.
function writeWebRepository(worktreePath: string, issueNumber: number): void {
  writeWorktreeFile(worktreePath, path.join(ADW_PLAYWRIGHT_STEP_DEF_DIR, 'proof.steps.ts'), '// The repository\'s step definitions.\n');
  writeWorktreeFile(worktreePath, ISSUE_FEATURE_FILE, issueFeature(issueNumber));
  fs.mkdirSync(path.join(worktreePath, ADW_PLAYWRIGHT_PROJECT_DIR, 'node_modules'), { recursive: true });
}

export function createReviewWorkflow(issueNumber: number, adwId: string): ReviewWorkflow {
  // A state directory left by a crashed earlier run would let an assertion pass without this run writing it.
  fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  world.adwIds.push(adwId);

  const worktreePath = makeTempDir('adw-937-worktree-');
  const logsDir = makeTempDir('adw-937-logs-');
  const proofRunDir = makeTempDir('adw-937-proof-run-');
  const runnerBinDir = path.join(makeTempDir('adw-937-runner-'), 'bin');
  writeWebRepository(worktreePath, issueNumber);
  installStandInNpx(runnerBinDir, proofRunDir);

  const repoContext = {
    issueTracker: recordingIssueTracker(),
    codeHost: recordingCodeHost(),
    cwd: worktreePath,
    repoId: REPO_ID,
  } as unknown as RepoContext;
  const ctx: WorkflowContext = { issueNumber, adwId, issueType: '/feature' };

  const config = {
    issueNumber,
    adwId,
    issue: {
      id: String(issueNumber),
      number: issueNumber,
      title: `Review screenshots scenario ${issueNumber}`,
      body: 'A review whose proof run leaves screenshots.',
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
    branchName: `feature-issue-${issueNumber}-review-screenshots`,
    applicationUrl: 'http://localhost:0',
    targetRepo: undefined,
    repoContext,
    projectConfig: repositoryProjectConfig(),
    adwYmlConfig: { hitl: false, unitTests: false },
    applicationProfile: APPLICATION_TYPE_PROFILES.web,
    topLevelStatePath: '',
    gitContext: undefined,
  } as unknown as WorkflowConfig;

  return { config, issueNumber, adwId, worktreePath, proofRunDir, runnerBinDir };
}

function writeFixture(dir: string, relPath: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, fixtureBytes(relPath));
}

/** Changes what the stand-in Playwright run copies into the proof directory, and attaches, from the next run on. */
export function setProofRun(proofRun: ProofRun): void {
  const { proofRunDir } = requireWorkflow();
  fs.rmSync(proofRunDir, { recursive: true, force: true });
  fs.mkdirSync(proofRunDir, { recursive: true });
  [...proofRun.screenshots, ...proofRun.otherFiles].forEach(relPath => writeFixture(proofRunDir, relPath));
  world.proofRun = proofRun;
}

export function removeScenarios(): void {
  const { config } = requireWorkflow();
  Object.assign(config, { projectConfig: { ...config.projectConfig, scenariosMd: '' } });
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function judgeProof(config: WorkflowConfig, proofPath: string): Promise<ReviewOutcome> {
  try {
    const { reviewPassed } = await executeReviewPhase(config, proofPath);
    return { returned: true, reviewPassed };
  } catch (error) {
    return { returned: false, failure: describeFailure(error) };
  }
}

/**
 * Runs the scenario tests, then the review over the proof they reported (an empty path when they
 * reported none), as the orchestrators do. The stand-in store and agent are installed for the run only,
 * and the stand-in Playwright run for the scenario tests only.
 */
export async function runScenarioTestsThenReview(): Promise<void> {
  const { config, worktreePath, runnerBinDir } = requireWorkflow();
  setProofUploaderForTesting(requireStore().uploader);
  activateStandInAgent();
  try {
    const { scenarioProof } = await withStandInNpxOnPath(runnerBinDir, () => executeScenarioTestPhase(config));
    const proofPath = scenarioProof?.resultsFilePath ?? '';
    scriptStandInVerdict(worktreePath, proofPath);
    world.outcome = await judgeProof(config, proofPath);
  } finally {
    deactivateStandInAgent();
    setProofUploaderForTesting(null);
  }
}
