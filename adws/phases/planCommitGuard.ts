import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { GitContext } from '@paysdoc/devplatform/git';
import { OrchestratorId, type IssueClassSlashCommand } from '../core';
import { parseUnifiedDiff, touchedPaths } from '../core/unifiedDiff';
import { buildCommitPrefix } from '../agents/gitAgent';

/** Prompts and project configuration: a plan may call for changing them, but the planner must not make the change. */
export const PLANNER_OFF_LIMITS_DIRS = ['.claude', '.adw'] as const;

export interface PlanPhaseBaseline {
  readonly head: string;
  /** POSIX path relative to the worktree → sha256 of the file's bytes, or of a symlink's target. */
  readonly offLimitsFiles: ReadonlyMap<string, string>;
}

export interface OffLimitsState {
  readonly offLimitsFiles: ReadonlyMap<string, string>;
  readonly committedPaths: readonly string[];
}

export function isOffLimitsToPlanner(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return PLANNER_OFF_LIMITS_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function isDirectory(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

// The scenario agent writes into the same worktree while the plan phase runs, so an entry can vanish mid-walk.
function listEntries(absoluteDir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

function hashEntry(absolutePath: string, entry: fs.Dirent): string | null {
  try {
    const bytes = entry.isSymbolicLink() ? Buffer.from(fs.readlinkSync(absolutePath)) : fs.readFileSync(absolutePath);
    return crypto.createHash('sha256').update(bytes).digest('hex');
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function collectHashes(worktreePath: string, relDir: string, into: Map<string, string>): void {
  for (const entry of listEntries(path.join(worktreePath, relDir))) {
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      collectHashes(worktreePath, relPath, into);
      continue;
    }
    const hash = entry.isFile() || entry.isSymbolicLink() ? hashEntry(path.join(worktreePath, relPath), entry) : null;
    if (hash !== null) into.set(relPath, hash);
  }
}

export function hashOffLimitsFiles(worktreePath: string): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();
  PLANNER_OFF_LIMITS_DIRS
    .filter((dir) => isDirectory(path.join(worktreePath, dir)))
    .forEach((dir) => collectHashes(worktreePath, dir, hashes));
  return hashes;
}

export function capturePlanPhaseBaseline(gitCtx: GitContext, worktreePath: string): PlanPhaseBaseline {
  return { head: gitCtx.headShort(worktreePath), offLimitsFiles: hashOffLimitsFiles(worktreePath) };
}

export function changedFilePaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const createdOrModified = [...after].filter(([file, hash]) => before.get(file) !== hash).map(([file]) => file);
  const deleted = [...before.keys()].filter((file) => !after.has(file));
  return [...new Set([...createdOrModified, ...deleted])].sort();
}

/**
 * A net tree difference: a path committed and then reverted within the phase leaves no trace here, nor in the hashes.
 * `GitContext.diff` hands its range to git as one argument, so there is no `--name-only`: the paths are read from the
 * patch, and a diff that holds text but no file header is refused rather than taken for an empty one.
 */
export function committedPathsSince(gitCtx: GitContext, worktreePath: string, head: string): string[] {
  const patch = gitCtx.diff(`${head}..HEAD`, worktreePath);
  const files = parseUnifiedDiff(patch);
  if (files.length === 0 && patch !== '') {
    throw new Error(`Plan phase guard: the diff since ${head} holds text but no file header, so the paths committed since then cannot be read`);
  }
  return files.flatMap(touchedPaths);
}

export function findOffLimitsChanges(baseline: PlanPhaseBaseline, current: OffLimitsState): string[] {
  const changed = changedFilePaths(baseline.offLimitsFiles, current.offLimitsFiles);
  const committed = current.committedPaths.filter(isOffLimitsToPlanner);
  return [...new Set([...changed, ...committed])].sort();
}

export class PlanCommitGuardError extends Error {
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    super(
      `Plan phase guard: the plan phase changed ${paths.length} path(s) under .claude/ or .adw/, which the planner must not touch (ADR-0056): ${paths.join(', ')}. ` +
        'The plan was not committed; a prompt or configuration change has to be a task in the plan, made by the build agent.',
    );
    this.name = 'PlanCommitGuardError';
    this.paths = paths;
  }
}

/**
 * Runs in the orchestrator process after the plan agent has exited, so the agent can neither
 * skip it nor route around it. Changes that predate the baseline, such as those worktree setup
 * leaves, are part of the baseline and do not trip it.
 */
export function assertPlanPhaseLeftOffLimitsAlone(
  gitCtx: GitContext,
  worktreePath: string,
  baseline: PlanPhaseBaseline,
): void {
  const offLimitsChanges = findOffLimitsChanges(baseline, {
    offLimitsFiles: hashOffLimitsFiles(worktreePath),
    committedPaths: committedPathsSince(gitCtx, worktreePath, baseline.head),
  });
  if (offLimitsChanges.length > 0) throw new PlanCommitGuardError(offLimitsChanges);
}

export function buildPlanCommitMessage(issueType: IssueClassSlashCommand, issueNumber: number): string {
  return `${buildCommitPrefix(OrchestratorId.Plan, issueType)}: add plan for issue #${issueNumber}`;
}

/**
 * Stages and commits `planFile` only, so every other change in the worktree — staged or
 * not — stays out of the plan commit. Returns false when the plan is already committed.
 */
export function commitPlanFileOnly(
  gitCtx: GitContext,
  worktreePath: string,
  planFile: string,
  message: string,
): boolean {
  if (!fs.existsSync(path.join(worktreePath, planFile))) {
    throw new Error(`Plan commit: expected the plan file at ${planFile} in ${worktreePath}, but it does not exist`);
  }
  return gitCtx.addAndCommitPaths([planFile], message, worktreePath);
}
