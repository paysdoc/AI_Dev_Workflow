/**
 * Scans target repository worktrees for dev server processes left behind by
 * SIGKILL'd or crashed orchestrators.
 *
 * Structure walked: {targetReposDir}/{owner}/{repo}/, where repo is treated as
 * an ADW target repo only when it carries BOTH a `.git` entry and the `.adw`
 * marker directory written by adw_init — TARGET_REPOS_DIR may be a general
 * projects folder shared with non-ADW repos, not an ADW-only directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { log, TARGET_REPOS_DIR, AGENTS_STATE_DIR, buildLaunchBoundary, type LogLevel } from '../core';
import { AgentStateManager } from '../core/agentState';
import { isAgentProcessRunning } from '../core/stateHelpers';
import { isActiveStage } from './cronStageResolver';
import { killProcessesInDirectory } from '@paysdoc/devplatform/git';
import type { AgentState } from '../types/agentTypes';

/** Grace period: worktrees younger than this are always left alone. */
export const JANITOR_GRACE_PERIOD_MS = 30 * 60 * 1000;

export interface WorktreeCandidate {
  worktreePath: string;
  dirName: string;
}

export interface JanitorDeps {
  readdirTargetRepos: (targetReposDir: string) => string[];
  isGitRepo: (repoPath: string) => boolean;
  /** Check if a repo directory carries the `.adw` marker written by adw_init (i.e. is ADW-managed). */
  hasAdwMarker: (repoPath: string) => boolean;
  listWorktrees: (owner: string, repo: string) => string[];
  readTopLevelState: (adwId: string) => AgentState | null;
  /** List adwId directories under AGENTS_STATE_DIR (excludes 'cron' and non-directories). */
  listAdwStateDirs: () => string[];
  /** Read top-level workflow state for an adwId (alias for AgentStateManager.readTopLevelState). */
  readTopLevelStateRaw: (adwId: string) => AgentState | null;
  isAgentProcessRunning: (adwId: string) => boolean;
  getWorktreeAgeMs: (worktreePath: string) => number;
  hasProcessesInDirectory: (directoryPath: string) => boolean;
  /** Kill all processes holding files in the given directory (SIGTERM → SIGKILL). */
  killProcessesInDirectory: (directoryPath: string) => void;
  log: (msg: string, level?: LogLevel) => void;
}

/**
 * Branch format is owned by generateBranchName() in adws/vcs/.
 * Example: `feature-issue-55-scraper-visual-asset-capture` → 55.
 *
 * @returns The issue number, or null if the directory name has no `-issue-<N>-` segment.
 */
