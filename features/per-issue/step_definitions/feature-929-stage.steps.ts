/**
 * §4 of feature-929: the retired review compaction recovery stage. Every step drives a
 * public entry point (the comment parser, the stage classifier, the comment formatter);
 * none reads a source file. The retired stage is a plain string here, because it is no
 * longer a `WorkflowStage` literal and the type-check must still pass.
 */

import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'assert';

import { parseWorkflowStageFromComment } from '../../../adws/core/workflowCommentParsing.ts';
import { classifyStageString } from '../../../adws/core/stageClassifier.ts';
import { formatWorkflowComment, type WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import type { WorkflowStage } from '../../../adws/types/workflowTypes.ts';
import { isHeaded } from './feature-929-comments.ts';

const ADW_ID = 'abjew4-bug-on-compaction-on';

const stageWorld: {
  commentBody: string | null;
  readStage: WorkflowStage | null | undefined;
  formattedComment: string | null;
} = {
  commentBody: null,
  readStage: undefined,
  formattedComment: null,
};

Before({ tags: '@adw-929' }, function () {
  stageWorld.commentBody = null;
  stageWorld.readStage = undefined;
  stageWorld.formattedComment = null;
});

Given('an ADW workflow comment headed {string}', function (heading: string) {
  stageWorld.commentBody = `## ${heading}\n\n**ADW ID:** \`${ADW_ID}\``;
});

When('the workflow stage is read from that comment', function () {
  assert.ok(stageWorld.commentBody, 'Expected a workflow comment to have been built first');
  stageWorld.readStage = parseWorkflowStageFromComment(stageWorld.commentBody);
});

Then('no workflow stage is read from that comment', function () {
  assert.strictEqual(stageWorld.readStage, null, `Expected no workflow stage, got "${String(stageWorld.readStage)}"`);
});

Then('the workflow stage read from that comment is {string}', function (stage: string) {
  assert.strictEqual(stageWorld.readStage, stage);
});

Then('the stage classifier classifies the stage {string} as {string}', function (stage: string, stageClass: string) {
  assert.strictEqual(classifyStageString(stage), stageClass);
});

When('ADW formats the workflow comment for the stage {string}', function (stage: string) {
  const ctx: WorkflowContext = { issueNumber: 929, adwId: ADW_ID };
  stageWorld.formattedComment = formatWorkflowComment(stage as WorkflowStage, ctx);
});

Then('the formatted comment is not headed {string}', function (heading: string) {
  assert.ok(stageWorld.formattedComment, 'Expected a workflow comment to have been formatted first');
  assert.ok(
    !isHeaded(stageWorld.formattedComment, heading),
    `Expected the formatted comment not to be headed "${heading}", got:\n${stageWorld.formattedComment}`,
  );
});
