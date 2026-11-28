import { describe, it, expect } from 'vitest';
import { parseRelevantFilesSection } from '../../triggers/regionOverlap';
import { ADW_CLASSIFICATION_LABELS } from '../adwLabels';
import { DOCS_INDEX_REPORT_MARKER } from '../docsIndexReportBody';
import {
  MAX_LISTED_PATTERN_LENGTH,
  MAX_LISTED_UNUSED_DEFINITIONS,
  UNUSED_STEP_ISSUE_MARKER,
  UNUSED_STEP_ISSUE_SEARCH,
  buildUnusedStepIssue,
  findOpenUnusedStepIssue,
  type UnusedStepIssueRef,
} from '../unusedStepIssueBody';
import type { UnusedStepDefinition } from '../unusedStepReport';

const ORDERS: UnusedStepDefinition = { file: 'features/step_definitions/orders.steps.ts', line: 12, pattern: 'an order is placed' };
const INVOICES: UnusedStepDefinition = { file: 'features/step_definitions/invoices.steps.ts', line: 6, pattern: 'the invoice is sent' };
const REGEX: UnusedStepDefinition = { file: 'features/step_definitions/orders.steps.ts', line: 30, pattern: '/^the shop closes at (\\d+)$/' };

function issueFor(definitions: readonly UnusedStepDefinition[], defaultBranch: string | null = 'main') {
  return buildUnusedStepIssue({ definitions, framework: 'cucumber-js', defaultBranch });
}

