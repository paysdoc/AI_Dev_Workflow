import { describe, it, expect } from 'vitest';
import {
  DOC_BLOAT_THRESHOLD_LINES,
  checkBloat,
  checkRegrowth,
  runDocsGuards,
  globsOverlap,
  type DocSize,
} from '../docsGuards';
import { type ConditionalDocEntry } from '../conditionalDocsRegistry';

function entry(docPath: string, ownedGlobs: string[]): ConditionalDocEntry {
  return { docPath, ownedGlobs, conditions: [] };
}

function sz(docPath: string, lineCount: number): DocSize {
  return { docPath, lineCount };
}

// ---------------------------------------------------------------------------
// §1 globsOverlap — overlap matrix
// ---------------------------------------------------------------------------

describe('globsOverlap', () => {
  it('identical globs → overlap', () => {
    expect(globsOverlap('adws/triggers/**', 'adws/triggers/**')).toBe(true);
  });

  it('nested glob contains literal → overlap', () => {
    expect(globsOverlap('adws/core/**', 'adws/core/foo.ts')).toBe(true);
  });

  it('sibling-disjoint roots → no overlap', () => {
    expect(globsOverlap('adws/vcs/**', 'adws/core/**')).toBe(false);
  });

  it('segment-collision adws/core vs adws/coreutils → no overlap', () => {
    expect(globsOverlap('adws/core/**', 'adws/coreutils/**')).toBe(false);
  });

  it('parent prefix adws/** vs adws/core/** → overlap', () => {
    expect(globsOverlap('adws/**', 'adws/core/**')).toBe(true);
  });

  it('unrelated trees src vs adws → no overlap', () => {
    expect(globsOverlap('src/**', 'adws/**')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 checkBloat — threshold boundaries
// ---------------------------------------------------------------------------

describe('checkBloat', () => {
  const T = 10;

  it('lineCount < threshold → no flag', () => {
    expect(checkBloat([sz('a.md', T - 1)], T)).toEqual([]);
  });

  it('lineCount === threshold → no flag (at-threshold is not bloat)', () => {
    expect(checkBloat([sz('a.md', T)], T)).toEqual([]);
  });

  it('lineCount === threshold + 1 → one flag with correct fields', () => {
    const flags = checkBloat([sz('a.md', T + 1)], T);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toEqual({ docPath: 'a.md', lineCount: T + 1, threshold: T });
  });

  it('multiple docs → only over-threshold flagged', () => {
    const sizes = [sz('ok.md', T - 1), sz('at.md', T), sz('over.md', T + 1), sz('way.md', T + 100)];
    const paths = checkBloat(sizes, T).map((f) => f.docPath);
    expect(paths).toEqual(['over.md', 'way.md']);
  });

  it('empty sizes → no flags', () => {
    expect(checkBloat([], T)).toEqual([]);
  });

  it('DOC_BLOAT_THRESHOLD_LINES at-boundary: at → no flag, over → one flag', () => {
    const TH = DOC_BLOAT_THRESHOLD_LINES;
    expect(checkBloat([sz('a.md', TH)], TH)).toEqual([]);
    expect(checkBloat([sz('a.md', TH + 1)], TH)).toHaveLength(1);
    expect(checkBloat([sz('a.md', TH + 1)], TH)[0].threshold).toBe(TH);
  });

  it('does not mutate input array', () => {
    const sizes: DocSize[] = [sz('a.md', T + 1)];
    const copy = JSON.stringify(sizes);
    checkBloat(sizes, T);
    expect(JSON.stringify(sizes)).toBe(copy);
  });
});

// ---------------------------------------------------------------------------
// §3 checkRegrowth — overlap matrix
// ---------------------------------------------------------------------------

describe('checkRegrowth', () => {
  it('identical owned glob → one regrowth flag naming both docPaths', () => {
    const entries = [
      entry('app_docs/a.md', ['adws/triggers/**']),
      entry('app_docs/b.md', ['adws/triggers/**']),
    ];
    const flags = checkRegrowth(entries);
    expect(flags).toHaveLength(1);
    expect(flags[0].docPathA).toBe('app_docs/a.md');
    expect(flags[0].docPathB).toBe('app_docs/b.md');
  });

  it('nested/subset globs → flagged', () => {
    const entries = [
      entry('app_docs/a.md', ['adws/core/**']),
      entry('app_docs/b.md', ['adws/core/foo.ts']),
    ];
    expect(checkRegrowth(entries)).toHaveLength(1);
  });

  it('sibling-disjoint globs → no flag (no false positive)', () => {
    const entries = [
      entry('app_docs/a.md', ['adws/vcs/**']),
      entry('app_docs/b.md', ['adws/core/**']),
    ];
    expect(checkRegrowth(entries)).toEqual([]);
  });

  it('segment-collision adws/core vs adws/coreutils → no flag', () => {
    const entries = [
      entry('app_docs/a.md', ['adws/core/**']),
      entry('app_docs/b.md', ['adws/coreutils/**']),
    ];
    expect(checkRegrowth(entries)).toEqual([]);
  });

  it('two legacy entries (ownedGlobs: []) → no flag', () => {
    const entries: ConditionalDocEntry[] = [
      { docPath: 'app_docs/a.md', ownedGlobs: [], conditions: ['x'] },
      { docPath: 'app_docs/b.md', ownedGlobs: [], conditions: ['y'] },
    ];
    expect(checkRegrowth(entries)).toEqual([]);
  });

  it('one legacy + one real entry → no flag', () => {
    const entries: ConditionalDocEntry[] = [
      { docPath: 'app_docs/a.md', ownedGlobs: [], conditions: ['x'] },
      entry('app_docs/b.md', ['adws/vcs/**']),
    ];
    expect(checkRegrowth(entries)).toEqual([]);
  });

  it('single entry → no flags', () => {
    expect(checkRegrowth([entry('app_docs/a.md', ['adws/vcs/**'])])).toEqual([]);
  });

  it('empty entries → no flags', () => {
    expect(checkRegrowth([])).toEqual([]);
  });

  it('does not mutate input array', () => {
    const entries = [
      entry('app_docs/a.md', ['adws/triggers/**']),
      entry('app_docs/b.md', ['adws/triggers/**']),
    ];
    const copy = JSON.stringify(entries);
    checkRegrowth(entries);
    expect(JSON.stringify(entries)).toBe(copy);
  });
});

// ---------------------------------------------------------------------------
// §4 runDocsGuards — combined entry point
// ---------------------------------------------------------------------------

describe('runDocsGuards', () => {
  it('returns both flag sets', () => {
    const entries = [
      entry('app_docs/a.md', ['adws/triggers/**']),
      entry('app_docs/b.md', ['adws/triggers/**']),
    ];
    const sizes = [sz('app_docs/a.md', 401)];
    const flags = runDocsGuards(entries, sizes, 400);
    expect(flags.bloat).toHaveLength(1);
    expect(flags.regrowth).toHaveLength(1);
  });

  it('uses DOC_BLOAT_THRESHOLD_LINES by default', () => {
    const sizes = [sz('a.md', DOC_BLOAT_THRESHOLD_LINES + 1)];
    const flags = runDocsGuards([], sizes);
    expect(flags.bloat).toHaveLength(1);
    expect(flags.bloat[0].threshold).toBe(DOC_BLOAT_THRESHOLD_LINES);
  });

  it('empty inputs → no flags', () => {
    expect(runDocsGuards([], [])).toEqual({ bloat: [], regrowth: [] });
  });
});
