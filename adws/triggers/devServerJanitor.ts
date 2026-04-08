/**
 * Dev server janitor — cron probe for orphaned dev server processes.
 *
 * Scans target repository worktrees for dev server processes left behind by
 * SIGKILL'd or crashed orchestrators. Applies a conservative kill decision:
 * leave alone if (non-terminal stage AND orchestrator PID alive) OR worktree
 * is younger than 30 minutes. Otherwise SIGTERM → SIGKILL survivors.
 *
 * Entry point: runJanitorPass()
 * All OS-touching operations are injectable via deps for unit testing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { log, TARGET_REPOS_DIR, type LogLevel } from '../core';
import { AgentStateManager } from '../core/agentState';
import { isAgentProcessRunning } from '../core/stateHelpers';
import { isActiveStage } from './cronStageResolver';
import { killProcessesInDirectory } from '../vcs/worktreeCleanup';
import { listWorktrees } from '../vcs/worktreeQuery';
import type { AgentState } from '../types/agentTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Grace period: worktrees younger than this are always left alone. */
export const JANITOR_GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discovered worktree candidate for janitor evaluation. */
export interface WorktreeCandidate {
  /** Absolute path to the worktree directory. */
  worktreePath: string;
  /** Directory name (basename of worktreePath). */
  dirName: string;
}

/** Injectable dependencies for unit testing. */
export interface JanitorDeps {
  /** Read directory entries from the target repos base directory. */
  readdirTargetRepos: (targetReposDir: string) => string[];
  /** Check if a path is a git repo (has .git directory). */
  isGitRepo: (repoPath: string) => boolean;
  /** List worktrees for a repo directory. */
  listWorktrees: (cwd: string) => string[];
  /** Read top-level workflow state for an adwId. */
  readTopLevelState: (adwId: string) => AgentState | null;
  /** Check if the orchestrator process for an adwId is still alive. */
  isAgentProcessRunning: (adwId: string) => boolean;
  /** Get the age of a worktree directory in milliseconds. */
  getWorktreeAgeMs: (worktreePath: string) => number;
  /** Check if any processes are holding files open in the given directory. */
  hasProcessesInDirectory: (directoryPath: string) => boolean;
  /** Kill all processes holding files in the given directory (SIGTERM → SIGKILL). */
  killProcessesInDirectory: (directoryPath: string) => void;
  /** Log function. */
  log: (msg: string, level?: LogLevel) => void;
}

// ---------------------------------------------------------------------------
// Pure decision logic
// ---------------------------------------------------------------------------

/**
 * Extracts the adwId from a worktree directory name.
 *
 * Branch format: {type}-issue-{N}-adw-{adwId}
 * adwId is everything after the first `-adw-` marker.
 *
 * @returns The adwId string, or null if the directory name has no `-adw-` marker.
 */
export function extractAdwIdFromDirName(dirName: string): string | null {
  const marker = '-adw-';
  const idx = dirName.indexOf(marker);
  if (idx === -1) return null;
  const adwId = dirName.substring(idx + marker.length);
  return adwId.length > 0 ? adwId : null;
}

/**
 * Pure kill decision function.
 *
 * Returns true (should clean) unless:
 * - The workflow is non-terminal AND the orchestrator PID is still alive (active workflow)
 * - The worktree is younger than the grace period (recently created)
 *
 * @param isNonTerminal  - True if the workflow stage is still active
 * @param orchestratorAlive - True if the orchestrator process is still running
 * @param ageMs - Age of the worktree directory in milliseconds
 * @param gracePeriodMs - Grace period in milliseconds (default: JANITOR_GRACE_PERIOD_MS)
 */
