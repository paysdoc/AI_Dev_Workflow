import { describe, it, expect } from 'vitest';
import {
  docsIndexViolationFingerprint,
  buildDocsIndexReportIssue,
  parseDocsIndexReportMarker,
  findOpenDocsIndexReport,
  DOCS_INDEX_REPORT_MARKER,
  type DocsIndexReportIssueRef,
} from '../docsIndexReportBody';
import type { DocsIndexViolation } from '../docsIndexHealth';

const OVERLAP: DocsIndexViolation = {
  kind: 'overlap',
  docPathA: 'app_docs/feature-a.md',
  docPathB: 'app_docs/feature-b.md',
  files: ['adws/shared/x.ts'],
};
const ORPHAN: DocsIndexViolation = { kind: 'orphan-doc', docPath: 'app_docs/feature-orphan.md' };
const COUNT: DocsIndexViolation = { kind: 'count-out-of-band', count: 70, band: { min: 25, max: 60 } };
const MISMATCH: DocsIndexViolation = { kind: 'decisions-mismatch', docPath: 'app_docs/feature-mismatch.md', onlyInBlock: ['0044'], onlyInSection: [] };
const UNKNOWN: DocsIndexViolation = { kind: 'unknown-decision', docPath: 'app_docs/feature-unknown.md', adr: '0099' };
const DEAD: DocsIndexViolation = { kind: 'dead-decision-link', docPath: 'app_docs/feature-dead.md', target: '../specs/adr/0044-old.md' };

