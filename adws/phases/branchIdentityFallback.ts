/**
 * Identity-recovery helpers for the deterministic branch-identity fallback.
 *
 * When the canonical adwId cannot be recovered from issue comments, these helpers
 * locate the existing branch/worktree that belongs to the issue (slug-agnostic)
 * and reverse-look up the adwId that owns it from the persisted state store.
 *
 * All I/O is behind an injectable `deps` object so the logic is unit-testable
 * without a live git repo or a real agents/ directory.
 */

import * as fs from 'fs';
import type { IssueClassSlashCommand } from '../core';
import { AGENTS_STATE_DIR } from '../core';
import { AgentStateManager } from '../core/agentState';
import type { AgentState } from '../types/agentTypes';
import { branchMatchesIssue } from '../vcs/branchIdentity';
import { getLastActivityFromState } from '../triggers/cronStageResolver';
import { gitContextForRepo, readLocalRepoInfo } from '../github/gitContextFactory';

/** Injectable dependencies for the identity-recovery helpers. */
export interface BranchIdentityFallbackDeps {
  /** Returns candidate branch names to scan (worktree branches + local branches). */
  listCandidateBranches(cwd?: string): string[];
  /** Returns adwId directory names from the agents state store. */
  listAdwIds(): string[];
  /** Reads the top-level state file for the given adwId. */
  readTopLevelState(adwId: string): AgentState | null;
}

function defaultListCandidateBranches(cwd?: string): string[] {
  const ctx = gitContextForRepo(readLocalRepoInfo(cwd));
  return [...new Set([...ctx.worktreeBranches(cwd), ...ctx.localBranches(cwd)])];
}

function defaultListAdwIds(): string[] {
  try {
    if (!fs.existsSync(AGENTS_STATE_DIR)) return [];
    return fs
      .readdirSync(AGENTS_STATE_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

const defaultDeps: BranchIdentityFallbackDeps = {
  listCandidateBranches: defaultListCandidateBranches,
  listAdwIds: defaultListAdwIds,
  readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
};

function branchBelongsToIssue(
  branch: string,
  issueType: IssueClassSlashCommand,
  issueNumber: number,
): boolean {
  return branchMatchesIssue(branch, issueType, issueNumber);
}

/**
 * Scans existing branches and worktrees for one that belongs to the given issue
 * under the current classifier, ignoring the slug.
 *
 * Returns the first matching branch name, or `null` when none is found.
 * A different classifier prefix (re-classification) produces no match here, which
 * causes the caller to fall through to LLM generation — the intended new-branch behaviour.
 */
export function findExistingBranchForIssue(
  issueType: IssueClassSlashCommand,
  issueNumber: number,
  deps: BranchIdentityFallbackDeps = defaultDeps,
): string | null {
  const candidates = deps.listCandidateBranches();
  for (const branch of candidates) {
    if (branchBelongsToIssue(branch, issueType, issueNumber)) {
      return branch;
    }
  }
  return null;
}

/**
 * Reverse-looks-up the adwId that owns the given branch by enumerating
 * `agents/<adwId>/state.json` and returning the adwId whose persisted
 * `branchName` matches (exact). On multiple matches, the most-recently-active
 * adwId wins. Returns `null` when no match is found or the state store is absent.
 *
 * The branch name does not embed the adwId, so this persisted-state reverse-lookup
 * is the only reliable mechanism.
 */
export function recoverAdwIdForBranch(
  branchName: string,
  deps: BranchIdentityFallbackDeps = defaultDeps,
): string | null {
  const adwIds = deps.listAdwIds();
  if (adwIds.length === 0) return null;

  type Candidate = { adwId: string; lastActivity: number | null };
  const matches: Candidate[] = [];

  for (const adwId of adwIds) {
    const state = deps.readTopLevelState(adwId);
    if (state?.branchName === branchName) {
      matches.push({ adwId, lastActivity: getLastActivityFromState(state) });
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].adwId;

  // Tie-break: most-recently-active wins; null activity sorts last.
  matches.sort((a, b) => {
    if (a.lastActivity === null && b.lastActivity === null) return 0;
    if (a.lastActivity === null) return 1;
    if (b.lastActivity === null) return -1;
    return b.lastActivity - a.lastActivity;
  });
  return matches[0].adwId;
}

