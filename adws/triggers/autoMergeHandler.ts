import { log, MAX_AUTO_MERGE_ATTEMPTS } from '../core';
import { combineMergedIn, type MergedInBase, type PostMergeRed, type PostMergeScenarioRerun } from '../core/postMergeVerdict';
import type { CodeHost } from '@paysdoc/devplatform';
import type { GitContext } from '@paysdoc/devplatform/git';
import { baseMovedPast, bringBaseIn, commitsMissingFrom, type BaseIntegration } from './baseIntegration';

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
      readonly kind: 'conflicts' | 'stale_retries_exhausted' | 'base_moved';
      readonly mergeAttempts: number;
      readonly error: string;
      readonly localMergeCheck: LocalMergeCheck;
    };

/**
 * Merges the pull request, asking again after every failure the local merge check does not back with conflicts: a failure
 * on a branch that merges cleanly is stale, whatever the forge's error says. Stops early when the check finds conflicts, and
 * when the base branch holds commits that the branch lacks: waiting would not bring them in, and the scenarios have not run on them.
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
    // The local merge check has just fetched, so this read sees the base branch as it is now.
    if (localMergeCheck === 'clean' && commitsMissingFrom('HEAD', baseBranch, worktreePath, ctx).length > 0) {
      return { kind: 'base_moved', mergeAttempts, error, localMergeCheck };
    }

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

export interface MergeOutcome {
  readonly success: boolean;
  readonly error?: string;
  /** The number of `mergePullRequest` calls, across every attempt. */
  readonly mergeAttempts: number;
  /** Whether the `/resolve_conflict` path was entered on any attempt. */
  readonly conflictResolutionRan: boolean;
  /** The latest result of the local merge check. */
  readonly localMergeCheck: LocalMergeCheck;
  /** Set when the scenarios failed on the branch merged with the base branch: the pull request was not merged. */
  readonly postMergeRed?: PostMergeRed;
}

interface MergeRun {
  readonly prNumber: number;
  readonly codeHost: Pick<CodeHost, 'mergePullRequest'>;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly adwId: string;
  readonly logsDir: string;
  readonly specPath: string;
  readonly ctx: GitContext;
  readonly rerunScenarios: PostMergeScenarioRerun;
  readonly wait: (ms: number) => Promise<void>;
}

/** What the attempts of one call have seen; each attempt updates it. */
interface Progress {
  mergeAttempts: number;
  conflictResolutionRan: boolean;
  localMergeCheck: LocalMergeCheck;
  lastMergeError: string;
  /** The base commits merged in since the scenarios last passed: the proof does not cover them yet. */
  untested: MergedInBase | null;
}

type AttemptEnd =
  | { readonly kind: 'merged' | 'retry' | 'give_up' }
  | { readonly kind: 'red'; readonly postMergeRed: PostMergeRed };

const MERGED: AttemptEnd = { kind: 'merged' };
const RETRY: AttemptEnd = { kind: 'retry' };
const GIVE_UP: AttemptEnd = { kind: 'give_up' };

/** Returns why the attempt ends before the forge is asked to merge, or null when the branch is proven. */
async function proveMergedInBase(run: MergeRun, progress: Progress): Promise<AttemptEnd | null> {
  if (progress.untested === null) return null;
  const verdict = await run.rerunScenarios();
  if (verdict.kind === 'red') return { kind: 'red', postMergeRed: { ...progress.untested, failures: verdict.failures } };

  progress.untested = null;
  if (!baseMovedPast(run.baseBranch, run.worktreePath, run.ctx)) return null;
  progress.lastMergeError = `origin/${run.baseBranch} moved on while the scenarios were re-run`;
  log(`${progress.lastMergeError}, so the next attempt brings it in and runs them again`, 'warn');
  return RETRY;
}

