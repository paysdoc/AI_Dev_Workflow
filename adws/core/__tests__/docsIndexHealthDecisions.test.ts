import { describe, it, expect } from 'vitest';
import { assessDocsIndexHealth, applyRepairs, findViolations, type DocsIndexRepair } from '../docsIndexHealth';
import { serializeConditionalDocs } from '../conditionalDocsRegistry';
import { entry, registryOf } from './fixtures/docsIndexEntries';

describe('applyRepairs — decisions', () => {
  it('keeps the decisions of an entry whose dead glob is pruned', () => {
    const registry = registryOf([
      entry({ docPath: 'app_docs/feature-live.md', ownedGlobs: ['adws/gone.ts', 'adws/live.ts'], decisions: ['0044', '0053'] }),
    ]);
    const repairs: DocsIndexRepair[] = [{ kind: 'prune-dead-glob', docPath: 'app_docs/feature-live.md', glob: 'adws/gone.ts' }];

    const repaired = applyRepairs(registry, repairs);

    expect(repaired.entries[0].ownedGlobs).toEqual(['adws/live.ts']);
    expect(repaired.entries[0].decisions).toEqual(['0044', '0053']);
  });
});

describe('findViolations — decisions', () => {
  it('an index whose first entry ends in a Decisions: block reports no non-canonical violation', () => {
    const first = entry({
      docPath: 'app_docs/feature-first.md',
      ownedGlobs: ['adws/first/**'],
      conditions: ['When working on first'],
      decisions: ['0043'],
    });
    const second = entry({ docPath: 'app_docs/feature-second.md', ownedGlobs: ['adws/second/**'] });
    const registry = registryOf([first, second]);
    const content = serializeConditionalDocs(registry);
    const files = [first.docPath, second.docPath, 'adws/first/x.ts', 'adws/second/y.ts'];

    const violations = findViolations(content, registry, files, null);

    expect(content).toContain('    - When working on first\n  - Decisions:\n    - 0043\n');
    expect(violations.filter((v) => v.kind === 'non-canonical')).toEqual([]);
  });
});

describe('assessDocsIndexHealth — decisions', () => {
  const ADR_44 = 'specs/adr/0044-living-docs-per-module.md';

  function docLinking(...targets: string[]): string {
    return ['# Module', '', '## Decisions', '', ...targets.map((t) => `- [ADR](${t}) — a title`), ''].join('\n');
  }

  it('reports a block whose doc lacks the section and a block naming a missing record, and repairs nothing for them', () => {
    const entries = [
      entry({ docPath: 'app_docs/feature-a.md', decisions: ['0044'] }),
      entry({ docPath: 'app_docs/feature-b.md', decisions: ['0099'] }),
    ];
    const docs: Record<string, string> = {
      'app_docs/feature-a.md': '# A\n',
      'app_docs/feature-b.md': docLinking('../specs/adr/0099-missing.md'),
    };
    const files = [...entries.map((e) => e.docPath), ADR_44];

    const assessment = assessDocsIndexHealth(
      { content: serializeConditionalDocs(registryOf(entries)), files, readDoc: (p) => docs[p] ?? null },
      null,
    );

    expect(assessment.repairs).toEqual([]);
    expect(assessment.violations).toEqual([
      { kind: 'decisions-mismatch', docPath: 'app_docs/feature-a.md', onlyInBlock: ['0044'], onlyInSection: [] },
      { kind: 'unknown-decision', docPath: 'app_docs/feature-b.md', adr: '0099' },
      { kind: 'dead-decision-link', docPath: 'app_docs/feature-b.md', target: '../specs/adr/0099-missing.md' },
    ]);
  });

  it('does not check a dangling entry that carries a block — only its drop repair is reported', () => {
    const entries = [entry({ docPath: 'app_docs/feature-ghost.md', decisions: ['0044'] })];
    const requested: string[] = [];

    const assessment = assessDocsIndexHealth(
      {
        content: serializeConditionalDocs(registryOf(entries)),
        files: [ADR_44],
        readDoc: (p) => {
          requested.push(p);
          return null;
        },
      },
      null,
    );

    expect(assessment.repairs).toEqual([{ kind: 'drop-dangling-entry', docPath: 'app_docs/feature-ghost.md' }]);
    expect(assessment.violations).toEqual([]);
    expect(requested).toEqual([]);
  });

  it('a fully healthy index with blocks, matching sections and record files has no violations', () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({ docPath: `app_docs/feature-n${i}.md`, ownedGlobs: [`adws/mod${i}/**`], decisions: i % 2 === 0 ? ['0044'] : [] }),
    );
    const files = [...entries.map((e) => e.docPath), ...entries.map((_e, i) => `adws/mod${i}/x.ts`), ADR_44];
    const readDoc = (docPath: string): string => (entries.find((e) => e.docPath === docPath)?.decisions.length ? docLinking(`../${ADR_44}`) : '# Module\n');

    const assessment = assessDocsIndexHealth({ content: serializeConditionalDocs(registryOf(entries)), files, readDoc });

    expect(assessment.repairs).toEqual([]);
    expect(assessment.violations).toEqual([]);
  });
});
