/**
 * What the feature-1104 steps read out of the text of a planning command: its `## Behavioural Equivalence` section, and the lines
 * a section of its `Plan Format` has, which the command shows in a fence. No hooks and no steps: any step file may import it.
 */

export const BEHAVIOURAL_EQUIVALENCE = '## Behavioural Equivalence';

const PLAN_FORMAT = '## Plan Format';
const FENCE = '```';

/** From the first line equal to the heading up to the next line that starts a `## ` section, or the end of the lines. */
function sectionOf(lines: readonly string[], heading: string): string[] | undefined {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The lines inside the fence that holds the Plan Format; none when the command has no such fence. */
function planFormatLines(lines: readonly string[]): string[] {
  const heading = lines.findIndex((line) => line.trim() === PLAN_FORMAT);
  const open = heading === -1 ? -1 : lines.findIndex((line, index) => index > heading && line.startsWith(FENCE));
  if (open === -1) return [];
  const close = lines.findIndex((line, index) => index > open && line.trim() === FENCE);
  return lines.slice(open + 1, close === -1 ? undefined : close);
}

export function behaviouralEquivalenceSection(commandText: string): string | undefined {
  return sectionOf(commandText.split('\n'), BEHAVIOURAL_EQUIVALENCE)?.join('\n');
}

/** The lines the Plan Format gives the plan section `heading`, heading included; absent when the Plan Format has no such section. */
export function planFormatSection(commandText: string, heading: string): string[] | undefined {
  return sectionOf(planFormatLines(commandText.split('\n')), heading);
}

/** A line of the Plan Format that stands for what the planner writes: a `<...>` placeholder. */
export function isPlaceholder(line: string): boolean {
  return line.startsWith('<') && line.endsWith('>');
}
