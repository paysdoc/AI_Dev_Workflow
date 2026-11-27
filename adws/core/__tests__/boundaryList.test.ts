import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import {
  BoundaryViolationKind,
  boundaryTag,
  checkBoundaryTags,
  describeBoundaryViolation,
  parseBoundaryList,
  withoutBoundaryTags,
  type BoundaryList,
  type DeclaredBoundaryList,
} from '../boundaryList';
import type { FeatureFileSource } from '../../proof/featureScenarioIndex';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const PER_ISSUE_TAG = '@adw-1139';

function declared(...names: string[]): DeclaredBoundaryList {
  return { kind: 'declared', boundaries: names.map((name) => ({ name, description: `the ${name} boundary` })), malformedEntries: [] };
}

function withSection(body: string): string {
  return ['# ADW BDD Scenario Configuration', '', '## Scenario Directory', 'features/', '', '## Real Boundaries', body, '', '## BDD Framework', 'cucumber-js', ''].join('\n');
}

function asDeclared(list: BoundaryList): DeclaredBoundaryList {
  expect(list.kind).toBe('declared');
  return list as DeclaredBoundaryList;
}

const featureFile = (filePath: string, ...lines: string[]): FeatureFileSource => ({ path: filePath, content: `${lines.join('\n')}\n` });

describe('parseBoundaryList', () => {
  it('reports the list as absent when .adw/scenarios.md has no ## Real Boundaries section', () => {
    expect(parseBoundaryList('## Scenario Directory\nfeatures/\n\n## BDD Framework\ncucumber-js\n')).toEqual({ kind: 'absent' });
  });

  it('reports empty configuration text as absent', () => {
    expect(parseBoundaryList('')).toEqual({ kind: 'absent' });
  });

  it('reports a section with no entry as declared and empty, not as absent', () => {
    expect(parseBoundaryList(withSection(''))).toEqual({ kind: 'declared', boundaries: [], malformedEntries: [] });
  });

  it('reports a section holding only an HTML comment as declared and empty', () => {
    expect(parseBoundaryList(withSection('<!-- One entry per Real Boundary. -->'))).toEqual({ kind: 'declared', boundaries: [], malformedEntries: [] });
  });

  it('reads a top-level item as a boundary with its name and description, whether the name is in backticks, followed by a colon, or bare', () => {
    const list = asDeclared(
      parseBoundaryList(withSection(['- `cli` — a real command-line invocation', '- browser: a real browser', '- built-artifact – the built artifact', '- runtime - the real runtime'].join('\n'))),
    );

    expect(list.boundaries).toEqual([
      { name: 'cli', description: 'a real command-line invocation' },
      { name: 'browser', description: 'a real browser' },
      { name: 'built-artifact', description: 'the built artifact' },
      { name: 'runtime', description: 'the real runtime' },
    ]);
    expect(list.malformedEntries).toEqual([]);
  });

  it('reads items that start with * as well as -', () => {
    const list = asDeclared(parseBoundaryList(withSection(['* `cli` — a real command-line invocation', '- `browser` — a real browser'].join('\n'))));

    expect(list.boundaries.map((boundary) => boundary.name)).toEqual(['cli', 'browser']);
  });

  it('ignores prose lines and indented items inside the section', () => {
    const body = ['The boundaries a scenario of this target drives:', '- `cli` — a real command-line invocation', '  - `nested` — a note on the cli entry', '    * `deeper` — another note', 'Each name is used as a tag.'].join('\n');
    const list = asDeclared(parseBoundaryList(withSection(body)));

    expect(list.boundaries).toEqual([{ name: 'cli', description: 'a real command-line invocation' }]);
    expect(list.malformedEntries).toEqual([]);
  });

  it.each([
    ['a bold name', '- **cli** — a real command-line invocation'],
    ['an uppercase name', '- CLI — a real command-line invocation'],
    ['a sentence', '- the built binary, run from the shell'],
  ])('reports an item whose first token is not a lowercase name as a malformed entry and not as a boundary: %s', (_case, entry) => {
    const list = asDeclared(parseBoundaryList(withSection(['- `browser` — a real browser', entry].join('\n'))));

    expect(list.boundaries.map((boundary) => boundary.name)).toEqual(['browser']);
    expect(list.malformedEntries).toEqual([entry]);
  });

  it('keeps the first of two entries with the same name', () => {
    const list = asDeclared(parseBoundaryList(withSection(['- `cli` — the first description', '- `cli` — the second description'].join('\n'))));

    expect(list.boundaries).toEqual([{ name: 'cli', description: 'the first description' }]);
  });

  it('ignores entries inside an HTML comment', () => {
    const body = ['<!-- An example entry:', '- `example` — what the boundary is', '-->', '- `cli` — a real command-line invocation'].join('\n');
    const list = asDeclared(parseBoundaryList(withSection(body)));

    expect(list.boundaries.map((boundary) => boundary.name)).toEqual(['cli']);
    expect(list.malformedEntries).toEqual([]);
  });

  it('finds the section whatever the case of its heading and leaves the other sections out', () => {
    const markdown = ['## Per-Issue Scenario Directory', '- `features` — not a boundary', '', '## REAL BOUNDARIES', '- `cli` — a real command-line invocation', '', '## Step Def Directory', '- `steps` — not a boundary'].join('\n');
    const list = asDeclared(parseBoundaryList(markdown));

    expect(list.boundaries.map((boundary) => boundary.name)).toEqual(['cli']);
    expect(list.malformedEntries).toEqual([]);
  });
});

