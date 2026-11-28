/**
 * Pure. The chore issue the Per-Issue Sweep files for the step definitions no feature file uses, and the marker by which a
 * later sweep finds it still open and files no other. Its `adw:chore` label routes it to the chore pipeline, which removes
 * what it lists.
 */

import type { ADW_CLASSIFICATION_LABELS } from './adwLabels';
import type { UnusedStepDefinition } from './unusedStepReport';

export const UNUSED_STEP_ISSUE_MARKER = 'Reconciles: unused-step-definitions';
/** Narrows the forge's open issues to those that may carry the marker; only the marker line itself decides. */
export const UNUSED_STEP_ISSUE_SEARCH = '"unused-step-definitions"';
/** Keeps the body far below the forge's size limit and each removal reviewable; a later sweep lists the rest. */
export const MAX_LISTED_UNUSED_DEFINITIONS = 100;
export const MAX_LISTED_PATTERN_LENGTH = 160;

export type AdwClassificationLabel = keyof typeof ADW_CLASSIFICATION_LABELS;

export interface BuildUnusedStepIssueInput {
  readonly definitions: readonly UnusedStepDefinition[];
  readonly framework: string;
  /** Null when the code host could not report it: the body then names no branch rather than guess one. */
  readonly defaultBranch: string | null;
}

export interface UnusedStepIssueSpec {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly AdwClassificationLabel[];
}

export interface UnusedStepIssueRef {
  readonly number: number;
  readonly body: string;
  /** 'OPEN' or 'CLOSED', compared without case; absent ⇒ open. */
  readonly state?: string;
}

const CHORE_LABEL: AdwClassificationLabel = 'adw:chore';
const MARKER_LINE = /^\s*Reconciles:\s*unused-step-definitions\s*$/m;
const ELLIPSIS = '…';

const INSTRUCTIONS: readonly string[] = [
  '## What to do',
  '',
  '- Remove each step definition listed above.',
  '- Remove the helpers, fixtures and imports that only those definitions used, and delete a file that is left empty.',
  '- Leave every other step definition and every `.feature` file as it is. Keep a listed definition that a feature file uses by the time this issue is worked.',
  "- The repository's static checks and scenarios must still pass.",
];

/** Delimited by one backtick more than the longest run inside the text, so a pattern holding backticks stays one span. */
export function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padding = longestRun > 0 ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

function shownPattern(pattern: string): string {
  if (pattern.length <= MAX_LISTED_PATTERN_LENGTH) return pattern;
  return `${pattern.slice(0, MAX_LISTED_PATTERN_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}

function definitionLine({ file, line, pattern }: UnusedStepDefinition): string {
  return `- ${codeSpan(`${file}:${line}`)} — ${codeSpan(shownPattern(pattern))}`;
}

function remainderLines(remaining: number): string[] {
  return remaining > 0 ? [`- … and ${remaining} more, which a later sweep will list once this issue is closed.`] : [];
}

export function buildUnusedStepIssue({ definitions, framework, defaultBranch }: BuildUnusedStepIssueInput): UnusedStepIssueSpec {
  const listed = definitions.slice(0, MAX_LISTED_UNUSED_DEFINITIONS);
  const touchedFiles = [...new Set(listed.map((definition) => definition.file))];
  const where = defaultBranch === null ? '' : ` on ${codeSpan(defaultBranch)}`;

  const body = [
    UNUSED_STEP_ISSUE_MARKER,
    '',
    `The Per-Issue Sweep's ${framework} dry run${where} found ${definitions.length} step definition(s) that no feature file uses.`,
    '',
    '## Unused step definitions',
    '',
    ...listed.map(definitionLine),
    ...remainderLines(definitions.length - listed.length),
    '',
    ...INSTRUCTIONS,
    '',
    '## Touched Files',
    '',
    ...touchedFiles.map((file) => `- ${codeSpan(file)}`),
  ].join('\n');

  return { title: `chore: remove ${listed.length} unused step definition(s)`, body, labels: [CHORE_LABEL] };
}

function isOpen(issue: UnusedStepIssueRef): boolean {
  return issue.state === undefined || issue.state.toUpperCase() === 'OPEN';
}

/** The lowest-numbered open issue whose body carries the marker on a line of its own, or null when none does. */
export function findOpenUnusedStepIssue(issues: readonly UnusedStepIssueRef[]): UnusedStepIssueRef | null {
  const open = issues.filter((issue) => isOpen(issue) && MARKER_LINE.test(issue.body));
  if (open.length === 0) return null;
  return open.reduce((lowest, issue) => (issue.number < lowest.number ? issue : lowest));
}
