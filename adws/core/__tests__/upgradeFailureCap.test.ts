import { describe, it, expect } from 'vitest';
import {
  isUpgradeFailureComment,
  countUpgradeFailureComments,
  UPGRADE_FAILURE_SIGNATURE,
  type IssueCommentRecord,
} from '../upgradeFailureCap';
import {
  buildUpgradeFailureComment,
  buildUpgradeHitlComment,
  buildUpgradeMergeFailedComment,
} from '../../adwUpgrade';

const BOT_AUTHOR = 'adw-bot[bot]';
const HUMAN_AUTHOR = 'some-human';

describe('UPGRADE_FAILURE_SIGNATURE', () => {
  it('matches the first line of buildUpgradeFailureComment output', () => {
    const comment = buildUpgradeFailureComment('reason', 'adw-id', 1);
    expect(comment.startsWith(UPGRADE_FAILURE_SIGNATURE)).toBe(true);
  });
});

describe('isUpgradeFailureComment', () => {
  it('recognises a bot-authored upgrade-failure comment', () => {
    const body = buildUpgradeFailureComment('LLM timed out', 'test-adw-id', 541);
    expect(isUpgradeFailureComment(body, BOT_AUTHOR)).toBe(true);
  });

  it('rejects a human-authored upgrade-failure comment', () => {
    const body = buildUpgradeFailureComment('LLM timed out', 'test-adw-id', 541);
    expect(isUpgradeFailureComment(body, HUMAN_AUTHOR)).toBe(false);
  });

  it('rejects a bot-authored HITL-deferred comment', () => {
    const body = buildUpgradeHitlComment(99, 'test-adw-id');
    expect(isUpgradeFailureComment(body, BOT_AUTHOR)).toBe(false);
  });

  it('rejects a bot-authored merge-failed comment', () => {
    const body = buildUpgradeMergeFailedComment(99, 'branch protection', 'test-adw-id');
    expect(isUpgradeFailureComment(body, BOT_AUTHOR)).toBe(false);
  });

  it('rejects a bot-authored unrelated comment', () => {
    expect(isUpgradeFailureComment('Some unrelated text', BOT_AUTHOR)).toBe(false);
  });
});

describe('countUpgradeFailureComments', () => {
  it('counts zero when the thread is empty', () => {
    expect(countUpgradeFailureComments([])).toBe(0);
  });

  it('counts only bot-authored upgrade-failure comments in a mixed thread', () => {
    const failureBody = buildUpgradeFailureComment('error', 'id', 1);
    const hitlBody = buildUpgradeHitlComment(1, 'id');
    const mergeFailBody = buildUpgradeMergeFailedComment(1, 'error', 'id');

    const comments: readonly IssueCommentRecord[] = [
      { body: failureBody, author: BOT_AUTHOR },
      { body: failureBody, author: BOT_AUTHOR },
      { body: failureBody, author: BOT_AUTHOR },
      { body: hitlBody, author: BOT_AUTHOR },
      { body: mergeFailBody, author: BOT_AUTHOR },
      { body: failureBody, author: HUMAN_AUTHOR },
      { body: 'random human comment', author: HUMAN_AUTHOR },
    ];

    expect(countUpgradeFailureComments(comments)).toBe(3);
  });

  it('counts all bot-authored failure comments when the thread has only failures', () => {
    const failureBody = buildUpgradeFailureComment('error', 'id', 1);
    const comments: readonly IssueCommentRecord[] = [
      { body: failureBody, author: BOT_AUTHOR },
      { body: failureBody, author: BOT_AUTHOR },
    ];
    expect(countUpgradeFailureComments(comments)).toBe(2);
  });
});
