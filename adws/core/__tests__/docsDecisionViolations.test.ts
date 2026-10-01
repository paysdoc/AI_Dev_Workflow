import { describe, it, expect } from 'vitest';
import { findDecisionViolations } from '../docsDecisions';
import type { ConditionalDocEntry, ConditionalDocsRegistry } from '../conditionalDocsRegistry';
import { ADR_44, ADR_53, DOC, docWithSection } from './fixtures/decisionDocs';

function entry(docPath: string, decisions: string[] = []): ConditionalDocEntry {
  return { docPath, ownedGlobs: [], conditions: ['When X'], decisions };
}

function registryOf(...entries: ConditionalDocEntry[]): ConditionalDocsRegistry {
  return { preamble: '', entries };
}

function readerOf(docs: Record<string, string>): (docPath: string) => string | null {
  return (docPath) => docs[docPath] ?? null;
}

describe('findDecisionViolations', () => {
  const files = [DOC, ADR_44, ADR_53, 'specs/adr/0001-first.md', 'specs/adr/0002-second.md', 'specs/adr/0003-third.md'];

  const run = (decisions: string[], doc: string | null, repoFiles: readonly string[] = files) =>
    findDecisionViolations(registryOf(entry(DOC, decisions)), repoFiles, readerOf(doc === null ? {} : { [DOC]: doc }));

  it('reports nothing when the block and the section list the same records and the files exist', () => {
    expect(run(['0044', '0053'], docWithSection(`../${ADR_44}`, `../${ADR_53}`))).toEqual([]);
  });

  it('reports a record the section lacks as onlyInBlock', () => {
    expect(run(['0044', '0053'], docWithSection(`../${ADR_44}`))).toEqual([
      { kind: 'decisions-mismatch', docPath: DOC, onlyInBlock: ['0053'], onlyInSection: [] },
    ]);
  });

  it('reports a section with no block as onlyInSection', () => {
    expect(run([], docWithSection(`../${ADR_44}`))).toEqual([
      { kind: 'decisions-mismatch', docPath: DOC, onlyInBlock: [], onlyInSection: ['0044'] },
    ]);
  });

  it('reports both differences when the two sides each hold a record the other lacks', () => {
    expect(run(['0001', '0002'], docWithSection('../specs/adr/0001-first.md', '../specs/adr/0003-third.md'))).toEqual([
      { kind: 'decisions-mismatch', docPath: DOC, onlyInBlock: ['0002'], onlyInSection: ['0003'] },
    ]);
  });

  it('lists each difference ascending and distinct', () => {
    const [violation] = run(['0003', '0001', '0003'], docWithSection());

    expect(violation).toMatchObject({ kind: 'decisions-mismatch', onlyInBlock: ['0001', '0003'], onlyInSection: [] });
  });

  it('reports a block with no section at all', () => {
    expect(run(['0044'], '# Module\n\n## Overview\n\nProse.\n')).toEqual([
      { kind: 'decisions-mismatch', docPath: DOC, onlyInBlock: ['0044'], onlyInSection: [] },
    ]);
  });

  it('reports an unknown record, and a mismatch as well when the section lacks it', () => {
    expect(run(['0099'], docWithSection())).toEqual([
      { kind: 'unknown-decision', docPath: DOC, adr: '0099' },
      { kind: 'decisions-mismatch', docPath: DOC, onlyInBlock: ['0099'], onlyInSection: [] },
    ]);
  });

  it('reports a malformed block item as an unknown record', () => {
    const violations = run(['ADR-0044'], docWithSection(`../${ADR_44}`));

    expect(violations).toContainEqual({ kind: 'unknown-decision', docPath: DOC, adr: 'ADR-0044' });
  });

  it('reports each unknown block item once, however often it is listed', () => {
    const violations = run(['0099', '0099'], docWithSection());

    expect(violations.filter((v) => v.kind === 'unknown-decision')).toHaveLength(1);
  });

  it('reports only a dead link when the slug is wrong but the numbers agree', () => {
    expect(run(['0044'], docWithSection('../specs/adr/0044-old-slug.md'))).toEqual([
      { kind: 'dead-decision-link', docPath: DOC, target: '../specs/adr/0044-old-slug.md' },
    ]);
  });

  it('reports a link without its ../ as a dead link', () => {
    expect(run(['0044'], docWithSection(ADR_44))).toEqual([
      { kind: 'dead-decision-link', docPath: DOC, target: ADR_44 },
    ]);
  });

  it('reports a URL to a record as a dead link', () => {
    const url = `https://github.com/o/r/blob/dev/${ADR_44}`;

    expect(run(['0044'], docWithSection(url))).toEqual([{ kind: 'dead-decision-link', docPath: DOC, target: url }]);
  });

  it('accepts a root-relative link that reaches the record', () => {
    expect(run(['0044'], docWithSection(`/${ADR_44}`))).toEqual([]);
  });

  it('ignores order and duplicates', () => {
    expect(run(['0053', '0044'], docWithSection(`../${ADR_44}`, `../${ADR_53}`, `../${ADR_44}`))).toEqual([]);
  });

  it('orders an entry\'s findings: unknown records, then dead links, then the mismatch', () => {
    const kinds = run(['0099'], docWithSection('../specs/adr/0044-old.md')).map((v) => v.kind);

    expect(kinds).toEqual(['unknown-decision', 'dead-decision-link', 'decisions-mismatch']);
  });

  it('reports nothing for a repository without ADRs, blocks or sections', () => {
    expect(run([], '# Module\n', [DOC])).toEqual([]);
  });

  it('reports an unknown record and a dead link, but no mismatch, for a block in a repository without ADRs', () => {
    expect(run(['0044'], docWithSection(`../${ADR_44}`), [DOC])).toEqual([
      { kind: 'unknown-decision', docPath: DOC, adr: '0044' },
      { kind: 'dead-decision-link', docPath: DOC, target: `../${ADR_44}` },
    ]);
  });

  it('ignores a ## Decisions heading of prose that links no record', () => {
    expect(run([], '# Module\n\n## Decisions\n\nWe decided to keep it simple.\n')).toEqual([]);
  });

  it('treats an unreadable doc as a doc with no section', () => {
    expect(run(['0044'], null)).toEqual([
      { kind: 'decisions-mismatch', docPath: DOC, onlyInBlock: ['0044'], onlyInSection: [] },
    ]);
  });

  it('reads every entry\'s doc, in entry order', () => {
    const docB = 'app_docs/feature-b.md';
    const registry = registryOf(entry(DOC, ['0001']), entry(docB, []));

    const violations = findDecisionViolations(
      registry,
      [...files, docB],
      readerOf({ [DOC]: docWithSection(), [docB]: docWithSection(`../${ADR_44}`) }),
    );

    expect(violations.map((v) => v.docPath)).toEqual([DOC, docB]);
  });

  it('does not mutate the registry', () => {
    const registry = registryOf(entry(DOC, ['0003', '0001']));
    const snapshot = JSON.parse(JSON.stringify(registry)) as ConditionalDocsRegistry;

    findDecisionViolations(registry, files, readerOf({ [DOC]: docWithSection() }));

    expect(registry).toEqual(snapshot);
  });
});
