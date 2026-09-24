import { Before, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { normalize, findNonCommentChanges, formatCommentOnlyReport } from '../../../adws/checkCommentOnly.ts';
import type { SourceKind } from '../../../adws/checkCommentOnly.ts';

const TS_WITH_COMMENTS = `/**
 * Adds two numbers.
 */
// sums a and b
export function add(a: number, b: number): number {
  /* inline */
  return a + b;

}
`;

const TS_WITHOUT_COMMENTS = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const TS_BASE = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const TS_CHANGED = `export function add(a: number, c: number): number {
  return a + c;
}
`;

const FEATURE_WITH_COMMENTS = `# header comment
Feature: Example

  # a comment before the scenario
  Scenario: Do a thing
    # a comment before the step
    Given a precondition
    When an action happens
    Then an outcome is observed
`;

const FEATURE_WITHOUT_COMMENTS = `Feature: Example

  Scenario: Do a thing
    Given a precondition
    When an action happens
    Then an outcome is observed
`;

const FEATURE_BASE = FEATURE_WITHOUT_COMMENTS;

const FEATURE_STEP_CHANGED = `Feature: Example

  Scenario: Do a thing
    Given a different precondition
    When an action happens
    Then an outcome is observed
`;

const FEATURE_WITH_MIDLINE_HASH = `Feature: Example

  Scenario: Do a thing
    Given the label #urgent is applied
    When an action happens
    Then an outcome is observed
`;

const FEATURE_MIDLINE_HASH_REMOVED = `Feature: Example

  Scenario: Do a thing
    Given the label urgent is applied
    When an action happens
    Then an outcome is observed
`;

let currentSource: string | null = null;
let baseSource: string | null = null;
let currentFile = 'adws/example.ts';
let currentTokens: readonly string[] = [];
let baseTokens: readonly string[] = [];
let reportLines: readonly string[] = [];

Before({ tags: '@adw-853' }, function () {
  currentSource = null;
  baseSource = null;
  currentFile = 'adws/example.ts';
  currentTokens = [];
  baseTokens = [];
  reportLines = [];
});

Given('a TypeScript source with a JSDoc block, line comments, a block comment, and blank lines', function () {
  currentSource = TS_WITH_COMMENTS;
});

Given('the same TypeScript source with every comment and blank line stripped', function () {
  baseSource = TS_WITHOUT_COMMENTS;
});

Given('the current version of {string} and its base version differing by one identifier', function (file: string) {
  currentFile = file;
  currentSource = TS_CHANGED;
  baseSource = TS_BASE;
});

Given('a feature file source with "#" comment lines interspersed between steps', function () {
  currentSource = FEATURE_WITH_COMMENTS;
});

Given('the same feature file source with every "#" comment line removed', function () {
  baseSource = FEATURE_WITHOUT_COMMENTS;
});

Given('a feature file source', function () {
  currentSource = FEATURE_BASE;
});

Given('the same feature file source with one step\'s text changed', function () {
  baseSource = FEATURE_STEP_CHANGED;
});

Given('a feature file source containing a step with a "#" in the middle of its text', function () {
  currentSource = FEATURE_WITH_MIDLINE_HASH;
});

Given('the same feature file source with that mid-line "#" removed', function () {
  baseSource = FEATURE_MIDLINE_HASH_REMOVED;
});

When('both sources are normalised as {string}', function (kind: string) {
  assert.ok(currentSource !== null && baseSource !== null, 'Expected both a current and a base source to have been set');
  currentTokens = normalize(currentSource, kind as SourceKind);
  baseTokens = normalize(baseSource, kind as SourceKind);
});

When('the comment-only guard checks that file pair against base ref {string}', function (baseRef: string) {
  const violations = findNonCommentChanges([{ file: currentFile, current: currentSource, base: baseSource }]);
  reportLines = formatCommentOnlyReport(violations, baseRef, 1);
});

Then('their normalised forms are equal', function () {
  assert.deepStrictEqual(currentTokens, baseTokens);
});

Then('their normalised forms are unequal', function () {
  assert.notDeepStrictEqual(currentTokens, baseTokens);
});

Then('the guard reports {string} as changed beyond comments', function (file: string) {
  const found = reportLines.some((line) => line.includes(file) && line.includes('code-changed'));
  assert.ok(found, `Expected a report line naming ${file} as code-changed, got: ${reportLines.join(' | ')}`);
});
