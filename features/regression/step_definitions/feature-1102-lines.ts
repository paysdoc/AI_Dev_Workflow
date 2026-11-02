/**
 * How the feature-1102 steps read the scenario proof and the BDD Proof comment. The lines are written out here, from the
 * scenarios, and are not taken from the renderers. No hooks and no steps: any step file may import it.
 */

const WARNING_LINE_START = '**Warning:** ';
const HEADING_START = '## ';

/** The lines of a tag's section of the scenario proof: from its heading up to the next heading of its level. */
export function sectionOf(document: string, tag: string): string[] {
  const lines = document.split('\n');
  const start = lines.findIndex(line => line.startsWith(`${HEADING_START}${tag} Scenarios `));
  if (start === -1) throw new Error(`Expected the scenario proof to have a section for the tag "${tag}".\n${document}`);
  const following = lines.slice(start + 1);
  const next = following.findIndex(line => line.startsWith(HEADING_START));
  return [lines[start], ...(next === -1 ? following : following.slice(0, next))];
}

export function warningsIn(section: readonly string[]): string[] {
  return section.filter(line => line.startsWith(WARNING_LINE_START)).map(line => line.slice(WARNING_LINE_START.length));
}

/** A row of the summary table of the comment, as the scenarios write it: the suite without its backticks, the status without its emoji. */
export interface SummaryRow {
  readonly suite: string;
  readonly scenarios: string;
  readonly status: string;
}

const TABLE_ROW_START = '|';
const LINES_ABOVE_THE_ROWS = 2;
const BACKTICKS = /`/g;

function cellsOf(line: string): string[] {
  return line.split('|').slice(1, -1).map(cell => cell.trim());
}

function summaryRowOf(line: string): SummaryRow {
  const [suite, scenarios, status] = cellsOf(line);
  return { suite: suite.replace(BACKTICKS, ''), scenarios, status: status.slice(status.indexOf(' ') + 1) };
}

/** The rows of the summary table, under its header and its rule, in the order the comment lists them. */
export function summaryRowsIn(comment: string): SummaryRow[] {
  return comment.split('\n').filter(line => line.startsWith(TABLE_ROW_START)).slice(LINES_ABOVE_THE_ROWS).map(summaryRowOf);
}
