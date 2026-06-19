import { describe, it, expect } from 'vitest';
import {
  parseConditionalDocs,
  serializeConditionalDocs,
  findOwningEntry,
  findOwningEntries,
  collapseEntries,
  upsertEntry,
  type ConditionalDocEntry,
  type ConditionalDocsRegistry,
} from '../conditionalDocsRegistry';

// ---------------------------------------------------------------------------
// Canonical fixture — includes one new-format entry (Owns:) and one legacy entry
// ---------------------------------------------------------------------------

const CANONICAL = `# Conditional Documentation

- app_docs/feature-new.md
  - Owns:
    - adws/vcs/**
  - Conditions:
    - When working on \`adws/vcs/\` VCS module

- app_docs/feature-legacy.md
  - Conditions:
    - When working on \`adws/legacy/\` module
`;

const CANONICAL_REGISTRY: ConditionalDocsRegistry = {
  preamble: '# Conditional Documentation\n\n',
  entries: [
    {
      docPath: 'app_docs/feature-new.md',
      ownedGlobs: ['adws/vcs/**'],
      conditions: ['When working on `adws/vcs/` VCS module'],
    },
    {
      docPath: 'app_docs/feature-legacy.md',
      ownedGlobs: [],
      conditions: ['When working on `adws/legacy/` module'],
    },
  ],
};

// ---------------------------------------------------------------------------
// §1 Round-trip
// ---------------------------------------------------------------------------

describe('round-trip: serialize(parse(canonical)) === canonical', () => {
  it('full canonical fixture round-trips losslessly', () => {
    expect(serializeConditionalDocs(parseConditionalDocs(CANONICAL))).toBe(CANONICAL);
  });

  it('parse(serialize(registry)) deep-equals registry', () => {
    expect(parseConditionalDocs(serializeConditionalDocs(CANONICAL_REGISTRY))).toEqual(
      CANONICAL_REGISTRY,
    );
  });
});

// ---------------------------------------------------------------------------
// §2 Legacy tolerance — no Owns: block
// ---------------------------------------------------------------------------

describe('legacy tolerance — no Owns: block', () => {
  const LEGACY = `# Conditional Documentation

- app_docs/feature-legacy.md
  - Conditions:
    - When working on legacy module
    - When implementing something else
`;

  it('parses to ownedGlobs: []', () => {
    const reg = parseConditionalDocs(LEGACY);
    expect(reg.entries[0].ownedGlobs).toEqual([]);
  });

  it('serializes back unchanged (byte-identical round-trip)', () => {
    expect(serializeConditionalDocs(parseConditionalDocs(LEGACY))).toBe(LEGACY);
  });
});

// ---------------------------------------------------------------------------
// §3 Non-app_docs docPath
// ---------------------------------------------------------------------------

describe('non-app_docs docPath', () => {
  const NON_APPDOCS = `# Conditional Documentation

- README.md
  - Conditions:
    - When writing user-facing docs

- adws/README.md
  - Conditions:
    - When adding adws modules
`;

  it('parses README.md and adws/README.md entries faithfully', () => {
    const reg = parseConditionalDocs(NON_APPDOCS);
    expect(reg.entries).toHaveLength(2);
    expect(reg.entries[0].docPath).toBe('README.md');
    expect(reg.entries[1].docPath).toBe('adws/README.md');
  });

  it('round-trips non-app_docs paths losslessly', () => {
    expect(serializeConditionalDocs(parseConditionalDocs(NON_APPDOCS))).toBe(NON_APPDOCS);
  });
});

// ---------------------------------------------------------------------------
// §4 Preamble preserved
// ---------------------------------------------------------------------------

