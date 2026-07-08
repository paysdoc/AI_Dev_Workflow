import { describe, it, expect } from 'vitest';
import { decidePromotionAction } from '../promotionSweepDecider';

describe('decidePromotionAction — exhaustive cross product {tagState} × {meetsThreshold} × {reconcile}', () => {
  describe('tagState: none', () => {
    it('meetsThreshold: true, reconcile: no-issue → originate', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'no-issue' })).toBe('originate');
    });
    it('meetsThreshold: true, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: true, reconcile: closed-unmerged → leave', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'closed-unmerged' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: blocked → leave', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'blocked' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: no-issue → leave', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: false, reconcile: 'no-issue' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: false, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: false, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: false, reconcile: closed-unmerged → leave', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: false, reconcile: 'closed-unmerged' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: blocked → leave', () => {
      expect(decidePromotionAction({ tagState: 'none', meetsThreshold: false, reconcile: 'blocked' })).toBe('leave');
    });
  });

  describe('tagState: suggested', () => {
    it('meetsThreshold: true, reconcile: no-issue → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'no-issue' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: true, reconcile: closed-unmerged → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'closed-unmerged' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: blocked → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'blocked' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: no-issue → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'no-issue' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: false, reconcile: closed-unmerged → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'closed-unmerged' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: blocked → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'blocked' })).toBe('leave');
    });
  });

  describe('tagState: declined', () => {
    it('meetsThreshold: true, reconcile: no-issue → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: true, reconcile: 'no-issue' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: true, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: true, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: true, reconcile: closed-unmerged → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: true, reconcile: 'closed-unmerged' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: blocked → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: true, reconcile: 'blocked' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: no-issue → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: false, reconcile: 'no-issue' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: false, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: false, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: false, reconcile: closed-unmerged → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: false, reconcile: 'closed-unmerged' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: blocked → leave', () => {
      expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: false, reconcile: 'blocked' })).toBe('leave');
    });
  });
});

describe('decidePromotionAction — named lifecycle edges', () => {
  it('fresh high scorer, nothing in flight → originate', () => {
    expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'no-issue' })).toBe('originate');
  });

  it('below-threshold fresh candidate → leave', () => {
    expect(decidePromotionAction({ tagState: 'none', meetsThreshold: false, reconcile: 'no-issue' })).toBe('leave');
  });

  it('already in-flight (suggested + open promotion issue) → leave', () => {
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'open' })).toBe('leave');
  });

  it('merged reconciliation fact → done regardless of tag state or threshold', () => {
    expect(decidePromotionAction({ tagState: 'none', meetsThreshold: false, reconcile: 'merged' })).toBe('done');
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'merged' })).toBe('done');
    expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: true, reconcile: 'merged' })).toBe('done');
  });

  it('declined (terminal) → leave regardless of threshold or non-merged reconcile facts', () => {
    expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: true, reconcile: 'no-issue' })).toBe('leave');
    expect(decidePromotionAction({ tagState: 'declined', meetsThreshold: false, reconcile: 'open' })).toBe('leave');
  });

  it('deferred reconciliation facts (closed-unmerged, blocked) → leave — placeholder for the sibling reconcile slice', () => {
    expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'closed-unmerged' })).toBe('leave');
    expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'blocked' })).toBe('leave');
  });
});
