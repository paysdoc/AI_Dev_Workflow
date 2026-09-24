/**
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
import type { GitContext } from '@paysdoc/devplatform/git';

export interface BranchIdentityFallbackDeps {
  /** Returns candidate branch names to scan (worktree branches + local branches). */
  listCandidateBranches(cwd?: string): string[];
  listAdwIds(): string[];
  readTopLevelState(adwId: string): AgentState | null;
}

function defaultListCandidateBranches(gitContext: Pick<GitContext, 'worktreeBranches' | 'localBranches'>, cwd?: string): string[] {
  return [...new Set([...gitContext.worktreeBranches(cwd), ...gitContext.localBranches(cwd)])];
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

export function buildDefaultBranchIdentityFallbackDeps(
  gitContext: Pick<GitContext, 'worktreeBranches' | 'localBranches'>,
): BranchIdentityFallbackDeps {
  return {
    listCandidateBranches: (cwd) => defaultListCandidateBranches(gitContext, cwd),
    listAdwIds: defaultListAdwIds,
    readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
  };
}

function branchBelongsToIssue(
  branch: string,
  issueType: IssueClassSlashCommand,
  issueNumber: number,
): boolean {
  return branchMatchesIssue(branch, issueType, issueNumber);
}

/**
 * A different classifier prefix (re-classification) produces no match here, which
 * causes the caller to fall through to LLM generation — the intended new-branch behaviour.
 */
export function findExistingBranchForIssue(
  issueType: IssueClassSlashCommand,
  issueNumber: number,
  deps: BranchIdentityFallbackDeps,
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
 * The branch name does not embed the adwId, so this persisted-state reverse-lookup
 * is the only reliable mechanism.
 */
export function recoverAdwIdForBranch(
  branchName: string,
  deps: BranchIdentityFallbackDeps,
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

