import { describe, it, expect } from 'vitest';
import { decideLabelRecovery, evaluateLabelRecovery } from '../cronLabelEligibility';
import type { LabelRecoveryIssue } from '../cronLabelEligibility';
import type { AdwLabelReading } from '../../github/labelManager';
import type { LinkedPRRef } from '../../github/linkedPrDetector';

// ── Helpers ────────────────────────────────────────────────────────────────────

function reading(overrides: Partial<AdwLabelReading> = {}): AdwLabelReading {
  return { optOut: false, classification: null, conflict: false, ...overrides };
}

const ADW_WORKFLOW_COMMENT =
  '## :rocket: ADW Workflow Started\n<!-- adw-bot -->';

function makeIssue(
  labels: string[],
  comments: string[] = [],
): LabelRecoveryIssue {
  return {
    number: 1,
    labels: labels.map((name) => ({ name })),
    comments: comments.map((body) => ({ body })),
  };
}

function makePR(body: string, state: string, mergedAt: string | null): LinkedPRRef {
  return { number: 10, body, state, mergedAt };
}

// ── decideLabelRecovery ─────────────────────────────────────────────────────

describe('decideLabelRecovery — precedence order', () => {
  it('opt_out wins over a classification label', () => {
    const result = decideLabelRecovery(
      reading({ optOut: true, classification: '/feature' }),
      false,
      false,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('opt_out');
  });

  it('conflict → multi_label (two adw:<type> labels)', () => {
    const result = decideLabelRecovery(
      reading({ conflict: true, classification: null }),
      false,
      false,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('multi_label');
  });

  it('no classification → no_adw_label', () => {
    const result = decideLabelRecovery(reading({ classification: null }), false, false);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_adw_label');
  });

  it('single classification + in-progress comment → in_progress_comment', () => {
    const result = decideLabelRecovery(
      reading({ classification: '/bug' }),
      true,
      false,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('in_progress_comment');
  });

  it('single classification + linked closed PR → linked_closed_pr', () => {
    const result = decideLabelRecovery(
      reading({ classification: '/bug' }),
      false,
      true,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('linked_closed_pr');
  });

  it('single classification, no in-progress comment, no linked PR → eligible', () => {
    const result = decideLabelRecovery(
      reading({ classification: '/feature' }),
      false,
      false,
    );
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.classification).toBe('/feature');
  });

  it('opt_out wins even when classification is also set (opt_out first in guard chain)', () => {
    const result = decideLabelRecovery(
      reading({ optOut: true, classification: '/chore' }),
      false,
      false,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('opt_out');
  });
});

// ── evaluateLabelRecovery ───────────────────────────────────────────────────

describe('evaluateLabelRecovery — composition', () => {
  it('fresh single-adw:feature issue with no comment and empty PR list is eligible', () => {
    const result = evaluateLabelRecovery(makeIssue(['adw:feature']), []);
    expect(result.eligible).toBe(true);
    expect(result.classification).toBe('/feature');
  });

  it('same issue with an ADW workflow comment → in_progress_comment', () => {
    const result = evaluateLabelRecovery(
      makeIssue(['adw:feature'], [ADW_WORKFLOW_COMMENT]),
      [],
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('in_progress_comment');
  });

  it('adw:none label → opt_out', () => {
    const result = evaluateLabelRecovery(makeIssue(['adw:none']), []);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('opt_out');
  });

  it('adw:none alongside adw:feature → opt_out (opt-out wins)', () => {
    const result = evaluateLabelRecovery(makeIssue(['adw:none', 'adw:feature']), []);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('opt_out');
  });

  it('two adw:<type> labels → multi_label', () => {
    const result = evaluateLabelRecovery(makeIssue(['adw:bug', 'adw:feature']), []);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('multi_label');
  });

  it('adw:feature + linked merged PR → linked_closed_pr', () => {
    const pr = makePR('Implements #1', 'MERGED', '2024-01-01T00:00:00Z');
    const issue = { ...makeIssue(['adw:feature']), number: 1 };
    const result = evaluateLabelRecovery(issue, [pr]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('linked_closed_pr');
  });

  it('adw:bug + unrelated closed PR (different issue) → eligible', () => {
    const pr = makePR('Implements #999', 'CLOSED', null);
    const result = evaluateLabelRecovery(makeIssue(['adw:bug']), [pr]);
    expect(result.eligible).toBe(true);
  });

  it('no adw:* labels → no_adw_label', () => {
    const result = evaluateLabelRecovery(makeIssue(['bug', 'enhancement']), []);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_adw_label');
  });
});
