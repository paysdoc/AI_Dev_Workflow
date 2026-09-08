import { describe, it, expect } from 'vitest';
import {
  assessDocsIndexHealth,
  findRepairs,
  applyRepairs,
  findViolations,
  isFeatureDocPath,
  formatViolation,
  DEFAULT_COUNT_BAND,
  type DocsIndexRepair,
} from '../docsIndexHealth';
import { serializeConditionalDocs, type ConditionalDocsRegistry, type ConditionalDocEntry } from '../conditionalDocsRegistry';

function entry(overrides: Partial<ConditionalDocEntry> & { docPath: string }): ConditionalDocEntry {
  return { ownedGlobs: [], conditions: ['When X'], ...overrides };
}

function registryOf(entries: ConditionalDocEntry[]): ConditionalDocsRegistry {
  return { preamble: '# Conditional Documentation\n', entries };
}

const FIXTURE_ENTRIES: ConditionalDocEntry[] = [
  entry({ docPath: 'app_docs/feature-vcs.md', ownedGlobs: ['adws/vcs/**'] }),
  entry({ docPath: 'app_docs/feature-core-x.md', ownedGlobs: ['adws/core/x.ts'] }),
  entry({ docPath: 'app_docs/feature-legacy.md' }), // legacy entry, no Owns:
  entry({ docPath: 'README.md' }),
  entry({ docPath: 'adws/README.md' }),
  entry({ docPath: 'app_docs/feature-dangling.md' }), // no backing file
  entry({ docPath: 'app_docs/feature-dead-glob.md', ownedGlobs: ['adws/gone.ts'] }),
];

const FIXTURE_FILES = [
  'README.md',
  'adws/README.md',
  'adws/vcs/foo.ts',
  'adws/core/x.ts',
  'app_docs/feature-vcs.md',
  'app_docs/feature-core-x.md',
  'app_docs/feature-legacy.md',
  'app_docs/feature-dead-glob.md',
];

describe('isFeatureDocPath', () => {
  it('matches a direct-child app_docs/feature-*.md path', () => {
    expect(isFeatureDocPath('app_docs/feature-foo.md')).toBe(true);
  });

  it('rejects app_docs/assets/** paths', () => {
    expect(isFeatureDocPath('app_docs/assets/diagram.png')).toBe(false);
  });

  it('rejects nested feature paths', () => {
    expect(isFeatureDocPath('app_docs/nested/feature-foo.md')).toBe(false);
  });

  it('rejects top-level README paths', () => {
    expect(isFeatureDocPath('README.md')).toBe(false);
    expect(isFeatureDocPath('adws/README.md')).toBe(false);
  });
});

describe('findRepairs', () => {
  it('README entries are not dangling when present in files', () => {
    const repairs = findRepairs(registryOf(FIXTURE_ENTRIES), FIXTURE_FILES);
    expect(repairs.some((r) => r.kind === 'drop-dangling-entry' && r.docPath === 'README.md')).toBe(false);
    expect(repairs.some((r) => r.kind === 'drop-dangling-entry' && r.docPath === 'adws/README.md')).toBe(false);
  });

  it('an entry whose doc file is absent produces a drop-dangling-entry repair', () => {
    const repairs = findRepairs(registryOf(FIXTURE_ENTRIES), FIXTURE_FILES);
    expect(repairs).toContainEqual({ kind: 'drop-dangling-entry', docPath: 'app_docs/feature-dangling.md' });
  });

  it('a dead glob produces a prune-dead-glob repair while a live glob in the same registry survives untouched', () => {
    const repairs = findRepairs(registryOf(FIXTURE_ENTRIES), FIXTURE_FILES);
    expect(repairs).toContainEqual({ kind: 'prune-dead-glob', docPath: 'app_docs/feature-dead-glob.md', glob: 'adws/gone.ts' });
    expect(repairs.some((r) => r.kind === 'prune-dead-glob' && r.glob === 'adws/vcs/**')).toBe(false);
    expect(repairs.some((r) => r.kind === 'prune-dead-glob' && r.glob === 'adws/core/x.ts')).toBe(false);
  });

  it('a legacy entry (no Owns:) with a present doc file produces no repair', () => {
    const repairs = findRepairs(registryOf(FIXTURE_ENTRIES), FIXTURE_FILES);
    expect(repairs.some((r) => r.docPath === 'app_docs/feature-legacy.md')).toBe(false);
  });

  it('a dangling entry short-circuits — its globs are not separately reported as dead', () => {
    const withGlobs = registryOf([entry({ docPath: 'app_docs/feature-gone.md', ownedGlobs: ['adws/whatever.ts'] })]);
    const repairs = findRepairs(withGlobs, []);
    expect(repairs).toEqual([{ kind: 'drop-dangling-entry', docPath: 'app_docs/feature-gone.md' }]);
  });
});

