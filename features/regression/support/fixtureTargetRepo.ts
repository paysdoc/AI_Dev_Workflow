/**
 * The target-repository workspace a subprocess run works in: the cli-tool fixture committed on `main`
 * at `<TARGET_REPOS_DIR>/<owner>/<repo>`, with the three things the target-repo path needs before it
 * will run. An `origin` whose URL parses to the workflow's owner/repo, since `bindWorkspaceContext`
 * otherwise binds no repository context and nothing is ever posted. A local `refs/remotes/origin/main`.
 * And a committed `.adw-version` equal to the framework's hash, since the upgrade gate otherwise parks
 * the issue and exits 0. The origin is never contacted: every child runs behind the git mock, which
 * turns fetch, clone and push into no-ops. Every git call here uses the real binary.
 */

import { cpSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { writeAdwVersion } from '../../../adws/core/adwVersion.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { computeFrameworkHash } from '../../../adws/core/hashComputer.ts';
import { commitFileOnBranch, initialiseRepository, realGit } from './fixtureWorktree.ts';

const FIXTURE_DIR = resolve(REPO_ROOT, 'test/fixtures/cli-tool');
const DEFAULT_BRANCH = 'main';

export function targetCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}

export function materialiseTargetWorkspace(owner: string, repo: string, targetReposDir: string): string {
  const workspace = join(targetReposDir, owner, repo);
  mkdirSync(dirname(workspace), { recursive: true });
  cpSync(FIXTURE_DIR, workspace, { recursive: true });
  writeAdwVersion(workspace, computeFrameworkHash(REPO_ROOT));

  initialiseRepository(workspace);
  realGit(workspace, 'remote', 'add', 'origin', targetCloneUrl(owner, repo));
  realGit(workspace, 'update-ref', `refs/remotes/origin/${DEFAULT_BRANCH}`, 'HEAD');
  realGit(workspace, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${DEFAULT_BRANCH}`);
  return workspace;
}

/** A branch off `main` holding one file, as `origin` would hold it. The workspace is back on `main` afterwards, so a worktree can be added for the branch. */
export function createRemoteBranch(workspace: string, branch: string, relPath: string, contents: string): void {
  realGit(workspace, 'checkout', '-q', '-b', branch);
  commitFileOnBranch(workspace, relPath, contents, `Add ${relPath}`);
  realGit(workspace, 'update-ref', `refs/remotes/origin/${branch}`, branch);
  realGit(workspace, 'checkout', '-q', DEFAULT_BRANCH);
}
