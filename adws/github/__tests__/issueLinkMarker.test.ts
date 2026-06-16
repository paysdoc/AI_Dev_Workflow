import { describe, it, expect } from 'vitest';
import { bodyLinksIssue, issueLinkPattern } from '../issueLinkMarker';

describe('bodyLinksIssue', () => {
  it('matches a bare `Implements #N` marker', () => {
    expect(bodyLinksIssue('Implements #42', 42)).toBe(true);
  });

  it('matches a bare same-repo `Closes #N` marker', () => {
    expect(bodyLinksIssue('Closes #42', 42)).toBe(true);
  });

  // Regression guard for the #592 incident: the SDLC PR template emits the
  // repo-qualified `Closes owner/repo#N` form, which the pre-fix regexes
  // (`(Closes|Implements) #N`) silently failed to match.
  it('matches the repo-qualified `Closes owner/repo#N` form the template emits', () => {
    expect(bodyLinksIssue('Closes paysdoc/AI_Dev_Workflow#578', 578)).toBe(true);
  });

  it('matches a repo-qualified `Implements owner/repo#N` form', () => {
    expect(bodyLinksIssue('Implements paysdoc/AI_Dev_Workflow#578', 578)).toBe(true);
  });

  it('matches the marker embedded in a larger body', () => {
    const body = '## Summary\n\nDoes a thing.\n\nCloses paysdoc/AI_Dev_Workflow#578\n\nADW tracking ID: x';
    expect(bodyLinksIssue(body, 578)).toBe(true);
  });

  it('does not match a different issue number', () => {
    expect(bodyLinksIssue('Closes paysdoc/AI_Dev_Workflow#578', 57)).toBe(false);
  });

  it('does not match a bare `#N` without a closing keyword', () => {
    expect(bodyLinksIssue('See #578 for context', 578)).toBe(false);
  });

  it('returns false for null/empty bodies', () => {
    expect(bodyLinksIssue(null, 578)).toBe(false);
    expect(bodyLinksIssue('', 578)).toBe(false);
  });

  // Digit-boundary guard: #1 must not match inside #12 (both qualifier forms).
  it('does not match `#12` when checking issue #1', () => {
    expect(bodyLinksIssue('Closes #12', 1)).toBe(false);
    expect(bodyLinksIssue('Closes owner/repo#12', 1)).toBe(false);
  });

  it('does not match `#1` when checking issue #12', () => {
    expect(bodyLinksIssue('Implements #1', 12)).toBe(false);
  });

  it('matches `#1` correctly when checking issue #1', () => {
    expect(bodyLinksIssue('Implements #1', 1)).toBe(true);
  });
});

describe('issueLinkPattern', () => {
  it('builds a per-issue pattern (no cross-issue bleed)', () => {
    const p578 = issueLinkPattern(578);
    expect(p578.test('Closes paysdoc/AI_Dev_Workflow#578')).toBe(true);
    expect(p578.test('Closes paysdoc/AI_Dev_Workflow#579')).toBe(false);
  });
});
