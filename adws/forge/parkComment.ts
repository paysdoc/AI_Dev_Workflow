// A type-only import: `core/applicationType.ts` imports this module at runtime, and the device lifecycle imports that one.
import type { DeviceFailure } from '../core/deviceLifecycle';
import { ADW_SIGNATURE } from '../core/workflowCommentParsing';
import { FixLoopStall } from '../core/staticCheckFixLoop';
import type { WorkflowStage } from '../types/workflowTypes';
import { inlineCode, onOneLine, quote } from './parkCommentFormat';
import { describePostMergeRed, POST_MERGE_RED_REMEDY, type PostMergeRedFacts } from './postMergeRedComment';

export { MAX_PARK_OUTPUT_CHARS } from './parkCommentFormat';

export enum ParkReason {
  BaselineRed = 'baseline_red',
  PreExistingRegression = 'pre_existing_regression',
  FixLoopStalled = 'fix_loop_stalled',
  MissingApplicationType = 'missing_application_type',
  BaseServerDown = 'base_server_down',
  DeviceBootFailed = 'device_boot_failed',
  WorktreeLost = 'worktree_lost',
  PostMergeBddRed = 'post_merge_bdd_red',
}

/** The phases that read the plan by path, and so the ones that can find it gone. */
export type PlanReadingPhase = 'plan' | 'plan validation' | 'build';

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
  | { readonly reason: ParkReason.BaseServerDown; readonly baseBranch: string; readonly output: string }
  | { readonly reason: ParkReason.DeviceBootFailed; readonly failure: DeviceFailure }
  | { readonly reason: ParkReason.WorktreeLost; readonly phase: PlanReadingPhase; readonly worktreePath: string; readonly planPath: string }
  | ({ readonly reason: ParkReason.PostMergeBddRed } & PostMergeRedFacts);

export interface ParkDirectives {
  readonly retry: string;
  readonly continue: string;
}

export type ParkStage = Extract<WorkflowStage, 'human_gated' | 'worktree_lost'>;

// Only a lost plan has a stage of its own: the state, and so the cron, shows that the plan is gone without reading the park reason.
const STAGES: Readonly<Record<ParkReason, ParkStage>> = {
  [ParkReason.BaselineRed]: 'human_gated',
  [ParkReason.PreExistingRegression]: 'human_gated',
  [ParkReason.FixLoopStalled]: 'human_gated',
  [ParkReason.MissingApplicationType]: 'human_gated',
  [ParkReason.BaseServerDown]: 'human_gated',
  [ParkReason.DeviceBootFailed]: 'human_gated',
  [ParkReason.WorktreeLost]: 'worktree_lost',
  [ParkReason.PostMergeBddRed]: 'human_gated',
};

export function parkStage(reason: ParkReason): ParkStage {
  return STAGES[reason];
}

const TITLES: Readonly<Record<ParkReason, string>> = {
  [ParkReason.BaselineRed]: 'Static Checks Fail on the Base Branch',
  [ParkReason.PreExistingRegression]: 'A Regression Scenario Also Fails on the Base Branch',
  [ParkReason.FixLoopStalled]: 'Static-Check Fix Loop Made No Progress',
  [ParkReason.MissingApplicationType]: 'Application Type Unknown',
  [ParkReason.BaseServerDown]: 'Dev Server Does Not Start on the Base Branch',
  [ParkReason.DeviceBootFailed]: 'A Device Did Not Boot',
  [ParkReason.WorktreeLost]: 'The Plan Was Lost with the Worktree',
  [ParkReason.PostMergeBddRed]: 'Scenarios Fail on the Branch Merged with the Base Branch',
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
    case ParkReason.DeviceBootFailed:
      return {
        retry: 're-runs the scenario phase, which creates and boots the devices again, and parks the issue again if a device still does not boot',
        continue: 'waives nothing, because no scenario can run without the devices: fix the host, then use `## Retry`',
      };
    case ParkReason.WorktreeLost:
      return {
        retry: 're-runs the workflow under the same ADW ID and parks the issue again if the plan is still not in the worktree, because ADW never re-runs the planner on its own',
        continue:
          'waives nothing, because no phase after the plan can run without it: to start the issue over with a new plan, use `## Cancel`, which clears the workflow and re-queues the issue',
      };
    case ParkReason.PostMergeBddRed: {
      const base = inlineCode(evidence.baseBranch);
      return {
        retry:
          'resumes the workflow under the same ADW ID: the scenarios run again on the branch as it is then, the scenario fix loop attempts fixes, ' +
          `the review and the documentation run again, and the merge re-runs the scenarios if ${base} has moved on again`,
        continue: `waives nothing for this park: the failure is this branch combined with ${base}, which only a fix clears, so use \`## Retry\``,
      };
    }
    default: {
      const unhandled: never = evidence;
      throw new Error(`Unhandled park reason: ${JSON.stringify(unhandled)}`);
    }
  }
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

function describeDeviceFailure(failure: DeviceFailure): string {
  const platform = inlineCode(failure.platform);
  switch (failure.kind) {
    case 'boot_failed':
      return [
        `The ${platform} device did not boot in ${failure.attempts} attempts. ADW removed what each attempt had created, and no scenario ran. ` +
          'The problem is the host’s, not this issue’s change, so it does not go to the fix agent. The output of the attempts:',
        quote(failure.output),
      ].join('\n\n');
    case 'tool_missing':
      return [
        `The host tool ${inlineCode(failure.tool)} is not on the host’s \`PATH\`, so the ${platform} device could not be created, and ADW did not retry. ` +
          'Install it on the host that runs ADW, and put it on the `PATH`. Its output:',
        quote(failure.output),
      ].join('\n\n');
    default: {
      const unhandled: never = failure;
      throw new Error(`Unhandled device failure: ${JSON.stringify(unhandled)}`);
    }
  }
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
    case ParkReason.DeviceBootFailed:
      return describeDeviceFailure(evidence.failure);
    case ParkReason.WorktreeLost:
      return describeLostPlan(evidence);
    case ParkReason.PostMergeBddRed:
      return describePostMergeRed(evidence);
    default: {
      const unhandled: never = evidence;
      throw new Error(`Unhandled park reason: ${JSON.stringify(unhandled)}`);
    }
  }
}

function describeLostPlan({ phase, planPath, worktreePath }: Extract<ParkEvidence, { reason: ParkReason.WorktreeLost }>): string {
  return (
    `The ${inlineCode(phase)} phase of this resumed run found no plan at ${inlineCode(planPath)} in the worktree ${inlineCode(worktreePath)}. ` +
    'An earlier run of this workflow wrote the plan there, but a plan is never committed: it lived only in that run’s worktree, which was removed, ' +
    'and the worktree rebuilt for this run has none. ADW does not run the planner again on its own, ' +
    'because a second plan would be written against a branch that may already hold part of the build.'
  );
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
    case ParkReason.PostMergeBddRed:
      return `The branch passed on its own and fails combined with ${inlineCode(evidence.baseBranch)}.`;
    default:
      return null;
  }
}

function describeParking(evidence: ParkEvidence): string {
  const parked = `The workflow is parked as \`${parkStage(evidence.reason)}\`.`;
  if (evidence.reason === ParkReason.PostMergeBddRed) {
    return `${parked} The full output of the scenario run is in the merge run’s \`merge.log\`. ${POST_MERGE_RED_REMEDY}`;
  }
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
