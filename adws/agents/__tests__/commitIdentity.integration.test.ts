/**
 * An agent commits by running `git commit` itself, inside its own Claude Code process, so its commit
 * carries whatever identity its environment gives git. This test makes real commits in a real git
 * worktree through the real spawn path: no mocks, a stub CLI in place of Claude Code that runs
 * `git commit` the way the `/commit` and `/resolve_conflict` prompts tell an agent to.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import { resolveBootstrapGitIdentity } from '@paysdoc/devplatform/providers';

import { clearClaudeCodePathCache } from '../../core';
import { runClaudeAgentWithCommand, type AgentLaunchContext } from '../claudeAgent';
import { runCommitAgent } from '../gitAgent';

const APP_IDENTITY = resolveBootstrapGitIdentity({
  env: { GITHUB_APP_ID: '3112553', GITHUB_APP_SLUG: 'paysdoc-adw', GITHUB_APP_PRIVATE_KEY_PATH: '/unused/app.pem' },
});
const APP = 'paysdoc-adw[bot] <3112553+paysdoc-adw[bot]@users.noreply.github.com>';
const HOST = 'Host User <host@example.invalid>';

const COMMIT_MESSAGE = 'plan-orchestrator: feat: add identity plan';
const IDENTITY_ENV_KEYS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;
const RESULT_ENVELOPE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/jsonl/envelopes/result-message.jsonl');

let root: string;
let worktreePath: string;
let logsDir: string;
let ctx: GitContext;
let launchContext: AgentLaunchContext;
let savedCliPath: string | undefined;
let savedIdentityEnv: Partial<Record<(typeof IDENTITY_ENV_KEYS)[number], string>>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function commitIdentity(): string {
  return git(worktreePath, 'log', '-1', '--format=%an <%ae>|%cn <%ce>');
}

function writeStubCli(): string {
  const resultLine = JSON.parse(readFileSync(RESULT_ENVELOPE, 'utf-8').split('\n')[0]);
  const resultPath = join(root, 'result.jsonl');
  writeFileSync(resultPath, `${JSON.stringify({ ...resultLine, result: COMMIT_MESSAGE })}\n`);

  const stubPath = join(root, 'claude');
  writeFileSync(stubPath, `#!/bin/sh\ngit add -A && git commit -q -m '${COMMIT_MESSAGE}' || exit 1\ncat '${resultPath}'\n`);
  chmodSync(stubPath, 0o755);
  return stubPath;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adw-commit-identity-'));
  const repo = join(root, 'repo');
  const noHooks = join(root, 'no-hooks');
  mkdirSync(repo);
  mkdirSync(noHooks);

  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Host User');
  git(repo, 'config', 'user.email', 'host@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', noHooks);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'initial commit');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature-issue-1-identity', '.worktrees/feature-issue-1-identity');
  worktreePath = join(repo, '.worktrees', 'feature-issue-1-identity');

  logsDir = join(root, 'logs');
  mkdirSync(logsDir);

  savedCliPath = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = writeStubCli();
  savedIdentityEnv = {};
  for (const key of IDENTITY_ENV_KEYS) {
    savedIdentityEnv[key] = process.env[key];
    delete process.env[key];
  }
  clearClaudeCodePathCache();

  ctx = new GitContext({
    owner: 'acme',
    repo: 'widget',
    selfHost: true,
    tokenProvider: createLiteralTokenProvider('test-token'),
    gitIdentity: APP_IDENTITY,
    frameworkRepoRoot: repo,
    targetReposDir: root,
  });
  launchContext = { selfHost: true, adwId: 'identity-test', gitContext: ctx };

  writeFileSync(join(worktreePath, 'plan.md'), '# Plan\n');
});

afterEach(() => {
  if (savedCliPath === undefined) delete process.env['CLAUDE_CODE_PATH'];
  else process.env['CLAUDE_CODE_PATH'] = savedCliPath;
  for (const key of IDENTITY_ENV_KEYS) {
    const saved = savedIdentityEnv[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  clearClaudeCodePathCache();
  rmSync(root, { recursive: true, force: true });
});

describe('the identity of a commit an agent makes in a worktree', () => {
  it('derives the App identity the launch boundary hands the GitContext', () => {
    expect(`${APP_IDENTITY.authorName} <${APP_IDENTITY.authorEmail}>`).toBe(APP);
    expect(`${APP_IDENTITY.committerName} <${APP_IDENTITY.committerEmail}>`).toBe(APP);
  });

  it('is the App, as author and as committer, for a /commit agent started with no subprocessEnv', async () => {
    await runCommitAgent('plan-orchestrator', '/feature', '{}', logsDir, undefined, worktreePath, undefined, undefined, launchContext);

    expect(commitIdentity()).toBe(`${APP}|${APP}`);
  }, 30_000);

  it('is the App for the conflict resolver, whose agent finalizes its merge by running git commit', async () => {
    await runClaudeAgentWithCommand(
      '/resolve_conflict',
      ['identity-test', '', 'trunk'],
      'conflict-resolver',
      join(logsDir, 'resolve-conflict.jsonl'),
      'sonnet',
      undefined,
      undefined,
      undefined,
      worktreePath,
      undefined,
      undefined,
      undefined,
      launchContext,
    );

    expect(commitIdentity()).toBe(`${APP}|${APP}`);
  }, 30_000);

  it('is the host git config when the agent is given no launch context: the cause of the host-identity commits', async () => {
    await runCommitAgent('plan-orchestrator', '/feature', '{}', logsDir, undefined, worktreePath);

    expect(commitIdentity()).toBe(`${HOST}|${HOST}`);
  }, 30_000);
});
