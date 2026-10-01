/**
 * The workflow the feature-937 scenarios run the real scenario test phase and the real review phase
 * over: a throwaway worktree, a recording issue tracker, and a scenario command that copies a fixed
 * proof run into the proof directory instead of starting a test suite.
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type { RepoContext } from '@paysdoc/devplatform';

import { AgentStateManager, detectRecoveryState } from '../../../adws/core/index.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { getDefaultProjectConfig, type ProjectConfig } from '../../../adws/core/projectConfig.ts';
import type { WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import { executeReviewPhase } from '../../../adws/phases/reviewPhase.ts';
import { executeScenarioTestPhase } from '../../../adws/phases/scenarioTestPhase.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { setProofUploaderForTesting } from '../../../adws/proof/proofUploader.ts';
import { activateStandInAgent, deactivateStandInAgent, scriptStandInVerdict } from './feature-937-agent.ts';
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

const PASSING_JUNIT_REPORT =
  '<?xml version="1.0" encoding="UTF-8"?><testsuite name="cucumber-js" tests="1" failures="0" skipped="0">' +
  '<testcase name="The proof run" classname="features.proof"/></testsuite>';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Whatever the tag, the command leaves the proof run in $ADW_PROOF_DIR and reports one passing scenario.
function proofRunCommand(proofRunDir: string): string {
  return [
    'mkdir -p "$ADW_PROOF_DIR"',
    `cp -R ${shellQuote(`${proofRunDir}/.`)} "$ADW_PROOF_DIR/"`,
    `printf '%s' ${shellQuote(PASSING_JUNIT_REPORT)} > "$ADW_JUNIT_REPORT_PATH"`,
    'echo "1 scenarios (1 passed)"',
  ].join(' && ');
}

function repositoryProjectConfig(proofRunDir: string): ProjectConfig {
  const defaults = getDefaultProjectConfig();
  return {
    ...defaults,
    commands: { ...defaults.commands, startDevServer: 'N/A', runScenariosByTag: proofRunCommand(proofRunDir) },
    scenariosMd: SCENARIOS_MD,
  };
}

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), prefix));
  world.tempDirs.push(dir);
  return dir;
}

// The scenario test phase only runs when the repository has step definitions in its step-definition directory.
function writeStepDefinitionFile(worktreePath: string): void {
  const stepDefinitionDir = path.join(worktreePath, 'features', 'step_definitions');
  fs.mkdirSync(stepDefinitionDir, { recursive: true });
  fs.writeFileSync(path.join(stepDefinitionDir, 'proof.steps.ts'), '// The repository\'s step definitions.\n');
}

export function createReviewWorkflow(issueNumber: number, adwId: string): ReviewWorkflow {
  // A state directory left by a crashed earlier run would let an assertion pass without this run writing it.
  fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  world.adwIds.push(adwId);

  const worktreePath = makeTempDir('adw-937-worktree-');
  const logsDir = makeTempDir('adw-937-logs-');
  const proofRunDir = makeTempDir('adw-937-proof-run-');
  writeStepDefinitionFile(worktreePath);

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
    projectConfig: repositoryProjectConfig(proofRunDir),
    adwYmlConfig: { hitl: false, unitTests: false, guardrails: false },
    topLevelStatePath: '',
    gitContext: undefined,
  } as unknown as WorkflowConfig;

  return { config, issueNumber, adwId, worktreePath, proofRunDir };
}

function writeFixture(dir: string, relPath: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, fixtureBytes(relPath));
}

/** Changes what the scenario command copies into the proof directory from the next run on. */
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
 * reported none), as the orchestrators do. The stand-in store and agent are installed for the run only.
 */
export async function runScenarioTestsThenReview(): Promise<void> {
  const { config, worktreePath } = requireWorkflow();
  setProofUploaderForTesting(requireStore().uploader);
  activateStandInAgent();
  try {
    const { scenarioProof } = await executeScenarioTestPhase(config);
    const proofPath = scenarioProof?.resultsFilePath ?? '';
    scriptStandInVerdict(worktreePath, proofPath);
    world.outcome = await judgeProof(config, proofPath);
  } finally {
    deactivateStandInAgent();
    setProofUploaderForTesting(null);
  }
}
