/**
 * What the real static-check fix-round port needs from the throwaway worktree of a feature-989 phase
 * scenario: a branch named as the workflow's, a local bare repository as `origin` (the port publishes
 * each round's base and restores a rejected round from it), and a clean tree at the start of the phase.
 * Everything runs real git: nothing here fakes a push, a commit or a reset.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

import type { Workflow929 } from './feature-929-workflow.ts';
import { s } from './feature-988-world.ts';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function hasOrigin(worktreePath: string): boolean {
  return git(worktreePath, 'remote').split('\n').includes('origin');
}

/** Safe to call more than once: the second call finds the remote and does nothing. */
export function prepareBranchAndOrigin(workflow: Workflow929): void {
  const { worktreePath, config } = workflow;
  if (hasOrigin(worktreePath)) return;

  const originPath = fs.mkdtempSync(path.join(tmpdir(), 'adw-989-origin-'));
  s.directories.push(originPath);
  git(originPath, 'init', '-q', '--bare');

  git(worktreePath, 'checkout', '-q', '-B', config.branchName);
  git(worktreePath, 'remote', 'add', 'origin', originPath);
  // The port's own commits go through the machine's git configuration, which may sign.
  git(worktreePath, 'config', 'commit.gpgsign', 'false');
}

/**
 * Commits whatever the Given steps wrote, so that the first round's commit holds only what the fix agent
 * changed: swept into a round, a scenario's ".adw/commands.md" would get that round rejected.
 */
export function commitSetup(worktreePath: string): void {
  if (git(worktreePath, 'status', '--porcelain').trim() === '') return;
  git(worktreePath, 'add', '-A');
  git(worktreePath, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'scenario setup');
}

/** A file's lines, or none when the worktree has no such file. */
export function linesOfWorktreeFile(worktreePath: string, relativePath: string): string[] {
  const file = path.join(worktreePath, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n') : [];
}
