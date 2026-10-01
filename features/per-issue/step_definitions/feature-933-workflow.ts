/**
 * The workflow the feature-933 commit scenarios run real phase functions over: a throwaway git
 * repository on a branch of its own, whose `origin` is a throwaway bare repository so that the push
 * after a commit lands without the network, and a real `GitContext` built through the launch boundary
 * of feature-796's `world796` harness with the GitHub App's identity injected. Every provider call
 * lands in `world796().activeCallLog`; nothing reaches GitHub.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

import type { Issue, RepoContext } from '@paysdoc/devplatform';
import type { GitIdentity } from '@paysdoc/devplatform/git';
import { resolveBootstrapGitIdentity } from '@paysdoc/devplatform/providers';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { AgentStateManager, detectRecoveryState, getDefaultProjectConfig } from '../../../adws/core/index.ts';
import type { WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';

import { buildRecordingBoundary, splitRepo, world796 } from './feature-796.steps.ts';

export interface Workflow933 {
  config: WorkflowConfig;
  issueNumber: number;
  adwId: string;
  branchName: string;
  worktreePath: string;
  logsDir: string;
}

export interface AddedCommit {
  sha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
}

const BASE_BRANCH = 'trunk';

const COMMIT_FORMAT = `${['%H', '%s', '%an', '%ae', '%cn', '%ce'].join('%x1f')}%x1e`;

const artefacts: { dirs: string[]; adwIds: string[] } = { dirs: [], adwIds: [] };

export function makeDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), prefix));
  artefacts.dirs.push(dir);
  return dir;
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Removes every directory a scenario made, and `agents/<adwId>` and `logs/<adwId>` for every adwId it used. */
export function removeScenarioArtefacts(): void {
  artefacts.dirs.splice(0).forEach(removeDir);
  artefacts.adwIds.splice(0).forEach(adwId => {
    removeDir(path.join(AGENTS_STATE_DIR, adwId));
    removeDir(path.join(LOGS_DIR, adwId));
  });
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The identity `resolveBootstrapGitIdentity` derives for the App: `<slug>[bot]`, `<id>+<slug>[bot]@users.noreply.github.com`. */
function appIdentityFor(slug: string, id: number): GitIdentity {
  return resolveBootstrapGitIdentity({
    env: { GITHUB_APP_ID: String(id), GITHUB_APP_SLUG: slug, GITHUB_APP_PRIVATE_KEY_PATH: '/nonexistent/adw-933-app.pem' },
  });
}

function uniqueAdwId(): string {
  return `bdd933-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** The repository's own identity is a stand-in until the scenario sets the host's. */
function initRepository(worktreePath: string, originPath: string, branchName: string): void {
  git(originPath, 'init', '-q', '--bare');
  git(worktreePath, 'init', '-q', '-b', branchName);
  git(worktreePath, 'config', 'commit.gpgsign', 'false');
  git(worktreePath, 'config', 'user.name', 'ADW BDD');
  git(worktreePath, 'config', 'user.email', 'bdd@adw.invalid');
  git(worktreePath, 'remote', 'add', 'origin', originPath);
  fs.writeFileSync(path.join(worktreePath, 'README.md'), '# Throwaway worktree\n');
  git(worktreePath, 'add', '--', 'README.md');
  git(worktreePath, 'commit', '-q', '-m', 'Start the throwaway worktree');
}

function buildIssue(issueNumber: number, owner: string, repo: string): Issue {
  return {
    id: String(issueNumber),
    number: issueNumber,
    title: `Commit identity scenario ${issueNumber}`,
    body: 'A phase commits the changes an agent made in the worktree.',
    state: 'open',
    author: 'tester',
    labels: [],
    comments: [],
    createdAt: new Date(0).toISOString(),
    url: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
  };
}

export function createWorkflow(issueNumber: number, repoStr: string, appSlug: string, appId: number): Workflow933 {
  const { owner, repo } = splitRepo(repoStr);
  const appIdentity = appIdentityFor(appSlug, appId);
  buildRecordingBoundary(owner, repo, { resolveGitIdentity: () => appIdentity });
  const w = world796();
  const boundary = w.boundary;
  assert.ok(boundary, 'Expected the recording launch boundary to have been built');
  artefacts.dirs.push(w.frameworkRoot, w.targetReposDir);

  const adwId = uniqueAdwId();
  artefacts.adwIds.push(adwId);
  const branchName = `bugfix-issue-${issueNumber}-app-commit-identity`;
  const worktreePath = makeDir('adw-933-worktree-');
  const logsDir = makeDir('adw-933-logs-');
  initRepository(worktreePath, makeDir('adw-933-origin-'), branchName);

  const repoContext: RepoContext = {
    issueTracker: boundary.providers.issueTracker,
    codeHost: boundary.providers.codeHost,
    boardManager: boundary.providers.boardManager,
    cwd: worktreePath,
    repoId: boundary.repoId,
  };
  const ctx: WorkflowContext = { issueNumber, adwId, issueType: '/bug', branchName };

  const config: WorkflowConfig = {
    issueNumber,
    adwId,
    issue: buildIssue(issueNumber, owner, repo),
    issueType: '/bug',
    worktreePath,
    defaultBranch: BASE_BRANCH,
    logsDir,
    orchestratorStatePath: AgentStateManager.initializeState(adwId, 'orchestrator'),
    orchestratorName: 'orchestrator',
    recoveryState: detectRecoveryState([]),
    ctx,
    branchName,
    applicationUrl: 'http://localhost:0',
    repoContext,
    projectConfig: getDefaultProjectConfig(),
    adwYmlConfig: { hitl: false, unitTests: false, guardrails: false },
    topLevelStatePath: AgentStateManager.getTopLevelStatePath(adwId),
    gitContext: boundary.gitContext,
  };

  return { config, issueNumber, adwId, branchName, worktreePath, logsDir };
}

/** `user.name` and `user.email` in the repository's local configuration: what git falls back on when the environment names no one. */
export function setHostIdentity(workflow: Workflow933, name: string, email: string): void {
  git(workflow.worktreePath, 'config', 'user.name', name);
  git(workflow.worktreePath, 'config', 'user.email', email);
}

/** Leaves the file uncommitted, as an agent leaves its work for the phase's commit. */
export function writeWorktreeFile(workflow: Workflow933, relativePath: string, content: string): void {
  const file = path.join(workflow.worktreePath, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Puts the files in the history the phase starts from. */
export function commitWorktreeFiles(workflow: Workflow933, files: Readonly<Record<string, string>>): void {
  const paths = Object.keys(files);
  paths.forEach(relativePath => writeWorktreeFile(workflow, relativePath, files[relativePath]));
  git(workflow.worktreePath, 'add', '--', ...paths);
  git(workflow.worktreePath, 'commit', '-q', '-m', 'Add the files the phase starts from');
}

export function headOf(worktreePath: string): string {
  return git(worktreePath, 'rev-parse', 'HEAD');
}

function toAddedCommit(record: string): AddedCommit {
  const [sha, subject, authorName, authorEmail, committerName, committerEmail] = record.split('\x1f');
  return { sha, subject, authorName, authorEmail, committerName, committerEmail };
}

/** Every commit after `base`, newest first, read with `git log`: no scenario trusts what a phase says it committed. */
export function commitsSince(worktreePath: string, base: string): AddedCommit[] {
  return git(worktreePath, 'log', `--format=${COMMIT_FORMAT}`, `${base}..HEAD`)
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(toAddedCommit);
}