export function shouldCleanWorktree(
  isNonTerminal: boolean,
  orchestratorAlive: boolean,
  ageMs: number,
  gracePeriodMs: number,
): boolean {
  // Active workflow with live orchestrator: always skip
  if (isNonTerminal && orchestratorAlive) return false;
  // Young worktree: skip (state file may not be written yet); <= is deliberately conservative
  if (ageMs <= gracePeriodMs) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Walks TARGET_REPOS_DIR to find all worktrees across all cloned target repos.
 * Structure: TARGET_REPOS_DIR/{owner}/{repo}/ where repo has a .git directory.
 */
export function discoverTargetRepoWorktrees(deps: JanitorDeps): WorktreeCandidate[] {
  const candidates: WorktreeCandidate[] = [];

  let owners: string[];
  try {
    owners = deps.readdirTargetRepos(TARGET_REPOS_DIR);
  } catch {
    return candidates;
  }

  for (const owner of owners) {
    const ownerPath = path.join(TARGET_REPOS_DIR, owner);
    let repos: string[];
    try {
      repos = deps.readdirTargetRepos(ownerPath);
    } catch {
      continue;
    }

    for (const repo of repos) {
      const repoPath = path.join(ownerPath, repo);
      if (!deps.isGitRepo(repoPath)) continue;

      const worktreePaths = deps.listWorktrees(repoPath);
      for (const wtPath of worktreePaths) {
        candidates.push({
          worktreePath: wtPath,
          dirName: path.basename(wtPath),
        });
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Default dependency implementations
// ---------------------------------------------------------------------------

function defaultReaddirTargetRepos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

function defaultIsGitRepo(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git'));
}

function defaultGetWorktreeAgeMs(worktreePath: string): number {
  try {
    const stat = fs.statSync(worktreePath);
    // birthtimeMs is reliable on macOS; fall back to ctimeMs on Linux
    return Date.now() - (stat.birthtimeMs || stat.ctimeMs);
  } catch {
    // If stat fails, treat as very old to err on the side of cleaning
    return Infinity;
  }
}

function defaultHasProcessesInDirectory(directoryPath: string): boolean {
  try {
    const output = execSync(`lsof +D "${directoryPath}" -t`, { encoding: 'utf-8' });
    const pids = output
      .split('\n')
      .map(line => parseInt(line.trim(), 10))
      .filter(pid => !isNaN(pid) && pid !== process.pid);
    return pids.length > 0;
  } catch {
    return false;
  }
}

const DEFAULT_DEPS: JanitorDeps = {
  readdirTargetRepos: defaultReaddirTargetRepos,
  isGitRepo: defaultIsGitRepo,
  listWorktrees,
  readTopLevelState: AgentStateManager.readTopLevelState,
  isAgentProcessRunning,
  getWorktreeAgeMs: defaultGetWorktreeAgeMs,
  hasProcessesInDirectory: defaultHasProcessesInDirectory,
  killProcessesInDirectory,
  log,
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Runs one janitor pass over all target repository worktrees.
 *
 * For each worktree:
 * 1. Extract adwId from directory name
 * 2. Read workflow stage from state file (if adwId found)
 * 3. Check orchestrator PID liveness
 * 4. Check worktree age
 * 5. Apply kill decision rule
 * 6. SIGTERM → SIGKILL processes in eligible worktrees
 *
 * @param deps - Injectable dependencies (defaults to real OS implementations)
 */
export async function runJanitorPass(deps: JanitorDeps = DEFAULT_DEPS): Promise<void> {
  const candidates = discoverTargetRepoWorktrees(deps);

  if (candidates.length === 0) {
    return;
  }

  deps.log(`Janitor: scanning ${candidates.length} worktree(s)`, 'info');

  for (const { worktreePath, dirName } of candidates) {
    try {
      // Step 1: Probe for processes via lsof — skip entirely if none found
      if (!deps.hasProcessesInDirectory(worktreePath)) {
        continue;
      }

      // Step 2: Apply kill decision rule
      const adwId = extractAdwIdFromDirName(dirName);

      let isNonTerminal = false;
      let orchestratorAlive = false;

      if (adwId !== null) {
        const state = deps.readTopLevelState(adwId);
        if (state?.workflowStage) {
          isNonTerminal = isActiveStage(state.workflowStage);
        }
        orchestratorAlive = deps.isAgentProcessRunning(adwId);
      }

      const ageMs = deps.getWorktreeAgeMs(worktreePath);

      if (!shouldCleanWorktree(isNonTerminal, orchestratorAlive, ageMs, JANITOR_GRACE_PERIOD_MS)) {
        continue;
      }

      // Step 3: Kill — SIGTERM → wait → SIGKILL survivors
      deps.log(`Janitor: cleaning orphaned processes in ${worktreePath}`, 'info');
      deps.killProcessesInDirectory(worktreePath);
    } catch (err) {
      deps.log(`Janitor: error processing ${worktreePath}: ${err}`, 'warn');
    }
  }
}
