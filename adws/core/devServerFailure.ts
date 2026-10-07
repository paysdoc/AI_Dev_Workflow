export enum DevServerStartStatus {
  NotStarted = 'not_started',
  Started = 'started',
  Failed = 'failed',
}

export interface FailedDevServerStart {
  readonly status: DevServerStartStatus.Failed;
  readonly command: string;
  readonly healthUrl: string;
  readonly output: string;
}

/** `NotStarted`: no server is declared, or there were no scenarios to serve. `Failed`: no scenario ran. */
export type DevServerStart =
  | { readonly status: DevServerStartStatus.NotStarted }
  | { readonly status: DevServerStartStatus.Started }
  | FailedDevServerStart;

export const NO_DEV_SERVER_START: DevServerStart = { status: DevServerStartStatus.NotStarted };

export interface ReviewAttempts {
  /** What is held against the cap. */
  readonly failed: number;
  /** Every failed review of the run, never reset. */
  readonly total: number;
  readonly lastStartFailed: boolean;
}

export const NO_REVIEW_ATTEMPTS: ReviewAttempts = { failed: 0, total: 0, lastStartFailed: false };

export function countFailedStart(attempts: ReviewAttempts): ReviewAttempts {
  return { failed: attempts.failed + 1, total: attempts.total + 1, lastStartFailed: true };
}

// Only a start that follows a failed start resets the count. A web repository's server starts on every
// re-test, so a reset on every start would erase real review failures and the cap could never be reached.
export function countStartedServer(attempts: ReviewAttempts): ReviewAttempts {
  if (!attempts.lastStartFailed) return attempts;
  return { ...attempts, failed: 0, lastStartFailed: false };
}

export function countFailedReview(attempts: ReviewAttempts): ReviewAttempts {
  return { failed: attempts.failed + 1, total: attempts.total + 1, lastStartFailed: false };
}

export function isReviewBudgetSpent(attempts: ReviewAttempts, maxAttempts: number): boolean {
  return attempts.failed >= maxAttempts;
}

export const SERVER_OUTPUT_TAIL_CHARS = 6000;

const NO_SERVER_OUTPUT = '(no output)';

/** A start's error is at the end of what the server printed. */
export function serverOutputTail(output: string): string {
  const trimmed = output.trimEnd();
  if (trimmed.trim() === '') return NO_SERVER_OUTPUT;
  if (trimmed.length <= SERVER_OUTPUT_TAIL_CHARS) return trimmed;
  const leftOut = trimmed.length - SERVER_OUTPUT_TAIL_CHARS;
  return `[${leftOut} earlier characters of the output left out]\n${trimmed.slice(leftOut)}`;
}
