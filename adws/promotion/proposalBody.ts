/**
 * Pure. Builds issue bodies in the proposal format and reads their candidate checkboxes back. A candidate is keyed by issue
 * number and scenario name through a marker on its own checkbox line, so edits anywhere else, including to that line's
 * visible text, do not change what is read. The Promotion Proposal uses the format with a tick meaning "promote", the
 * Regression Suite audit with a tick meaning "keep".
 */

import { ADW_NONE_LABEL, ADW_PROMOTION_PROPOSAL_LABEL } from '../core/adwLabels.ts';
import { codeSpan } from '../core/unusedStepIssueBody.ts';
import type { NominationKey } from './nominationCollector.ts';

export const PROPOSAL_CANDIDATE_MARKER = 'adw-candidate';
export const PROMOTION_PROPOSAL_EXPIRY_DAYS = 30;
export const MAX_ANALYSIS_TEXT_LENGTH = 1200;
export const MAX_LISTED_OVERLAPS = 5;
export const MAX_OVERLAP_TEXT_LENGTH = 200;

export interface CandidateAnalysis extends NominationKey {
  readonly qualification: string;
  readonly fit: string;
  readonly overlaps: readonly string[];
}

export interface PromotionCandidate extends CandidateAnalysis {
  readonly featurePath: string;
}

export interface ProposalSection {
  readonly heading: string;
  readonly text: string;
}

export interface ProposalEntry extends NominationKey {
  readonly ticked: boolean;
  readonly featurePath: string;
  readonly sections: readonly ProposalSection[];
}

export interface ProposalDocument {
  readonly heading: string;
  readonly intro: readonly string[];
  readonly checklistHeading: string;
  readonly entries: readonly ProposalEntry[];
}

export interface ProposalCandidateReading extends NominationKey {
  readonly ticked: boolean;
}

export interface ProposalIssueSpec {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

const ELLIPSIS = '…';
const UNNAMED_SCENARIO = '(unnamed scenario)';
const NO_OVERLAP = 'None found.';
const LINE_BREAK = /\r\n|\r|\n/;
const CANDIDATE_LINE = /^\s*[-*+]\s+\[([ xX])\]\s/;
// The name is percent-encoded, so it never holds a space, `<` or `>`, and the space before `-->` ends it unambiguously.
const CANDIDATE_MARKER = new RegExp(`<!--\\s*${PROPOSAL_CANDIDATE_MARKER}:(\\d+):([A-Za-z0-9\\-_.!~*'()%]*)\\s*-->`, 'g');
/** A line GitHub would render with a task-list box: a list item, possibly quoted or nested, opening with `[ ]`, `[x]` or `[X]`. */
const TASK_LIST_BOX = /^(\s*(?:>\s*)*(?:(?:[-*+]|\d{1,9}[.)])\s+)+)\[(?=[ xX]\])/;
const LEADING_HASH = /^(\s*)#/;

const PROMOTION_INTRO: readonly string[] = [
  'ADW gathered the Nominations of merged issues that no earlier Promotion Proposal listed. Each candidate is one Per-Issue Scenario that the scenario agent nominated for the Regression Suite. Below the checklist, the analysis of each candidate says why it qualifies and how it fits the Regression Suite as it stands, including overlap with the scenarios already there.',
  `**To decide:** tick each candidate you want promoted, then close this issue as completed. The candidates ticked when you close it are approved. Closing it as not planned, or as completed with nothing ticked, declines every candidate, and so does leaving it open for ${PROMOTION_PROPOSAL_EXPIRY_DAYS} days. While it is open, the Per-Issue Sweep keeps these scenarios.`,
];

function shownName(scenarioName: string): string {
  return scenarioName === '' ? UNNAMED_SCENARIO : codeSpan(scenarioName);
}

export function candidateMarker({ issueNumber, scenarioName }: NominationKey): string {
  return `<!-- ${PROPOSAL_CANDIDATE_MARKER}:${issueNumber}:${encodeURIComponent(scenarioName)} -->`;
}

function neutralisedLine(line: string): string {
  return line.replace(TASK_LIST_BOX, '$1\\[').replace(LEADING_HASH, '$1\\#');
}

/** Text an agent wrote can neither forge a candidate, hide a comment, add a checkbox nor open a heading of the body. */
function sanitised(text: string): string {
  const withoutComments = text.replace(/\r\n?/g, '\n').trim().replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
  return withoutComments.split('\n').map(neutralisedLine).join('\n');
}

function truncated(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - ELLIPSIS.length)}${ELLIPSIS}`;
}

function checklistLine(entry: ProposalEntry): string {
  const box = entry.ticked ? '[x]' : '[ ]';
  return `- ${box} #${entry.issueNumber} · ${shownName(entry.scenarioName)} ${candidateMarker(entry)}`;
}

