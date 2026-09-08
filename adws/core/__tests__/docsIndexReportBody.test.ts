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

  it('titles with the violation count and index path', () => {
    const spec = buildDocsIndexReportIssue({ violations: [OVERLAP], indexPath: '.adw/conditional_docs.md', defaultBranch: 'dev' });
    expect(spec.title).toBe('`docs-index-health`: 1 violation(s) in .adw/conditional_docs.md');
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
