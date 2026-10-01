import { describe, it, expect } from 'vitest';
import { findAdrNumbers, parseDecisionLinks, findDecisionViolations } from '../docsDecisions';
import type { ConditionalDocEntry, ConditionalDocsRegistry } from '../conditionalDocsRegistry';

const ADR_44 = 'specs/adr/0044-living-docs-per-module.md';
const ADR_53 = 'specs/adr/0053-docs-index-health-gate-and-sweep.md';
const DOC = 'app_docs/feature-a.md';

function entry(docPath: string, decisions: string[] = []): ConditionalDocEntry {
  return { docPath, ownedGlobs: [], conditions: ['When X'], decisions };
}

function registryOf(...entries: ConditionalDocEntry[]): ConditionalDocsRegistry {
  return { preamble: '', entries };
}

function bullets(targets: string[]): string[] {
  return targets.map((target) => `- [ADR](${target}) — a title`);
}

function docWithSection(...targets: string[]): string {
  return ['# Module', '', '## Overview', '', 'Prose.', '', '## Decisions', '', ...bullets(targets), ''].join('\n');
}

function readerOf(docs: Record<string, string>): (docPath: string) => string | null {
  return (docPath) => docs[docPath] ?? null;
}

describe('findAdrNumbers', () => {
  it('picks the number of a record file directly under specs/adr/', () => {
    expect([...findAdrNumbers(['specs/adr/0044-a.md', 'specs/adr/0053-b.md'])].sort()).toEqual(['0044', '0053']);
  });

  it.each([
    'specs/adr/README.md',
    'specs/adr/sub/0001-x.md',
    'specs/adr/44-x.md',
    'specs/adr/0044.md',
    'specs/adr/0044-x.txt',
    'app_docs/0044-x.md',
  ])('ignores %s', (file) => {
    expect(findAdrNumbers([file]).size).toBe(0);
  });

  it('is empty for a repository without specs/adr/', () => {
    expect(findAdrNumbers(['README.md', 'adws/core/a.ts']).size).toBe(0);
  });
});

