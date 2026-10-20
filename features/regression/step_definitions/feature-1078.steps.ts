/**
 * The two phrases of the "A Plan Lost With Its Worktree on Resume" section of the vocabulary registry. The When
 * removes the worktree the first run of a workflow left, so that the second run rebuilds it from the branch alone;
 * the Then counts the comments of one kind on an issue. Every assertion reads a runtime artefact: the state file,
 * the workspace's worktrees and branches, and the requests the mock GitHub API recorded. No step reads a source file.
 */

import { Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync } from 'fs';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';
import { realGit } from '../support/fixtureWorktree.ts';
import { requireHarness } from '../support/subprocessHarness.ts';
import type { RegressionWorld } from './world.ts';

/** `git worktree list --porcelain` separates the worktrees with a blank line and names each one's checked-out branch. */
function worktreeOfBranch(workspacePath: string, branch: string): string | null {
  const entries = realGit(workspacePath, 'worktree', 'list', '--porcelain').split('\n\n');
  const entry = entries.map((block) => block.split('\n')).find((lines) => lines.includes(`branch refs/heads/${branch}`));
  return entry?.find((line) => line.startsWith('worktree '))?.slice('worktree '.length) ?? null;
}

function commentBodyOf(request: RecordedRequest): string | undefined {
  try {
    const { body } = JSON.parse(request.body) as { body?: unknown };
    return typeof body === 'string' ? body : undefined;
  } catch {
    return undefined;
  }
}

function firstLineOf(request: RecordedRequest): string {
  return (commentBodyOf(request) ?? '').split('\n')[0];
}

When(
  'the worktree of the workflow for adwId {string} is removed, leaving its branch',
  function (this: RegressionWorld, adwId: string) {
    const { workspacePath } = requireHarness(this);
    assert.ok(workspacePath, 'Expected the subprocess harness to hold the target workspace the first run worked in');
    const branch = AgentStateManager.readTopLevelState(adwId)?.branchName;
    assert.ok(branch, `Expected the state file for adwId "${adwId}" to record a branchName`);
    const worktree = worktreeOfBranch(workspacePath, branch);
    assert.ok(worktree, `Expected the workspace to list a worktree on the branch "${branch}"`);

    realGit(workspacePath, 'worktree', 'remove', '--force', worktree);

    assert.ok(!existsSync(worktree), `Expected the worktree ${worktree} to be gone after it was removed`);
    assert.doesNotThrow(
      () => realGit(workspacePath, 'rev-parse', '--verify', `refs/heads/${branch}`),
      `Expected the branch "${branch}" to survive the removal of its worktree`,
    );
  },
);

Then(
  'the mock GitHub API recorded exactly {int} comment(s) on issue {int} containing the text {string}',
  function (this: RegressionWorld, expected: number, issueNumber: number, text: string) {
    const matching = this.getRecordedRequests().filter(
      (request) => request.method === 'POST' && request.url.includes(`/issues/${issueNumber}/comments`) && commentBodyOf(request)?.includes(text),
    );
    const found = matching.length === 0 ? '' : `:\n${matching.map((request) => `  ${firstLineOf(request)}`).join('\n')}`;
    assert.strictEqual(matching.length, expected, `Expected exactly ${expected} comment(s) on issue ${issueNumber} containing "${text}", but recorded ${matching.length}${found}`);
  },
);