describe('checkBoundaryTags', () => {
  it('finds no violation when every @adw-N scenario carries a declared boundary tag', () => {
    const file = featureFile('orders.feature', 'Feature: Orders', '', '  @adw-1139 @boundary-cli', '  Scenario: Orders are listed', '    Given an order', '', '  @adw-1139 @boundary-browser', '  Scenario: Orders are shown', '    Given an order');

    expect(checkBoundaryTags(declared('cli', 'browser'), [file], PER_ISSUE_TAG)).toEqual([]);
  });

  it('reports a @adw-N scenario without a boundary tag as missing, naming its feature file and title', () => {
    const file = featureFile('per-issue/feature-1139.feature', 'Feature: Orders', '', '  @adw-1139', '  Scenario: Orders are listed', '    Given an order');

    expect(checkBoundaryTags(declared('cli'), [file], PER_ISSUE_TAG)).toEqual([
      { kind: BoundaryViolationKind.MissingTag, featurePath: 'per-issue/feature-1139.feature', scenario: 'Orders › Orders are listed' },
    ]);
  });

  it('reports a boundary tag that is not on the list as undeclared, naming the tag', () => {
    const file = featureFile('orders.feature', 'Feature: Orders', '', '  @adw-1139 @boundary-database', '  Scenario: Orders are stored', '    Given an order');

    expect(checkBoundaryTags(declared('cli'), [file], PER_ISSUE_TAG)).toEqual([
      { kind: BoundaryViolationKind.UndeclaredTag, featurePath: 'orders.feature', scenario: 'Orders › Orders are stored', tag: '@boundary-database' },
    ]);
  });

  it('reports only the undeclared tag of a scenario that also carries a declared one', () => {
    const file = featureFile('orders.feature', 'Feature: Orders', '', '  @adw-1139 @boundary-cli @boundary-database', '  Scenario: Orders are stored', '    Given an order');

    expect(checkBoundaryTags(declared('cli'), [file], PER_ISSUE_TAG)).toEqual([
      { kind: BoundaryViolationKind.UndeclaredTag, featurePath: 'orders.feature', scenario: 'Orders › Orders are stored', tag: '@boundary-database' },
    ]);
  });

  it('takes a boundary tag on the Feature or the Rule as the tag of every scenario below it', () => {
    const onFeature = featureFile('feature.feature', '@boundary-cli', 'Feature: Orders', '', '  @adw-1139', '  Scenario: Orders are listed', '    Given an order');
    const onRule = featureFile(
      'rule.feature',
      'Feature: Payments',
      '',
      '  @boundary-cli',
      '  Rule: Payments are listed',
      '',
      '    @adw-1139',
      '    Scenario: A payment is listed',
      '      Given a payment',
    );

    expect(checkBoundaryTags(declared('cli'), [onFeature, onRule], PER_ISSUE_TAG)).toEqual([]);
  });

  it('checks each row of a Scenario Outline with the tags of its outline and Examples', () => {
    const file = featureFile(
      'outline.feature',
      'Feature: Orders',
      '',
      '  @adw-1139',
      '  Scenario Outline: An order of <quantity> is judged',
      '    Given an order of <quantity>',
      '',
      '    @boundary-cli',
      '    Examples:',
      '      | quantity |',
      '      | 1        |',
      '',
      '    Examples:',
      '      | quantity |',
      '      | 2        |',
    );

    const violations = checkBoundaryTags(declared('cli'), [file], PER_ISSUE_TAG);

    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe(BoundaryViolationKind.MissingTag);
    expect(violations[0].scenario).toMatch(/An order of 2 is judged$/);
  });

  it("ignores scenarios without the per-issue tag: a @regression scenario and another issue's per-issue scenario written before this change, neither with a boundary tag, are no violation", () => {
    const regression = featureFile('regression/orders.feature', 'Feature: Orders', '', '  @regression', '  Scenario: Orders are accepted', '    Given an order');
    const otherIssue = featureFile('per-issue/feature-1138.feature', '@adw-1138', 'Feature: Workflows', '', '  @adw-1138 @subprocess', '  Scenario: A workflow runs', '    Given a workflow');

    expect(checkBoundaryTags(declared('cli'), [regression, otherIssue], PER_ISSUE_TAG)).toEqual([]);
  });

  it('compares the per-issue tag whole: a scenario tagged @adw-11390 is not checked for @adw-1139', () => {
    const file = featureFile('orders.feature', 'Feature: Orders', '', '  @adw-11390', '  Scenario: Orders are listed', '    Given an order');

    expect(checkBoundaryTags(declared('cli'), [file], PER_ISSUE_TAG)).toEqual([]);
  });

  it('reports every tagged scenario as undeclared against a declared but empty list', () => {
    const file = featureFile('orders.feature', 'Feature: Orders', '', '  @adw-1139 @boundary-cli', '  Scenario: Orders are listed', '    Given an order', '', '  @adw-1139 @boundary-browser', '  Scenario: Orders are shown', '    Given an order');

    expect(checkBoundaryTags(declared(), [file], PER_ISSUE_TAG).map((violation) => violation.kind)).toEqual([
      BoundaryViolationKind.UndeclaredTag,
      BoundaryViolationKind.UndeclaredTag,
    ]);
  });

  it('finds nothing for an issue without per-issue scenarios', () => {
    const file = featureFile('orders.feature', 'Feature: Orders', '', '  @regression', '  Scenario: Orders are accepted', '    Given an order');

    expect(checkBoundaryTags(declared('cli'), [file], PER_ISSUE_TAG)).toEqual([]);
    expect(checkBoundaryTags(declared('cli'), [], PER_ISSUE_TAG)).toEqual([]);
  });

  it('skips a feature file the Gherkin parser rejects', () => {
    const broken = featureFile('broken.feature', '@adw-1139', 'Scenario: outside any feature', '    Given nothing parses');
    const valid = featureFile('orders.feature', 'Feature: Orders', '', '  @adw-1139 @boundary-cli', '  Scenario: Orders are listed', '    Given an order');

    expect(checkBoundaryTags(declared('cli'), [broken, valid], PER_ISSUE_TAG)).toEqual([]);
  });
});

