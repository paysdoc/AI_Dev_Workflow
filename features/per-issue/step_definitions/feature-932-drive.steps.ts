import { When } from '@cucumber/cucumber';
import * as path from 'path';
import assert from 'assert';
import type * as http from 'http';

import { seededIssueNumbers } from '../../regression/step_definitions/feature-796.steps.ts';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { writeCronPid } from '../../../adws/triggers/cronProcessGuard.ts';
import { dispatchWebhookEvent } from '../../../adws/triggers/trigger_webhook.ts';
import { bunxBinDir, repoKeyOf, requireBoundary, requireFixture, s, settle, staleTimestamp } from '../../regression/step_definitions/feature-932-world.ts';

function seedListingTimestamps(): void {
  const fixture = requireFixture();
  for (const issueNumber of seededIssueNumbers(fixture)) {
    if (!fixture.issueCreatedAts.has(issueNumber)) fixture.issueCreatedAts.set(issueNumber, staleTimestamp());
    if (!fixture.issueUpdatedAts.has(issueNumber)) fixture.issueUpdatedAts.set(issueNumber, staleTimestamp());
  }
}

/** Every launch goes through `bunx`; shadowing it for the whole scenario keeps any orchestrator from starting. */
function shadowBunx(): void {
  process.env['PATH'] = `${bunxBinDir()}${path.delimiter}${s.savedPath ?? ''}`;
}

function repositoryPayload(boundary: LaunchBoundary): Record<string, unknown> {
  const fullName = repoKeyOf(boundary.repoId);
  return { full_name: fullName, clone_url: `https://example.invalid/${fullName}.git` };
}

/** The issue as the recording tracker holds it, so reading the event and reading the tracker see the same thing. */
function issuePayload(issueNumber: number, labelsInEvent: boolean): Record<string, unknown> {
  const fixture = requireFixture();
  const labels = labelsInEvent ? (fixture.issueLabels.get(issueNumber) ?? []).map((name) => ({ name })) : [];
  return {
    number: issueNumber,
    title: fixture.issueTitles.get(issueNumber) ?? '',
    body: fixture.issueBodies.get(issueNumber) ?? '',
    labels,
  };
}

async function dispatchWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const boundary = requireBoundary();
  // ensureCronProcess launches nothing for a repository whose cron is registered as alive.
  const repoKey = repoKeyOf(boundary.repoId);
  writeCronPid(repoKey, process.pid);
  s.registeredCronRepoKeys.add(repoKey);
  shadowBunx();

  const response: { body?: Record<string, unknown> } = {};
  const req = { headers: { 'x-github-event': event } } as unknown as http.IncomingMessage;
  const res = {
    writeHead: () => res,
    end: (body?: string) => { if (body) response.body = JSON.parse(body) as Record<string, unknown>; },
  } as unknown as http.ServerResponse;

  dispatchWebhookEvent(req, res, Buffer.from(JSON.stringify(payload)), () => boundary);

  // An event the webhook ignores (cooldown, auth gate, no boundary) would make every "no run" assertion pass for the wrong reason.
  assert.strictEqual(response.body?.status, 'processing', `Expected the webhook to process the ${event} event, answered ${JSON.stringify(response.body)}`);
  await settle();
}

function dispatchIssueEvent(action: 'opened' | 'closed', issueNumber: number, labelsInEvent: boolean): Promise<void> {
  const boundary = requireBoundary();
  return dispatchWebhook('issues', { action, repository: repositoryPayload(boundary), issue: issuePayload(issueNumber, labelsInEvent) });
}

When('the webhook dispatches the opening of issue {int} from that boundary', function (issueNumber: number) {
  return dispatchIssueEvent('opened', issueNumber, true);
});

When(
  'the webhook dispatches the opening of issue {int} from that boundary with no labels in the event',
  function (issueNumber: number) {
    return dispatchIssueEvent('opened', issueNumber, false);
  },
);

When('the webhook dispatches the closing of issue {int} from that boundary', function (issueNumber: number) {
  return dispatchIssueEvent('closed', issueNumber, true);
});

When(
  'the webhook dispatches a {string} comment on issue {int} from that boundary',
  function (commentText: string, issueNumber: number) {
    return dispatchWebhook('issue_comment', {
      action: 'created',
      repository: repositoryPayload(requireBoundary()),
      issue: issuePayload(issueNumber, true),
      comment: { body: commentText },
    });
  },
);

When('the cron tick runs once from that boundary', async function () {
  const boundary = requireBoundary();
  seedListingTimestamps();
  shadowBunx();
  // Imported here, not at load: importing the cron module resolves the checkout's own repository.
  const { checkAndTrigger } = await import('../../../adws/triggers/trigger_cron.ts');
  await checkAndTrigger(boundary);
  await settle();
});
