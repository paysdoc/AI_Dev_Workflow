import { describe, it, expect } from 'vitest';
import { findAdrNumbers, parseDecisionLinks } from '../docsDecisions';
import { ADR_44, ADR_53, DOC, bullets, docWithSection } from './fixtures/decisionDocs';

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
