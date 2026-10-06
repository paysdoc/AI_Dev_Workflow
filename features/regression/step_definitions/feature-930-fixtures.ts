/**
 * Git fixtures for feature-930.feature: real temporary repositories and a real GitContext, so
 * the scenarios assert on what git recorded rather than on what a mock was called with.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trimEnd();
}

export function writeRepoFile(root: string, relPath: string, contents: string): void {
  const absolute = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, 'utf-8');
}

export function initRepo(dir: string, branch: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 'bdd930@adw.local');
  git(dir, 'config', 'user.name', 'BDD 930');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
}

export function commitFiles(dir: string, files: Readonly<Record<string, string>>, message: string): void {
  for (const [relPath, contents] of Object.entries(files)) writeRepoFile(dir, relPath, contents);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

/** Carries the path, so a copy taken from the wrong file shows in a failed comparison. */
export function contentsOnBranch(relPath: string): string {
  return `${relPath} as the branch has it\n`;
}

export function appendLine(dir: string, relPath: string, line: string): void {
  fs.appendFileSync(path.join(dir, relPath), `${line}\n`, 'utf-8');
}

export function readRepoFile(dir: string, relPath: string): string {
  return fs.readFileSync(path.join(dir, relPath), 'utf-8');
}

/** Staged, unstaged and untracked paths; untracked directories are expanded to their files. */
export function uncommittedPaths(dir: string): string[] {
  return git(dir, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
}

export function commitsSince(dir: string, base: string): string[] {
  return git(dir, 'rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean);
}

export function pathsInCommit(dir: string, sha: string): string[] {
  return git(dir, 'show', '--name-only', '--no-renames', '--format=', sha).split('\n').filter(Boolean);
}

export function newGitContext(owner: string, repo: string, root: string): GitContext {
  return new GitContext({
    owner,
    repo,
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('t'),
    gitIdentity: {
      authorName: 'BDD 930',
      authorEmail: 'bdd930@adw.local',
      committerName: 'BDD 930',
      committerEmail: 'bdd930@adw.local',
    },
    frameworkRepoRoot: root,
    targetReposDir: root,
  });
}