function sectionLines({ heading, text }: ProposalSection): string[] {
  return ['', `**${heading}**`, '', sanitised(text)];
}

function entryBlock(entry: ProposalEntry): string[] {
  return ['', `### #${entry.issueNumber} · ${shownName(entry.scenarioName)}`, '', `In ${codeSpan(entry.featurePath)}`, ...entry.sections.flatMap(sectionLines)];
}

/** One checkbox per entry, then one block per entry with its sections, whose text is sanitised. */
export function buildProposalBody(document: ProposalDocument): string {
  return [
    document.heading,
    '',
    ...document.intro.flatMap((paragraph) => [paragraph, '']),
    document.checklistHeading,
    '',
    ...document.entries.map(checklistLine),
    ...document.entries.flatMap(entryBlock),
  ].join('\n');
}

function decodedName(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/** The reading of a candidate line, keyed by the last marker on it; null for any other line or a malformed marker. */
function readingOf(line: string): ProposalCandidateReading | null {
  const box = CANDIDATE_LINE.exec(line);
  const markers = box ? [...line.matchAll(CANDIDATE_MARKER)] : [];
  const marker = markers[markers.length - 1];
  if (!box || !marker) return null;

  const issueNumber = Number(marker[1]);
  const scenarioName = decodedName(marker[2]);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || scenarioName === null) return null;
  return { issueNumber, scenarioName, ticked: box[1] !== ' ' };
}

export function isSameCandidate(a: NominationKey, b: NominationKey): boolean {
  return a.issueNumber === b.issueNumber && a.scenarioName === b.scenarioName;
}

function mergedReading(readings: readonly ProposalCandidateReading[], reading: ProposalCandidateReading): readonly ProposalCandidateReading[] {
  const at = readings.findIndex((known) => isSameCandidate(known, reading));
  if (at === -1) return [...readings, reading];
  return readings.map((known, index) => (index === at ? { ...known, ticked: known.ticked || reading.ticked } : known));
}

function isReading(reading: ProposalCandidateReading | null): reading is ProposalCandidateReading {
  return reading !== null;
}

/** Every candidate checkbox of the body in body order, each once, ticked when any of its lines is. Never throws. */
export function readProposalCandidates(body: string): readonly ProposalCandidateReading[] {
  return body.split(LINE_BREAK).map(readingOf).filter(isReading).reduce(mergedReading, []);
}

export function tickedCandidates(body: string): readonly NominationKey[] {
  return readProposalCandidates(body)
    .filter((reading) => reading.ticked)
    .map(({ issueNumber, scenarioName }) => ({ issueNumber, scenarioName }));
}

function overlapLine(overlap: string): string {
  return `- ${truncated(overlap, MAX_OVERLAP_TEXT_LENGTH)}`;
}

function overlapText(overlaps: readonly string[]): string {
  const singleLined = overlaps.map((overlap) => overlap.replace(/\s+/g, ' ').trim()).filter((overlap) => overlap !== '');
  if (singleLined.length === 0) return NO_OVERLAP;
  const listed = singleLined.slice(0, MAX_LISTED_OVERLAPS).map(overlapLine);
  const rest = singleLined.length - listed.length;
  return [...listed, ...(rest > 0 ? [`- ${ELLIPSIS} and ${rest} more.`] : [])].join('\n');
}

function promotionEntry(candidate: PromotionCandidate): ProposalEntry {
  const { issueNumber, scenarioName, featurePath } = candidate;
  const sections: readonly ProposalSection[] = [
    { heading: 'Why it qualifies', text: truncated(candidate.qualification, MAX_ANALYSIS_TEXT_LENGTH) },
    { heading: 'How it fits the Regression Suite', text: truncated(candidate.fit, MAX_ANALYSIS_TEXT_LENGTH) },
    { heading: 'Overlap with the Regression Suite', text: overlapText(candidate.overlaps) },
  ];
  return { issueNumber, scenarioName, featurePath, ticked: false, sections };
}

/** The Promotion Proposal for `candidates`, dated by the UTC day of `date`, unticked, labelled `adw:none` first. */
export function buildPromotionProposal(candidates: readonly PromotionCandidate[], date: Date): ProposalIssueSpec {
  const body = buildProposalBody({
    heading: '## Promotion Proposal',
    intro: PROMOTION_INTRO,
    checklistHeading: '### Candidates',
    entries: candidates.map(promotionEntry),
  });
  const count = `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`;
  return {
    title: `Promotion Proposal ${date.toISOString().slice(0, 10)}: ${count}`,
    body,
    labels: [ADW_NONE_LABEL, ADW_PROMOTION_PROPOSAL_LABEL],
  };
}
