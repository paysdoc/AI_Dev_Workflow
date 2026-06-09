import { describe, it, expect } from 'vitest';
import { evaluateProgressGate, type ProgressGateInput } from '../progressGate';

const SEED = 'seed-tree-hash-abc123';
const NOVEL_A = 'novel-tree-hash-aaa';
const NOVEL_B = 'net-negative-novel-hash-bbb';

function makeInput(overrides: Partial<ProgressGateInput>): ProgressGateInput {
  return {
    headTreeHash: NOVEL_A,
    seen: new Set([SEED]),
    checkpointCount: 0,
    maxCheckpoints: 20,
    ...overrides,
  };
}

describe('evaluateProgressGate', () => {
  it('returns continue for the first novel boundary within the backstop', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: NOVEL_A,
      seen: new Set([SEED]),
      checkpointCount: 0,
      maxCheckpoints: 20,
    }));
    expect(result).toEqual({ kind: 'continue' });
  });

  it('returns abort:no_progress for a previously-seen hash', () => {
    const h1 = 'hash-h1';
    const result = evaluateProgressGate(makeInput({
      headTreeHash: h1,
      seen: new Set([SEED, h1]),
    }));
    expect(result).toEqual({ kind: 'abort', reason: 'no_progress' });
  });

  it('returns abort:no_progress when the committed state equals the build-start seed (frozen)', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: SEED,
      seen: new Set([SEED]),
    }));
    expect(result).toEqual({ kind: 'abort', reason: 'no_progress' });
  });

  it('returns continue for a novel state at the backstop limit (checkpointCount = maxCheckpoints - 1)', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: 'novel-at-limit',
      seen: new Set([SEED]),
      checkpointCount: 2,
      maxCheckpoints: 3,
    }));
    expect(result).toEqual({ kind: 'continue' });
  });

  it('returns abort:backstop for a novel state one past the backstop (checkpointCount = maxCheckpoints)', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: 'novel-past-limit',
      seen: new Set([SEED]),
      checkpointCount: 3,
      maxCheckpoints: 3,
    }));
    expect(result).toEqual({ kind: 'abort', reason: 'backstop' });
  });

  it('returns continue for a net-negative novel state (deletion/refactor reaching a novel tree)', () => {
    // NOVEL_B represents a tree after a net deletion — fewer files/lines —
    // but it is not in `seen`, so novelty (not size) drives the decision.
    const result = evaluateProgressGate(makeInput({
      headTreeHash: NOVEL_B,
      seen: new Set([SEED]),
      checkpointCount: 0,
      maxCheckpoints: 20,
    }));
    expect(result).toEqual({ kind: 'continue' });
  });

  it('does not mutate the seen set passed to the gate', () => {
    const seen = new Set([SEED, 'h1']);
    const sizeBefore = seen.size;
    const membersBefore = [...seen];

    evaluateProgressGate(makeInput({
      headTreeHash: 'novel-for-purity-test',
      seen,
      checkpointCount: 1,
      maxCheckpoints: 20,
    }));

    expect(seen.size).toBe(sizeBefore);
    expect([...seen]).toEqual(membersBefore);
  });

  it('does not mutate the checkpoint count (pure function, no side effects)', () => {
    const input = makeInput({ checkpointCount: 1, maxCheckpoints: 20 });
    const countBefore = input.checkpointCount;
    evaluateProgressGate(input);
    expect(input.checkpointCount).toBe(countBefore);
  });
});
