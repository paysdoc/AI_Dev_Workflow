import { describe, it, expect } from 'vitest';
import {
  DevServerStartStatus,
  NO_DEV_SERVER_START,
  NO_REVIEW_ATTEMPTS,
  SERVER_OUTPUT_TAIL_CHARS,
  countFailedReview,
  countFailedStart,
  countStartedServer,
  isReviewBudgetSpent,
  serverOutputTail,
  type ReviewAttempts,
} from '../devServerFailure';

const times = (n: number, step: (a: ReviewAttempts) => ReviewAttempts, from: ReviewAttempts = NO_REVIEW_ATTEMPTS): ReviewAttempts =>
  Array.from({ length: n }).reduce<ReviewAttempts>(step, from);

describe('NO_DEV_SERVER_START', () => {
  it('is a start that never happened', () => {
    expect(NO_DEV_SERVER_START).toEqual({ status: DevServerStartStatus.NotStarted });
  });
});

describe('countFailedStart', () => {
  it('uses one attempt of the budget and remembers that the start failed', () => {
    expect(countFailedStart(NO_REVIEW_ATTEMPTS)).toEqual({ failed: 1, total: 1, lastStartFailed: true });
  });

  it('spends the budget on the third failed start and not on the second', () => {
    expect(isReviewBudgetSpent(times(2, countFailedStart), 3)).toBe(false);
    expect(isReviewBudgetSpent(times(3, countFailedStart), 3)).toBe(true);
  });

  it('adds to the failed reviews already counted', () => {
    const afterReview = countFailedReview(NO_REVIEW_ATTEMPTS);
    expect(countFailedStart(afterReview)).toEqual({ failed: 2, total: 2, lastStartFailed: true });
  });
});

describe('countStartedServer', () => {
  it('sets the failed count to zero after failed starts, and keeps the total', () => {
    const afterStarts = times(2, countFailedStart);
    expect(countStartedServer(afterStarts)).toEqual({ failed: 0, total: 2, lastStartFailed: false });
  });

  it('sets the failed count to zero when failed reviews came before the failed start', () => {
    const afterReviewAndStart = countFailedStart(times(2, countFailedReview));
    expect(countStartedServer(afterReviewAndStart)).toEqual({ failed: 0, total: 3, lastStartFailed: false });
  });

  it('leaves the count alone when no start has failed since the last review', () => {
    const afterReviews = times(2, countFailedReview);
    expect(countStartedServer(afterReviews)).toEqual(afterReviews);
  });

  it('leaves a fresh run alone: a server that keeps starting never erases real review failures', () => {
    expect(countStartedServer(NO_REVIEW_ATTEMPTS)).toEqual(NO_REVIEW_ATTEMPTS);
  });

  it('resets only once per failed start', () => {
    const reset = countStartedServer(countFailedStart(NO_REVIEW_ATTEMPTS));
    const failedReview = countFailedReview(reset);
    expect(countStartedServer(failedReview)).toEqual(failedReview);
  });
});

describe('countFailedReview', () => {
  it('adds one to both counts and clears the failed start', () => {
    const afterStart = countFailedStart(NO_REVIEW_ATTEMPTS);
    expect(countFailedReview(afterStart)).toEqual({ failed: 2, total: 2, lastStartFailed: false });
  });
});

describe('isReviewBudgetSpent', () => {
  it('is spent exactly when the failed count reaches the cap', () => {
    expect(isReviewBudgetSpent(times(2, countFailedReview), 3)).toBe(false);
    expect(isReviewBudgetSpent(times(3, countFailedReview), 3)).toBe(true);
    expect(isReviewBudgetSpent(times(4, countFailedReview), 3)).toBe(true);
  });

  it('is never spent by the total after a reset', () => {
    const afterReset = countStartedServer(times(2, countFailedStart));
    expect(afterReset.total).toBe(2);
    expect(isReviewBudgetSpent(afterReset, 3)).toBe(false);
  });
});

describe('serverOutputTail', () => {
  it('returns short output with its trailing whitespace trimmed', () => {
    expect(serverOutputTail("Error: Cannot find module './routes'\n\n")).toBe("Error: Cannot find module './routes'");
  });

  it('returns output of exactly the limit unchanged', () => {
    const output = 'x'.repeat(SERVER_OUTPUT_TAIL_CHARS);
    expect(serverOutputTail(output)).toBe(output);
  });

  it('keeps the end of long output behind a marker that counts what was left out', () => {
    const output = `${'a'.repeat(100)}${'b'.repeat(SERVER_OUTPUT_TAIL_CHARS - 1)}ERROR`;
    const tail = serverOutputTail(output);
    const [marker, ...rest] = tail.split('\n');
    expect(marker).toContain(String(output.length - SERVER_OUTPUT_TAIL_CHARS));
    expect(rest.join('\n')).toBe(output.slice(-SERVER_OUTPUT_TAIL_CHARS));
    expect(tail.endsWith('ERROR')).toBe(true);
  });

  it('counts the left-out characters from the trimmed output', () => {
    const output = `${'a'.repeat(10)}${'b'.repeat(SERVER_OUTPUT_TAIL_CHARS)}\n\n  `;
    expect(serverOutputTail(output).split('\n')[0]).toMatch(/\b10\b/);
  });

  it.each(['', '   ', '\n\t \n'])('says there was no output for %j', (output) => {
    expect(serverOutputTail(output)).toBe('(no output)');
  });
});