function sectionOf(body: string, heading: string): string {
  const start = body.indexOf(`## ${heading}\n`);
  if (start === -1) return '';
  const rest = body.slice(start + heading.length + 4);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

function many(count: number): UnusedStepDefinition[] {
  return Array.from({ length: count }, (_, index) => ({ file: `features/step_definitions/bulk-${Math.floor(index / 10)}.steps.ts`, line: index + 1, pattern: `bulk step ${index}` }));
}

describe('buildUnusedStepIssue', () => {
  it('builds a chore labelled adw:chore whose body starts with the reconcile marker on a line of its own', () => {
    const issue = issueFor([ORDERS]);

    expect(issue.labels).toEqual(['adw:chore']);
    expect(Object.keys(ADW_CLASSIFICATION_LABELS)).toContain(issue.labels[0]);
    expect(issue.body.split('\n')[0]).toBe(UNUSED_STEP_ISSUE_MARKER);
    expect(UNUSED_STEP_ISSUE_MARKER).toBe('Reconciles: unused-step-definitions');
  });

  it('lists each definition as file:line with its pattern, in the order given', () => {
    const listed = sectionOf(issueFor([ORDERS, INVOICES, REGEX]).body, 'Unused step definitions').split('\n').filter((line) => line.startsWith('- '));

    expect(listed).toEqual([
      '- `features/step_definitions/orders.steps.ts:12` — `an order is placed`',
      '- `features/step_definitions/invoices.steps.ts:6` — `the invoice is sent`',
      '- `features/step_definitions/orders.steps.ts:30` — `/^the shop closes at (\\d+)$/`',
    ]);
  });

  it("names the dry run's framework and default branch, and no branch when the code host could not report one", () => {
    const onMain = issueFor([ORDERS], 'main').body;
    const unknownBranch = issueFor([ORDERS], null).body;

    expect(onMain).toContain('cucumber-js dry run on `main`');
    expect(unknownBranch).toContain('cucumber-js dry run');
    expect(unknownBranch).not.toContain(' on `');
  });

  it('lists at most 100 definitions and says how many more a later sweep will list once this issue is closed', () => {
    const definitions = many(MAX_LISTED_UNUSED_DEFINITIONS + 7);
    const body = issueFor(definitions).body;
    const listed = sectionOf(body, 'Unused step definitions').split('\n').filter((line) => line.startsWith('- `'));

    expect(MAX_LISTED_UNUSED_DEFINITIONS).toBe(100);
    expect(listed).toHaveLength(100);
    expect(listed[99]).toContain('bulk step 99');
    expect(body).not.toContain('bulk step 100`');
    expect(body).toMatch(/7 more\b.*later sweep.*once this issue is closed/);
    expect(issueFor(many(100)).body).not.toMatch(/more\b.*later sweep/);
  });

  it('counts the listed definitions in the title', () => {
    expect(issueFor([ORDERS, INVOICES]).title).toBe('chore: remove 2 unused step definition(s)');
    expect(issueFor(many(250)).title).toBe('chore: remove 100 unused step definition(s)');
  });

  it('cuts a pattern longer than 160 characters with an ellipsis', () => {
    const long = { ...ORDERS, pattern: `a ${'very '.repeat(60)}long step` };
    const exact = { ...INVOICES, pattern: 'x'.repeat(MAX_LISTED_PATTERN_LENGTH) };
    const listed = sectionOf(issueFor([long, exact]).body, 'Unused step definitions').split('\n').filter((line) => line.startsWith('- '));
    const shown = (line: string): string => line.slice(line.indexOf(' — `') + 4, -1);

    expect(MAX_LISTED_PATTERN_LENGTH).toBe(160);
    expect(shown(listed[0])).toHaveLength(MAX_LISTED_PATTERN_LENGTH);
    expect(shown(listed[0]).endsWith('…')).toBe(true);
    expect(long.pattern.startsWith(shown(listed[0]).slice(0, -1))).toBe(true);
    expect(shown(listed[1])).toBe('x'.repeat(MAX_LISTED_PATTERN_LENGTH));
  });

  it('keeps a pattern holding a backtick in one code span', () => {
    const body = issueFor([{ ...ORDERS, pattern: 'the `orders` table is ``empty``' }, { ...INVOICES, pattern: '`quoted` start' }]).body;

    expect(body).toContain('— ``` the `orders` table is ``empty`` ```');
    expect(body).toContain('— `` `quoted` start ``');
  });

  it('tells the pipeline to remove the listed definitions with the helpers, fixtures and imports only they used, and to leave every other definition and feature file alone', () => {
    const instructions = sectionOf(issueFor([ORDERS]).body, 'What to do');

    expect(instructions).toMatch(/Remove each step definition listed/);
    expect(instructions).toMatch(/helpers, fixtures and imports that only those definitions used/);
    expect(instructions).toMatch(/delete a file .*left empty/);
    expect(instructions).toMatch(/Leave every other step definition and every `\.feature` file as it is/);
    expect(instructions).toMatch(/Keep a listed definition that a feature file uses/);
    expect(instructions).toMatch(/static checks and scenarios must still pass/);
  });

  it('lists each touched file once under ## Touched Files', () => {
    const body = issueFor([ORDERS, INVOICES, REGEX]).body;

    expect(sectionOf(body, 'Touched Files').split('\n').filter((line) => line.startsWith('- '))).toEqual([
      '- `features/step_definitions/orders.steps.ts`',
      '- `features/step_definitions/invoices.steps.ts`',
    ]);
    expect(parseRelevantFilesSection(body)).toEqual(['features/step_definitions/orders.steps.ts', 'features/step_definitions/invoices.steps.ts']);
  });
});

describe('findOpenUnusedStepIssue', () => {
  const body = (marker: string): string => `${marker}\n\nThe sweep found unused step definitions.`;

  it('findOpenUnusedStepIssue returns the lowest-numbered open issue carrying the marker', () => {
    const issues: UnusedStepIssueRef[] = [
      { number: 40, body: body(UNUSED_STEP_ISSUE_MARKER), state: 'OPEN' },
      { number: 12, body: body(UNUSED_STEP_ISSUE_MARKER), state: 'open' },
      { number: 31, body: body(UNUSED_STEP_ISSUE_MARKER) },
    ];

    expect(findOpenUnusedStepIssue(issues)?.number).toBe(12);
    expect(UNUSED_STEP_ISSUE_SEARCH).toBe('"unused-step-definitions"');
  });

  it("findOpenUnusedStepIssue ignores closed issues, a marker that is not on a line of its own, and the docs-index sweep's marker, and returns null for none", () => {
    const issues: UnusedStepIssueRef[] = [
      { number: 3, body: body(UNUSED_STEP_ISSUE_MARKER), state: 'CLOSED' },
      { number: 4, body: `This issue mentions ${UNUSED_STEP_ISSUE_MARKER} in a sentence.`, state: 'OPEN' },
      { number: 5, body: body(DOCS_INDEX_REPORT_MARKER), state: 'OPEN' },
    ];

    expect(findOpenUnusedStepIssue(issues)).toBeNull();
    expect(findOpenUnusedStepIssue([])).toBeNull();
    expect(findOpenUnusedStepIssue([...issues, { number: 9, body: `Intro\r\n${UNUSED_STEP_ISSUE_MARKER}\r\n`, state: 'OPEN' }])?.number).toBe(9);
  });
});
