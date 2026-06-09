/**
 * Pure state-novelty progress gate for the build phase. No I/O; does not mutate
 * its inputs. The caller performs git work (commit, tree-hash read) and updates
 * the `seen` set and counters based on the returned decision.
 */

/** Discriminated decision returned by {@link evaluateProgressGate}. */
export type ProgressGateDecision =
  | { kind: 'continue' }
  | { kind: 'abort'; reason: 'no_progress' }
  | { kind: 'abort'; reason: 'backstop' };

export interface ProgressGateInput {
  /** HEAD tree hash computed at this batch boundary. */
  headTreeHash: string;
  /** Tree hashes already seen this build (seeded with the build-start hash). Not mutated. */
  seen: ReadonlySet<string>;
  /** Number of progress checkpoints already recorded this build. */
  checkpointCount: number;
  /** Hard backstop on checkpoints (MAX_PROGRESS_CHECKPOINTS). */
  maxCheckpoints: number;
}

/**
 * Classifies a committed worktree state at a batch boundary.
 * - Non-novel (returned to a prior state, or nothing committed → unchanged hash
 *   still in `seen`, including the build-start seed) → abort: no_progress.
 * - Novel but the backstop is exhausted → abort: backstop.
 * - Novel and within budget → continue.
 */
export function evaluateProgressGate(input: ProgressGateInput): ProgressGateDecision {
  const { headTreeHash, seen, checkpointCount, maxCheckpoints } = input;

  if (seen.has(headTreeHash)) {
    return { kind: 'abort', reason: 'no_progress' };
  }
  if (checkpointCount >= maxCheckpoints) {
    return { kind: 'abort', reason: 'backstop' };
  }
  return { kind: 'continue' };
}

/** The abort reasons the progress gate can return (derived from {@link ProgressGateDecision}). */
export type ProgressGateAbortReason = Extract<ProgressGateDecision, { kind: 'abort' }>['reason'];

export interface ProgressGateAbortBounds {
  /** Per-batch restart cap (MAX_CONTEXT_RESETS). */
  maxContextResets: number;
  /** Checkpoint backstop ceiling (MAX_PROGRESS_CHECKPOINTS). */
  maxCheckpoints: number;
}

/**
 * Maps a progress-gate abort reason to a distinct, operator-facing failure message
 * describing the corrective action. Pure: same inputs → same string; no I/O, no mutation.
 * The two reasons demand opposite responses and must not be conflated.
 */
export function describeProgressGateAbort(
  reason: ProgressGateAbortReason,
  bounds: ProgressGateAbortBounds,
): string {
  switch (reason) {
    case 'no_progress':
      return (
        `Build aborted — no progress. The build stopped advancing: after ${bounds.maxContextResets} ` +
        `restarts the worktree returned to a state already seen this build, so the agent is stuck. ` +
        `Inspect the plan and the task before re-running — a plain retry will likely stall the same way.`
      );
    case 'backstop':
      return (
        `Build aborted — checkpoint backstop reached. The build kept reaching new states but ` +
        `exhausted the ${bounds.maxCheckpoints}-checkpoint ceiling, so the issue is likely too large ` +
        `for a single build. Split it into smaller issues rather than re-running it unchanged.`
      );
    default: {
      // Exhaustiveness guard: a new reason added to ProgressGateDecision must be handled above.
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}
