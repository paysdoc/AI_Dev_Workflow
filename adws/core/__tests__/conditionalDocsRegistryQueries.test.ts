import { describe, it, expect } from 'vitest';
import {
  findOwningEntry,
  findOwningEntries,
  type ConditionalDocsRegistry,
} from '../conditionalDocsRegistry';

describe('findOwningEntry', () => {
  const registry: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/feature-vcs.md', ownedGlobs: ['adws/vcs/**'], conditions: [], decisions: [] },
      { docPath: 'app_docs/feature-foo.md', ownedGlobs: ['adws/foo/*.ts'], conditions: [], decisions: [] },
      { docPath: 'app_docs/feature-legacy.md', ownedGlobs: [], conditions: ['legacy'], decisions: [] },
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
      entries: [{ docPath: 'app_docs/feature-legacy.md', ownedGlobs: [], conditions: ['foo'], decisions: [] }],
    };
    const entry = findOwningEntry(legacyRegistry, ['anything.ts']);
    expect(entry).toBeUndefined();
  });

  it('deterministic first-match when multiple entries could match', () => {
    const multiRegistry: ConditionalDocsRegistry = {
      preamble: '',
      entries: [
        { docPath: 'app_docs/first.md', ownedGlobs: ['adws/**'], conditions: [], decisions: [] },
        { docPath: 'app_docs/second.md', ownedGlobs: ['adws/vcs/**'], conditions: [], decisions: [] },
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

describe('glob matcher boundary cases', () => {
  const makeSingleEntry = (glob: string): ConditionalDocsRegistry => ({
    preamble: '',
    entries: [{ docPath: 'app_docs/doc.md', ownedGlobs: [glob], conditions: [], decisions: [] }],
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

describe('findOwningEntries', () => {
  const registry: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: [
      { docPath: 'app_docs/feature-vcs.md', ownedGlobs: ['adws/vcs/**'], conditions: [], decisions: [] },
      { docPath: 'app_docs/feature-cost.md', ownedGlobs: ['adws/cost/**'], conditions: [], decisions: [] },
      { docPath: 'app_docs/feature-all.md', ownedGlobs: ['adws/**'], conditions: [], decisions: [] },
      { docPath: 'app_docs/feature-legacy.md', ownedGlobs: [], conditions: ['legacy'], decisions: [] },
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
      entries: [{ docPath: 'app_docs/legacy.md', ownedGlobs: [], conditions: ['foo'], decisions: [] }],
    };
    expect(findOwningEntries(legacyRegistry, ['anything.ts'])).toEqual([]);
  });

  it('multiple entries matching the same path are all returned', () => {
    const multi: ConditionalDocsRegistry = {
      preamble: '',
      entries: [
        { docPath: 'app_docs/a.md', ownedGlobs: ['adws/vcs/**'], conditions: [], decisions: [] },
        { docPath: 'app_docs/b.md', ownedGlobs: ['adws/**'], conditions: [], decisions: [] },
        { docPath: 'app_docs/c.md', ownedGlobs: ['adws/cost/**'], conditions: [], decisions: [] },
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
