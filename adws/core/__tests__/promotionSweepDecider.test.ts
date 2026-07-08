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
    it('meetsThreshold: true, reconcile: no-issue → redrive', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'no-issue' })).toBe('redrive');
    });
    it('meetsThreshold: true, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: true, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: true, reconcile: closed-unmerged → decline', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'closed-unmerged' })).toBe('decline');
    });
    it('meetsThreshold: true, reconcile: blocked → decline', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'blocked' })).toBe('decline');
    });
    it('meetsThreshold: false, reconcile: no-issue → withdraw', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'no-issue' })).toBe('withdraw');
    });
    it('meetsThreshold: false, reconcile: open → leave', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'open' })).toBe('leave');
    });
    it('meetsThreshold: false, reconcile: merged → done', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'merged' })).toBe('done');
    });
    it('meetsThreshold: false, reconcile: closed-unmerged → decline', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'closed-unmerged' })).toBe('decline');
    });
    it('meetsThreshold: false, reconcile: blocked → decline', () => {
      expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'blocked' })).toBe('decline');
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

  it('untagged file ignores closed-unmerged and blocked facts → leave (only an in-flight suggested file reconciles)', () => {
    expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'closed-unmerged' })).toBe('leave');
    expect(decidePromotionAction({ tagState: 'none', meetsThreshold: true, reconcile: 'blocked' })).toBe('leave');
  });

  it('decline-closed: an in-flight candidate whose tracker closed unmerged is declined regardless of current score', () => {
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'closed-unmerged' })).toBe('decline');
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'closed-unmerged' })).toBe('decline');
  });

  it('decline-blocked: an in-flight candidate whose tracker escalated to adw:blocked is declined regardless of current score', () => {
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'blocked' })).toBe('decline');
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'blocked' })).toBe('decline');
  });

  it('redrive: a stranded candidate (in flight, no tracker) that still meets threshold is re-driven', () => {
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: true, reconcile: 'no-issue' })).toBe('redrive');
  });

  it('withdraw: a stranded candidate (in flight, no tracker) that has dropped below threshold is withdrawn instead of re-filed', () => {
    expect(decidePromotionAction({ tagState: 'suggested', meetsThreshold: false, reconcile: 'no-issue' })).toBe('withdraw');
  });
});
