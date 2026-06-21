import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  parseRelevantFilesSection,
  pathsOverlap,
  decideSerialization,
  scanPostPlanOverlaps,
} from '../regionOverlap';
import type { RegionSignal } from '../regionOverlap';

// ── normalizePath ─────────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('trims whitespace', () => {
    expect(normalizePath('  adws/foo.ts  ')).toBe('adws/foo.ts');
  });

  it('strips surrounding backticks', () => {
    expect(normalizePath('`adws/foo.ts`')).toBe('adws/foo.ts');
  });

  it('strips surrounding quotes', () => {
    expect(normalizePath('"adws/foo.ts"')).toBe('adws/foo.ts');
    expect(normalizePath("'adws/foo.ts'")).toBe('adws/foo.ts');
  });

  it('lowercases the path', () => {
    expect(normalizePath('ADWS/Triggers/Foo.TS')).toBe('adws/triggers/foo.ts');
  });

  it('normalizes backslash separators', () => {
    expect(normalizePath('adws\\triggers\\foo.ts')).toBe('adws/triggers/foo.ts');
  });

  it('is idempotent', () => {
    const p = 'adws/triggers/takeoverHandler.ts';
    expect(normalizePath(normalizePath(p))).toBe(normalizePath(p));
  });
});

// ── parseRelevantFilesSection ─────────────────────────────────────────────────

describe('parseRelevantFilesSection', () => {
  it('returns empty array when section is absent', () => {
    expect(parseRelevantFilesSection('## Problem\nNo paths here.')).toEqual([]);
    expect(parseRelevantFilesSection('')).toEqual([]);
  });

  it('parses bullet list paths under ## Relevant Files', () => {
    const md = `## Relevant Files\n- adws/triggers/takeoverHandler.ts\n- adws/core/logger.ts\n`;
    expect(parseRelevantFilesSection(md)).toEqual([
      'adws/triggers/takeoverhandler.ts',
      'adws/core/logger.ts',
    ]);
  });

  it('parses backtick-wrapped paths in bullet list', () => {
    const md = `## Relevant Files\n- \`adws/triggers/takeoverHandler.ts\`\n`;
    expect(parseRelevantFilesSection(md)).toEqual(['adws/triggers/takeoverhandler.ts']);
  });

  it('parses paths under ## Touched Files', () => {
    const md = `## Touched Files\n- adws/triggers/issueEligibility.ts\n`;
    expect(parseRelevantFilesSection(md)).toEqual(['adws/triggers/issueeligibility.ts']);
  });

  it('stops at the next ## heading', () => {
    const md = `## Relevant Files\n- adws/foo.ts\n## Implementation\nSome prose.`;
    const result = parseRelevantFilesSection(md);
    expect(result).toEqual(['adws/foo.ts']);
  });

  it('deduplicates entries', () => {
    const md = `## Relevant Files\n- adws/foo.ts\n- adws/foo.ts\n`;
    expect(parseRelevantFilesSection(md)).toEqual(['adws/foo.ts']);
  });

  it('ignores prose lines without path-like tokens', () => {
    const md = `## Relevant Files\nThis is some explanation text.\n- adws/foo.ts\n`;
    const result = parseRelevantFilesSection(md);
    expect(result).toContain('adws/foo.ts');
    expect(result.some(p => p.includes('explanation'))).toBe(false);
  });
});

// ── pathsOverlap ──────────────────────────────────────────────────────────────

describe('pathsOverlap', () => {
  it('returns overlap=true for identical single files', () => {
    const result = pathsOverlap(
      ['adws/triggers/takeoverHandler.ts'],
      ['adws/triggers/takeoverHandler.ts'],
    );
    expect(result.overlap).toBe(true);
    expect(result.shared).toContain('adws/triggers/takeoverhandler.ts');
  });

  it('returns overlap=true when one shared file exists among larger sets', () => {
    const result = pathsOverlap(
      ['adws/triggers/takeoverHandler.ts', 'adws/core/logger.ts'],
      ['adws/core/logger.ts', 'adws/triggers/cronIssueFilter.ts'],
    );
    expect(result.overlap).toBe(true);
    expect(result.shared).toContain('adws/core/logger.ts');
  });

  it('returns overlap=false for disjoint single files', () => {
    const result = pathsOverlap(
      ['adws/triggers/takeoverHandler.ts'],
      ['adws/triggers/cronIssueFilter.ts'],
    );
    expect(result.overlap).toBe(false);
    expect(result.shared).toHaveLength(0);
  });

  it('returns overlap=false for fully disjoint sets', () => {
    const result = pathsOverlap(
      ['adws/core/logger.ts', 'adws/core/index.ts'],
      ['adws/phases/planPhase.ts', 'adws/triggers/trigger_cron.ts'],
    );
    expect(result.overlap).toBe(false);
  });

  it('normalizes before comparison (case-insensitive)', () => {
    const result = pathsOverlap(
      ['ADWS/Triggers/TakeoverHandler.TS'],
      ['adws/triggers/takeoverHandler.ts'],
    );
    expect(result.overlap).toBe(true);
  });

  it('returns overlap=false when either set is empty', () => {
    expect(pathsOverlap([], ['adws/foo.ts']).overlap).toBe(false);
    expect(pathsOverlap(['adws/foo.ts'], []).overlap).toBe(false);
    expect(pathsOverlap([], []).overlap).toBe(false);
  });
});

// ── decideSerialization ───────────────────────────────────────────────────────

function sig(issueNumber: number, paths: string[], inFlight = false): RegionSignal {
  return { issueNumber, paths, inFlight };
}

