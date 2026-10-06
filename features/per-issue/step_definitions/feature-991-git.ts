/**
 * The repository a feature-991 workflow runs in has a local bare `origin` whose default branch stands where the
 * workflow's worktree stands, so that what the default branch gains later is what the gate's merge brings in.
 * Everything runs real git: nothing here fakes a push, a clone or a merge.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

import type { Workflow929 } from './feature-929-workflow.ts';
import { s as sharedWorld } from './feature-988-world.ts';
import { prepareBranchAndOrigin } from './feature-989-git.ts';

const IDENTITY_OPTIONS = ['-c', 'user.name=ADW BDD', '-c', 'user.email=bdd@adw.invalid', '-c', 'commit.gpgsign=false'];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/** Gives the worktree a local bare `origin` and publishes the commit the worktree stands at as that origin's default branch. */
export function publishDefaultBranch(workflow: Workflow929): void {
  prepareBranchAndOrigin(workflow);
  git(workflow.worktreePath, 'push', '-q', 'origin', `HEAD:refs/heads/${workflow.config.defaultBranch}`);
}

/**
 * Adds a commit to the default branch of the worktree's `origin`. The commit is made in a clone of its own, so that
 * the worktree stays as it was until the workflow itself merges the default branch.
 */
export function commitToDefaultBranch(workflow: Workflow929, relativePath: string, content: string): void {
  const { worktreePath, config } = workflow;
  const origin = git(worktreePath, 'remote', 'get-url', 'origin').trim();
  const clone = fs.mkdtempSync(path.join(tmpdir(), 'adw-991-default-branch-'));
  sharedWorld.directories.push(clone);

  git(clone, 'clone', '-q', '--branch', config.defaultBranch, origin, '.');
  const file = path.join(clone, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  git(clone, 'add', '--', relativePath);
  git(clone, ...IDENTITY_OPTIONS, 'commit', '-q', '-m', `add ${relativePath}`);
  git(clone, 'push', '-q', 'origin', `HEAD:refs/heads/${config.defaultBranch}`);
}