export function extractIssueNumberFromDirName(dirName: string): number | null {
  const m = dirName.match(/-issue-(\d+)-/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

/**
 *
 * Multiple state files may share an issue number (re-runs, takeovers); the freshest
 * `lastSeenAt` (refreshed by the heartbeat ticker) wins. Entries without `lastSeenAt`
 * are tie-broken by treating their seen time as 0.
 *
 */
export function findActiveAdwIdForIssue(
  issueNumber: number,
  deps: Pick<JanitorDeps, 'listAdwStateDirs' | 'readTopLevelStateRaw'>,
): string | null {
  const candidates = deps.listAdwStateDirs();
  let best: { adwId: string; lastSeenMs: number } | null = null;
  for (const adwId of candidates) {
    const state = deps.readTopLevelStateRaw(adwId);
    if (!state || state.issueNumber !== issueNumber) continue;
    const seen = state.lastSeenAt ? Date.parse(state.lastSeenAt) : 0;
    const seenMs = Number.isNaN(seen) ? 0 : seen;
    if (!best || seenMs > best.lastSeenMs) best = { adwId, lastSeenMs: seenMs };
  }
  return best?.adwId ?? null;
}

/**
 *
 * Returns true (should clean) unless:
 * - The workflow is non-terminal AND the orchestrator PID is still alive (active workflow)
 * - The worktree is younger than the grace period (recently created)
 *
 */
export function shouldCleanWorktree(
  isNonTerminal: boolean,
  orchestratorAlive: boolean,
  ageMs: number,
  gracePeriodMs: number,
): boolean {
  if (isNonTerminal && orchestratorAlive) return false;
  // Young worktree: skip (state file may not be written yet); <= is deliberately conservative
  if (ageMs <= gracePeriodMs) return false;
  return true;
}

/**
 * Lists the worktrees of one `{owner}/{repo}` directory, or `[]` when it is not an
 * ADW target repo or its worktrees cannot be listed.
 *
 * Only a directory carrying BOTH `.git` and the `.adw` marker is an ADW target repo;
 * anything else under the target repos root is skipped before any GitContext / token
 * resolution happens. A listing failure (GitHub App not installed → HTTP 404, missing
 * remote, deleted repo, network error) is logged as a warning naming the repo and
 * isolated to that repo so discovery continues with the rest.
 */
function discoverRepoWorktrees(owner: string, repo: string, repoPath: string, deps: JanitorDeps): string[] {
  if (!deps.isGitRepo(repoPath)) return [];
  if (!deps.hasAdwMarker(repoPath)) return [];

  try {
    return deps.listWorktrees(owner, repo);
  } catch (err) {
    deps.log(`Janitor: skipping ${owner}/${repo} — worktree listing failed: ${err}`, 'warn');
    return [];
  }
}

export function discoverTargetRepoWorktrees(deps: JanitorDeps, targetReposDir: string = TARGET_REPOS_DIR): WorktreeCandidate[] {
  const candidates: WorktreeCandidate[] = [];

  let owners: string[];
  try {
    owners = deps.readdirTargetRepos(targetReposDir);
  } catch {
    return candidates;
  }

  for (const owner of owners) {
    const ownerPath = path.join(targetReposDir, owner);
    let repos: string[];
    try {
      repos = deps.readdirTargetRepos(ownerPath);
    } catch {
      continue;
    }

    for (const repo of repos) {
      const repoPath = path.join(ownerPath, repo);
      const worktreePaths = discoverRepoWorktrees(owner, repo, repoPath, deps);
      candidates.push(...worktreePaths.map(wtPath => ({ worktreePath: wtPath, dirName: path.basename(wtPath) })));
    }
  }

  return candidates;
}

function defaultReaddirTargetRepos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

function defaultListAdwStateDirs(): string[] {
  try {
    return fs.readdirSync(AGENTS_STATE_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name !== 'cron')
      .map(e => e.name);
  } catch {
    return [];
  }
}

function defaultIsGitRepo(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git'));
}

function defaultHasAdwMarker(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.adw'));
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

const defaultDeps: JanitorDeps = {
  readdirTargetRepos: defaultReaddirTargetRepos,
  isGitRepo: defaultIsGitRepo,
  hasAdwMarker: defaultHasAdwMarker,
  listWorktrees: (owner, repo) => buildLaunchBoundary({ owner, repo, cloneUrl: '' }).gitContext.listWorktrees(),
  readTopLevelState: AgentStateManager.readTopLevelState,
  readTopLevelStateRaw: AgentStateManager.readTopLevelState,
  listAdwStateDirs: defaultListAdwStateDirs,
  isAgentProcessRunning,
  getWorktreeAgeMs: defaultGetWorktreeAgeMs,
  hasProcessesInDirectory: defaultHasProcessesInDirectory,
  killProcessesInDirectory,
  log,
};

/** Exported frozen so tests and step definitions can spread it and override only the network- and process-touching members. */
export const DEFAULT_DEPS: JanitorDeps = Object.freeze(defaultDeps);

export async function runJanitorPass(deps: JanitorDeps = DEFAULT_DEPS, targetReposDir: string = TARGET_REPOS_DIR): Promise<void> {
  const candidates = discoverTargetRepoWorktrees(deps, targetReposDir);

  if (candidates.length === 0) {
    return;
  }

  deps.log(`Janitor: scanning ${candidates.length} worktree(s)`, 'info');

  for (const { worktreePath, dirName } of candidates) {
    try {
      if (!deps.hasProcessesInDirectory(worktreePath)) {
        continue;
      }

      const issueNumber = extractIssueNumberFromDirName(dirName);
      const adwId = issueNumber !== null ? findActiveAdwIdForIssue(issueNumber, deps) : null;

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

      deps.log(`Janitor: cleaning orphaned processes in ${worktreePath}`, 'info');
      deps.killProcessesInDirectory(worktreePath);
    } catch (err) {
      deps.log(`Janitor: error processing ${worktreePath}: ${err}`, 'warn');
    }
  }
}
