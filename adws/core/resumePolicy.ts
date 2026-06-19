/**
 * Pure resume policy for the bounded resume cap (issue #639).
 *
 * No I/O, no side effects — same inputs always produce the same output.
 * Mirrors progressGate.ts: a discriminated decision, a hard backstop.
 */

/** Outcome returned by {@link nextResumeAction}. */
export type ResumeAction = 'resume' | 'escalate';

/**
 * Hard cap on automatic resumes of a resumable stage before the workflow is
 * escalated to human_gated. Mirrors MAX_PR_RESOLUTION_ATTEMPTS and
 * MAX_AUTO_MERGE_ATTEMPTS.
 */
export const MAX_RESUME_ATTEMPTS = 3;

/**
 * Pure policy: returns 'resume' while attempts are strictly below the bound,
 * 'escalate' once attempts reach or exceed it.
 *
 * @param attempts - Number of automatic resumes already performed.
 * @param max      - The cap (defaults to MAX_RESUME_ATTEMPTS).
 *
 * Semantics:
 *   attempts < max  → 'resume'   (still within budget)
 *   attempts >= max → 'escalate' (cap reached — park until human Retry)
 *
 * Mirrors the `checkpointCount >= maxCheckpoints` backstop in progressGate.ts
 * applied across cron-tick resume attempts rather than in-build checkpoints.
 */
export function nextResumeAction(attempts: number, max: number = MAX_RESUME_ATTEMPTS): ResumeAction {
  return attempts >= max ? 'escalate' : 'resume';
}
