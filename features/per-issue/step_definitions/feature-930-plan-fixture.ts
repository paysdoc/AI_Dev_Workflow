/**
 * The plan phase's fixture for feature-930.feature: a real temporary repository and GitContext, a
 * WorkflowConfig for executePlanPhase, and the Claude CLI stand-in.
 *
 * The stand-in is test/mocks/claude-cli-stub.ts, reached through a wrapper script that hands it a
 * manifest kept OUTSIDE the worktree: the stub's own marker file would otherwise sit in the
 * worktree and be swept into every commit that stages everything.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import type { GitContext } from '@paysdoc/devplatform/git';

import { AgentStateManager, detectRecoveryState } from '../../../adws/core/index.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { git, initRepo, appendLine, readRepoFile, writeRepoFile, newGitContext } from './feature-930-fixtures.ts';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLAUDE_CLI_STUB_PATH = path.join(FRAMEWORK_ROOT, 'test/mocks/claude-cli-stub.ts');
const PLAN_PAYLOAD_PATH = path.join(FRAMEWORK_ROOT, 'test/fixtures/jsonl/payloads/plan-agent.json');

interface StandInManifest {
  jsonlPath: string;
  edits: { path: string; contents: string }[];
  deletes: string[];
  stage: string[];
  commitAll?: { subject: string };
  onCommitCommand: 'stage-all-and-commit';
}

export interface PlanScenario {
  readonly root: string;
  readonly worktreePath: string;
  readonly gitContext: GitContext;
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
  readonly adwId: string;
  readonly planFile: string;
  readonly manifest: StandInManifest;
  readonly manifestPath: string;
  headBefore: string;
  phaseError: Error | null;
}

export function newPlanScenario(issueNumber: number, repoFullName: string): PlanScenario {
  const [owner, repo] = repoFullName.split('/');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-930-'));
  const worktreePath = path.join(root, 'worktree');
  initRepo(worktreePath, `feature-issue-${issueNumber}-plan-commit`);
  const adwId = `bdd930-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    root,
    worktreePath,
    gitContext: newGitContext(owner, repo, root),
    owner,
    repo,
    issueNumber,
    adwId,
    planFile: `specs/issue-${issueNumber}-adw-${adwId}-sdlc_planner-plan-only.md`,
    manifest: { jsonlPath: PLAN_PAYLOAD_PATH, edits: [], deletes: [], stage: [], onCommitCommand: 'stage-all-and-commit' },
    manifestPath: path.join(root, 'stand-in-manifest.json'),
    headBefore: '',
    phaseError: null,
  };
}

export function removeScenarioFiles(sc: PlanScenario): void {
  fs.rmSync(sc.root, { recursive: true, force: true });
  fs.rmSync(path.join(AGENTS_STATE_DIR, sc.adwId), { recursive: true, force: true });
  fs.rmSync(path.join(LOGS_DIR, sc.adwId), { recursive: true, force: true });
}

export function flushManifest(sc: PlanScenario): void {
  fs.writeFileSync(sc.manifestPath, JSON.stringify(sc.manifest), 'utf-8');
}

let savedClaudeCodePath: string | undefined;
let claudeCliReplaced = false;

/** `CLAUDE_CODE_PATH` must name an executable, and the agent runner filters MOCK_* out of the child's environment, so the manifest's location travels in this wrapper. */
export function installClaudeCliStandIn(sc: PlanScenario): void {
  const scriptPath = path.join(sc.root, 'claude');
  fs.writeFileSync(
    scriptPath,
    ['#!/bin/sh', `export MOCK_MANIFEST_PATH='${sc.manifestPath}'`, 'export MOCK_STREAM_DELAY_MS=0', `exec bun '${CLAUDE_CLI_STUB_PATH}' "$@"`, ''].join('\n'),
    { mode: 0o755 },
  );
  flushManifest(sc);
  savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = scriptPath;
  clearClaudeCodePathCache();
  claudeCliReplaced = true;
}

export function restoreClaudeCli(): void {
  if (!claudeCliReplaced) return;
  if (savedClaudeCodePath === undefined) delete process.env['CLAUDE_CODE_PATH'];
  else process.env['CLAUDE_CODE_PATH'] = savedClaudeCodePath;
  clearClaudeCodePathCache();
  claudeCliReplaced = false;
}

export function buildIssue(sc: PlanScenario) {
  return {
    id: String(sc.issueNumber),
    number: sc.issueNumber,
    title: 'Test issue',
    body: 'Test issue body',
    state: 'open',
    author: 'tester',
    labels: [],
    comments: [],
    createdAt: new Date(0).toISOString(),
    url: `https://github.com/${sc.owner}/${sc.repo}/issues/${sc.issueNumber}`,
  };
}

export function buildWorkflowConfig(sc: PlanScenario): WorkflowConfig {
  return {
    issueNumber: sc.issueNumber,
    adwId: sc.adwId,
    issue: buildIssue(sc),
    issueType: '/feature',
    worktreePath: sc.worktreePath,
    defaultBranch: 'main',
    logsDir: path.join(sc.root, 'logs'),
    orchestratorStatePath: AgentStateManager.initializeState(sc.adwId, 'orchestrator'),
    orchestratorName: 'orchestrator',
    recoveryState: detectRecoveryState([]),
    ctx: { issueNumber: sc.issueNumber, adwId: sc.adwId, issueType: '/feature' },
    branchName: git(sc.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'),
    applicationUrl: 'http://localhost:0',
    targetRepo: { owner: sc.owner, repo: sc.repo, cloneUrl: '' },
    repoContext: undefined,
    projectConfig: {},
    adwYmlConfig: { hitl: false, unitTests: true },
    topLevelStatePath: '',
    gitContext: sc.gitContext,
  } as unknown as WorkflowConfig;
}

type Change = 'creates' | 'modifies' | 'modifies and stages' | 'deletes';

export function asChange(raw: string): Change {
  assert.ok(['creates', 'modifies', 'modifies and stages', 'deletes'].includes(raw), `Unknown change "${raw}"`);
  return raw as Change;
}

export function planPlannerChange(sc: PlanScenario, change: Change, relPath: string): void {
  if (change === 'deletes') {
    sc.manifest.deletes.push(relPath);
    return;
  }
  const contents = change === 'creates'
    ? 'created by the planner\n'
    : `${readRepoFile(sc.worktreePath, relPath)}modified by the planner\n`;
  sc.manifest.edits.push({ path: relPath, contents });
  if (change === 'modifies and stages') sc.manifest.stage.push(relPath);
}

export function leaveChangeInWorktree(sc: PlanScenario, change: Change, relPath: string): void {
  assert.ok(change === 'creates' || change === 'modifies', `Worktree setup only creates or modifies files, not "${change}"`);
  if (change === 'creates') writeRepoFile(sc.worktreePath, relPath, 'left by worktree setup\n');
  else appendLine(sc.worktreePath, relPath, 'stale copy left by worktree setup');
}

export function planPlanFile(sc: PlanScenario): void {
  sc.manifest.edits.push({ path: sc.planFile, contents: '# Plan\n\nThe plan the planner wrote.\n' });
}
