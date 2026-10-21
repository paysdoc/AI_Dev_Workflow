import { Platform } from '../../core/applicationType';
import { HostTool } from '../../core/deviceCommands';
import type { DeviceFailure } from '../../core/deviceLifecycle';
import { FixLoopStall } from '../../core/staticCheckFixLoop';
import { ParkReason, type ParkEvidence, type ParkedCheck } from '../parkComment';

export const ADW_ID = 'k3x9ab-feat-park-comment';

const BOOT_ATTEMPT_OUTPUTS = [1, 2, 3].map(
  attempt => `Attempt ${attempt} of 3: The iOS simulator "adw-${ADW_ID}" could not be booted: "xcrun simctl boot UDID" failed with exit code 1: Unable to boot device\nUnable to boot device`,
);

export const LINT: ParkedCheck = { check: 'lint', command: 'bun run lint', exitCode: 1, output: 'src/app.ts: 1 problem (1 error, 0 warnings)\n' };
export const TYPE_CHECK: ParkedCheck = {
  check: 'type check',
  command: 'bunx tsc --noEmit',
  exitCode: 2,
  output: "src/cart.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.\n",
};

export const SAMPLE: Readonly<Record<ParkReason, ParkEvidence>> = {
  [ParkReason.BaselineRed]: { reason: ParkReason.BaselineRed, baseBranch: 'trunk', failedChecks: [TYPE_CHECK] },
  [ParkReason.PreExistingRegression]: {
    reason: ParkReason.PreExistingRegression,
    baseBranch: 'trunk',
    scenario: 'The cron launches one orchestrator per eligible issue',
  },
  [ParkReason.FixLoopStalled]: {
    reason: ParkReason.FixLoopStalled,
    failedChecks: [LINT],
    stall: FixLoopStall.IdenticalOutput,
    rounds: 3,
    rejections: [],
  },
  [ParkReason.MissingApplicationType]: { reason: ParkReason.MissingApplicationType, found: 'desktop' },
  [ParkReason.BaseServerDown]: {
    reason: ParkReason.BaseServerDown,
    baseBranch: 'trunk',
    output: 'Error: listen EADDRINUSE: address already in use :::3000\n',
  },
  [ParkReason.DeviceBootFailed]: {
    reason: ParkReason.DeviceBootFailed,
    failure: { kind: 'boot_failed', platform: Platform.Ios, attempts: 3, output: BOOT_ATTEMPT_OUTPUTS.join('\n\n') },
  },
  [ParkReason.WorktreeLost]: {
    reason: ParkReason.WorktreeLost,
    phase: 'build',
    worktreePath: '/srv/adw/.worktrees/feature-issue-42-widget',
    planPath: 'specs/issue-42-adw-k3x9ab-feat-park-comment-sdlc_planner-widget.md',
  },
};

export const REASONS = Object.values(ParkReason);

export function lines(comment: string): string[] {
  return comment.split('\n');
}

export function toolMissing(overrides: Partial<Extract<DeviceFailure, { kind: 'tool_missing' }>> = {}): ParkEvidence {
  return {
    reason: ParkReason.DeviceBootFailed,
    failure: { kind: 'tool_missing', platform: Platform.Android, tool: HostTool.AvdManager, output: 'Error: spawn avdmanager ENOENT', ...overrides },
  };
}

export function stalled(overrides: Partial<Extract<ParkEvidence, { reason: ParkReason.FixLoopStalled }>> = {}): ParkEvidence {
  return { reason: ParkReason.FixLoopStalled, failedChecks: [LINT], stall: FixLoopStall.IdenticalOutput, rounds: 3, rejections: [], ...overrides };
}