describe('applyRepairs', () => {
  it('never mutates the input registry or its entries (deep-equal before/after)', () => {
    const registry = registryOf(FIXTURE_ENTRIES);
    const before = JSON.parse(JSON.stringify(registry));
    const repairs = findRepairs(registry, FIXTURE_FILES);

    applyRepairs(registry, repairs);

    expect(registry).toEqual(before);
  });

  it('drops entries named by a drop-dangling-entry repair and preserves entry order', () => {
    const registry = registryOf(FIXTURE_ENTRIES);
    const repairs = findRepairs(registry, FIXTURE_FILES);

    const repaired = applyRepairs(registry, repairs);

    expect(repaired.entries.map((e) => e.docPath)).toEqual([
      'app_docs/feature-vcs.md',
      'app_docs/feature-core-x.md',
      'app_docs/feature-legacy.md',
      'README.md',
      'adws/README.md',
      'app_docs/feature-dead-glob.md',
    ]);
  });

  it('filters only the dead glob, leaving the entry as a legacy entry when its last glob dies', () => {
    const registry = registryOf([
      entry({ docPath: 'app_docs/feature-live.md', ownedGlobs: ['adws/core/deleted.ts', 'adws/core/removed.ts'] }),
    ]);
    const repairs: DocsIndexRepair[] = [
      { kind: 'prune-dead-glob', docPath: 'app_docs/feature-live.md', glob: 'adws/core/deleted.ts' },
      { kind: 'prune-dead-glob', docPath: 'app_docs/feature-live.md', glob: 'adws/core/removed.ts' },
    ];

    const repaired = applyRepairs(registry, repairs);

    expect(repaired.entries).toHaveLength(1);
    expect(repaired.entries[0].docPath).toBe('app_docs/feature-live.md');
    expect(repaired.entries[0].ownedGlobs).toEqual([]);
    expect(repaired.entries[0].conditions).toEqual(['When X']);
  });
});

