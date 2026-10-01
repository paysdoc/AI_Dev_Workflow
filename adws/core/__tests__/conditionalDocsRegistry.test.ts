import { describe, it, expect } from 'vitest';
import {
  parseConditionalDocs,
  serializeConditionalDocs,
  type ConditionalDocsRegistry,
} from '../conditionalDocsRegistry';

const CANONICAL = `# Conditional Documentation

- app_docs/feature-new.md
  - Owns:
    - adws/vcs/**
  - Conditions:
    - When working on \`adws/vcs/\` VCS module
  - Decisions:
    - 0042
    - 0044

- app_docs/feature-legacy.md
  - Conditions:
    - When working on \`adws/legacy/\` module

- app_docs/feature-legacy-decided.md
  - Conditions:
    - When working on \`adws/decided/\` module
  - Decisions:
    - 0053
`;

const CANONICAL_REGISTRY: ConditionalDocsRegistry = {
  preamble: '# Conditional Documentation\n\n',
  entries: [
    {
      docPath: 'app_docs/feature-new.md',
      ownedGlobs: ['adws/vcs/**'],
      conditions: ['When working on `adws/vcs/` VCS module'],
      decisions: ['0042', '0044'],
    },
    {
      docPath: 'app_docs/feature-legacy.md',
      ownedGlobs: [],
      conditions: ['When working on `adws/legacy/` module'],
      decisions: [],
    },
    {
      docPath: 'app_docs/feature-legacy-decided.md',
      ownedGlobs: [],
      conditions: ['When working on `adws/decided/` module'],
      decisions: ['0053'],
    },
  ],
};

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

describe('preamble preserved through round-trip', () => {
  it('# Conditional Documentation header survives round-trip', () => {
    const reg = parseConditionalDocs(CANONICAL);
    expect(reg.preamble).toBe('# Conditional Documentation\n\n');
    const serialized = serializeConditionalDocs(reg);
    expect(serialized.startsWith('# Conditional Documentation\n\n')).toBe(true);
  });
});

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

describe('Decisions: block', () => {
  const withBlock = (block: string): string => `# Conditional Documentation

- app_docs/feature-a.md
  - Owns:
    - adws/a/**
  - Conditions:
    - When working on a
${block}`;

  it('parses the items into decisions, verbatim and in order, without leaking into the other lists', () => {
    const reg = parseConditionalDocs(withBlock('  - Decisions:\n    - 0053\n    - 0042\n'));

    expect(reg.entries[0].decisions).toEqual(['0053', '0042']);
    expect(reg.entries[0].ownedGlobs).toEqual(['adws/a/**']);
    expect(reg.entries[0].conditions).toEqual(['When working on a']);
  });

  it('does not let the next entry inherit the block', () => {
    const content = withBlock('  - Decisions:\n    - 0042\n') + '\n- app_docs/feature-b.md\n  - Conditions:\n    - When working on b\n';

    const reg = parseConditionalDocs(content);

    expect(reg.entries[1].decisions).toEqual([]);
    expect(reg.entries[1].conditions).toEqual(['When working on b']);
    expect(serializeConditionalDocs(reg)).toBe(content);
  });

  it('an entry without the block parses to decisions: [] and serializes without a Decisions: line', () => {
    const content = withBlock('');

    const reg = parseConditionalDocs(content);

    expect(reg.entries[0].decisions).toEqual([]);
    expect(serializeConditionalDocs(reg)).toBe(content);
    expect(serializeConditionalDocs(reg)).not.toContain('Decisions:');
  });

  it.each(['44', 'ADR-0044', '0044 '])('a malformed item %j round-trips byte-identically', (item) => {
    const content = withBlock(`  - Decisions:\n    - ${item}\n`);

    expect(parseConditionalDocs(content).entries[0].decisions).toEqual([item]);
    expect(serializeConditionalDocs(parseConditionalDocs(content))).toBe(content);
  });

  it('a block placed before Conditions: parses into decisions but serializes after Conditions:, so it is non-canonical', () => {
    const content = `# Conditional Documentation

- app_docs/feature-a.md
  - Owns:
    - adws/a/**
  - Decisions:
    - 0044
  - Conditions:
    - When working on a
`;

    const reg = parseConditionalDocs(content);

    expect(reg.entries[0].decisions).toEqual(['0044']);
    expect(reg.entries[0].conditions).toEqual(['When working on a']);
    expect(serializeConditionalDocs(reg)).not.toBe(content);
    expect(serializeConditionalDocs(reg)).toBe(withBlock('  - Decisions:\n    - 0044\n'));
  });

  it('an empty Decisions: header serializes without the header, so it is non-canonical like an empty Owns:', () => {
    const content = withBlock('  - Decisions:\n');

    const reg = parseConditionalDocs(content);

    expect(reg.entries[0].decisions).toEqual([]);
    expect(serializeConditionalDocs(reg)).not.toBe(content);
  });

  it('a misspelt Decision: header is not learnt — its item lands in conditions and the round trip fails', () => {
    const content = withBlock('  - Decision:\n    - 0044\n');

    const reg = parseConditionalDocs(content);

    expect(reg.entries[0].decisions).toEqual([]);
    expect(reg.entries[0].conditions).toEqual(['When working on a', '0044']);
    expect(serializeConditionalDocs(reg)).not.toBe(content);
  });
});
