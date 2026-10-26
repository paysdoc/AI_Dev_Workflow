import * as path from 'path';
import { log, MAX_AUTO_MERGE_ATTEMPTS } from '../core';
import { getModelForCommand, getEffortForCommand } from '../core/modelRouting';
import { isSelfHostLaunch } from '../core/selfHostLaunch';
import type { CodeHost } from '@paysdoc/devplatform';
import { runClaudeAgentWithCommand } from '../agents';
import type { GitContext } from '@paysdoc/devplatform/git';

const maxAttempts = MAX_AUTO_MERGE_ATTEMPTS;

export type LocalMergeCheck = 'clean' | 'conflicts' | 'unavailable';

// GitHub recomputes mergeability in the background after every push, so a merge call made before that settles is answered from stale state.
export const STALE_MERGE_RETRY_DELAYS_MS: readonly number[] = [3_000, 6_000, 12_000, 24_000];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The local merge check: a dry-run merge of origin/<base> into the worktree after a fresh fetch of it, leaving the
 * working tree as it was. It is the source of truth for mergeability; the forge's merge errors are not, since right
 * after a push they are answered from stale state. A failed fetch is `unavailable`, which is no evidence of conflicts.
 */
function checkLocalMerge(baseBranch: string, cwd: string, ctx: GitContext): LocalMergeCheck {
  try {
    ctx.fetchRemote(baseBranch, cwd);
  } catch (error) {
    log(`Failed to fetch origin/${baseBranch}: ${error}`, 'warn');
    return 'unavailable';
  }

  try {
    ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noCommit: true, noFf: true });
    return 'clean';
  } catch {
    return 'conflicts';
  } finally {
    ctx.abortMerge(cwd);
  }
}

