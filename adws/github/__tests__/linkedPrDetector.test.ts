import { describe, it, expect } from 'vitest';
import { hasLinkedMergedOrClosedPR } from '../linkedPrDetector';
import type { LinkedPRRef } from '../linkedPrDetector';

function makePR(overrides: Partial<LinkedPRRef> & { number: number; body: string }): LinkedPRRef {
  return {
    state: 'OPEN',
    mergedAt: null,
    ...overrides,
  };
}

describe('hasLinkedMergedOrClosedPR', () => {
  it('returns true for a PR with Implements reference that is merged', () => {
    const prs = [makePR({ number: 10, body: 'Implements #42', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(true);
  });

  it('returns true for a PR with Implements reference that is CLOSED', () => {
    const prs = [makePR({ number: 11, body: 'Implements #42', state: 'CLOSED', mergedAt: null })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(true);
  });

  it('returns false for a PR with Implements reference that is OPEN (not merged)', () => {
    const prs = [makePR({ number: 12, body: 'Implements #42', state: 'OPEN', mergedAt: null })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(false);
  });

  it('returns false when no PR references the issue', () => {
    const prs = [makePR({ number: 13, body: 'Fixes a bug', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(false);
  });

  it('returns false when only an unrelated closed PR exists', () => {
    const prs = [
      makePR({ number: 14, body: 'Implements #99', state: 'CLOSED', mergedAt: null }),
      makePR({ number: 15, body: 'Implements #42', state: 'OPEN', mergedAt: null }),
    ];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(false);
  });

  it('returns false for an empty PR list', () => {
    expect(hasLinkedMergedOrClosedPR(42, [])).toBe(false);
  });

  // Digit-boundary: Implements #1 must not match issue #12
  it('does not match Implements #1 when checking issue #12', () => {
    const prs = [makePR({ number: 20, body: 'Implements #1', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(12, prs)).toBe(false);
  });

  // Digit-boundary: Implements #12 must not match issue #1
  it('does not match Implements #12 when checking issue #1', () => {
    const prs = [makePR({ number: 21, body: 'Implements #12', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(1, prs)).toBe(false);
  });

  it('matches Implements #1 correctly when checking issue #1', () => {
    const prs = [makePR({ number: 22, body: 'Implements #1', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(1, prs)).toBe(true);
  });

  it('matches Implements #12 correctly when checking issue #12', () => {
    const prs = [makePR({ number: 23, body: 'Implements #12 some text', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(12, prs)).toBe(true);
  });
});