describe('findViolations', () => {
  it('detects an orphan doc file that no entry indexes, and never flags app_docs/assets/**', () => {
    const registry = registryOf([entry({ docPath: 'app_docs/feature-live.md' })]);
    const files = ['app_docs/feature-live.md', 'app_docs/feature-orphan.md', 'app_docs/assets/diagram.png'];

    const violations = findViolations(serializeConditionalDocs(registry), registry, files, null);

    expect(violations).toContainEqual({ kind: 'orphan-doc', docPath: 'app_docs/feature-orphan.md' });
    expect(violations.some((v) => v.kind === 'orphan-doc' && v.docPath.includes('assets'))).toBe(false);
  });

  it('detects a duplicate docPath', () => {
    const registry = registryOf([
      entry({ docPath: 'app_docs/feature-dup.md' }),
      entry({ docPath: 'app_docs/feature-dup.md' }),
    ]);

    const violations = findViolations(serializeConditionalDocs(registry), registry, ['app_docs/feature-dup.md'], null);

    expect(violations).toContainEqual({ kind: 'duplicate-entry', docPath: 'app_docs/feature-dup.md' });
  });

  it('aggregates an overlap once per pair with every overlapping file, and legacy entries never overlap', () => {
    const registry = registryOf([
      entry({ docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/shared/*.ts'] }),
      entry({ docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/shared/x.ts', 'adws/shared/y.ts'] }),
      entry({ docPath: 'app_docs/feature-legacy.md' }),
    ]);
    const files = ['adws/shared/x.ts', 'adws/shared/y.ts'];

    const violations = findViolations(serializeConditionalDocs(registry), registry, files, null);
    const overlaps = violations.filter((v) => v.kind === 'overlap');

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ docPathA: 'app_docs/feature-a.md', docPathB: 'app_docs/feature-b.md' });
    expect(overlaps[0].kind === 'overlap' && [...overlaps[0].files].sort()).toEqual(['adws/shared/x.ts', 'adws/shared/y.ts']);
  });

  it.each([
    [DEFAULT_COUNT_BAND.min - 1, true],
    [DEFAULT_COUNT_BAND.min, false],
    [DEFAULT_COUNT_BAND.max, false],
    [DEFAULT_COUNT_BAND.max + 1, true],
  ])('count %i against the band → violation=%s', (count, expectViolation) => {
    const entries = Array.from({ length: count }, (_, i) => entry({ docPath: `app_docs/feature-n${i}.md` }));
    const registry = registryOf(entries);
    const files = entries.map((e) => e.docPath);

    const violations = findViolations(serializeConditionalDocs(registry), registry, files, DEFAULT_COUNT_BAND);

    expect(violations.some((v) => v.kind === 'count-out-of-band')).toBe(expectViolation);
  });

  it('band = null skips the count check entirely', () => {
    const entries = Array.from({ length: 3 }, (_, i) => entry({ docPath: `app_docs/feature-n${i}.md` }));
    const registry = registryOf(entries);

    const violations = findViolations(serializeConditionalDocs(registry), registry, [], null);

    expect(violations.some((v) => v.kind === 'count-out-of-band')).toBe(false);
  });

  it('reports non-canonical content with the first diverging line', () => {
    const registry = registryOf([entry({ docPath: 'app_docs/feature-a.md' })]);
    const canonical = serializeConditionalDocs(registry);
    const nonCanonical = canonical + '\n';

    const violations = findViolations(nonCanonical, registry, ['app_docs/feature-a.md'], null);

    const nc = violations.find((v) => v.kind === 'non-canonical');
    expect(nc).toBeDefined();
    expect(nc && nc.kind === 'non-canonical' && nc.firstDiffLine).toBeGreaterThan(0);
  });

  it('empty content parses to no entries and does not crash', () => {
    const violations = findViolations('', registryOf([]), [], null);
    expect(violations).toEqual([]);
  });
});

describe('assessDocsIndexHealth', () => {
  it('computes violations on the repaired registry — a dangling entry above the band max does not trip the band once dropped', () => {
    const entries = Array.from({ length: DEFAULT_COUNT_BAND.max }, (_, i) => entry({ docPath: `app_docs/feature-n${i}.md` }));
    entries.push(entry({ docPath: 'app_docs/feature-ghost.md' })); // dangling — pushes raw count over max
    const registry = registryOf(entries);
    const files = entries.filter((e) => e.docPath !== 'app_docs/feature-ghost.md').map((e) => e.docPath);
    const content = serializeConditionalDocs(registry);

    const assessment = assessDocsIndexHealth({ content, files });

    expect(assessment.repairs).toContainEqual({ kind: 'drop-dangling-entry', docPath: 'app_docs/feature-ghost.md' });
    expect(assessment.repaired.entries).toHaveLength(DEFAULT_COUNT_BAND.max);
    expect(assessment.violations.some((v) => v.kind === 'count-out-of-band')).toBe(false);
  });

  it('a fully healthy index yields no repairs and no violations', () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry({ docPath: `app_docs/feature-n${i}.md`, ownedGlobs: [`adws/mod${i}/**`] }));
    const registry = registryOf(entries);
    const files = entries.map((e) => e.docPath).concat(entries.map((_e, i) => `adws/mod${i}/x.ts`));
    const content = serializeConditionalDocs(registry);

    const assessment = assessDocsIndexHealth({ content, files });

    expect(assessment.repairs).toEqual([]);
    expect(assessment.violations).toEqual([]);
  });
});

describe('formatViolation', () => {
  it('truncates an overlap violation to 5 files with a trailing count', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'];
    const line = formatViolation({ kind: 'overlap', docPathA: 'x.md', docPathB: 'y.md', files });
    expect(line).toContain('a.ts, b.ts, c.ts, d.ts, e.ts');
    expect(line).toContain('… and 2 more');
    expect(line).not.toContain('f.ts');
  });
});