describe('decideSerialization', () => {
  it('serializes the higher-numbered issue behind the lower-numbered one (backlog tie-break)', () => {
    const candidate = sig(639, ['adws/triggers/takeoverHandler.ts']);
    const sibling = sig(638, ['adws/triggers/takeoverHandler.ts']);

    const decision = decideSerialization(candidate, [sibling]);

    expect(decision.serialize).toBe(true);
    expect(decision.blockedBy).toBe(638);
    expect(decision.overlapPaths).toContain('adws/triggers/takeoverhandler.ts');
  });

  it('the lower-numbered issue proceeds — the #638/#639 collision shape', () => {
    const candidate = sig(638, ['adws/triggers/takeoverHandler.ts']);
    const sibling = sig(639, ['adws/triggers/takeoverHandler.ts']);

    const decision = decideSerialization(candidate, [sibling]);

    expect(decision.serialize).toBe(false);
  });

  it('defers behind an in-flight sibling even when candidate has a lower number', () => {
    const candidate = sig(100, ['adws/triggers/takeoverHandler.ts']);
    const inFlightSibling = sig(200, ['adws/triggers/takeoverHandler.ts'], true);

    const decision = decideSerialization(candidate, [inFlightSibling]);

    expect(decision.serialize).toBe(true);
    expect(decision.blockedBy).toBe(200);
  });

  it('lowest in-flight wins in a multi-way cluster', () => {
    const candidate = sig(105, ['adws/foo.ts']);
    const siblings = [
      sig(110, ['adws/foo.ts'], true),
      sig(108, ['adws/foo.ts'], true),
    ];

    const decision = decideSerialization(candidate, siblings);

    expect(decision.serialize).toBe(true);
    expect(decision.blockedBy).toBe(108);
  });

  it('does not serialize when candidate has an empty path signal (no false positives)', () => {
    const candidate = sig(200, []);
    const sibling = sig(100, ['adws/triggers/takeoverHandler.ts']);

    const decision = decideSerialization(candidate, [sibling]);

    expect(decision.serialize).toBe(false);
  });

  it('does not serialize when sibling has an empty path signal', () => {
    const candidate = sig(200, ['adws/triggers/takeoverHandler.ts']);
    const sibling = sig(100, []);

    const decision = decideSerialization(candidate, [sibling]);

    expect(decision.serialize).toBe(false);
  });

  it('does not serialize when paths are disjoint', () => {
    const candidate = sig(200, ['adws/core/logger.ts']);
    const sibling = sig(100, ['adws/triggers/cronIssueFilter.ts']);

    const decision = decideSerialization(candidate, [sibling]);

    expect(decision.serialize).toBe(false);
  });

  it('deadlock-freedom: of any pair, at most one defers behind the other', () => {
    const a = sig(500, ['adws/triggers/takeoverHandler.ts']);
    const b = sig(600, ['adws/triggers/takeoverHandler.ts']);

    const decisionA = decideSerialization(a, [b]);
    const decisionB = decideSerialization(b, [a]);

    const aDefers = decisionA.serialize;
    const bDefers = decisionB.serialize;

    expect(aDefers && bDefers).toBe(false);
  });

  it('exactly one of a 3-way cluster defers in each call (multi-way)', () => {
    const a = sig(10, ['adws/foo.ts']);
    const b = sig(20, ['adws/foo.ts']);
    const c = sig(30, ['adws/foo.ts']);

    const decisionA = decideSerialization(a, [b, c]);
    const decisionB = decideSerialization(b, [a, c]);
    const decisionC = decideSerialization(c, [a, b]);

    expect(decisionA.serialize).toBe(false);  // 10 is anchor
    expect(decisionB.serialize).toBe(true);   // 20 defers behind 10
    expect(decisionC.serialize).toBe(true);   // 30 defers behind 10
    expect(decisionB.blockedBy).toBe(10);
    expect(decisionC.blockedBy).toBe(10);
  });
});

// ── scanPostPlanOverlaps ──────────────────────────────────────────────────────

describe('scanPostPlanOverlaps', () => {
  it('surfaces a recommendation for two in-flight issues sharing a file', () => {
    const recommendations = scanPostPlanOverlaps([
      { issueNumber: 638, relevantFiles: ['adws/triggers/takeoverHandler.ts', 'adws/core/logger.ts'] },
      { issueNumber: 639, relevantFiles: ['adws/triggers/takeoverHandler.ts'] },
    ]);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]!.issueA).toBe(638);
    expect(recommendations[0]!.issueB).toBe(639);
    expect(recommendations[0]!.sharedPaths).toContain('adws/triggers/takeoverhandler.ts');
  });

  it('returns empty for fully disjoint in-flight issues', () => {
    const recommendations = scanPostPlanOverlaps([
      { issueNumber: 1, relevantFiles: ['adws/core/logger.ts'] },
      { issueNumber: 2, relevantFiles: ['adws/phases/planPhase.ts'] },
    ]);

    expect(recommendations).toHaveLength(0);
  });

  it('returns empty for a single in-flight issue', () => {
    const recommendations = scanPostPlanOverlaps([
      { issueNumber: 1, relevantFiles: ['adws/core/logger.ts'] },
    ]);

    expect(recommendations).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(scanPostPlanOverlaps([])).toHaveLength(0);
  });

  it('produces a recommendation for each colliding pair in a 3-way cluster', () => {
    const recommendations = scanPostPlanOverlaps([
      { issueNumber: 1, relevantFiles: ['adws/foo.ts'] },
      { issueNumber: 2, relevantFiles: ['adws/foo.ts'] },
      { issueNumber: 3, relevantFiles: ['adws/foo.ts'] },
    ]);

    expect(recommendations).toHaveLength(3); // pairs (1,2), (1,3), (2,3)
  });
});
