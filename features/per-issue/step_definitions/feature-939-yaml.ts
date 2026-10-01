/**
 * Reads the block-style YAML of a workflow file into nested maps, lists and strings. It
 * understands mappings, sequences, flow sequences of scalars, plain and quoted scalars and `|`
 * block scalars, and every scalar is a string. Any other shape throws, so an unexpected edit fails
 * loudly instead of being misread.
 */

export type YamlMap = ReadonlyMap<string, YamlNode>;
export type YamlNode = string | readonly YamlNode[] | YamlMap;

interface Parsed<T> {
  readonly value: T;
  /** The index of the next line the caller has to look at. */
  readonly next: number;
}

const ENTRY = /^([\w.-]+):(?:\s+(.*))?$/;
const MAPPING_START = /^[\w.-]+:(\s|$)/;

const unsupported = (detail: string): Error => new Error(`Unsupported workflow syntax: ${detail}`);
const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '';
const isIgnorable = (line: string): boolean => isBlank(line) || line.trim().startsWith('#');
const isSequenceEntry = (line: string): boolean => /^\s*-(\s|$)/.test(line);

function nextContent(lines: readonly string[], from: number): number {
  const index = lines.findIndex((line, position) => position >= from && !isIgnorable(line));
  return index === -1 ? lines.length : index;
}

function unquoteSingle(text: string): string {
  const quoted = /^'((?:[^']|'')*)'$/.exec(text);
  if (quoted === null) throw unsupported(text);
  return quoted[1].replace(/''/g, "'");
}

function unquoteDouble(text: string): string {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) throw unsupported(text);
  try {
    return JSON.parse(text) as string;
  } catch {
    throw unsupported(text);
  }
}

function parseScalar(text: string): string {
  if (text.startsWith("'")) return unquoteSingle(text);
  if (text.startsWith('"')) return unquoteDouble(text);
  if (/^[[\]{},&*!%@`|>#]/.test(text) || /\s#/.test(text) || /:(\s|$)/.test(text)) throw unsupported(text);
  return text;
}

function parseFlowSequence(text: string): string[] {
  if (!text.endsWith(']')) throw unsupported(text);
  const body = text.slice(1, -1).trim();
  return body === '' ? [] : body.split(',').map(item => parseScalar(item.trim()));
}

function parseInline(text: string): string | readonly string[] {
  return text.startsWith('[') ? parseFlowSequence(text) : parseScalar(text);
}

/** The lines of a `|` block scalar: those more indented than the key, up to the next line that is not. */
function parseBlockScalar(lines: readonly string[], from: number, parentIndent: number, strip: boolean): Parsed<string> {
  const end = lines.findIndex((line, position) => position >= from && !isBlank(line) && indentOf(line) <= parentIndent);
  const stop = end === -1 ? lines.length : end;
  const body = lines.slice(from, stop);
  const first = body.find(line => !isBlank(line));
  if (first === undefined) return { value: '', next: stop };

  const indent = indentOf(first);
  if (body.some(line => !isBlank(line) && indentOf(line) < indent)) throw unsupported('a block scalar line indented less than its first line');
  const content = body.map(line => line.slice(indent)).join('\n').replace(/\n+$/, '');
  return { value: strip ? content : `${content}\n`, next: stop };
}

/** The value that starts on the lines after a `key:` or a bare `-`; a missing value is the empty string. */
function parseBlock(lines: readonly string[], from: number, parentIndent: number): Parsed<YamlNode> {
  const start = nextContent(lines, from);
  if (start === lines.length || indentOf(lines[start]) <= parentIndent) return { value: '', next: from };

  const indent = indentOf(lines[start]);
  return isSequenceEntry(lines[start]) ? parseSequence(lines, start, indent) : parseMapping(lines, start, indent);
}

function parseValue(lines: readonly string[], index: number, indent: number, text: string): Parsed<YamlNode> {
  if (text === '') return parseBlock(lines, index + 1, indent);
  if (/^\|-?$/.test(text)) return parseBlockScalar(lines, index + 1, indent, text === '|-');
  return { value: parseInline(text), next: index + 1 };
}

function parseEntry(lines: readonly string[], index: number, indent: number): Parsed<readonly [string, YamlNode]> {
  const match = ENTRY.exec(lines[index].trim());
  if (match === null) throw unsupported(`"${lines[index].trim()}"`);
  const { value, next } = parseValue(lines, index, indent, (match[2] ?? '').trim());
  return { value: [match[1], value], next };
}

function parseMapping(lines: readonly string[], start: number, indent: number): Parsed<YamlMap> {
  const entries = new Map<string, YamlNode>();
  let index = nextContent(lines, start);
  while (index < lines.length && indentOf(lines[index]) >= indent) {
    if (indentOf(lines[index]) > indent) throw unsupported(`unexpected indentation at "${lines[index].trim()}"`);
    const { value: [key, node], next } = parseEntry(lines, index, indent);
    if (entries.has(key)) throw unsupported(`the key "${key}" appears twice`);
    entries.set(key, node);
    index = nextContent(lines, next);
  }
  return { value: entries, next: index };
}

/** An item that opens a mapping (`- key: value`) is parsed with its dash replaced by spaces, so its keys line up with the ones below. */
function parseItem(lines: readonly string[], index: number, indent: number): Parsed<YamlNode> {
  const item = /^(\s*-\s+)(\S.*)$/.exec(lines[index]);
  if (item === null) return parseBlock(lines, index + 1, indent);

  const [, prefix, text] = item;
  if (!MAPPING_START.test(text)) return { value: parseInline(text.trim()), next: index + 1 };
  const rewritten = lines.map((line, position) => (position === index ? ' '.repeat(prefix.length) + text : line));
  return parseMapping(rewritten, index, prefix.length);
}

function parseSequence(lines: readonly string[], start: number, indent: number): Parsed<readonly YamlNode[]> {
  const items: YamlNode[] = [];
  let index = nextContent(lines, start);
  while (index < lines.length && indentOf(lines[index]) >= indent) {
    if (indentOf(lines[index]) > indent || !isSequenceEntry(lines[index])) throw unsupported(`"${lines[index].trim()}" in a list`);
    const { value, next } = parseItem(lines, index, indent);
    items.push(value);
    index = nextContent(lines, next);
  }
  return { value: items, next: index };
}

export function parseYamlMap(text: string): YamlMap {
  const lines = text.split(/\r?\n/);
  if (lines.some(line => /^ *\t/.test(line))) throw unsupported('a tab in the indentation');

  const start = nextContent(lines, 0);
  if (start === lines.length) return new Map();
  if (indentOf(lines[start]) !== 0 || isSequenceEntry(lines[start])) throw unsupported('the document is not a mapping at its root');

  return parseMapping(lines, start, 0).value;
}
