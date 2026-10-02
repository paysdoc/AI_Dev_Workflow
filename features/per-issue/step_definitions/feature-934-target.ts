/**
 * The throwaway target of the promotion-sweep scenarios: a bare repository standing in for
 * "acme/widgets", a seed clone the Givens commit through, and the cron host's checkout, a clone
 * taken lazily so a later Given can still change the remote after it.
 *
 * A hook in the bare repository refuses every push that updates the default branch and records
 * the attempt. The default branch then changes only through `mergeBranchIntoDefault`, the fake
 * code host's merge: a real three-way merge computed inside the bare repository, whose ref update
 * no push hook sees. Fixture commits pass the hook with `FIXTURE_ALLOW_DIRECT_PUSH`, which only
 * the fixture's own `git push` sets — the sweep under test never does.
 *
 * Nothing here talks to GitHub.
 */

import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const DAY_MS = 86_400_000;
const IDENTITY_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
};

export interface Target {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly root: string;
  readonly remote: string;
  readonly seed: string;
  /** The `targetReposDir` of the GitContext bound to this target. */
  readonly hostsDir: string;
  readonly hostCheckout: string;
  readonly attemptsLog: string;
  /** Scenarios the fixture itself added to per-issue features inside the 90-day window. */
  addedScenarios: number;
}

export interface HostSnapshot {
  readonly branch: string;
  readonly head: string;
  readonly status: string;
}

function gitRaw(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...IDENTITY_ENV, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): string {
  return gitRaw(cwd, args, env).trim();
}

function refusingHook(defaultBranch: string, attemptsLog: string): string {
  return [
    '#!/bin/sh',
    'while read old new ref; do',
    `  if [ "$ref" = "refs/heads/${defaultBranch}" ] && [ -z "$FIXTURE_ALLOW_DIRECT_PUSH" ]; then`,
    `    echo "$ref $old $new" >> "${attemptsLog}"`,
    `    echo "remote: ${defaultBranch} accepts changes only through merged pull requests" >&2`,
    '    exit 1',
    '  fi',
    'done',
    'exit 0',
    '',
  ].join('\n');
}

export function createTarget(owner: string, repo: string, defaultBranch: string): Target {
  const root = mkdtempSync(path.join(tmpdir(), 'adw-934-'));
  const hostsDir = path.join(root, 'hosts');
  const target: Target = {
    owner,
    repo,
    defaultBranch,
    root,
    remote: path.join(root, 'remote.git'),
    seed: path.join(root, 'seed'),
    hostsDir,
    hostCheckout: path.join(hostsDir, owner, repo),
    attemptsLog: path.join(root, 'direct-push-attempts.log'),
    addedScenarios: 0,
  };

  git(root, ['init', '--bare', '-b', defaultBranch, target.remote]);
  const hookPath = path.join(target.remote, 'hooks', 'pre-receive');
  writeFileSync(hookPath, refusingHook(defaultBranch, target.attemptsLog));
  chmodSync(hookPath, 0o755);

  git(root, ['clone', target.remote, target.seed]);
  git(target.seed, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  commitToDefault(target, { 'README.md': `# ${repo}\n` }, 'chore: seed the target', 100);
  return target;
}

export function removeTarget(target: Target): void {
  rmSync(target.root, { recursive: true, force: true });
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Commits `files` onto the default branch's current tip, dated `daysAgo` days before now. */
export function commitToDefault(
  target: Target,
  files: Readonly<Record<string, string | null>>,
  message: string,
  daysAgo = 0,
): void {
  const branch = target.defaultBranch;
  if (branchExistsOnRemote(target, branch)) {
    git(target.seed, ['fetch', 'origin', branch]);
    git(target.seed, ['reset', '--hard', `origin/${branch}`]);
  }
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(target.seed, relPath);
    if (content === null) rmSync(full, { force: true });
    else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  git(target.seed, ['add', '--all']);
  const when = daysAgoIso(daysAgo);
  git(target.seed, ['commit', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  git(target.seed, ['push', 'origin', `HEAD:${branch}`], { FIXTURE_ALLOW_DIRECT_PUSH: '1' });
}

/** The file's text on the remote default branch, or null when it is not tracked there. */
export function readOnDefault(target: Target, relPath: string): string | null {
  try {
    return gitRaw(target.remote, ['show', `${target.defaultBranch}:${relPath}`]);
  } catch {
    return null;
  }
}

export function trackedOnDefault(target: Target, relPath: string): boolean {
  return git(target.remote, ['ls-tree', '--name-only', target.defaultBranch, '--', relPath]) === relPath;
}

export function directPushAttempts(target: Target): string[] {
  return existsSync(target.attemptsLog)
    ? readFileSync(target.attemptsLog, 'utf-8').split('\n').filter(line => line.trim().length > 0)
    : [];
}

export function branchExistsOnRemote(target: Target, branch: string): boolean {
  return git(target.remote, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]) !== '';
}

export interface MergeResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Paths the merge changed on the default branch. */
  readonly files: readonly string[];
}

/** A real three-way merge of `branch` into the default branch, committed as a merge commit. */
export function mergeBranchIntoDefault(target: Target, branch: string, message: string): MergeResult {
  const base = target.defaultBranch;
  try {
    const head = git(target.remote, ['rev-parse', base]);
    const tree = git(target.remote, ['merge-tree', '--write-tree', base, branch]).split('\n')[0];
    const merged = git(target.remote, ['commit-tree', tree, '-p', head, '-p', branch, '-m', message]);
    git(target.remote, ['update-ref', `refs/heads/${base}`, merged, head]);
    const files = git(target.remote, ['diff', '--name-only', head, merged]).split('\n').filter(Boolean);
    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: String(err), files: [] };
  }
}

/** Takes the cron host's checkout now, unless an earlier Given already took it. */
export function ensureHostCheckout(target: Target): void {
  if (existsSync(path.join(target.hostCheckout, '.git'))) return;
  mkdirSync(path.dirname(target.hostCheckout), { recursive: true });
  git(target.root, ['clone', '--branch', target.defaultBranch, target.remote, target.hostCheckout]);
}

export function snapshotHost(target: Target): HostSnapshot {
  const cwd = target.hostCheckout;
  return {
    branch: git(cwd, ['branch', '--show-current']),
    head: git(cwd, ['rev-parse', 'HEAD']),
    status: git(cwd, ['status', '--porcelain']),
  };
}

export function worktreesOf(target: Target): string[] {
  return git(target.hostCheckout, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter(line => line.startsWith('worktree '));
}

export function leftoverWorktreeDirs(target: Target): string[] {
  const dir = path.join(target.hostCheckout, '.worktrees');
  return existsSync(dir) ? readdirSync(dir) : [];
}
