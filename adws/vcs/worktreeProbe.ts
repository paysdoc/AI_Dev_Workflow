/**
 * worktreeProbe — thin I/O shell that gathers Class-A git-operability signals.
 *
 * `probeWorktree(input, deps?)` returns a `WorktreeProbe` for `decideWorktreeReuse`.
 * All I/O is injected via `ProbeDeps`; `buildDefaultProbeDeps()` wires real fs/git.
 * `clearOrphanedIndexLock(worktreePath, deps?)` removes a stale lock before resume.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isProcessLive } from '../core/processLiveness';
import type { WorktreeProbe } from './worktreeReuseGate';
import type { GitContext } from '../gitContext';

export interface ProbeInput {
  readonly worktreePath: string;
  readonly expectedBranch: string;
  readonly recordedPid?: number;
  readonly recordedPidStartedAt?: string;
}

export interface ProbeDeps {
  readonly existsSync: (p: string) => boolean;
  readonly resolveGitDir: (worktreePath: string) => string | null;
  readonly currentBranch: (worktreePath: string) => string | null;
  readonly worktreeRegistration: (worktreePath: string) => 'healthy' | 'locked' | 'prunable' | 'missing';
  readonly isProcessLive: (pid: number, pidStartedAt: string) => boolean;
  readonly rmSync: (p: string, opts: { force: boolean }) => void;
}

function detectInterruptedOp(
  gitDir: string,
  deps: ProbeDeps,
): 'none' | 'rebase' | 'merge' | 'cherry_pick' {
  if (deps.existsSync(path.join(gitDir, 'rebase-merge'))) return 'rebase';
  if (deps.existsSync(path.join(gitDir, 'rebase-apply'))) return 'rebase';
  if (deps.existsSync(path.join(gitDir, 'MERGE_HEAD'))) return 'merge';
  if (deps.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry_pick';
  return 'none';
}

function resolveOwnerLiveness(
  recordedPid: number | undefined,
  recordedPidStartedAt: string | undefined,
  deps: ProbeDeps,
): boolean {
  if (recordedPid === undefined || !recordedPidStartedAt) return false;
  return deps.isProcessLive(recordedPid, recordedPidStartedAt);
}

// Returns a benign probe indicating "missing" when the git dir cannot be resolved.
function missingProbe(): WorktreeProbe {
  return {
    registration: 'missing',
    indexLock: 'absent',
    interruptedOp: 'none',
    headOnExpectedBranch: false,
    liveOwner: false,
  };
}

export function probeWorktree(input: ProbeInput, deps: ProbeDeps): WorktreeProbe {
  const { worktreePath, expectedBranch, recordedPid, recordedPidStartedAt } = input;

  const ownerLive = resolveOwnerLiveness(recordedPid, recordedPidStartedAt, deps);
  const registration = deps.worktreeRegistration(worktreePath);
  const gitDir = deps.resolveGitDir(worktreePath);
  if (gitDir === null) return missingProbe();

  const lockPath = path.join(gitDir, 'index.lock');
  const lockPresent = deps.existsSync(lockPath);
  const indexLock = lockPresent
    ? (ownerLive ? 'live_held' : 'orphaned')
    : 'absent';

  const interruptedOp = detectInterruptedOp(gitDir, deps);
  const headOnExpectedBranch = deps.currentBranch(worktreePath) === expectedBranch;

  return { registration, indexLock, interruptedOp, headOnExpectedBranch, liveOwner: ownerLive };
}

export function clearOrphanedIndexLock(worktreePath: string, deps: ProbeDeps): void {
  const gitDir = deps.resolveGitDir(worktreePath);
  if (gitDir === null) return;
  const lockPath = path.join(gitDir, 'index.lock');
  if (!deps.existsSync(lockPath)) return;
  deps.rmSync(lockPath, { force: true });
}

export function buildDefaultProbeDeps(ctx: GitContext): ProbeDeps {
  return {
    existsSync: (p) => fs.existsSync(p),
    resolveGitDir: (worktreePath) => ctx.resolveGitDir(worktreePath),
    currentBranch: (worktreePath) => ctx.currentBranchSymbolic(worktreePath),
    worktreeRegistration: (worktreePath) => ctx.worktreeRegistration(worktreePath),
    isProcessLive: (pid, pidStartedAt) => isProcessLive(pid, pidStartedAt),
    rmSync: (p, opts) => fs.rmSync(p, opts),
  };
}