async function askForgeToMerge(run: MergeRun, progress: Progress, attempt: number): Promise<AttemptEnd> {
  const { prNumber, baseBranch } = run;
  const step = await mergeWithStaleRetry(prNumber, run.codeHost, baseBranch, run.worktreePath, run.ctx, run.wait);
  progress.mergeAttempts += step.mergeAttempts;
  if (step.kind === 'merged') {
    log(`PR #${prNumber} merged successfully on attempt ${attempt}`, 'success');
    return MERGED;
  }

  progress.lastMergeError = step.error;
  progress.localMergeCheck = step.localMergeCheck;
  if (step.kind === 'stale_retries_exhausted') {
    log(`PR #${prNumber} is still refused after ${STALE_MERGE_RETRY_DELAYS_MS.length} stale-mergeability retries, with a ${step.localMergeCheck} local merge check — stopping`, 'error');
    return GIVE_UP;
  }
  const found = step.kind === 'base_moved' ? `commits on origin/${baseBranch} that the branch lacks` : `conflicts with origin/${baseBranch}`;
  log(`Local merge check found ${found} after the failed merge on attempt ${attempt}, retrying`, 'warn');
  return RETRY;
}

/**
 * Check the local merge → bring the base in → push → re-run the scenarios on what came in → ask the forge to merge. The forge is
 * asked only for a branch that holds the base tip fetched last and whose scenarios passed after the base was last brought in.
 */
async function runAttempt(run: MergeRun, progress: Progress, attempt: number): Promise<AttemptEnd> {
  const { baseBranch, worktreePath, ctx } = run;
  progress.localMergeCheck = checkLocalMerge(baseBranch, worktreePath, ctx);
  const hasConflicts = progress.localMergeCheck === 'conflicts';
  progress.conflictResolutionRan = progress.conflictResolutionRan || hasConflicts;

  // A base that cannot be fetched is not brought in: nothing is known of what it holds.
  const integration: BaseIntegration =
    progress.localMergeCheck === 'unavailable'
      ? { kind: 'current' }
      : await bringBaseIn({ attempt, hasConflicts, adwId: run.adwId, specPath: run.specPath, baseBranch, logsDir: run.logsDir, cwd: worktreePath, ctx });
  if (integration.kind === 'unresolved') return RETRY;
  if (integration.kind === 'brought_in') progress.untested = combineMergedIn(progress.untested, integration);

  if (!pushBranchChanges(run.headBranch, worktreePath, ctx)) {
    log(`Push failed on attempt ${attempt}, retrying`, 'warn');
    return RETRY;
  }

  return (await proveMergedInBase(run, progress)) ?? askForgeToMerge(run, progress, attempt);
}

function outcomeOf(progress: Progress, result: Pick<MergeOutcome, 'success' | 'error' | 'postMergeRed'>): MergeOutcome {
  const { mergeAttempts, conflictResolutionRan, localMergeCheck } = progress;
  return { ...result, mergeAttempts, conflictResolutionRan, localMergeCheck };
}

/**
 * Core retry loop. A branch that lacks the base branch's tip gets the base merged in, pushed and proven by `rerunScenarios`
 * before the forge is asked to merge; a red proof ends the loop without a merge call. Stale refusals are asked again.
 */
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
  rerunScenarios: PostMergeScenarioRerun,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<MergeOutcome> {
  const run: MergeRun = { prNumber, codeHost, headBranch, baseBranch, worktreePath, adwId, logsDir, specPath, ctx: gitContext, rerunScenarios, wait };
  const progress: Progress = { mergeAttempts: 0, conflictResolutionRan: false, localMergeCheck: 'unavailable', lastMergeError: '', untested: null };

  syncWorktreeToOriginHead(headBranch, worktreePath, gitContext);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Auto-merge attempt ${attempt}/${maxAttempts} for PR #${prNumber}`, 'info');
    const end = await runAttempt(run, progress, attempt);
    if (end.kind === 'merged') return outcomeOf(progress, { success: true });
    if (end.kind === 'red') {
      const error = `the scenarios failed on the branch merged with origin/${baseBranch}`;
      return outcomeOf(progress, { success: false, error, postMergeRed: end.postMergeRed });
    }
    if (end.kind === 'give_up') break;
  }

  return outcomeOf(progress, { success: false, error: progress.lastMergeError });
}
