import * as path from 'path';
import type { GitContext } from '@paysdoc/devplatform/git';
import { runClaudeAgentWithCommand } from '../agents';
import { log } from '../core';
import { getEffortForCommand, getModelForCommand } from '../core/modelRouting';
import type { MergedInBase } from '../core/postMergeVerdict';
import { isSelfHostLaunch } from '../core/selfHostLaunch';

export type BaseIntegration =
  | { readonly kind: 'current' }
  | ({ readonly kind: 'brought_in' } & MergedInBase)
  | { readonly kind: 'unresolved' };

export interface BringBaseInRun {
  readonly attempt: number;
  /** Whether the local merge check found conflicts, so that the merge goes through `/resolve_conflict`. */
  readonly hasConflicts: boolean;
  readonly adwId: string;
  readonly specPath: string;
  readonly baseBranch: string;
  readonly logsDir: string;
  readonly cwd: string;
  readonly ctx: GitContext;
}

interface ConflictResolution {
  readonly resolved: boolean;
  readonly conflictedFiles: readonly string[];
}

const CURRENT: BaseIntegration = { kind: 'current' };
const UNRESOLVED: BaseIntegration = { kind: 'unresolved' };
const DAY_MS = 24 * 60 * 60 * 1000;

const linesOf = (text: string): string[] => text.split('\n').filter((line) => line !== '');

/** The commits of origin/<base> that `ref` lacks, as `<author date> <subject>` lines; merge commits are left out. */
export function commitsMissingFrom(ref: string, baseBranch: string, cwd: string, ctx: GitContext): string[] {
  try {
    return linesOf(ctx.log(`${ref}..origin/${baseBranch}`, cwd));
  } catch (error) {
    log(`Failed to list the commits of origin/${baseBranch} that ${ref} lacks: ${error}`, 'warn');
    return [];
  }
}

function onelineLogSince(since: string, cwd: string, ctx: GitContext): string[] {
  try {
    return linesOf(ctx.logSince({ since, oneline: true }, cwd));
  } catch (error) {
    log(`Failed to read the commit log since ${since}: ${error}`, 'warn');
    return [];
  }
}

/**
 * `GitContext` has no range `--oneline` read, so the commits a merge brought in are the difference between two `logSince`
 * reads, one just before the merge and one just after it. That difference is what `git log --oneline <old head>..origin/<base>`
 * prints, merge commits left out. `--since` filters on committer dates, which are normally at or after author dates; the
 * day of slack before the earliest pending author date absorbs small clock skew.
 */
function windowStart(pending: readonly string[]): string | null {
  const authored = pending.map((line) => Date.parse(line.split(' ')[0] ?? '')).filter((time) => !Number.isNaN(time));
  if (authored.length === 0) return null;
  return new Date(Math.min(...authored) - DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function headOf(cwd: string, ctx: GitContext): string | null {
  try {
    return ctx.headShort(cwd);
  } catch (error) {
    log(`Failed to read HEAD: ${error}`, 'warn');
    return null;
  }
}

/**
 * The worktree was reset to origin/<head> before the merge, so during a conflicted merge the only paths whose working tree
 * differs from the index are the unmerged ones; `GitContext` has no unmerged-paths read. Git prints an unmerged path more than
 * once (a modify/modify conflict lists it twice), so each is kept once.
 */
function conflictedPaths(cwd: string, ctx: GitContext): string[] {
  try {
    return [...new Set(linesOf(ctx.diff('--name-only', cwd)))];
  } catch (error) {
    log(`Failed to read the conflicted files: ${error}`, 'warn');
    return [];
  }
}

/** Starts a real merge (with conflict markers), then hands what is left to the /resolve_conflict agent. */
async function resolveConflictsViaAgent(
  adwId: string,
  specPath: string,
  baseBranch: string,
  logsDir: string,
  cwd: string,
  ctx: GitContext,
): Promise<ConflictResolution> {
  try {
    ctx.fetchRemote(baseBranch, cwd);
    ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noEdit: true });
    log(`Merge from origin/${baseBranch} succeeded cleanly — no agent resolution needed`, 'info');
    return { resolved: true, conflictedFiles: [] };
  } catch {
    // Expected when conflicts exist — agent will resolve them
  }

  const conflictedFiles = conflictedPaths(cwd, ctx);
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
    { selfHost: isSelfHostLaunch(ctx), adwId, gitContext: ctx },
  );

  if (result.success) {
    log(`Conflict resolution agent succeeded`, 'success');
  } else {
    log(`Conflict resolution agent failed: ${result.output.substring(0, 200)}`, 'error');
  }

  return { resolved: result.success, conflictedFiles };
}

async function resolveConflictsForAttempt(run: BringBaseInRun): Promise<ConflictResolution> {
  const { attempt, adwId, specPath, baseBranch, logsDir, cwd, ctx } = run;
  log(`Merge conflicts detected on attempt ${attempt}, invoking /resolve_conflict`, 'info');
  const resolution = await resolveConflictsViaAgent(adwId, specPath, baseBranch, logsDir, cwd, ctx);
  if (!resolution.resolved) log(`Conflict resolution failed on attempt ${attempt}, retrying`, 'warn');
  return resolution;
}

function mergeBaseCleanly({ baseBranch, cwd, ctx }: BringBaseInRun): ConflictResolution {
  try {
    ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noEdit: true });
    return { resolved: true, conflictedFiles: [] };
  } catch (error) {
    ctx.abortMerge(cwd);
    log(`Merging origin/${baseBranch}, which the local merge check found clean, failed: ${error}`, 'error');
    return { resolved: false, conflictedFiles: [] };
  }
}

function mergeBaseIn(run: BringBaseInRun): Promise<ConflictResolution> | ConflictResolution {
  return run.hasConflicts ? resolveConflictsForAttempt(run) : mergeBaseCleanly(run);
}

/**
 * Merges origin/<base> into the branch. Whether the branch already held the tip is read off HEAD, since git leaves HEAD alone
 * exactly when the tip is already in it. A HEAD that cannot be read after the merge counts as moved: a re-run that was not
 * needed costs time, a merge that skipped a needed one lands code no scenario ran on.
 */
export async function bringBaseIn(run: BringBaseInRun): Promise<BaseIntegration> {
  const { baseBranch, cwd, ctx } = run;
  const before = headOf(cwd, ctx);
  if (before === null) return UNRESOLVED;

  const since = windowStart(commitsMissingFrom('HEAD', baseBranch, cwd, ctx));
  const listedBefore = since === null ? [] : onelineLogSince(since, cwd, ctx);

  const merge = await mergeBaseIn(run);
  if (!merge.resolved) return UNRESOLVED;
  if (headOf(cwd, ctx) === before) return CURRENT;

  const alreadyListed = new Set(listedBefore);
  const mergedCommits = since === null ? [] : onelineLogSince(since, cwd, ctx).filter((line) => !alreadyListed.has(line));
  return { kind: 'brought_in', mergedCommits, conflictedFiles: merge.conflictedFiles };
}

/** Whether origin/<base>, fetched afresh, holds commits that HEAD lacks. A fetch that fails is no evidence that it does. */
export function baseMovedPast(baseBranch: string, cwd: string, ctx: GitContext): boolean {
  try {
    ctx.fetchRemote(baseBranch, cwd);
  } catch (error) {
    log(`Failed to fetch origin/${baseBranch} to see whether it moved on: ${error}`, 'warn');
    return false;
  }
  return commitsMissingFrom('HEAD', baseBranch, cwd, ctx).length > 0;
}
