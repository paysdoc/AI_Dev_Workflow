/**
 * Recovery of the plan file from an issue's workflow comments. Every step drives a public entry
 * point (the comment formatter, the recovery-state reader); none reads a source file.
 */

import { Given, When, Then, Before, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import type { IssueComment } from '@paysdoc/devplatform';

import { detectRecoveryState } from '../../../adws/core/workflowCommentParsing.ts';
import { formatWorkflowComment } from '../../../adws/forge/workflowCommentsIssue.ts';
import type { RecoveryState, WorkflowStage } from '../../../adws/types/workflowTypes.ts';

const FIRST_COMMENT_AT = Date.UTC(2026, 9, 20, 10, 0, 0);
const MINUTE_MS = 60_000;

const recoveryWorld: {
  commentsByIssue: Map<number, IssueComment[]>;
  recoveryState: RecoveryState | null;
} = {
  commentsByIssue: new Map(),
  recoveryState: null,
};

Before({ tags: '@adw-1080' }, function () {
  recoveryWorld.commentsByIssue = new Map();
  recoveryWorld.recoveryState = null;
});

// `||` rather than `??`: an empty cell and an absent column both mean the comment carries no such field.
const cell = (row: Record<string, string>, column: string): string | undefined => row[column] || undefined;

function postedComment(issueNumber: number, adwId: string, row: Record<string, string>, index: number): IssueComment {
  const summary = cell(row, 'summary');
  // Each formatter reads only its own field, so the summary lands only in the comment whose stage prints it.
  const body = formatWorkflowComment(row.stage as WorkflowStage, {
    issueNumber,
    adwId,
    planPath: cell(row, 'plan file'),
    planOutput: summary,
    buildOutput: summary,
  });
  const createdAt = new Date(FIRST_COMMENT_AT + index * MINUTE_MS).toISOString();
  return { id: createdAt, author: 'adw-bot', createdAt, body };
}

function readRecoveryState(): RecoveryState {
  assert.ok(recoveryWorld.recoveryState, 'Expected the recovery state to have been read first');
  return recoveryWorld.recoveryState;
}

Given(
  'ADW posted its workflow comments for these stages on issue {int} under adwId {string}, oldest first:',
  function (issueNumber: number, adwId: string, table: DataTable) {
    const comments = table.hashes().map((row, index) => postedComment(issueNumber, adwId, row, index));
    recoveryWorld.commentsByIssue.set(issueNumber, comments);
  },
);

When('ADW reads the recovery state from the comments on issue {int}', function (issueNumber: number) {
  const comments = recoveryWorld.commentsByIssue.get(issueNumber);
  assert.ok(comments, `Expected workflow comments to have been posted on issue ${issueNumber} first`);
  recoveryWorld.recoveryState = detectRecoveryState(comments);
});

Then('the recovery state records the plan file {string}', function (planFile: string) {
  assert.strictEqual(readRecoveryState().planPath, planFile);
});

Then('the recovery state resumes the run after the stage {string}', function (stage: string) {
  const { lastCompletedStage, canResume } = readRecoveryState();
  assert.strictEqual(lastCompletedStage, stage);
  assert.strictEqual(canResume, true, `Expected the run to be resumable after "${stage}"`);
});
