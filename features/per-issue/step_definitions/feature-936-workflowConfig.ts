/**
 * Reads the parts of the deploy workflow that decide which Workers a push deploys: the push
 * trigger, the inputs of the `dorny/paths-filter` step and its filters. The workflow file is
 * block-style YAML, and only the shapes it uses are understood; anything else throws, so an
 * unexpected edit fails loudly instead of being misread.
 */

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '' || line.trim().startsWith('#');

function unquote(scalar: string): string {
  const quoted = /^'(.*)'$|^"(.*)"$/.exec(scalar.trim());
  return quoted ? (quoted[1] ?? quoted[2] ?? '') : scalar.trim();
}

function nestedLines(lines: readonly string[], keyIndex: number): string[] {
  const keyIndent = indentOf(lines[keyIndex]);
  const nested: string[] = [];
  for (const line of lines.slice(keyIndex + 1)) {
    if (!isBlank(line) && indentOf(line) <= keyIndent) break;
    nested.push(line);
  }
  return nested;
}

interface Entry {
  readonly key: string;
  readonly value: string;
  readonly nested: string[];
}

function entriesOf(lines: readonly string[]): Entry[] {
  const childIndent = indentOf(lines.find(line => !isBlank(line)) ?? '');
  return lines.flatMap((line, index): Entry[] => {
    if (isBlank(line) || indentOf(line) !== childIndent) return [];
    const entry = /^\s*([\w.-]+):(?:\s+(.*))?$/.exec(line);
    if (!entry) throw new Error(`Unsupported workflow syntax: ${line.trim()}`);
    return [{ key: entry[1], value: (entry[2] ?? '').trim(), nested: nestedLines(lines, index) }];
  });
}

function sequenceItems(lines: readonly string[]): string[] {
  return lines.filter(line => !isBlank(line)).map(line => {
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (!item) throw new Error(`Unsupported workflow syntax in a list: ${line.trim()}`);
    return unquote(item[1]);
  });
}

function blockScalar(lines: readonly string[]): string {
  const indent = Math.min(...lines.filter(line => !isBlank(line)).map(indentOf));
  return lines.map(line => line.slice(indent)).join('\n');
}

export interface PushTrigger {
  readonly branches: readonly string[];
  readonly paths: readonly string[] | undefined;
}

export function readPushTrigger(workflow: string): PushTrigger {
  const lines = workflow.split('\n');
  const onIndex = lines.findIndex(line => /^on:\s*$/.test(line));
  if (onIndex === -1) throw new Error('Unsupported workflow syntax: no block-style "on:" trigger');

  const push = entriesOf(nestedLines(lines, onIndex)).find(entry => entry.key === 'push');
  if (!push) throw new Error('The workflow has no push trigger');

  const keys = entriesOf(push.nested);
  const unsupported = keys.find(entry => !['branches', 'paths'].includes(entry.key));
  if (unsupported) throw new Error(`Unsupported push trigger key: ${unsupported.key}`);

  const listOf = (key: string): string[] | undefined => {
    const entry = keys.find(candidate => candidate.key === key);
    return entry && sequenceItems(entry.nested);
  };
  return { branches: listOf('branches') ?? [], paths: listOf('paths') };
}

function stepStartIndex(lines: readonly string[], usesIndex: number, stepColumn: number): number {
  for (let index = usesIndex; index >= 0; index--) {
    if (indentOf(lines[index]) === stepColumn - 2 && lines[index].trimStart().startsWith('- ')) return index;
  }
  throw new Error('Unsupported workflow syntax: a step does not start with "- "');
}

/** The `with:` inputs of the step that uses `action`, block scalars included. */
export function readStepInputs(workflow: string, action: string): Record<string, string> {
  const lines = workflow.split('\n');
  const usesIndex = lines.findIndex(line => line.includes(`uses: ${action}`));
  if (usesIndex === -1) throw new Error(`The workflow has no step that uses ${action}`);

  const stepColumn = lines[usesIndex].indexOf('uses:');
  const start = stepStartIndex(lines, usesIndex, stepColumn);
  const end = lines.findIndex((line, index) => index > usesIndex && !isBlank(line) && indentOf(line) < stepColumn);
  const stepLines = lines
    .slice(start, end === -1 ? lines.length : end)
    .map((line, index) => (index === 0 ? line.replace(/^(\s*)-\s/, '$1  ') : line));

  const withEntry = entriesOf(stepLines).find(entry => entry.key === 'with');
  if (!withEntry) return {};
  return Object.fromEntries(
    entriesOf(withEntry.nested).map(input => [input.key, input.value === '|' ? blockScalar(input.nested) : unquote(input.value)]),
  );
}

/** The `filters` input: filter names, each with a list of glob patterns. */
export function readFilters(filters: string): Record<string, string[]> {
  return Object.fromEntries(entriesOf(filters.split('\n')).map(entry => [entry.key, sequenceItems(entry.nested)]));
}

export function evaluateExpressions(value: string, context: Readonly<Record<string, string>>): string {
  return value.replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => {
    const resolved = context[name];
    if (resolved === undefined) throw new Error(`Unsupported workflow expression: ${name}`);
    return resolved;
  });
}

const WILDCARDS = new Map([
  ['**/', '(?:.*/)?'],
  ['**', '.*'],
  ['*', '[^/]*'],
]);

/** The subset of picomatch (with `dot: true`) that the workflow's patterns use: literals, `*` and `**`. */
export function globMatches(pattern: string, file: string): boolean {
  if (/[{}()[\]!+@?]/.test(pattern.replace(/\*+/g, ''))) throw new Error(`Unsupported glob syntax: ${pattern}`);
  const source = pattern
    .split(/(\*\*\/|\*\*|\*)/)
    .map(token => WILDCARDS.get(token) ?? token.replace(/[.^$|\\]/g, '\\$&'))
    .join('');
  return new RegExp(`^${source}$`).test(file);
}
