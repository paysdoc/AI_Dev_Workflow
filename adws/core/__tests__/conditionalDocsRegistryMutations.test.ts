import { describe, it, expect } from 'vitest';
import {
  collapseEntries,
  upsertEntry,
  type ConditionalDocEntry,
  type ConditionalDocsRegistry,
} from '../conditionalDocsRegistry';

describe('upsertEntry', () => {
  const baseRegistry: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/a/**'], conditions: ['old cond'], decisions: [] },
      { docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/b/**'], conditions: ['b cond'], decisions: [] },
    ],
  };

  it('novel docPath → appends (length + 1)', () => {
    const newEntry: ConditionalDocEntry = {
      docPath: 'app_docs/feature-c.md',
      ownedGlobs: ['adws/c/**'],
      conditions: ['c cond'],
      decisions: [],
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
      decisions: [],
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
      decisions: [],
    };
    const entry2: ConditionalDocEntry = {
      docPath: 'app_docs/feature-new.md',
      ownedGlobs: ['adws/new/**'],
      conditions: ['cond v2'],
      decisions: [],
    };
    const after1 = upsertEntry(baseRegistry, entry1);
    const after2 = upsertEntry(after1, entry2);
    const matching = after2.entries.filter((e) => e.docPath === 'app_docs/feature-new.md');
    expect(matching).toHaveLength(1);
    expect(matching[0].conditions).toEqual(['cond v2']);
  });

  it("an updated entry's decisions replace the old ones", () => {
    const decided: ConditionalDocsRegistry = {
      preamble: '',
      entries: [{ docPath: 'app_docs/feature-a.md', ownedGlobs: [], conditions: ['c'], decisions: ['0001', '0002'] }],
    };

    const result = upsertEntry(decided, { docPath: 'app_docs/feature-a.md', ownedGlobs: [], conditions: ['c'], decisions: ['0003'] });

    expect(result.entries[0].decisions).toEqual(['0003']);
  });

  it('upsertEntry is pure — original registry is not mutated', () => {
    const original = JSON.parse(JSON.stringify(baseRegistry)) as ConditionalDocsRegistry;
    upsertEntry(baseRegistry, { docPath: 'app_docs/feature-a.md', ownedGlobs: [], conditions: ['mutated'], decisions: [] });
    expect(baseRegistry).toEqual(original);
  });
});

describe('collapseEntries', () => {
  const base: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/sib-a.md', ownedGlobs: ['adws/cost/a/**'], conditions: ['cond-a'], decisions: ['0026'] },
      { docPath: 'app_docs/sib-b.md', ownedGlobs: ['adws/cost/b/**'], conditions: ['cond-b'], decisions: ['0026', '0030'] },
      { docPath: 'app_docs/sib-c.md', ownedGlobs: ['adws/cost/c/**'], conditions: ['cond-c'], decisions: [] },
      { docPath: 'app_docs/unrelated.md', ownedGlobs: ['adws/other/**'], conditions: ['other'], decisions: ['0009'] },
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
        { docPath: 'app_docs/x.md', ownedGlobs: ['adws/cost/**', 'adws/shared/**'], conditions: [], decisions: [] },
        { docPath: 'app_docs/y.md', ownedGlobs: ['adws/cost/**', 'adws/extra/**'], conditions: [], decisions: [] },
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

  it('merged decisions is the de-duplicated union in first-seen order', () => {
    const withOverlap: ConditionalDocsRegistry = {
      preamble: '',
      entries: [
        { docPath: 'app_docs/x.md', ownedGlobs: [], conditions: [], decisions: ['0002', '0001'] },
        { docPath: 'app_docs/y.md', ownedGlobs: [], conditions: [], decisions: ['0001', '0003'] },
        { docPath: 'app_docs/z.md', ownedGlobs: [], conditions: [], decisions: ['0003', '0004'] },
      ],
    };
    const { registry: r } = collapseEntries(
      withOverlap,
      ['app_docs/x.md', 'app_docs/y.md', 'app_docs/z.md'],
      { docPath: 'app_docs/x.md', conditions: ['merged'] },
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].decisions).toEqual(['0002', '0001', '0003', '0004']);
  });

  it('a collapse whose siblings carry no decisions yields an entry with decisions: []', () => {
    const { registry: r } = collapseEntries(
      base,
      ['app_docs/sib-c.md'],
      { docPath: 'app_docs/sib-c.md', conditions: ['merged'] },
    );
    expect(r.entries.find((e) => e.docPath === 'app_docs/sib-c.md')?.decisions).toEqual([]);
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
