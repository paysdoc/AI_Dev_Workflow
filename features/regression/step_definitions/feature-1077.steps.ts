/**
 * The Thens of the full adwSdlc scenario of feature-1077.feature, which read the worktree the run left
 * and the .gitignore its branch committed. The scenario carries `@subprocess`, so the
 * `@regression and (@subprocess or @webhook)` hooks give it the mock infrastructure and the subprocess
 * harness these steps read the workspace from.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';
import { requireHarness } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

function workspaceOfRun(world: RegressionWorld): string {
  const { workspacePath } = requireHarness(world);
  assert.ok(workspacePath, 'Expected the subprocess harness to hold the target workspace the run worked in');
  return workspacePath;
}

function branchOfWorkflow(adwId: string): string {
  const branch = AgentStateManager.readTopLevelState(adwId)?.branchName;
  assert.ok(branch, `Expected the state file for adwId "${adwId}" to record a branchName`);
  return branch;
}

/** `git worktree list --porcelain` separates the worktrees with a blank line and names each one's checked-out branch. */
function worktreeOfBranch(workspacePath: string, branch: string): string | null {
  const entries = realGit(workspacePath, 'worktree', 'list', '--porcelain').split('\n\n');
  const entry = entries.map((block) => block.split('\n')).find((lines) => lines.includes(`branch refs/heads/${branch}`));
  return entry?.find((line) => line.startsWith('worktree '))?.slice('worktree '.length) ?? null;
}

/** The `.gitignore` file and pattern that `git check-ignore -v` names, as `<file>:<line>:<pattern>`; null when nothing ignores the path. */
function ignoredBy(dir: string, relPath: string): string | null {
  try {
    return realGit(dir, 'check-ignore', '-v', '--', relPath).split('\t')[0];
  } catch {
    return null;
  }
}

Then(
  'the worktree of the workflow for adwId {string} still holds {string}, which git ignores',
  function (this: RegressionWorld, adwId: string, relPath: string) {
    const workspace = workspaceOfRun(this);
    const branch = branchOfWorkflow(adwId);
    const worktree = worktreeOfBranch(workspace, branch);
    assert.ok(worktree, `Expected the workspace to list a worktree on the branch "${branch}"`);
    assert.ok(fs.existsSync(path.join(worktree, relPath)), `Expected the worktree ${worktree} to still hold "${relPath}"`);
    assert.ok(ignoredBy(worktree, relPath), `Expected git to ignore "${relPath}" in the worktree ${worktree}`);
  },
);

Then(
  'the {string} committed on the branch of the workflow for adwId {string} has git ignore {string}',
  function (this: RegressionWorld, file: string, adwId: string, relPath: string) {
    const workspace = workspaceOfRun(this);
    const branch = branchOfWorkflow(adwId);
    const committed = realGit(workspace, 'show', `${branch}:${file}`);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1077-committed-ignore-'));
    try {
      realGit(scratch, 'init', '-q');
      fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
      fs.writeFileSync(path.join(scratch, file), `${committed}\n`, 'utf-8');
      const ignoring = ignoredBy(scratch, relPath);
      assert.ok(ignoring, `Expected the "${file}" committed on "${branch}" to have git ignore "${relPath}"; it holds:\n${committed}`);
      assert.ok(ignoring.startsWith(`${file}:`), `Expected "${file}" to be what ignores "${relPath}", but git named ${ignoring}`);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
);
