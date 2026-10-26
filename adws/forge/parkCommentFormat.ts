/** Per quoted output, so that a comment with several failing checks stays far below the forge's comment size limit. */
export const MAX_PARK_OUTPUT_CHARS = 2_000;

const QUOTE_INDENT = '    ';
const NO_OUTPUT = '(no output)';
const CUT_MARKER = `… output cut after ${MAX_PARK_OUTPUT_CHARS} characters; the full output is in the run’s execution log`;

export function onOneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** The fence is one backtick longer than the longest run inside the text, so that no text can end the span early. */
export function inlineCode(text: string): string {
  const flat = onOneLine(text);
  const longestRun = Math.max(0, ...(flat.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padding = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${flat}${padding}${fence}`;
}

function cutAt(text: string, limit: number): string {
  const cut = text.slice(0, limit);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

function excerptOf(output: string): string {
  const text = output.replace(/\r\n?/g, '\n').trimEnd();
  if (text === '') return NO_OUTPUT;
  return text.length <= MAX_PARK_OUTPUT_CHARS ? text : `${cutAt(text, MAX_PARK_OUTPUT_CHARS)}\n${CUT_MARKER}`;
}

/** Indented line by line, so that no quoted line can stand alone as a directive or as a heading. */
export function quote(output: string): string {
  return excerptOf(output)
    .split('\n')
    .map(line => `${QUOTE_INDENT}${line}`.trimEnd())
    .join('\n');
}
