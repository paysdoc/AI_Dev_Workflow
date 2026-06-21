/**
 * worktreeProbe — thin I/O shell that gathers Class-A git-operability signals.
 *
 * `probeWorktree(input, deps?)` returns a `WorktreeProbe` for `decideWorktreeReuse`.
 * All I/O is injected via `ProbeDeps`; `buildDefaultProbeDeps()` wires real fs/git.
 * `clearOrphanedIndexLock(worktreePath, deps?)` removes a stale lock before resume.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isProcessLive } from '../core/processLiveness';
import type { WorktreeProbe } from './worktreeReuseGate';

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

export function probeWorktree(input: ProbeInput, deps: ProbeDeps = buildDefaultProbeDeps()): WorktreeProbe {
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

export function clearOrphanedIndexLock(worktreePath: string, deps: ProbeDeps = buildDefaultProbeDeps()): void {
  const gitDir = deps.resolveGitDir(worktreePath);
  if (gitDir === null) return;
  const lockPath = path.join(gitDir, 'index.lock');
  if (!deps.existsSync(lockPath)) return;
  deps.rmSync(lockPath, { force: true });
}

export function buildDefaultProbeDeps(): ProbeDeps {
  return {
    existsSync: (p) => fs.existsSync(p),
    resolveGitDir: (worktreePath) => {
      try {
        const raw = execSync('git rev-parse --git-dir', {
          encoding: 'utf-8',
          stdio: 'pipe',
          cwd: worktreePath,
        }).trim();
        return path.isAbsolute(raw) ? raw : path.resolve(worktreePath, raw);
      } catch {
        return null;
      }
    },
    currentBranch: (worktreePath) => {
      try {
        return execSync('git symbolic-ref --short HEAD', {
          encoding: 'utf-8',
          stdio: 'pipe',
          cwd: worktreePath,
        }).trim();
      } catch {
        return null;
      }
    },
    worktreeRegistration: (worktreePath) => {
      try {
        const output = execSync('git worktree list --porcelain', {
          encoding: 'utf-8',
          stdio: 'pipe',
          cwd: worktreePath,
        });
        const lines = output.split('\n');
        let currentPath: string | null = null;
        let isLocked = false;
        let isPrunable = false;

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            currentPath = line.slice('worktree '.length);
            isLocked = false;
            isPrunable = false;
          } else if (line.startsWith('locked') && currentPath === worktreePath) {
            isLocked = true;
          } else if (line.startsWith('prunable') && currentPath === worktreePath) {
            isPrunable = true;
          } else if (line === '' && currentPath === worktreePath) {
            if (isLocked) return 'locked';
            if (isPrunable) return 'prunable';
            return 'healthy';
          }
        }
        // Path not in list
        return 'missing';
      } catch {
        return 'missing';
      }
    },
    isProcessLive: (pid, pidStartedAt) => isProcessLive(pid, pidStartedAt),
    rmSync: (p, opts) => fs.rmSync(p, opts),
  };
}
