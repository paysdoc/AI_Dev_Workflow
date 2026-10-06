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
  rows: number;
}

interface Examples {
  readonly name: string;
  readonly tags: readonly string[];
  header: readonly string[] | null;
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

export function runnerCases(featureText: string, type: RepositoryType): RunnerCase[] {
  const found: RunnerCase[] = [];
  let feature = '';
  let featureTags: readonly string[] = [];
  let pendingTags: string[] = [];
  let outline: Outline | null = null;
  let examples: Examples | null = null;

  const takeTags = (): string[] => pendingTags.splice(0);
  const nameOf = (...segments: string[]): string => (type === 'web' ? [feature, ...segments].join(SEPARATOR) : segments[segments.length - 1]);
  const addCase = (scenario: string, tags: readonly string[], ...segments: string[]): void => {
    found.push({ scenario, feature, name: nameOf(...segments), tags: [...new Set([...featureTags, ...tags])] });
  };

  for (const raw of featureText.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      pendingTags = [...pendingTags, ...line.split(/\s+/)];
    } else if (line.startsWith('Feature:')) {
      feature = after(line, 'Feature:');
      featureTags = takeTags();
    } else if (line.startsWith('Scenario Outline:')) {
      outline = { name: after(line, 'Scenario Outline:'), tags: takeTags(), rows: 0 };
      examples = null;
    } else if (line.startsWith('Scenario:')) {
      const name = after(line, 'Scenario:');
      outline = null;
      addCase(name, takeTags(), name);
    } else if (line.startsWith('Examples:') && outline) {
      examples = { name: after(line, 'Examples:'), tags: takeTags(), header: null };
    } else if (line.startsWith('|') && outline && examples) {
      const row = cells(line);
      if (examples.header === null) {
        examples.header = row;
        continue;
      }
      outline.rows += 1;
      const values = Object.fromEntries(examples.header.map((column, position) => [column, row[position]]));
      const title = rowTitle(outline, examples, values);
      addCase(title, [...outline.tags, ...examples.tags], outline.name, title);
    }
  }
  return found;
}
