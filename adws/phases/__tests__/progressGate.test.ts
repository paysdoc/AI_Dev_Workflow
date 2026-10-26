import { describe, it, expect } from 'vitest';
import {
  evaluateProgressGate,
  describeProgressGateAbort,
  reportsBuildComplete,
  BUILD_COMPLETE_MARKER,
  type ProgressGateInput,
  type ProgressGateAbortBounds,
} from '../progressGate';

const SEED = 'seed-tree-hash-abc123';
const NOVEL_A = 'novel-tree-hash-aaa';
const NOVEL_B = 'net-negative-novel-hash-bbb';

function makeInput(overrides: Partial<ProgressGateInput>): ProgressGateInput {
  return {
    headTreeHash: NOVEL_A,
    seen: new Set([SEED]),
    checkpointCount: 0,
    maxCheckpoints: 20,
    completionReported: false,
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

describe('evaluateProgressGate — completion reported', () => {
  it('does not count a new tree hash after completion as progress', () => {
    const afterCompletion = makeInput({
      headTreeHash: 'polished-tree',
      seen: new Set([SEED, 'complete-tree']),
      checkpointCount: 1,
      completionReported: true,
    });

    expect(evaluateProgressGate(afterCompletion)).toEqual({ kind: 'complete' });
    expect(evaluateProgressGate({ ...afterCompletion, completionReported: false })).toEqual({ kind: 'continue' });
  });

  it('does not abort a completed build as no_progress when the tree hash was already seen', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: 'complete-tree',
      seen: new Set([SEED, 'complete-tree']),
      completionReported: true,
    }));
    expect(result).toEqual({ kind: 'complete' });
  });

  it('does not abort a completed build as no_progress when the tree equals the build-start seed', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: SEED,
      seen: new Set([SEED]),
      completionReported: true,
    }));
    expect(result).toEqual({ kind: 'complete' });
  });

  it('never aborts a completed build as a backstop, at the checkpoint ceiling', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: 'novel-at-ceiling',
      checkpointCount: 20,
      maxCheckpoints: 20,
      completionReported: true,
    }));
    expect(result).toEqual({ kind: 'complete' });
  });

  it('leaves an incomplete build at the checkpoint ceiling a backstop abort', () => {
    const result = evaluateProgressGate(makeInput({
      headTreeHash: 'novel-at-ceiling',
      checkpointCount: 20,
      maxCheckpoints: 20,
      completionReported: false,
    }));
    expect(result).toEqual({ kind: 'abort', reason: 'backstop' });
  });

  it('does not mutate the seen set when completion is reported', () => {
    const seen = new Set([SEED, 'h1']);
    const membersBefore = [...seen];

    evaluateProgressGate(makeInput({ headTreeHash: 'novel-after-completion', seen, completionReported: true }));

    expect(seen.size).toBe(membersBefore.length);
    expect([...seen]).toEqual(membersBefore);
  });
});

describe('reportsBuildComplete', () => {
  it('is true when the marker is the last line of the output', () => {
    expect(reportsBuildComplete(`Every plan step is committed.\n${BUILD_COMPLETE_MARKER}`)).toBe(true);
  });

  it('is true when the marker is the whole output', () => {
    expect(reportsBuildComplete(BUILD_COMPLETE_MARKER)).toBe(true);
  });

  it('is true when the marker line is followed by more output (the agent kept going before it was stopped)', () => {
    expect(reportsBuildComplete(`Done.\n${BUILD_COMPLETE_MARKER}\nSplitting the callbacks into helpers…`)).toBe(true);
  });

  it('is true when the marker line has surrounding spaces', () => {
    expect(reportsBuildComplete(`Done.\n  ${BUILD_COMPLETE_MARKER}  \nMore.`)).toBe(true);
  });

  it('is true when the marker line ends in a carriage return', () => {
    expect(reportsBuildComplete(`Done.\r\n${BUILD_COMPLETE_MARKER}\r\n`)).toBe(true);
  });

  it('is false for prose that mentions the marker inside a sentence', () => {
    expect(reportsBuildComplete(`I will print ${BUILD_COMPLETE_MARKER} once every step is done.`)).toBe(false);
  });

  it('is false for the marker wrapped in backticks on a line of its own', () => {
    expect(reportsBuildComplete(`Done.\n\`${BUILD_COMPLETE_MARKER}\``)).toBe(false);
  });

  it('is false for the marker wrapped in ** on a line of its own', () => {
    expect(reportsBuildComplete(`Done.\n**${BUILD_COMPLETE_MARKER}**`)).toBe(false);
  });

  it.each([
    `${BUILD_COMPLETE_MARKER}_SOON`,
    `NOT_${BUILD_COMPLETE_MARKER}`,
  ])('is false for the longer token %s on a line of its own', (token) => {
    expect(reportsBuildComplete(`Done.\n${token}\n`)).toBe(false);
  });

  it('is false for an empty output', () => {
    expect(reportsBuildComplete('')).toBe(false);
  });

  it('is false for a prose completion report without the marker', () => {
    const report = 'Issue is implemented and validated… all 12 plan steps were already committed.';
    expect(reportsBuildComplete(report)).toBe(false);
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
