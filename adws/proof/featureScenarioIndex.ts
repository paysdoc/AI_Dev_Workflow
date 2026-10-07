/**
 * Pure. Playwright's JUnit test-case names carry no tags, so the tags of a test case are found by naming each
 * scenario of the feature files the way ADW's Playwright project names its test, and matching the case to it.
 */

import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import type { Comment, Examples, FeatureChild, GherkinDocument, Rule, Scenario, TableRow, Tag } from '@cucumber/messages';

export interface FeatureFileSource {
  readonly path: string;
  readonly content: string;
}

export interface IndexedScenario {
  readonly featurePath: string;
  /** The test-case name the Playwright project's JUnit report gives the scenario; for a Scenario Outline, the row. */
  readonly title: string;
  /** The last segment of the title. */
  readonly name: string;
  /** The tags of the Feature, the Rule, the scenario, and for an outline row its Examples table, each once. */
  readonly tags: readonly string[];
}

export interface FeatureScenarioIndex {
  readonly scenarios: readonly IndexedScenario[];
  /** Files the Gherkin parser rejected; the scenario runner reports their parse error. */
  readonly unparsed: readonly FeatureFileSource[];
}

export const EMPTY_FEATURE_SCENARIO_INDEX: FeatureScenarioIndex = { scenarios: [], unparsed: [] };

const TITLE_SEPARATOR = ' › ';
const TITLE_FORMAT_COMMENT = '# title-format:';
const PLACEHOLDER = /<(.+?)>/g;

/** What the Feature and the Rule above a scenario contribute to its title and its tags. */
interface Scope {
  readonly titleSegments: readonly string[];
  readonly tags: readonly string[];
}

interface FileContext {
  readonly featurePath: string;
  readonly language: string;
  readonly comments: readonly Comment[];
}

function parseDocument(content: string): GherkinDocument | null {
  try {
    const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
    return parser.parse(content) as unknown as GherkinDocument;
  } catch {
    return null;
  }
}

function tagNames(tags: readonly Tag[]): string[] {
  return tags.map(tag => tag.name);
}

function indexedScenario(featurePath: string, titleSegments: readonly string[], tags: readonly string[]): IndexedScenario {
  return {
    featurePath,
    title: titleSegments.join(TITLE_SEPARATOR),
    name: titleSegments[titleSegments.length - 1],
    tags: [...new Set(tags)],
  };
}

// The example title rules replicate playwright-bdd 9.2.1 (dist/generate/examplesTitleBuilder.js) as ADW's Playwright
// project pins it: the test names have to match what that project emits. ADW's configuration sets no `examplesTitleFormat`.

function titleFormatComment(examples: Examples, comments: readonly Comment[]): string {
  const firstTagLine = Math.min(...examples.tags.map(tag => tag.location.line));
  const candidateLines = [examples.location.line - 1, firstTagLine - 1];
  const format = candidateLines
    .map(line => comments.find(comment => comment.location.line === line)?.text.trim())
    .find(text => text?.startsWith(TITLE_FORMAT_COMMENT));
  return format?.replace(TITLE_FORMAT_COMMENT, '').trim() ?? '';
}

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map(match => match[1]);
}

/** The text itself when it names at least one column of the table, else ''. */
function templateNamingAColumn(examples: Examples, text: string): string {
  const columns = examples.tableHeader?.cells.map(cell => cell.value) ?? [];
  return placeholdersIn(text).some(placeholder => columns.includes(placeholder)) ? text : '';
}

function defaultTemplate(examples: Examples, language: string): string {
  return language === 'en' ? 'Example #<_index_>' : `${examples.keyword}: #<_index_>`;
}

function exampleTitleTemplate(outline: Scenario, examples: Examples, context: FileContext): string {
  return (
    titleFormatComment(examples, context.comments) ||
    templateNamingAColumn(examples, examples.name) ||
    templateNamingAColumn(examples, outline.name) ||
    defaultTemplate(examples, context.language)
  );
}

