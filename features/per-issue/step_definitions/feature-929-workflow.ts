/**
 * The workflow the feature-929 scenarios run real phase functions over: a throwaway git
 * worktree (the build phase reads its HEAD tree hash), a real `GitContext`, and the
 * recording providers of feature-796's `world796` harness. No scenario in the feature
 * makes a network call: every provider call lands in `world796().activeCallLog`.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

import type { RepoContext } from '@paysdoc/devplatform';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import type { WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import { AgentStateManager, detectRecoveryState } from '../../../adws/core/index.ts';

import { world796, splitRepo, buildRecordingBoundary } from './feature-796.steps.ts';

export interface Workflow929 {
  config: WorkflowConfig;
  issueNumber: number;
  adwId: string;
  worktreePath: string;
  logsDir: string;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** Writes and commits one file, so the worktree stays clean for the phases that inspect it. */
export function commitFile(worktreePath: string, relativePath: string, content: string): void {
  const fullPath = path.join(worktreePath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  git(worktreePath, 'add', '--', relativePath);
  git(worktreePath, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `add ${relativePath}`);
}

function initRepository(worktreePath: string): void {
  git(worktreePath, 'init', '-q');
  git(worktreePath, 'config', 'user.name', 'ADW BDD');
  git(worktreePath, 'config', 'user.email', 'bdd@adw.invalid');
  commitFile(worktreePath, 'README.md', '# Throwaway worktree\n');
}

function uniqueAdwId(): string {
  return `bdd929-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createWorkflow(issueNumber: number, repoStr: string): Workflow929 {
  const { owner, repo } = splitRepo(repoStr);
  buildRecordingBoundary(owner, repo);
  const w = world796();
  const boundary = w.boundary;
  assert.ok(boundary, 'Expected the recording launch boundary to have been built');

  const adwId = uniqueAdwId();
  w.usedAdwIds.add(adwId);
  const worktreePath = fs.mkdtempSync(path.join(tmpdir(), 'adw-929-worktree-'));
  const logsDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-929-logs-'));
  w.tempDirs.push(worktreePath, logsDir);
  initRepository(worktreePath);

  const repoContext: RepoContext = {
    issueTracker: boundary.providers.issueTracker,
    codeHost: boundary.providers.codeHost,
    boardManager: boundary.providers.boardManager,
    cwd: worktreePath,
    repoId: boundary.repoId,
  };
  const issue = {
    id: String(issueNumber),
    number: issueNumber,
    title: `Context compaction scenario ${issueNumber}`,
    body: 'An agent whose context is compacted partway through its run.',
    state: 'open',
    author: 'tester',
    labels: [],
    comments: [],
    createdAt: new Date(0).toISOString(),
    url: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
  };
  const ctx: WorkflowContext = { issueNumber, adwId, issueType: '/bug' };

  const config = {
    issueNumber,
    adwId,
    issue,
    issueType: '/bug',
    worktreePath,
    defaultBranch: 'main',
    logsDir,
    orchestratorStatePath: AgentStateManager.initializeState(adwId, 'orchestrator'),
    orchestratorName: 'orchestrator',
    recoveryState: detectRecoveryState([]),
    ctx,
    branchName: `bug-issue-${issueNumber}-compaction`,
    applicationUrl: 'http://localhost:0',
    targetRepo: undefined,
    repoContext,
    projectConfig: {
      commands: { testFramework: 'vitest', runTests: 'bun run test:unit', runScenariosByTag: 'bunx cucumber-js --tags "@{tag}"' },
      scenarios: { bddFramework: 'cucumber-js' },
    },
    adwYmlConfig: { hitl: false, unitTests: false },
    topLevelStatePath: '',
    gitContext: boundary.gitContext,
  } as unknown as WorkflowConfig;

  return { config, issueNumber, adwId, worktreePath, logsDir };
}

/** The bodies of the comments the recording tracker received on one issue, oldest first. */
export function commentsOn(issueNumber: number): string[] {
  return world796().activeCallLog
    .filter(call => call.operation === 'commentOnIssue' && call.args[0] === issueNumber)
    .map(call => String(call.args[1]));
}