describe('parseDecisionLinks', () => {
  it('extracts the links of the ## Decisions section and resolves ../specs/adr/… against the doc', () => {
    const links = parseDecisionLinks(DOC, docWithSection(`../${ADR_44}`, `../${ADR_53}`));

    expect(links).toEqual([
      { adr: '0044', target: `../${ADR_44}`, resolvedPath: ADR_44 },
      { adr: '0053', target: `../${ADR_53}`, resolvedPath: ADR_53 },
    ]);
  });

  it('ignores ADR links in other sections', () => {
    const doc = ['# Module', '', '## Overview', '', `Governed by [ADR-0044](../${ADR_44}).`, '', '## Decisions', '', ...bullets([`../${ADR_53}`]), '', '## Gotchas', '', `See [ADR-0044](../${ADR_44}).`, ''].join('\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0053']);
  });

  it('ends the section at the next ## heading but not at a ### heading', () => {
    const doc = ['## Decisions', '', ...bullets([`../${ADR_44}`]), '', '### Older', '', ...bullets([`../${ADR_53}`]), '', '## Gotchas', '', ...bullets(['../specs/adr/0001-x.md']), ''].join('\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0044', '0053']);
  });

  it('ends the section at a # heading', () => {
    const doc = ['## Decisions', '', ...bullets([`../${ADR_44}`]), '', '# Appendix', '', ...bullets([`../${ADR_53}`]), ''].join('\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0044']);
  });

  it('starts a section at a heading with trailing whitespace', () => {
    const doc = ['## Decisions   ', '', ...bullets([`../${ADR_44}`]), ''].join('\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0044']);
  });

  it('is empty for a doc with no ## Decisions section', () => {
    expect(parseDecisionLinks(DOC, '# Module\n\n## Overview\n\nProse.\n')).toEqual([]);
  });

  it.each(['```', '~~~', '```md'])('ignores a heading and links inside a %s fence', (fence) => {
    const closing = fence.startsWith('~') ? '~~~' : '```';
    const doc = ['# Module', '', fence, '## Decisions', '', ...bullets([`../${ADR_44}`]), closing, '', '## Decisions', '', ...bullets([`../${ADR_53}`]), ''].join('\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0053']);
  });

  it('skips links inside a fence that sits within the section', () => {
    const doc = ['## Decisions', '', '```md', ...bullets([`../${ADR_44}`]), '```', '', ...bullets([`../${ADR_53}`]), ''].join('\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0053']);
  });

  it('does not let a ~~~ line close a backtick fence', () => {
    const doc = ['# Module', '', '```', '~~~', '## Decisions', ...bullets([`../${ADR_44}`]), '```', ''].join('\n');

    expect(parseDecisionLinks(DOC, doc)).toEqual([]);
  });

  it('strips a #fragment from the target', () => {
    const [link] = parseDecisionLinks(DOC, docWithSection(`../${ADR_44}#decision-outcome`));

    expect(link).toEqual({ adr: '0044', target: `../${ADR_44}`, resolvedPath: ADR_44 });
  });

  it('reads the target of a link that carries a title', () => {
    const doc = `## Decisions\n\n- [ADR-0044](../${ADR_44} "Living docs") — a title\n`;

    expect(parseDecisionLinks(DOC, doc).map((l) => l.resolvedPath)).toEqual([ADR_44]);
  });

  it('reads several links on one line', () => {
    const doc = `## Decisions\n\n- [A](../${ADR_44}) and [B](../${ADR_53})\n`;

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0044', '0053']);
  });

  it('ignores the ADR index, other docs and URLs that do not end in a record path', () => {
    const doc = docWithSection('../specs/adr/README.md', 'feature-b.md', 'https://example.com/page.md', '../specs/adr/0044-x.txt');

    expect(parseDecisionLinks(DOC, doc)).toEqual([]);
  });

  it('treats a URL that ends in a record path as a decision link that is not a repository file', () => {
    const url = 'https://github.com/o/r/blob/dev/specs/adr/0044-x.md';

    const [link] = parseDecisionLinks(DOC, docWithSection(url));

    expect(link.adr).toBe('0044');
    expect(link.target).toBe(url);
    expect(link.resolvedPath).not.toBe('specs/adr/0044-x.md');
  });

  it('reports a link missing its ../ with the path it resolves to from the doc directory', () => {
    const [link] = parseDecisionLinks(DOC, docWithSection('specs/adr/0044-x.md'));

    expect(link.resolvedPath).toBe('app_docs/specs/adr/0044-x.md');
  });

  it('resolves a root-relative target from the repository root', () => {
    const [link] = parseDecisionLinks(DOC, docWithSection('/specs/adr/0044-x.md'));

    expect(link.resolvedPath).toBe('specs/adr/0044-x.md');
  });

  it('resolves a root-level doc against the root, with no ../', () => {
    const [link] = parseDecisionLinks('README.md', docWithSection('specs/adr/0044-x.md'));

    expect(link.resolvedPath).toBe('specs/adr/0044-x.md');
  });

  it('resolves against a nested doc directory', () => {
    const [link] = parseDecisionLinks('adws/README.md', docWithSection('../specs/adr/0044-x.md'));

    expect(link.resolvedPath).toBe('specs/adr/0044-x.md');
  });

  it('reads a doc with CRLF line endings, tilde fences included', () => {
    const doc = ['~~~', '## Decisions', ...bullets([`../${ADR_44}`]), '~~~', '', '## Decisions', '', ...bullets([`../${ADR_53}`]), ''].join('\r\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0053']);
  });

  it('reads two ## Decisions sections', () => {
    const doc = ['## Decisions', '', ...bullets([`../${ADR_44}`]), '', '## Gotchas', '', 'x', '', '## Decisions', '', ...bullets([`../${ADR_53}`]), ''].join('\n');

    expect(parseDecisionLinks(DOC, doc).map((l) => l.adr)).toEqual(['0044', '0053']);
  });
});

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
