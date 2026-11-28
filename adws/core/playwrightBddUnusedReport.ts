/**
 * Pure. What playwright-bdd's `bddgen export --unused-steps` prints: `Using config: <file>`, the `Unused steps (<n>):` line,
 * then a bordered table with the columns `Pattern / Text` and `Location` and one row per definition no feature file uses.
 * A row's text is the definition's keyword and pattern, and its location is `<file>:<line>`, relative to the directory the
 * export ran in.
 */

import type { UnusedStepDefinition } from './unusedStepReport';

export type PlaywrightBddUnusedParse =
  | { readonly kind: 'parsed'; readonly rows: readonly UnusedStepDefinition[] }
  | { readonly kind: 'unreadable'; readonly detail: string };

interface ReportLine {
  readonly number: number;
  readonly text: string;
}

type RowParse = { readonly kind: 'row'; readonly row: UnusedStepDefinition } | { readonly kind: 'bad'; readonly detail: string };

const ESCAPE = '\u001b';
const COLOUR_CODE = /^\[[0-9;]*m/;
const COUNT_LINE = /^Unused steps \((\d+)\):$/;
/** The table's rules: above the header, between the rows and below the last one. */
const BORDER_LINE = /^[┌┬┐├┼┤└┴┘─\s]+$/u;
const CELL_SEPARATOR = '│';
const HEADER_CELLS = ['Pattern / Text', 'Location'];
const LOCATION = /^(.+):(\d+)$/;
/** playwright-bdd prints a definition registered without a keyword as `When`. */
const KEYWORD = /^(?:Given|When|Then) /;
const OUTPUT = 'the bddgen export output';

function unreadable(detail: string): PlaywrightBddUnusedParse {
  return { kind: 'unreadable', detail };
}

function withoutColour(text: string): string {
  return text
    .split(ESCAPE)
    .map((part, index) => (index === 0 ? part : part.replace(COLOUR_CODE, '')))
    .join('');
}

/** The non-blank lines, without surrounding space, each with its 1-based number in the output. */
function outputLines(output: string): ReportLine[] {
  return withoutColour(output)
    .split(/\r?\n/)
    .map((text, index) => ({ number: index + 1, text: text.trim() }))
    .filter((line) => line.text !== '');
}

/** The text and location cells of `│ <text> │ <location> │`; the text is everything before the last separator, so it may hold one. */
function cellsOf(text: string): readonly [string, string] | null {
  if (text.length < 2 || !text.startsWith(CELL_SEPARATOR) || !text.endsWith(CELL_SEPARATOR)) return null;
  const inner = text.slice(1, -1);
  const split = inner.lastIndexOf(CELL_SEPARATOR);
  return split === -1 ? null : [inner.slice(0, split).trim(), inner.slice(split + 1).trim()];
}

function isHeaderRow(line: ReportLine): boolean {
  const cells = cellsOf(line.text);
  return cells !== null && cells.every((cell, index) => cell === HEADER_CELLS[index]);
}

function parseRow(line: ReportLine): RowParse {
  const cells = cellsOf(line.text);
  if (cells === null) return { kind: 'bad', detail: `line ${line.number} of ${OUTPUT} is not a row of its table: "${line.text}"` };
  const [text, location] = cells;
  const at = LOCATION.exec(location);
  if (!at) return { kind: 'bad', detail: `line ${line.number} of ${OUTPUT} has no "<file>:<line>" location: "${line.text}"` };
  return { kind: 'row', row: { file: at[1], line: Number(at[2]), pattern: text.replace(KEYWORD, '') } };
}

/** The rows' files are returned as printed, relative to where the export ran. */
export function parsePlaywrightBddUnusedReport(output: string): PlaywrightBddUnusedParse {
  const lines = outputLines(output);
  if (lines.length === 0) return unreadable(`${OUTPUT} is empty: the export printed nothing to the report before it stopped`);
  const countAt = lines.findIndex((line) => COUNT_LINE.test(line.text));
  if (countAt === -1) return unreadable(`${OUTPUT} has no "Unused steps (<n>):" line; line ${lines[0].number} reads "${lines[0].text}"`);

  const countLine = lines[countAt];
  const count = Number(COUNT_LINE.exec(countLine.text)?.[1]);
  const parsed = lines
    .slice(countAt + 1)
    .filter((line) => !BORDER_LINE.test(line.text) && !isHeaderRow(line))
    .map(parseRow);
  const bad = parsed.find((row) => row.kind === 'bad');
  if (bad?.kind === 'bad') return unreadable(bad.detail);

  const rows = parsed.flatMap((row) => (row.kind === 'row' ? [row.row] : []));
  if (rows.length !== count) return unreadable(`line ${countLine.number} of ${OUTPUT} counts ${count} unused steps, but its table lists ${rows.length}`);
  return { kind: 'parsed', rows };
}
