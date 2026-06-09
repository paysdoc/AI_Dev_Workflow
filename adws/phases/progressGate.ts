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
