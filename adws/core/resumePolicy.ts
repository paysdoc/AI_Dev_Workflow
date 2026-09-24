/**
 * Pure resume policy for the bounded resume cap.
 *
 * Mirrors progressGate.ts: a discriminated decision, a hard backstop.
 */

export type ResumeAction = 'resume' | 'escalate';

/**
 * Hard cap on automatic resumes of a resumable stage before the workflow is
 * escalated to human_gated. Mirrors MAX_PR_RESOLUTION_ATTEMPTS and
 * MAX_AUTO_MERGE_ATTEMPTS.
 */
export const MAX_RESUME_ATTEMPTS = 3;

/**
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
