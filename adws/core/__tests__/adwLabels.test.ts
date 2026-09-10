import { describe, it, expect } from 'vitest';
import {
  readAdwLabels,
  readAdwLabelNames,
  issueTypeToAdwLabel,
} from '../adwLabels';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIssue(...labelNames: string[]): { labels: string[] } {
  return { labels: labelNames };
}

// ── readAdwLabels — all branches ──────────────────────────────────────────────

describe('readAdwLabels', () => {
  it('zero adw:* labels and no adw:none → no classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue())).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('zero adw:* labels with adw:none → opt-out, no classification, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:none'))).toEqual({ optOut: true, classification: null, conflict: false });
  });

  it('exactly adw:chore → /chore classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:chore'))).toEqual({ optOut: false, classification: '/chore', conflict: false });
  });

  it('exactly adw:bug → /bug classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:bug'))).toEqual({ optOut: false, classification: '/bug', conflict: false });
  });

  it('exactly adw:feature → /feature classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:feature'))).toEqual({ optOut: false, classification: '/feature', conflict: false });
  });

  it('exactly adw:pr_review → /pr_review classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:pr_review'))).toEqual({ optOut: false, classification: '/pr_review', conflict: false });
  });

  it('adw:bug + adw:none → opt-out, /bug classification, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'adw:none'))).toEqual({ optOut: true, classification: '/bug', conflict: false });
  });

  it('adw:bug + adw:feature → conflict, no classification, no opt-out', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'adw:feature'))).toEqual({ optOut: false, classification: null, conflict: true });
  });

  it('adw:bug + adw:feature + adw:none → opt-out, conflict, no classification', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'adw:feature', 'adw:none'))).toEqual({ optOut: true, classification: null, conflict: true });
  });

  it('non-adw labels are ignored', () => {
    expect(readAdwLabels(makeIssue('hitl', 'bug'))).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:upgrade alone → no classification, no opt-out, no conflict', () => {
    expect(readAdwLabels(makeIssue('adw:upgrade'))).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw-bug (hyphen) and adwesome are ignored — exact match only', () => {
    expect(readAdwLabels(makeIssue('adw-bug', 'adwesome'))).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:bug + unrelated labels → /bug classification only', () => {
    expect(readAdwLabels(makeIssue('adw:bug', 'hitl'))).toEqual({ optOut: false, classification: '/bug', conflict: false });
  });
});

// ── readAdwLabelNames — parity with readAdwLabels ─────────────────────────────

describe('readAdwLabelNames', () => {
  it('zero labels → no classification, no opt-out, no conflict', () => {
    expect(readAdwLabelNames([])).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:none only → opt-out, no classification, no conflict', () => {
    expect(readAdwLabelNames(['adw:none'])).toEqual({ optOut: true, classification: null, conflict: false });
  });

  it('exactly adw:bug → /bug classification, no opt-out, no conflict', () => {
    expect(readAdwLabelNames(['adw:bug'])).toEqual({ optOut: false, classification: '/bug', conflict: false });
  });

  it('adw:bug + adw:feature → conflict, no classification, no opt-out', () => {
    expect(readAdwLabelNames(['adw:bug', 'adw:feature'])).toEqual({ optOut: false, classification: null, conflict: true });
  });

  it('adw:bug + adw:none → opt-out wins, /bug classification, no conflict', () => {
    expect(readAdwLabelNames(['adw:bug', 'adw:none'])).toEqual({ optOut: true, classification: '/bug', conflict: false });
  });

  it('non-adw labels are ignored', () => {
    expect(readAdwLabelNames(['bug', 'enhancement'])).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('exact match only — adw-bug and adwesome are not matched', () => {
    expect(readAdwLabelNames(['adw-bug', 'adwesome'])).toEqual({ optOut: false, classification: null, conflict: false });
  });

  it('adw:upgrade alone is not a classification label', () => {
    expect(readAdwLabelNames(['adw:upgrade'])).toEqual({ optOut: false, classification: null, conflict: false });
  });
});

// ── issueTypeToAdwLabel ───────────────────────────────────────────────────────

describe('issueTypeToAdwLabel', () => {
  it('/feature → adw:feature', () => {
    expect(issueTypeToAdwLabel('/feature')).toBe('adw:feature');
  });

  it('/bug → adw:bug', () => {
    expect(issueTypeToAdwLabel('/bug')).toBe('adw:bug');
  });

  it('/chore → adw:chore', () => {
    expect(issueTypeToAdwLabel('/chore')).toBe('adw:chore');
  });

  it('/pr_review → adw:pr_review', () => {
    expect(issueTypeToAdwLabel('/pr_review')).toBe('adw:pr_review');
  });

  it('/adw_init → null (no classification label)', () => {
    expect(issueTypeToAdwLabel('/adw_init')).toBeNull();
  });
});
