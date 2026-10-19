/**
 * How the feature-1046 Then steps read the platform lines of a proof. The wording of the lines is written out here, from the
 * scenarios, and is not taken from the proof renderer. No hooks and no steps: any step file may import it.
 */

const COVERAGE_LINE_START = 'On some platforms only: ';
const UNATTRIBUTED_LINE = /^Left out as unattributed, because they are in no platform directory \(.*?\): (.*)$/;
const BACKTICKED = /`([^`]+)`/g;

export interface ExpectedCoverage {
  readonly scenario: string;
  /** Platforms as the line writes them, such as "android" or "android, ios". */
  readonly present: string;
  readonly missing: string;
}

export function coverageLineOf({ scenario, present, missing }: ExpectedCoverage): string {
  return `${COVERAGE_LINE_START}\`${scenario}\` (present: ${present}; missing: ${missing})`;
}

export function coverageLinesIn(document: string): string[] {
  return document.split('\n').filter(line => line.startsWith(COVERAGE_LINE_START));
}

/** The paths the proof lists as unattributed; none when it has no such line. */
export function unattributedImagesIn(document: string): string[] {
  const listed = document.split('\n').map(line => UNATTRIBUTED_LINE.exec(line)).find(match => match !== null);
  return listed ? [...listed[1].matchAll(BACKTICKED)].map(match => match[1]) : [];
}

const GENERATED_AT_LINE = /^Generated at: (.+)$/m;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** What `<generated at>` stands for: the time the proof says it was generated, which has to be a time. */
export function generatedAtIn(document: string): string {
  const generatedAt = GENERATED_AT_LINE.exec(document)?.[1];
  if (generatedAt === undefined || !ISO_TIME.test(generatedAt)) throw new Error(`Expected the proof to say when it was generated, as an ISO time.\n${document}`);
  return generatedAt;
}
