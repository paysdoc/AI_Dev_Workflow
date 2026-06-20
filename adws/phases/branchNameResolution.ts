/**
 * Branch-name resolution for ADW workflows.
 *
 * Priority: persisted state → recovery comment → LLM generation.
 * Once resolved for an adwId, the name is persisted in agents/{adwId}/state.json
 * and reused on every subsequent initializeWorkflow call — the LLM is invoked
 * at most once per adwId.
 *
 * If the LLM is somehow invoked and returns a name that disagrees with a
 * concurrently-written persisted value (race condition), this module aborts
 * instead of silently forking into an orphan worktree (issue #524).
 */

import { AgentStateManager, log } from '../core';
import type { IssueClassSlashCommand, GitHubIssue, RecoveryState } from '../core';
import { runGenerateBranchNameAgent } from '../agents';
import { findExistingBranchForIssue } from './branchIdentityFallback';
import type { BranchIdentityFallbackDeps } from './branchIdentityFallback';

/** Returns the branch name stored in agents/{adwId}/state.json, or undefined. */
export function readPersistedBranchName(adwId: string): string | undefined {
  return AgentStateManager.readTopLevelState(adwId)?.branchName ?? undefined;
}

/** Merges { branchName } into the top-level state for adwId (atomic write). */
export function persistBranchName(adwId: string, branchName: string): void {
  AgentStateManager.writeTopLevelState(adwId, { branchName });
}

type AgentFn = typeof runGenerateBranchNameAgent;
type FinderFn = (
  issueType: IssueClassSlashCommand,
  issueNumber: number,
  deps?: BranchIdentityFallbackDeps,
) => string | null;

async function resolveInternal(
  args: {
    adwId: string;
    issueType: IssueClassSlashCommand;
    issue: GitHubIssue;
    logsDir: string;
    recoveryState: RecoveryState;
  },
  agentFn: AgentFn,
  finderFn: FinderFn = findExistingBranchForIssue,
): Promise<string> {
  const { adwId, issueType, issue, logsDir, recoveryState } = args;

  const persisted = readPersistedBranchName(adwId);
  if (persisted) {
    log(`Reusing persisted branch name for adwId ${adwId}: ${persisted}`, 'info');
    return persisted;
  }

  if (recoveryState.branchName) {
    log(`Reusing branch from previous workflow: ${recoveryState.branchName}`, 'info');
    persistBranchName(adwId, recoveryState.branchName);
    return recoveryState.branchName;
  }

  // Deterministic fallback: find an existing branch that belongs to this issue
  // without relying on the LLM. Inserted between recovery-comment reuse and LLM
  // generation so a lost-comment run reuses the existing branch, not a new one.
  const found = finderFn(issueType, issue.number);
  if (found) {
    log(`Reusing existing branch found by deterministic identity fallback: ${found}`, 'info');
    persistBranchName(adwId, found);
    return found;
  }

  const { branchName: generated } = await agentFn(issueType, issue, logsDir);

  // Defense-in-depth: re-read state after the LLM call to detect concurrent writes.
  const persistedNow = readPersistedBranchName(adwId);
  if (persistedNow && persistedNow !== generated) {
    throw new Error(
      `Refusing to fork into a new worktree (issue #524): adwId "${adwId}" ` +
      `has persisted branch name "${persistedNow}" but runGenerateBranchNameAgent returned "${generated}". ` +
      `Aborting to prevent stranding phase-1 artifacts on an orphan branch.`,
    );
  }

  log(`Branch name generated: ${generated}`, 'success');
  persistBranchName(adwId, generated);
  return generated;
}

/**
 * Resolves the branch name for a workflow run.
 *
 * Resolution priority:
 *   1. Persisted top-level state (agents/{adwId}/state.json → branchName)
 *   2. Recovery comment (recoveryState.branchName)
 *   3. Deterministic identity fallback (existing branch for this issue, slug-agnostic)
 *   4. LLM generation via runGenerateBranchNameAgent
 *
 * The resolved name is persisted immediately so subsequent calls return it from
 * step 1 without invoking the LLM again. runGenerateBranchNameAgent is called
 * at most once per adwId.
 */
export async function resolveWorkflowBranchName(args: {
  adwId: string;
  issueType: IssueClassSlashCommand;
  issue: GitHubIssue;
  logsDir: string;
  recoveryState: RecoveryState;
}): Promise<string> {
  return resolveInternal(args, runGenerateBranchNameAgent);
}

/**
 * @internal Exported for test use only — allows injecting a mock agent function
 * and an optional mock finder function.
 * Production callers must use resolveWorkflowBranchName.
 */
export const _resolveWorkflowBranchNameForTest = resolveInternal;
