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

import { executeBuildPhase } from '../../../adws/phases/buildPhase.ts';
import { executePlanPhase } from '../../../adws/phases/planPhase.ts';
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
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';
import { HARNESS_GIT_IDENTITY } from './fixtureWorktree.ts';
import { SURFACE_REPO, mockForgeProviders } from './mockForgeProviders.ts';

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

const ORCHESTRATORS: Readonly<Record<string, OrchestratorDefinition>> = {
  plan: { id: OrchestratorId.Plan, issueType: '/feature', phases: { plan: { fn: executePlanPhase } } },
  build: { id: OrchestratorId.Build, issueType: '/feature', phases: { build: { fn: executeBuildPhase, phaseName: 'build' } } },
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function labelName(label: unknown): string {
  if (typeof label === 'string') return label;
  return isRecord(label) && typeof label['name'] === 'string' ? label['name'] : '';
}

function toPortIssue(key: string, raw: unknown): Issue {
  const record = isRecord(raw) ? raw : {};
  const user = isRecord(record['user']) ? record['user'] : {};
  const number = Number(record['number'] ?? key);
  return {
    id: String(record['id'] ?? number),
    number,
    title: String(record['title'] ?? ''),
    body: String(record['body'] ?? ''),
    state: String(record['state'] ?? 'open'),
    author: String(user['login'] ?? ''),
    labels: (Array.isArray(record['labels']) ? record['labels'] : []).map(labelName).filter(Boolean),
    comments: [],
    createdAt: typeof record['created_at'] === 'string' ? record['created_at'] : new Date(0).toISOString(),
    url: `https://github.com/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}/issues/${number}`,
  };
}

/** G4 replaces the whole issue map, so after it the server holds exactly the issue the row seeded. */
function seededIssue(): Issue {
  const entries = Object.entries(getMockServerState().issues);
  assert.strictEqual(
    entries.length,
    1,
    `Expected the mock issue tracker to hold exactly the issue G4 seeded, but it holds: ${entries.map(([key]) => key).join(', ') || 'none'}`,
  );
  const [key, raw] = entries[0];
  return toPortIssue(key, raw);
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

export function buildPhaseConfig(world: RegressionWorld, adwId: string, orchestratorName: string): WorkflowConfig {
  const { id, issueType } = orchestratorDefinition(orchestratorName);
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
    projectConfig: loadProjectConfig(worktreePath),
    adwYmlConfig: readAdwYmlConfig(worktreePath),
    topLevelStatePath: AgentStateManager.getTopLevelStatePath(adwId),
    gitContext,
  };
}
