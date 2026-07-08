import { describe, it, expect } from 'vitest';
import { parsePromotesMarker, reconcilePromotionLink, reconcileFactFor } from '../promotionReconcileLink';
import type { PromotionIssueRef } from '../promotionReconcileLink';

describe('parsePromotesMarker', () => {
  it('matches a well-formed "Promotes: feature-N" line', () => {
    const body = 'Some intro text.\n\nPromotes: feature-42\n\nMore text.';
    expect(parsePromotesMarker(body)).toBe('feature-42');
  });

  it('ignores prose that merely mentions "Promotes" without the marker shape', () => {
    const body = 'This PR Promotes better test coverage overall, unrelated to any specific feature-9 marker.';
    expect(parsePromotesMarker(body)).toBeNull();
  });

  it('returns null when no marker is present', () => {
    const body = 'Just a normal issue body with no marker at all.';
    expect(parsePromotesMarker(body)).toBeNull();
  });

  it('tolerates leading/trailing whitespace around the marker line', () => {
    const body = '   Promotes:   feature-7   \n';
    expect(parsePromotesMarker(body)).toBe('feature-7');
  });
});

describe('reconcilePromotionLink', () => {
  it('single match → that issue number', () => {
    const openIssues: PromotionIssueRef[] = [{ number: 101, body: 'Promotes: feature-42' }];
    expect(reconcilePromotionLink('feature-42', openIssues)).toBe(101);
  });

  it('no match → null', () => {
    const openIssues: PromotionIssueRef[] = [{ number: 101, body: 'Promotes: feature-1' }];
    expect(reconcilePromotionLink('feature-42', openIssues)).toBeNull();
  });

  it('empty open-issue list → null', () => {
    expect(reconcilePromotionLink('feature-42', [])).toBeNull();
  });

  it('multiple open issues promoting the same feature-N → lowest issue number wins (documented tie-break)', () => {
    const openIssues: PromotionIssueRef[] = [
      { number: 205, body: 'Promotes: feature-42' },
      { number: 101, body: 'Promotes: feature-42' },
      { number: 150, body: 'Promotes: feature-42' },
    ];
    expect(reconcilePromotionLink('feature-42', openIssues)).toBe(101);
  });

  it('distinct feature-N ids do not cross-match (no substring collision)', () => {
    const openIssues: PromotionIssueRef[] = [{ number: 101, body: 'Promotes: feature-42' }];
    expect(reconcilePromotionLink('feature-4', openIssues)).toBeNull();
  });
});

describe('reconcileFactFor', () => {
  it('returns "open" when the feature is linked to an open promotion issue', () => {
    const openIssues: PromotionIssueRef[] = [{ number: 101, body: 'Promotes: feature-42' }];
    expect(reconcileFactFor('feature-42', openIssues)).toBe('open');
  });

  it('returns "no-issue" when the feature has no linked open promotion issue', () => {
    expect(reconcileFactFor('feature-42', [])).toBe('no-issue');
  });
});