function fillTemplate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(PLACEHOLDER, (placeholder, key: string) => (params[key] !== undefined ? String(params[key]) : placeholder));
}

function rowValues(examples: Examples, row: TableRow): Record<string, string> {
  const columns = examples.tableHeader?.cells.map(cell => cell.value) ?? [];
  const entries = row.cells.flatMap((cell, position) => (columns[position] ? [[columns[position], cell.value]] : []));
  return Object.fromEntries(entries);
}

interface OutlineRow {
  readonly examples: Examples;
  readonly row: TableRow;
}

function indexOutline(outline: Scenario, scope: Scope, context: FileContext): IndexedScenario[] {
  const rows: OutlineRow[] = outline.examples.flatMap(examples => examples.tableBody.map(row => ({ examples, row })));
  return rows.map(({ examples, row }, position) => {
    const template = exampleTitleTemplate(outline, examples, context);
    const title = fillTemplate(template, { _index_: position + 1, ...rowValues(examples, row) });
    const tags = [...scope.tags, ...tagNames(outline.tags), ...tagNames(examples.tags)];
    return indexedScenario(context.featurePath, [...scope.titleSegments, outline.name, title], tags);
  });
}

function indexScenario(scenario: Scenario, scope: Scope, context: FileContext): IndexedScenario {
  return indexedScenario(context.featurePath, [...scope.titleSegments, scenario.name], [...scope.tags, ...tagNames(scenario.tags)]);
}

function enterRule(scope: Scope, rule: Rule): Scope {
  return { titleSegments: [...scope.titleSegments, rule.name], tags: [...scope.tags, ...tagNames(rule.tags)] };
}

// A Scenario Outline without an Examples block behaves like a scenario, as the generator treats it.
function indexChild(child: FeatureChild, scope: Scope, context: FileContext): IndexedScenario[] {
  const { rule, scenario } = child;
  if (rule) return rule.children.flatMap(ruleChild => indexChild(ruleChild, enterRule(scope, rule), context));
  if (!scenario) return [];
  return scenario.examples.length > 0 ? indexOutline(scenario, scope, context) : [indexScenario(scenario, scope, context)];
}

function indexDocument(featurePath: string, document: GherkinDocument): IndexedScenario[] {
  const { feature } = document;
  if (!feature) return [];
  const scope: Scope = { titleSegments: [feature.name], tags: tagNames(feature.tags) };
  const context: FileContext = { featurePath, language: feature.language, comments: document.comments };
  return feature.children.flatMap(child => indexChild(child, scope, context));
}

export function indexFeatureScenarios(files: readonly FeatureFileSource[]): FeatureScenarioIndex {
  const parsed = files.map(file => ({ file, document: parseDocument(file.content) }));
  return {
    scenarios: parsed.flatMap(({ file, document }) => (document ? indexDocument(file.path, document) : [])),
    unparsed: parsed.filter(({ document }) => document === null).map(({ file }) => file),
  };
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function holdsTagToken(text: string, tag: string): boolean {
  return new RegExp(`(^|\\s)${escapeForRegExp(tag)}(?=\\s|$)`, 'm').test(text);
}

/**
 * Tags are compared whole, so `@adw-99` is not `@adw-992`. A file that did not parse counts when its raw text holds the tag:
 * the run goes ahead and reports the parse error, instead of reading as "no scenario carries the tag".
 */
export function hasScenarioTagged(index: FeatureScenarioIndex, tag: string): boolean {
  return index.scenarios.some(scenario => scenario.tags.includes(tag)) || index.unparsed.some(file => holdsTagToken(file.content, tag));
}

/** A name without a separator is a runner that reports the scenario title alone: it is matched against the last segment. */
export function scenariosForTestCase(index: FeatureScenarioIndex, caseName: string): readonly IndexedScenario[] {
  const byTitle = index.scenarios.filter(scenario => scenario.title === caseName);
  if (byTitle.length > 0 || caseName.includes(TITLE_SEPARATOR)) return byTitle;
  return index.scenarios.filter(scenario => scenario.name === caseName);
}
