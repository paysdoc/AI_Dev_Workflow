import { describe, it, expect } from 'vitest';
import { evaluateProgressGate, describeProgressGateAbort, type ProgressGateInput, type ProgressGateAbortBounds } from '../progressGate';

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

const FIXED_BOUNDS: ProgressGateAbortBounds = { maxContextResets: 3, maxCheckpoints: 20 };

describe('describeProgressGateAbort', () => {
  it('no_progress message reports build stopped advancing and is stuck', () => {
    const msg = describeProgressGateAbort('no_progress', FIXED_BOUNDS);
    expect(msg).toMatch(/stopped advancing/i);
    expect(msg).toMatch(/stuck/i);
  });

  it('no_progress message directs operator to inspect plan and task', () => {
    const msg = describeProgressGateAbort('no_progress', FIXED_BOUNDS);
    expect(msg).toMatch(/plan/i);
    expect(msg).toMatch(/task/i);
  });

  it('no_progress message does not suggest the issue is too large or to split', () => {
    const msg = describeProgressGateAbort('no_progress', FIXED_BOUNDS);
    expect(msg).not.toMatch(/too large/i);
    expect(msg).not.toMatch(/split/i);
  });

  it('backstop message reports issue is likely too large and should be split', () => {
    const msg = describeProgressGateAbort('backstop', FIXED_BOUNDS);
    expect(msg).toMatch(/too large/i);
    expect(msg).toMatch(/split/i);
  });

  it('backstop message does not say build made no progress or is stuck', () => {
    const msg = describeProgressGateAbort('backstop', FIXED_BOUNDS);
    expect(msg).not.toMatch(/no progress/i);
    expect(msg).not.toMatch(/stuck/i);
  });

  it('the two messages are distinct — not conflated into one generic string', () => {
    const noProgress = describeProgressGateAbort('no_progress', FIXED_BOUNDS);
    const backstop = describeProgressGateAbort('backstop', FIXED_BOUNDS);
    expect(noProgress).not.toBe(backstop);
  });

  it('no_progress message interpolates maxContextResets from bounds', () => {
    const msg = describeProgressGateAbort('no_progress', FIXED_BOUNDS);
    expect(msg).toContain(String(FIXED_BOUNDS.maxContextResets));
  });

  it('backstop message interpolates maxCheckpoints from bounds', () => {
    const msg = describeProgressGateAbort('backstop', FIXED_BOUNDS);
    expect(msg).toContain(String(FIXED_BOUNDS.maxCheckpoints));
  });

  it('is deterministic — same inputs return the same string', () => {
    expect(describeProgressGateAbort('no_progress', FIXED_BOUNDS))
      .toBe(describeProgressGateAbort('no_progress', FIXED_BOUNDS));
    expect(describeProgressGateAbort('backstop', FIXED_BOUNDS))
      .toBe(describeProgressGateAbort('backstop', FIXED_BOUNDS));
  });
});