describe('describeBoundaryViolation', () => {
  it('names the feature file, the scenario and the problem for a missing and for an undeclared tag', () => {
    expect(describeBoundaryViolation({ kind: BoundaryViolationKind.MissingTag, featurePath: 'orders.feature', scenario: 'Orders › Orders are listed' })).toBe(
      '`orders.feature`: scenario "Orders › Orders are listed" carries no boundary tag',
    );
    expect(
      describeBoundaryViolation({ kind: BoundaryViolationKind.UndeclaredTag, featurePath: 'orders.feature', scenario: 'Orders › Orders are stored', tag: '@boundary-database' }),
    ).toBe('`orders.feature`: scenario "Orders › Orders are stored" carries @boundary-database, which names no boundary under ## Real Boundaries');
  });
});

describe('boundaryTag', () => {
  it('prefixes the name with @boundary-', () => {
    expect(boundaryTag('subprocess')).toBe('@boundary-subprocess');
  });
});

describe('withoutBoundaryTags', () => {
  it('removes boundary tags from tag lines and drops a tag line that held nothing else', () => {
    const text = ['@boundary-cli', 'Feature: Orders', '', '  @adw-1139 @boundary-cli @smoke', '  Scenario: Orders are listed', '    Given an order'].join('\n');

    expect(withoutBoundaryTags(text)).toBe(['Feature: Orders', '', '  @adw-1139 @smoke', '  Scenario: Orders are listed', '    Given an order'].join('\n'));
  });

  it('leaves other tags, steps, comments and blank lines as they are', () => {
    const text = ['# language: en', '@adw-1139', 'Feature: Orders', '', '  # A comment that mentions @boundary-cli', '  @regression', '  Scenario: Orders are accepted', '    Given an order tagged "@boundary-cli"', '', ''].join('\n');

    expect(withoutBoundaryTags(text)).toBe(text);
  });

  it('gives the same text for a tag line with a boundary tag inserted and for the line without it', () => {
    const before = ['Feature: Orders', '', '  @adw-1139 @smoke', '  Scenario: Orders are listed', '    Given an order'].join('\n');
    const inserted = ['Feature: Orders', '', '  @adw-1139 @boundary-cli @smoke', '  Scenario: Orders are listed', '    Given an order'].join('\n');
    const onItsOwnLine = ['Feature: Orders', '', '  @boundary-cli', '  @adw-1139 @smoke', '  Scenario: Orders are listed', '    Given an order'].join('\n');

    expect(withoutBoundaryTags(inserted)).toBe(withoutBoundaryTags(before));
    expect(withoutBoundaryTags(onItsOwnLine)).toBe(withoutBoundaryTags(before));
  });
});

describe("ADW's own configuration", () => {
  it("ADW's own .adw/scenarios.md declares the subprocess boundary and no malformed entry", () => {
    const list = asDeclared(parseBoundaryList(fs.readFileSync(path.join(REPO_ROOT, '.adw/scenarios.md'), 'utf-8')));

    expect(list.boundaries.map((boundary) => boundary.name)).toContain('subprocess');
    expect(list.malformedEntries).toEqual([]);
  });
});
