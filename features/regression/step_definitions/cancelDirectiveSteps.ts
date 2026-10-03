/**
 * Steps of the "Cancel Directive" section of the vocabulary registry: the Givens that seed what a
 * `## Cancel` comment resets (an ADW workflow comment, a worktree), the When that delivers the
 * comment to the real `dispatchWebhookEvent`, and the Thens that read what the cancel handler left.
 * Every Then reads a runtime artefact: the `agents/<adwId>/` directory, git's own listings of the
 * target workspace, or the requests the mock GitHub API recorded. No step reads a source file.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync } from 'fs';
import { join } from 'path';

import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { extractAdwIdFromComment } from '../../../adws/core/workflowCommentParsing.ts';
import { formatWorkflowComment } from '../../../adws/forge/workflowCommentsIssue.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { targetCloneUrl } from '../support/fixtureTargetRepo.ts';
import { SURFACE_REPO } from '../support/mockForgeProviders.ts';
import { assertMadeUpAdwId } from '../support/subprocessHarness.ts';
import { addIssueWorktree, branchExists, issueWorktreesLeft, webhookTargetBoundary } from '../support/webhookTarget.ts';
import { deliverPayload } from './webhookCronSteps.ts';
import type { RegressionWorld } from './world.ts';

const WORKFLOW_COMMENT_LOGIN = 'adw-bot';
const COMMENTER_LOGIN = 'maintainer';

function commentsOn(issueNumber: number): unknown[] {
  return getMockServerState().comments[String(issueNumber)] ?? [];
}

function commentIdOf(comment: unknown): number {
  return Number((comment as { id?: unknown }).id);
}

function commentBodyOf(comment: unknown): string {
  return String((comment as { body?: unknown }).body ?? '');
}

/** Unique across issues, since the mock deletes a comment by its id alone. */
function nextCommentId(): number {
  const ids = Object.values(getMockServerState().comments).flatMap((comments) => comments.map(commentIdOf));
  return Math.max(0, ...ids.filter(Number.isFinite)) + 1;
}

/** Through the mock's state, not a recorded POST: GitHub already holds a comment when it delivers the event, and T14 counts the POSTs. */
async function appendIssueComment(world: RegressionWorld, issueNumber: number, body: string, login: string): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  const now = new Date().toISOString();
  const comment = { id: nextCommentId(), body, user: { login }, created_at: now, updated_at: now };
  const { comments } = getMockServerState();
  await world.mockContext.setState({ comments: { ...comments, [String(issueNumber)]: [...commentsOn(issueNumber), comment] } });
}

/** The handler deletes `agents/<adwId>/` for every adwId an issue's comments name, so a real workflow's must never be among them. */
function assertOnlyMadeUpWorkflows(issueNumber: number): void {
  const adwIds = commentsOn(issueNumber).flatMap((comment) => extractAdwIdFromComment(commentBodyOf(comment)) ?? []);
  adwIds.forEach(assertMadeUpAdwId);
}

Given(
  "the target repository's workspace holds a worktree for issue {int} on the branch {string}",
  function (this: RegressionWorld, issueNumber: number, branch: string) {
    addIssueWorktree(this, issueNumber, branch);
  },
);

Given('issue {int} holds an ADW workflow comment for adwId {string}', async function (this: RegressionWorld, issueNumber: number, adwId: string) {
  assertMadeUpAdwId(adwId);
  await appendIssueComment(this, issueNumber, formatWorkflowComment('starting', { issueNumber, adwId }), WORKFLOW_COMMENT_LOGIN);
});

When(
  'the webhook receives the comment {string} on issue {int} from the repository {string}, signed with the secret {string}',
  async function (this: RegressionWorld, body: string, issueNumber: number, repoFullName: string, secret: string) {
    await appendIssueComment(this, issueNumber, body, COMMENTER_LOGIN);
    assertOnlyMadeUpWorkflows(issueNumber);

    const [owner, repo] = repoFullName.split('/');
    const payload = {
      action: 'created',
      issue: { number: issueNumber, body: '' },
      comment: { body },
      repository: { full_name: repoFullName, clone_url: targetCloneUrl(owner, repo) },
    };
    await deliverPayload('issue_comment', payload, repoFullName, secret, webhookTargetBoundary(this));
  },
);

Then('the checkout holds no state for adwId {string}', function (adwId: string) {
  const directory = join(AGENTS_STATE_DIR, adwId);
  assert.ok(!existsSync(directory), `Expected the checkout to hold no state for adwId "${adwId}", but ${directory} exists`);
});

Then("the target repository's workspace holds no worktree for issue {int}", function (this: RegressionWorld, issueNumber: number) {
  const left = issueWorktreesLeft(this, issueNumber);
  assert.deepStrictEqual(left, [], `Expected the workspace to hold no worktree for issue ${issueNumber}, but it holds: ${left.join(', ')}`);
});

Then("the target repository's workspace holds no branch {string}", function (this: RegressionWorld, branch: string) {
  assert.ok(!branchExists(this, branch), `Expected the workspace to hold no branch "${branch}", but git lists it`);
});

/** The mock keeps a comment after a DELETE of it, so the ids it still holds are those the issue held when the comment was delivered. */
Then('the mock GitHub API recorded the deletion of every comment on issue {int}', function (this: RegressionWorld, issueNumber: number) {
  const held = commentsOn(issueNumber).map(commentIdOf);
  assert.ok(held.length > 0, `Expected issue ${issueNumber} to hold comments for the handler to delete, but the mock holds none`);

  const deletions = this.getRecordedRequests().filter((request) => request.method === 'DELETE').map((request) => request.url);
  const deleted = (id: number): boolean => deletions.includes(`/repos/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}/issues/comments/${id}`);
  assert.deepStrictEqual(
    held.filter((id) => !deleted(id)),
    [],
    `Expected a DELETE of every comment on issue ${issueNumber} (${held.join(', ')}). Recorded DELETEs: ${deletions.join(', ') || 'none'}`,
  );
});
