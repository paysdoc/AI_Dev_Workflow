/**
 * The test-case names a repository's scenario runner gives the scenarios of a feature file, and the tags each carries. It is
 * written from the Gherkin text alone and does not use the proof assembler's feature index, so that the scenarios which
 * run the assembler do not check the index against itself.
 *
 * ADW's Playwright project names a scenario "<Feature> › <Scenario>" and an outline row "<Feature> › <Outline> › <title>";
 * cucumber-js, the runner of a cli repository, names it by the scenario alone. The title of an outline row is the name of its
 * Examples table when that names a column, else the outline's name when that does, else "Example #<n>". Rules, comments and
 * languages other than English are not used by the scenarios and are not handled.
 */

export type RepositoryType = 'web' | 'cli';

export interface RunnerCase {
  /** What the tables' "scenario" column says: the scenario's name, or the title of an outline row. */
  readonly scenario: string;
  readonly feature: string;
  /** The test-case name of the scenario in the repository's JUnit report. */
  readonly name: string;
  /** Those of the Feature, the scenario and, for an outline row, its Examples table. */
  readonly tags: readonly string[];
}

const SEPARATOR = ' › ';
const PLACEHOLDER = /<(.+?)>/g;

interface Outline {
  readonly name: string;
  readonly tags: readonly string[];
  /** The rows seen so far, across the Examples tables of the outline. */
  readonly rows: number;
}

interface Examples {
  readonly name: string;
  readonly tags: readonly string[];
  readonly header: readonly string[] | null;
}

function after(line: string, keyword: string): string {
  return line.slice(keyword.length).trim();
}

function cells(line: string): string[] {
  return line.split('|').slice(1, -1).map(cell => cell.trim());
}

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map(match => match[1]);
}

function namesAColumn(text: string, header: readonly string[]): boolean {
  return placeholdersIn(text).some(placeholder => header.includes(placeholder));
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (placeholder, key: string) => values[key] ?? placeholder);
}

function rowTitle(outline: Outline, examples: Examples, values: Readonly<Record<string, string>>): string {
  const header = examples.header ?? [];
  if (namesAColumn(examples.name, header)) return fill(examples.name, values);
  if (namesAColumn(outline.name, header)) return fill(outline.name, values);
  return `Example #${outline.rows}`;
}

interface ParserState {
  readonly feature: string;
  readonly featureTags: readonly string[];
  readonly pendingTags: readonly string[];
  readonly outline: Outline | null;
  readonly examples: Examples | null;
  readonly cases: readonly RunnerCase[];
}

const INITIAL_STATE: ParserState = { feature: '', featureTags: [], pendingTags: [], outline: null, examples: null, cases: [] };

function nameOf(type: RepositoryType, feature: string, segments: readonly string[]): string {
  return type === 'web' ? [feature, ...segments].join(SEPARATOR) : segments[segments.length - 1];
}

function withCase(state: ParserState, type: RepositoryType, scenario: string, tags: readonly string[], ...segments: string[]): ParserState {
  const found: RunnerCase = {
    scenario,
    feature: state.feature,
    name: nameOf(type, state.feature, segments),
    tags: [...new Set([...state.featureTags, ...tags])],
  };
  return { ...state, cases: [...state.cases, found] };
}

function withScenario(state: ParserState, type: RepositoryType, line: string): ParserState {
  const name = after(line, 'Scenario:');
  return withCase({ ...state, outline: null, pendingTags: [] }, type, name, state.pendingTags, name);
}

function withExamplesRow(state: ParserState, type: RepositoryType, line: string): ParserState {
  const { outline, examples } = state;
  if (!outline || !examples) return state;

  const row = cells(line);
  if (examples.header === null) return { ...state, examples: { ...examples, header: row } };

  const counted: Outline = { ...outline, rows: outline.rows + 1 };
  const values = Object.fromEntries(examples.header.map((column, position) => [column, row[position]]));
  const title = rowTitle(counted, examples, values);
  return withCase({ ...state, outline: counted }, type, title, [...outline.tags, ...examples.tags], outline.name, title);
}

function readLine(state: ParserState, rawLine: string, type: RepositoryType): ParserState {
  const line = rawLine.trim();
  if (line === '' || line.startsWith('#')) return state;
  if (line.startsWith('@')) return { ...state, pendingTags: [...state.pendingTags, ...line.split(/\s+/)] };
  if (line.startsWith('Feature:')) return { ...state, feature: after(line, 'Feature:'), featureTags: state.pendingTags, pendingTags: [] };
  if (line.startsWith('Scenario Outline:')) {
    return { ...state, outline: { name: after(line, 'Scenario Outline:'), tags: state.pendingTags, rows: 0 }, examples: null, pendingTags: [] };
  }
  if (line.startsWith('Scenario:')) return withScenario(state, type, line);
  if (line.startsWith('Examples:') && state.outline) {
    return { ...state, examples: { name: after(line, 'Examples:'), tags: state.pendingTags, header: null }, pendingTags: [] };
  }
  if (line.startsWith('|')) return withExamplesRow(state, type, line);
  return state;
}

export function runnerCases(featureText: string, type: RepositoryType): RunnerCase[] {
  const final = featureText.split('\n').reduce((state, line) => readLine(state, line, type), INITIAL_STATE);
  return [...final.cases];
}
