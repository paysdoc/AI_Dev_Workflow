import { ADW_SIGNATURE } from '../core/workflowCommentParsing';
import { FixLoopStall } from '../core/staticCheckFixLoop';

export enum ParkReason {
  BaselineRed = 'baseline_red',
  PreExistingRegression = 'pre_existing_regression',
  FixLoopStalled = 'fix_loop_stalled',
  MissingApplicationType = 'missing_application_type',
  BaseServerDown = 'base_server_down',
}

export interface ParkedCheck {
  readonly check: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly output: string;
}

export type ParkEvidence =
  | { readonly reason: ParkReason.BaselineRed; readonly baseBranch: string; readonly failedChecks: readonly ParkedCheck[] }
  | { readonly reason: ParkReason.PreExistingRegression; readonly baseBranch: string; readonly scenario: string }
  | {
      readonly reason: ParkReason.FixLoopStalled;
      readonly failedChecks: readonly ParkedCheck[];
      readonly stall: FixLoopStall;
      readonly rounds: number;
      /** One line per reason the fix-round guard gave; empty unless the guard rejected the round. */
      readonly rejections: readonly string[];
    }
  | { readonly reason: ParkReason.MissingApplicationType; readonly found: string | null }
  | { readonly reason: ParkReason.BaseServerDown; readonly baseBranch: string; readonly output: string };

export interface ParkDirectives {
  readonly retry: string;
  readonly continue: string;
}

/** Per quoted output, so that a comment with several failing checks stays far below the forge's comment size limit. */
export const MAX_PARK_OUTPUT_CHARS = 2_000;

const QUOTE_INDENT = '    ';
const NO_OUTPUT = '(no output)';
const CUT_MARKER = `… output cut after ${MAX_PARK_OUTPUT_CHARS} characters; the full output is in the run’s execution log`;

const TITLES: Readonly<Record<ParkReason, string>> = {
  [ParkReason.BaselineRed]: 'Static Checks Fail on the Base Branch',
  [ParkReason.PreExistingRegression]: 'A Regression Scenario Also Fails on the Base Branch',
  [ParkReason.FixLoopStalled]: 'Static-Check Fix Loop Made No Progress',
  [ParkReason.MissingApplicationType]: 'Application Type Unknown',
  [ParkReason.BaseServerDown]: 'Dev Server Does Not Start on the Base Branch',
};

const BASELINE_DIRECTIVES: ParkDirectives = {
  retry: 're-runs the baseline and parks the issue again if it is still red',
  continue: 'waives the baseline, so that this run fixes the pre-existing failures too',
};

/** Each directive's meaning is the one its decision record gives for the park; neither is a new directive. */
export function parkDirectives(evidence: ParkEvidence): ParkDirectives {
  switch (evidence.reason) {
    case ParkReason.BaselineRed:
    case ParkReason.BaseServerDown:
      return BASELINE_DIRECTIVES;
    case ParkReason.PreExistingRegression:
      return {
        retry: 're-runs the scenario on the base branch and parks the issue again if it still fails there',
        continue: 'waives the scenario, which lets this run fix the pre-existing failure too',
      };
    case ParkReason.FixLoopStalled:
      return {
        retry: 're-runs the static checks and continues the static-check fix loop, parking again on no progress',
        continue: 'waives nothing for this park: use `## Retry` to continue the fix loop',
      };
    case ParkReason.MissingApplicationType:
      return {
        retry: 're-reads `## Application Type` after `adw_init` has been re-run',
        continue: 'waives nothing, because ADW never assumes an application type',
      };
    default: {
      const unhandled: never = evidence;
      throw new Error(`Unhandled park reason: ${JSON.stringify(unhandled)}`);
    }
  }
}

function onOneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** The fence is one backtick longer than the longest run inside the text, so that no text can end the span early. */
function inlineCode(text: string): string {
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
function quote(output: string): string {
  return excerptOf(output)
    .split('\n')
    .map(line => `${QUOTE_INDENT}${line}`.trimEnd())
    .join('\n');
}

function describeCheck({ check, command, exitCode, output }: ParkedCheck): string {
  return `${inlineCode(check)} — ${inlineCode(command)} (exit ${exitCode ?? 'none'})\n\n${quote(output)}`;
}

function describeChecks(checks: readonly ParkedCheck[]): string {
  return checks.map(describeCheck).join('\n\n');
}

function describeStall(evidence: Extract<ParkEvidence, { reason: ParkReason.FixLoopStalled }>): string {
  const { stall, rounds, rejections } = evidence;
  if (stall === FixLoopStall.IdenticalOutput) {
    const count = `${rounds} fix round${rounds === 1 ? '' : 's'}`;
    return `The static-check fix loop stopped after ${count}: the checks produced the same output as the round before, so the last round made no progress.`;
  }
  const rejected =
    `The static-check fix loop stopped at fix round ${rounds}. The fix-round guard rejected the change that fix round ${rounds} made, ` +
    'and the change was reverted; a rejected round counts as no progress. The guard found:';
  return [rejected, rejections.map(line => `- ${onOneLine(line)}`).join('\n')].join('\n\n');
}

function describeFailure(evidence: ParkEvidence): string {
  switch (evidence.reason) {
    case ParkReason.BaselineRed:
      return ['The static checks were run on the base branch before any work started, and these failed:', describeChecks(evidence.failedChecks)].join('\n\n');
    case ParkReason.PreExistingRegression:
      return `The regression scenario ${inlineCode(evidence.scenario)} failed on this issue’s change.`;
    case ParkReason.FixLoopStalled:
      return [describeStall(evidence), 'Still failing:', describeChecks(evidence.failedChecks)].join('\n\n');
    case ParkReason.MissingApplicationType:
      return describeMissingApplicationType(evidence.found);
    case ParkReason.BaseServerDown:
      return ['The dev server did not start. Its output:', quote(evidence.output)].join('\n\n');
    default: {
      const unhandled: never = evidence;
      throw new Error(`Unhandled park reason: ${JSON.stringify(unhandled)}`);
    }
  }
}

function describeMissingApplicationType(found: string | null): string {
  const seen = found === null ? 'is missing' : `says ${inlineCode(found)}, which ADW does not know`;
  return (
    `ADW does not know this repository’s application type: \`## Application Type\` in \`.adw/project.md\` ${seen}. ` +
    'ADW assumes no type, because the evidence a review needs depends on it. Re-run `adw_init` to detect and write the type.'
  );
}

function baseBranchNote(evidence: ParkEvidence): string | null {
  switch (evidence.reason) {
    case ParkReason.BaselineRed:
    case ParkReason.PreExistingRegression:
    case ParkReason.BaseServerDown:
      return `This fails on the base branch ${inlineCode(evidence.baseBranch)}, so this issue did not cause it.`;
    default:
      return null;
  }
}

function describeParking(evidence: ParkEvidence): string {
  const parked = 'The workflow is parked as `human_gated`.';
  const checkBased = evidence.reason === ParkReason.BaselineRed || evidence.reason === ParkReason.FixLoopStalled;
  return checkBased ? `${parked} The full output of each check is in the run’s execution log.` : parked;
}

/**
 * The heading is deliberately absent from the lifecycle stage map, so recovery never reads a park as a stage.
 * The ADW ID line comes first: a reader takes the first ID in a comment, and nothing quoted below may displace it.
 */
export function buildParkComment(adwId: string, evidence: ParkEvidence): string {
  const directives = parkDirectives(evidence);
  const sections = [
    `## :raised_hand: ADW Parked — ${TITLES[evidence.reason]}`,
    `**ADW ID:** \`${adwId}\``,
    describeFailure(evidence),
    baseBranchNote(evidence),
    describeParking(evidence),
    [`- \`## Retry\` — ${directives.retry}.`, `- \`## Continue\` — ${directives.continue}.`].join('\n'),
  ];
  return sections.filter((section): section is string => section !== null).join('\n\n') + ADW_SIGNATURE;
}
