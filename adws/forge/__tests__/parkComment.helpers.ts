import { FixLoopStall } from '../../core/staticCheckFixLoop';
import { ParkReason, type ParkEvidence, type ParkedCheck } from '../parkComment';

export const ADW_ID = 'k3x9ab-feat-park-comment';

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
};

export const REASONS = Object.values(ParkReason);

export function lines(comment: string): string[] {
  return comment.split('\n');
}

export function stalled(overrides: Partial<Extract<ParkEvidence, { reason: ParkReason.FixLoopStalled }>> = {}): ParkEvidence {
  return { reason: ParkReason.FixLoopStalled, failedChecks: [LINT], stall: FixLoopStall.IdenticalOutput, rounds: 3, rejections: [], ...overrides };
}