describe('preamble preserved through round-trip', () => {
  it('# Conditional Documentation header survives round-trip', () => {
    const reg = parseConditionalDocs(CANONICAL);
    expect(reg.preamble).toBe('# Conditional Documentation\n\n');
    const serialized = serializeConditionalDocs(reg);
    expect(serialized.startsWith('# Conditional Documentation\n\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 Malformed / edge cases
// ---------------------------------------------------------------------------

describe('malformed / edge cases', () => {
  it('empty string → empty registry with empty preamble', () => {
    const reg = parseConditionalDocs('');
    expect(reg.preamble).toBe('');
    expect(reg.entries).toEqual([]);
  });

  it('whitespace-only string → empty registry', () => {
    const reg = parseConditionalDocs('   \n  \n');
    expect(reg.entries).toEqual([]);
  });

  it('entry missing Conditions: → conditions: [] (no throw)', () => {
    const content = `# Conditional Documentation

- app_docs/feature-no-conditions.md
  - Owns:
    - adws/foo/**
`;
    const reg = parseConditionalDocs(content);
    expect(reg.entries[0].conditions).toEqual([]);
    expect(reg.entries[0].ownedGlobs).toEqual(['adws/foo/**']);
  });

  it('blank lines between entries normalized to one', () => {
    const content = `# Conditional Documentation

- app_docs/feature-a.md
  - Conditions:
    - cond a


- app_docs/feature-b.md
  - Conditions:
    - cond b
`;
    const reg = parseConditionalDocs(content);
    expect(reg.entries).toHaveLength(2);
    // Serializer normalizes to one blank line between entries
    const output = serializeConditionalDocs(reg);
    expect(output).not.toContain('\n\n\n');
  });

  it('conditions containing backticks, parentheses, slashes preserved verbatim', () => {
    const content = `# Conditional Documentation

- app_docs/feature-x.md
  - Conditions:
    - When using \`adws/core/foo.ts\` (bar/baz)
`;
    const reg = parseConditionalDocs(content);
    expect(reg.entries[0].conditions[0]).toBe('When using `adws/core/foo.ts` (bar/baz)');
    expect(serializeConditionalDocs(reg)).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// §6 findOwningEntry — glob matching
// ---------------------------------------------------------------------------

describe('findOwningEntry', () => {
  const registry: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/feature-vcs.md', ownedGlobs: ['adws/vcs/**'], conditions: [] },
      { docPath: 'app_docs/feature-foo.md', ownedGlobs: ['adws/foo/*.ts'], conditions: [] },
      { docPath: 'app_docs/feature-legacy.md', ownedGlobs: [], conditions: ['legacy'] },
    ],
  };

  it('** spans path separators — matches nested path', () => {
    const entry = findOwningEntry(registry, ['adws/vcs/worktreeReset.ts']);
    expect(entry?.docPath).toBe('app_docs/feature-vcs.md');
  });

  it('** matches direct child too', () => {
    const entry = findOwningEntry(registry, ['adws/vcs/something.ts']);
    expect(entry?.docPath).toBe('app_docs/feature-vcs.md');
  });

  it('* does not span path separators — matches flat file', () => {
    const entry = findOwningEntry(registry, ['adws/foo/bar.ts']);
    expect(entry?.docPath).toBe('app_docs/feature-foo.md');
  });

  it('* does not match subdirectory path', () => {
    const entry = findOwningEntry(registry, ['adws/foo/sub/bar.ts']);
    expect(entry).toBeUndefined();
  });

  it('returns undefined when no entry matches', () => {
    const entry = findOwningEntry(registry, ['adws/unknown/file.ts']);
    expect(entry).toBeUndefined();
  });

  it('legacy entries (empty ownedGlobs) never match', () => {
    const legacyRegistry: ConditionalDocsRegistry = {
      preamble: '',
      entries: [{ docPath: 'app_docs/feature-legacy.md', ownedGlobs: [], conditions: ['foo'] }],
    };
    const entry = findOwningEntry(legacyRegistry, ['anything.ts']);
    expect(entry).toBeUndefined();
  });

  it('deterministic first-match when multiple entries could match', () => {
    const multiRegistry: ConditionalDocsRegistry = {
      preamble: '',
      entries: [
        { docPath: 'app_docs/first.md', ownedGlobs: ['adws/**'], conditions: [] },
        { docPath: 'app_docs/second.md', ownedGlobs: ['adws/vcs/**'], conditions: [] },
      ],
    };
    const entry = findOwningEntry(multiRegistry, ['adws/vcs/worktreeReset.ts']);
    expect(entry?.docPath).toBe('app_docs/first.md');
  });

  it('returns undefined for empty changedFilePaths', () => {
    const entry = findOwningEntry(registry, []);
    expect(entry).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §7 upsertEntry
// ---------------------------------------------------------------------------

describe('upsertEntry', () => {
  const baseRegistry: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/a/**'], conditions: ['old cond'] },
      { docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/b/**'], conditions: ['b cond'] },
    ],
  };

  it('novel docPath → appends (length + 1)', () => {
    const newEntry: ConditionalDocEntry = {
      docPath: 'app_docs/feature-c.md',
      ownedGlobs: ['adws/c/**'],
      conditions: ['c cond'],
    };
    const result = upsertEntry(baseRegistry, newEntry);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[2]).toEqual(newEntry);
  });

  it('existing docPath → updates in place (same length, same index)', () => {
    const updated: ConditionalDocEntry = {
      docPath: 'app_docs/feature-a.md',
      ownedGlobs: ['adws/a/**', 'adws/a-extra/**'],
      conditions: ['new cond'],
    };
    const result = upsertEntry(baseRegistry, updated);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual(updated);
    expect(result.entries[1]).toEqual(baseRegistry.entries[1]);
  });

  it('two upserts of the same docPath → exactly one entry (convergence property)', () => {
    const entry1: ConditionalDocEntry = {
      docPath: 'app_docs/feature-new.md',
      ownedGlobs: ['adws/new/**'],
      conditions: ['cond v1'],
    };
    const entry2: ConditionalDocEntry = {
      docPath: 'app_docs/feature-new.md',
      ownedGlobs: ['adws/new/**'],
      conditions: ['cond v2'],
    };
    const after1 = upsertEntry(baseRegistry, entry1);
    const after2 = upsertEntry(after1, entry2);
    const matching = after2.entries.filter((e) => e.docPath === 'app_docs/feature-new.md');
    expect(matching).toHaveLength(1);
    expect(matching[0].conditions).toEqual(['cond v2']);
  });

  it('upsertEntry is pure — original registry is not mutated', () => {
    const original = JSON.parse(JSON.stringify(baseRegistry)) as ConditionalDocsRegistry;
    upsertEntry(baseRegistry, { docPath: 'app_docs/feature-a.md', ownedGlobs: [], conditions: ['mutated'] });
    expect(baseRegistry).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// §8 Glob matcher boundary cases
// ---------------------------------------------------------------------------

describe('glob matcher boundary cases', () => {
  const makeSingleEntry = (glob: string): ConditionalDocsRegistry => ({
    preamble: '',
    entries: [{ docPath: 'app_docs/doc.md', ownedGlobs: [glob], conditions: [] }],
  });

  const matches = (glob: string, filePath: string): boolean =>
    findOwningEntry(makeSingleEntry(glob), [filePath]) !== undefined;

  it('** matches across multiple path segments', () => {
    expect(matches('adws/**', 'adws/a/b/c.ts')).toBe(true);
  });

  it('* does not span path separators', () => {
    expect(matches('adws/*', 'adws/a/b.ts')).toBe(false);
  });

  it('? matches exactly one non-separator char', () => {
    expect(matches('adws/?.ts', 'adws/a.ts')).toBe(true);
    expect(matches('adws/?.ts', 'adws/ab.ts')).toBe(false);
    expect(matches('adws/?.ts', 'adws/a/b.ts')).toBe(false);
  });

  it('literal dot is matched literally (not as regex wildcard)', () => {
    expect(matches('README.md', 'README.md')).toBe(true);
    expect(matches('README.md', 'READMExmd')).toBe(false);
  });

  it('literal path without wildcards matches exact path only', () => {
    expect(matches('adws/core/projectConfig.ts', 'adws/core/projectConfig.ts')).toBe(true);
    expect(matches('adws/core/projectConfig.ts', 'adws/core/projectConfigX.ts')).toBe(false);
  });

  it('** after trailing slash matches deeply nested paths', () => {
    expect(matches('adws/vcs/**', 'adws/vcs/deep/nested/file.ts')).toBe(true);
  });

  it('** without trailing slash also matches the base path', () => {
    expect(matches('adws/vcs/**', 'adws/vcs/file.ts')).toBe(true);
  });

  it('special regex chars in literal segments are escaped', () => {
    expect(matches('adws/core/foo(bar).ts', 'adws/core/foo(bar).ts')).toBe(true);
    expect(matches('adws/core/foo(bar).ts', 'adws/core/fooXbar.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9 findOwningEntries
// ---------------------------------------------------------------------------

describe('findOwningEntries', () => {
  const registry: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/feature-vcs.md', ownedGlobs: ['adws/vcs/**'], conditions: [] },
      { docPath: 'app_docs/feature-cost.md', ownedGlobs: ['adws/cost/**'], conditions: [] },
      { docPath: 'app_docs/feature-all.md', ownedGlobs: ['adws/**'], conditions: [] },
      { docPath: 'app_docs/feature-legacy.md', ownedGlobs: [], conditions: ['legacy'] },
    ],
  };

  it('returns all matching entries in document order', () => {
    const entries = findOwningEntries(registry, ['adws/vcs/worktreeReset.ts']);
    expect(entries.map((e) => e.docPath)).toEqual([
      'app_docs/feature-vcs.md',
      'app_docs/feature-all.md',
    ]);
  });

  it('returns [] when no entry matches', () => {
    const entries = findOwningEntries(registry, ['other/lib/foo.ts']);
    expect(entries).toEqual([]);
  });

  it('legacy entries (empty ownedGlobs) never appear', () => {
    const legacyRegistry: ConditionalDocsRegistry = {
      preamble: '',
      entries: [{ docPath: 'app_docs/legacy.md', ownedGlobs: [], conditions: ['foo'] }],
    };
    expect(findOwningEntries(legacyRegistry, ['anything.ts'])).toEqual([]);
  });

  it('multiple entries matching the same path are all returned', () => {
    const multi: ConditionalDocsRegistry = {
      preamble: '',
      entries: [
        { docPath: 'app_docs/a.md', ownedGlobs: ['adws/vcs/**'], conditions: [] },
        { docPath: 'app_docs/b.md', ownedGlobs: ['adws/**'], conditions: [] },
        { docPath: 'app_docs/c.md', ownedGlobs: ['adws/cost/**'], conditions: [] },
      ],
    };
    const entries = findOwningEntries(multi, ['adws/vcs/foo.ts']);
    expect(entries).toHaveLength(2);
    expect(entries[0].docPath).toBe('app_docs/a.md');
    expect(entries[1].docPath).toBe('app_docs/b.md');
  });

  it('returns [] for empty changedFilePaths', () => {
    expect(findOwningEntries(registry, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10 collapseEntries
// ---------------------------------------------------------------------------

describe('collapseEntries', () => {
  const base: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/sib-a.md', ownedGlobs: ['adws/cost/a/**'], conditions: ['cond-a'] },
      { docPath: 'app_docs/sib-b.md', ownedGlobs: ['adws/cost/b/**'], conditions: ['cond-b'] },
      { docPath: 'app_docs/sib-c.md', ownedGlobs: ['adws/cost/c/**'], conditions: ['cond-c'] },
      { docPath: 'app_docs/unrelated.md', ownedGlobs: ['adws/other/**'], conditions: ['other'] },
    ],
  };

  it('3 siblings collapse to exactly 1 (length − 2)', () => {
    const { registry: r } = collapseEntries(
      base,
      ['app_docs/sib-a.md', 'app_docs/sib-b.md', 'app_docs/sib-c.md'],
      { docPath: 'app_docs/sib-a.md', conditions: ['merged'] },
    );
    expect(r.entries).toHaveLength(2);
    expect(r.entries.filter((e) => e.docPath === 'app_docs/sib-a.md')).toHaveLength(1);
  });

  it('merged ownedGlobs is the de-duplicated union', () => {
    const withOverlap: ConditionalDocsRegistry = {
      preamble: '',
      entries: [
        { docPath: 'app_docs/x.md', ownedGlobs: ['adws/cost/**', 'adws/shared/**'], conditions: [] },
        { docPath: 'app_docs/y.md', ownedGlobs: ['adws/cost/**', 'adws/extra/**'], conditions: [] },
      ],
    };
    const { registry: r } = collapseEntries(
      withOverlap,
      ['app_docs/x.md', 'app_docs/y.md'],
      { docPath: 'app_docs/x.md', conditions: ['merged'] },
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].ownedGlobs).toEqual([
      'adws/cost/**',
      'adws/shared/**',
      'adws/extra/**',
    ]);
  });

  it('prunedDocPaths equals the non-survivor collapsed paths', () => {
    const { prunedDocPaths } = collapseEntries(
      base,
      ['app_docs/sib-a.md', 'app_docs/sib-b.md', 'app_docs/sib-c.md'],
      { docPath: 'app_docs/sib-a.md', conditions: ['merged'] },
    );
    expect(prunedDocPaths.sort()).toEqual(['app_docs/sib-b.md', 'app_docs/sib-c.md'].sort());
  });

  it('a missing docPath in the list is a no-op (no throw)', () => {
    const { registry: r, prunedDocPaths } = collapseEntries(
      base,
      ['app_docs/does-not-exist.md'],
      { docPath: 'app_docs/does-not-exist.md', conditions: [] },
    );
    expect(r.entries).toHaveLength(base.entries.length);
    expect(prunedDocPaths).toEqual([]);
  });

  it('single-entry collapse keeps length and prunedDocPaths: []', () => {
    const { registry: r, prunedDocPaths } = collapseEntries(
      base,
      ['app_docs/sib-a.md'],
      { docPath: 'app_docs/sib-a.md', conditions: ['new cond'] },
    );
    expect(r.entries).toHaveLength(base.entries.length);
    expect(prunedDocPaths).toEqual([]);
  });

  it('original registry is not mutated (purity)', () => {
    const snapshot = JSON.parse(JSON.stringify(base)) as ConditionalDocsRegistry;
    collapseEntries(
      base,
      ['app_docs/sib-a.md', 'app_docs/sib-b.md', 'app_docs/sib-c.md'],
      { docPath: 'app_docs/sib-a.md', conditions: ['merged'] },
    );
    expect(base).toEqual(snapshot);
  });

  it('unrelated entries are preserved unchanged and in order', () => {
    const { registry: r } = collapseEntries(
      base,
      ['app_docs/sib-a.md', 'app_docs/sib-b.md', 'app_docs/sib-c.md'],
      { docPath: 'app_docs/sib-a.md', conditions: ['merged'] },
    );
    const unrelated = r.entries.find((e) => e.docPath === 'app_docs/unrelated.md');
    expect(unrelated).toEqual(base.entries[3]);
    expect(r.entries[1]).toEqual(base.entries[3]);
  });

  it('survivor entry is inserted at the position of the first collapsed entry', () => {
    const { registry: r } = collapseEntries(
      base,
      ['app_docs/sib-b.md', 'app_docs/sib-c.md'],
      { docPath: 'app_docs/sib-b.md', conditions: ['merged'] },
    );
    expect(r.entries[1].docPath).toBe('app_docs/sib-b.md');
    expect(r.entries[0].docPath).toBe('app_docs/sib-a.md');
    expect(r.entries[2].docPath).toBe('app_docs/unrelated.md');
  });
});
