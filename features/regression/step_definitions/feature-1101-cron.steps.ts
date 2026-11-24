/**
 * The two steps that the cron scenario of feature-1101 adds to feature-959's launch boundary: the park reason the seeded workflow
 * recorded when it stopped, and the human's `## Retry` in the recording tracker. The poll, the launches and the state are
 * feature-959's.
 */

import { Given, When } from '@cucumber/cucumber';
import type { IssueComment } from '@paysdoc/devplatform';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { requireFixture } from '../../regression/step_definitions/feature-932-world.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-959-world.ts';

const HUMAN = 'a-human';

Given('the top-level state of workflow {string} records the park reason {string}', function (adwId: string, parkReason: string) {
  requireWorkflow(adwId);
  AgentStateManager.writeTopLevelState(adwId, { parkReason });
});

When('a human comments {string} on issue {int} in the recording tracker', function (body: string, issueNumber: number) {
  const fixture = requireFixture();
  const existing = fixture.issueComments.get(issueNumber) ?? [];
  const comment: IssueComment = { id: `human-comment-${existing.length + 1}`, body, author: HUMAN, createdAt: new Date().toISOString() };
  fixture.issueComments.set(issueNumber, [...existing, comment]);
});