describe('docsIndexViolationFingerprint', () => {
  it('is stable across violation ordering', () => {
    const a = docsIndexViolationFingerprint([OVERLAP, ORPHAN, COUNT]);
    const b = docsIndexViolationFingerprint([COUNT, OVERLAP, ORPHAN]);
    expect(a).toBe(b);
  });

  it('differs when the violation set differs', () => {
    const a = docsIndexViolationFingerprint([OVERLAP]);
    const b = docsIndexViolationFingerprint([OVERLAP, ORPHAN]);
    expect(a).not.toBe(b);
  });

  it('differs when a decisions violation is added', () => {
    const a = docsIndexViolationFingerprint([OVERLAP]);
    const b = docsIndexViolationFingerprint([OVERLAP, MISMATCH]);
    expect(a).not.toBe(b);
  });

  it('is a 12-character hex string', () => {
    const fp = docsIndexViolationFingerprint([OVERLAP]);
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('buildDocsIndexReportIssue', () => {
  it('carries the marker and fingerprint lines, and exactly the hitl + adw:none labels', () => {
    const spec = buildDocsIndexReportIssue({ violations: [OVERLAP, ORPHAN, COUNT], indexPath: '.adw/conditional_docs.md', defaultBranch: 'dev' });

    expect(spec.body).toContain(DOCS_INDEX_REPORT_MARKER);
    expect(spec.body).toContain(`Fingerprint: ${docsIndexViolationFingerprint([OVERLAP, ORPHAN, COUNT])}`);
    expect(spec.labels).toEqual(['hitl', 'adw:none']);
  });

  it('names the overlapping pair, the orphan doc, and the count against the band in the body', () => {
    const spec = buildDocsIndexReportIssue({ violations: [OVERLAP, ORPHAN, COUNT], indexPath: '.adw/conditional_docs.md', defaultBranch: 'dev' });

    expect(spec.body).toContain('app_docs/feature-a.md');
    expect(spec.body).toContain('app_docs/feature-b.md');
    expect(spec.body).toContain('app_docs/feature-orphan.md');
    expect(spec.body).toContain('70');
  });

  it('gives each decisions finding its own heading and names its doc', () => {
    const spec = buildDocsIndexReportIssue({ violations: [MISMATCH, UNKNOWN, DEAD], indexPath: '.adw/conditional_docs.md', defaultBranch: 'dev' });

    expect(spec.body).toContain('## Decisions out of step with the index');
    expect(spec.body).toContain('## Unknown decision records');
    expect(spec.body).toContain('## Dead decision links');
    expect(spec.body).toContain('app_docs/feature-mismatch.md');
    expect(spec.body).toContain('app_docs/feature-unknown.md');
    expect(spec.body).toContain('app_docs/feature-dead.md');
    expect(spec.body).toContain('0099');
  });

  it('lists the decisions sections after the duplicate entries and before the non-canonical and count sections', () => {
    const NON_CANONICAL: DocsIndexViolation = { kind: 'non-canonical', firstDiffLine: 3 };
    const DUPLICATE: DocsIndexViolation = { kind: 'duplicate-entry', docPath: 'app_docs/feature-dup.md' };
    const spec = buildDocsIndexReportIssue({
      violations: [COUNT, NON_CANONICAL, DEAD, UNKNOWN, MISMATCH, DUPLICATE],
      indexPath: '.adw/conditional_docs.md',
      defaultBranch: 'dev',
    });

    const positions = [
      '## Duplicate entries',
      '## Decisions out of step with the index',
      '## Unknown decision records',
      '## Dead decision links',
      '## Non-canonical serialization',
      '## Entry count out of band',
    ].map((heading) => spec.body.indexOf(heading));

    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('says a decisions finding resolves toward the index, whose Decisions: block is authoritative', () => {
    const spec = buildDocsIndexReportIssue({ violations: [MISMATCH], indexPath: '.adw/conditional_docs.md', defaultBranch: 'dev' });

    expect(spec.body).toContain('`Decisions:` block is authoritative');
  });

  it('titles with the violation count and index path', () => {
    const spec = buildDocsIndexReportIssue({ violations: [OVERLAP], indexPath: '.adw/conditional_docs.md', defaultBranch: 'dev' });
    expect(spec.title).toBe('`docs-index-health`: 1 violation(s) in .adw/conditional_docs.md');
  });

  it('names the default branch the code host reports', () => {
    const spec = buildDocsIndexReportIssue({ violations: [OVERLAP], indexPath: '.adw/conditional_docs.md', defaultBranch: 'trunk' });

    expect(spec.body).toContain('in `.adw/conditional_docs.md` on `trunk` that need a human decision.');
  });

  it('names no branch when the default branch is unknown, and still names the index path', () => {
    const spec = buildDocsIndexReportIssue({ violations: [OVERLAP], indexPath: '.adw/conditional_docs.md', defaultBranch: null });

    expect(spec.body).toContain('in `.adw/conditional_docs.md` that need a human decision.');
    expect(spec.body).not.toMatch(/ on `/);
  });

  it('computes the fingerprint from the violations only, so an unknown branch never refreshes an open report', () => {
    const known = buildDocsIndexReportIssue({ violations: [OVERLAP], indexPath: '.adw/conditional_docs.md', defaultBranch: 'trunk' });
    const unknown = buildDocsIndexReportIssue({ violations: [OVERLAP], indexPath: '.adw/conditional_docs.md', defaultBranch: null });

    expect(parseDocsIndexReportMarker(unknown.body)).toEqual(parseDocsIndexReportMarker(known.body));
  });
});

describe('parseDocsIndexReportMarker', () => {
  it('round-trips through buildDocsIndexReportIssue', () => {
    const spec = buildDocsIndexReportIssue({ violations: [OVERLAP], indexPath: '.adw/conditional_docs.md', defaultBranch: 'dev' });
    const parsed = parseDocsIndexReportMarker(spec.body);
    expect(parsed).toEqual({ fingerprint: docsIndexViolationFingerprint([OVERLAP]) });
  });

  it('returns null when the marker is absent', () => {
    expect(parseDocsIndexReportMarker('just some other issue body')).toBeNull();
  });

  it('returns null when the marker is present but the fingerprint line is missing', () => {
    expect(parseDocsIndexReportMarker(DOCS_INDEX_REPORT_MARKER)).toBeNull();
  });
});

describe('findOpenDocsIndexReport', () => {
  function ref(number: number, fingerprint: string, state?: string): DocsIndexReportIssueRef {
    return { number, body: `${DOCS_INDEX_REPORT_MARKER}\nFingerprint: ${fingerprint}\n`, state };
  }

  it('returns null when no issue carries the marker', () => {
    expect(findOpenDocsIndexReport([{ number: 1, body: 'unrelated' }])).toBeNull();
  });

  it('the lowest-numbered open issue wins when more than one carries the marker', () => {
    const issues = [ref(205, 'aaa'), ref(101, 'bbb'), ref(150, 'ccc')];
    expect(findOpenDocsIndexReport(issues)?.number).toBe(101);
  });

  it('ignores a closed marker issue', () => {
    const issues = [ref(101, 'aaa', 'CLOSED')];
    expect(findOpenDocsIndexReport(issues)).toBeNull();
  });

  it('treats an issue with no state field as open', () => {
    const issues = [ref(101, 'aaa')];
    expect(findOpenDocsIndexReport(issues)?.number).toBe(101);
  });
});
