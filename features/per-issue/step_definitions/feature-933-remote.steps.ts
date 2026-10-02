/**
 * §2 of feature-933.feature: when an issue closes, the cleanup deletes the branch its workflow recorded
 * from the remote, unless that branch is the repository's default branch as the code host reports it.
 *
 * `handleIssueClosedEvent` runs with its production collaborators over a launch boundary whose
 * `GitContext` works in a real clone of a throwaway bare repository. `deleteRemoteBranch` is never
 * injected: its default is what is under test. Every assertion reads the branches on the bare
 * repository or the result the cleanup returns.
 */

import { Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { handleIssueClosedEvent, type IssueClosedResult } from '../../../adws/triggers/webhookHandlers.ts';

import { splitRepo, world796 } from './feature-796.steps.ts';
import { ensureBoundary, targetReposDir } from './feature-933-boundary.steps.ts';
import { trackAdwId } from './feature-933-fixture.ts';
import { createRemote, ensureRemoteBranch, remoteBranches, type Remote } from './feature-933-remote.ts';

const s: { remotes: Map<string, Remote>; cleanup: IssueClosedResult | null } = { remotes: new Map(), cleanup: null };

Before({ tags: '@adw-933' }, function () {
  s.remotes = new Map();
  s.cleanup = null;
});

function requireRemote(repoStr: string): Remote {
  const remote = s.remotes.get(repoStr);
  assert.ok(remote, `Expected a remote for ${repoStr} to have been set up first`);
  return remote;
}

Given('a remote for the target repository {string} whose default branch is {string}', function (repoStr: string, defaultBranch: string) {
  ensureBoundary(repoStr);
  const { owner, repo } = splitRepo(repoStr);
  s.remotes.set(repoStr, createRemote(targetReposDir(), owner, repo, defaultBranch));
});

Given('the workflow for issue {int} in {string} recorded the branch {string}', function (issueNumber: number, repoStr: string, branch: string) {
  ensureRemoteBranch(requireRemote(repoStr), branch);

  const adwId = `bdd933-issue-${issueNumber}`;
  trackAdwId(adwId);
  AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber, branchName: branch, workflowStage: 'completed' });

  const comment = { id: `comment-${issueNumber}`, body: `**ADW ID:** \`${adwId}\``, author: 'adw-bot[bot]', createdAt: new Date(0).toISOString() };
  const { activeFixture } = world796();
  assert.ok(activeFixture, 'Expected the recording issue tracker to have been set up first');
  activeFixture.issueComments.set(issueNumber, [comment]);
});

When('issue {int} in {string} is closed', async function (issueNumber: number, repoStr: string) {
  s.cleanup = await handleIssueClosedEvent(issueNumber, ensureBoundary(repoStr), undefined, []);
});

Then('the remote of {string} still holds the branch {string}', function (repoStr: string, branch: string) {
  const branches = remoteBranches(requireRemote(repoStr));
  assert.ok(branches.includes(branch), `Expected the remote of ${repoStr} to still hold "${branch}". It holds: ${branches.join(', ')}`);
});

Then('the remote of {string} no longer holds the branch {string}', function (repoStr: string, branch: string) {
  const branches = remoteBranches(requireRemote(repoStr));
  assert.ok(!branches.includes(branch), `Expected the remote of ${repoStr} to no longer hold "${branch}". It holds: ${branches.join(', ')}`);
});

Then('the issue-closed cleanup deleted no branch', function () {
  assert.ok(s.cleanup, 'Expected the issue-closed cleanup to have run');
  assert.strictEqual(s.cleanup.branchDeleted, false, 'Expected the issue-closed cleanup to delete no branch');
});