/** Initiates a real merge (with conflict markers) then invokes the /resolve_conflict agent. */
async function resolveConflictsViaAgent(
  adwId: string,
  specPath: string,
  baseBranch: string,
  logsDir: string,
  cwd: string,
  ctx: GitContext,
): Promise<boolean> {
  try {
    ctx.fetchRemote(baseBranch, cwd);
    ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noEdit: true });
    log(`Merge from origin/${baseBranch} succeeded cleanly — no agent resolution needed`, 'info');
    return true;
  } catch {
    // Expected when conflicts exist — agent will resolve them
  }

  const outputFile = path.join(logsDir, `resolve-conflict-${Date.now()}.jsonl`);
  log(`Invoking /resolve_conflict agent for adwId=${adwId}, baseBranch=${baseBranch}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/resolve_conflict',
    [adwId, specPath, baseBranch],
    'conflict-resolver',
    outputFile,
    getModelForCommand('/resolve_conflict'),
    getEffortForCommand('/resolve_conflict'),
    undefined,
    undefined,
    cwd,
    undefined,
    undefined,
    undefined,
    { selfHost: isSelfHostLaunch(ctx), adwId, gitContext: ctx }
  );

  if (result.success) {
    log(`Conflict resolution agent succeeded`, 'success');
  } else {
    log(`Conflict resolution agent failed: ${result.output.substring(0, 200)}`, 'error');
  }

  return result.success;
}

function pushBranchChanges(branchName: string, cwd: string, ctx: GitContext): boolean {
  try {
    ctx.pushBranch(branchName, cwd);
    log(`Pushed branch '${branchName}' to origin`, 'success');
    return true;
  } catch (error) {
    log(`Failed to push branch '${branchName}': ${error}`, 'error');
    return false;
  }
}

/**
 * Syncs the local worktree to origin/<headBranch> so subsequent operations
 * reason about the same commit GitHub will merge. Best-effort — failures are
 * logged as warnings and the loop proceeds against the existing worktree.
 */
function syncWorktreeToOriginHead(headBranch: string, cwd: string, ctx: GitContext): void {
  try {
    ctx.fetchAndResetToRemote(headBranch, cwd);
  } catch (error) {
    log(`Failed to sync worktree to origin/${headBranch}: ${error}`, 'warn');
  }
}

type MergeStep =
  | { readonly kind: 'merged'; readonly mergeAttempts: number }
  | {
      readonly kind: 'conflicts' | 'stale_retries_exhausted';
      readonly mergeAttempts: number;
      readonly error: string;
      readonly localMergeCheck: LocalMergeCheck;
    };

/**
 * Merges the pull request, asking again after every failure the local merge check does not back with conflicts: a failure
 * on a branch that merges cleanly is stale, whatever the forge's error says. Stops early only when the check finds conflicts.
 */
async function mergeWithStaleRetry(
  prNumber: number,
  codeHost: Pick<CodeHost, 'mergePullRequest'>,
  baseBranch: string,
  worktreePath: string,
  ctx: GitContext,
  wait: (ms: number) => Promise<void>,
): Promise<MergeStep> {
  for (let mergeAttempts = 1; ; mergeAttempts++) {
    const mergeResult = codeHost.mergePullRequest(prNumber);
    if (mergeResult.success) return { kind: 'merged', mergeAttempts };

    const error = mergeResult.error || '';
    const localMergeCheck = checkLocalMerge(baseBranch, worktreePath, ctx);
    if (localMergeCheck === 'conflicts') return { kind: 'conflicts', mergeAttempts, error, localMergeCheck };

    if (mergeAttempts > STALE_MERGE_RETRY_DELAYS_MS.length) {
      return { kind: 'stale_retries_exhausted', mergeAttempts, error, localMergeCheck };
    }
    const delayMs = STALE_MERGE_RETRY_DELAYS_MS[mergeAttempts - 1];
    log(
      `Merge failed: ${error} — local merge check is ${localMergeCheck}, so treating it as stale mergeability; ` +
        `retry ${mergeAttempts}/${STALE_MERGE_RETRY_DELAYS_MS.length} in ${delayMs / 1000}s`,
      'warn',
    );
    await wait(delayMs);
  }
}

async function resolveConflictsForAttempt(
  attempt: number,
  adwId: string,
  specPath: string,
  baseBranch: string,
  logsDir: string,
  cwd: string,
  ctx: GitContext,
): Promise<boolean> {
  log(`Merge conflicts detected on attempt ${attempt}, invoking /resolve_conflict`, 'info');
  const resolved = await resolveConflictsViaAgent(adwId, specPath, baseBranch, logsDir, cwd, ctx);
  if (!resolved) log(`Conflict resolution failed on attempt ${attempt}, retrying`, 'warn');
  return resolved;
}

export interface MergeOutcome {
  readonly success: boolean;
  readonly error?: string;
  /** The number of `mergePullRequest` calls, across every attempt. */
  readonly mergeAttempts: number;
  /** Whether the `/resolve_conflict` path was entered on any attempt. */
  readonly conflictResolutionRan: boolean;
  /** The latest result of the local merge check. */
  readonly localMergeCheck: LocalMergeCheck;
}

/** Core retry loop: check the local merge → resolve conflicts → push → merge, asking again after stale refusals. */
export async function mergeWithConflictResolution(
  prNumber: number,
  codeHost: Pick<CodeHost, 'mergePullRequest'>,
  headBranch: string,
  baseBranch: string,
  worktreePath: string,
  adwId: string,
  logsDir: string,
  specPath: string,
  gitContext: GitContext,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<MergeOutcome> {
  const ctx = gitContext;
  let lastMergeError = '';
  let mergeAttempts = 0;
  let conflictResolutionRan = false;
  let localMergeCheck: LocalMergeCheck = 'unavailable';

  syncWorktreeToOriginHead(headBranch, worktreePath, ctx);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Auto-merge attempt ${attempt}/${maxAttempts} for PR #${prNumber}`, 'info');

    localMergeCheck = checkLocalMerge(baseBranch, worktreePath, ctx);
    const hasConflicts = localMergeCheck === 'conflicts';
    conflictResolutionRan = conflictResolutionRan || hasConflicts;
    if (hasConflicts && !(await resolveConflictsForAttempt(attempt, adwId, specPath, baseBranch, logsDir, worktreePath, ctx))) continue;

    if (!pushBranchChanges(headBranch, worktreePath, ctx)) {
      log(`Push failed on attempt ${attempt}, retrying`, 'warn');
      continue;
    }

    const step = await mergeWithStaleRetry(prNumber, codeHost, baseBranch, worktreePath, ctx, wait);
    mergeAttempts += step.mergeAttempts;

    if (step.kind === 'merged') {
      log(`PR #${prNumber} merged successfully on attempt ${attempt}`, 'success');
      return { success: true, mergeAttempts, conflictResolutionRan, localMergeCheck };
    }

    lastMergeError = step.error;
    localMergeCheck = step.localMergeCheck;

    if (step.kind === 'stale_retries_exhausted') {
      log(`PR #${prNumber} is still refused after ${STALE_MERGE_RETRY_DELAYS_MS.length} stale-mergeability retries, with a ${localMergeCheck} local merge check — stopping`, 'error');
      break;
    }
    log(`Local merge check found conflicts with origin/${baseBranch} after the failed merge on attempt ${attempt}, retrying`, 'warn');
  }

  return { success: false, error: lastMergeError, mergeAttempts, conflictResolutionRan, localMergeCheck };
}
