/**
 * Post-removal gate for the per-issue scenario sweep. A removal batch lands only
 * when the tree it leaves behind passes the repo's own static checks, run in the
 * sweep worktree before anything is committed:
 *
 * 1. Candidates a surviving file still imports are kept (see sweepImportGraph).
 * 2. The untouched base is checked (install + static checks). A red base skips the
 *    batch: the sweep did not break it and cannot be blamed for it.
 * 3. The removals are applied to the working tree and the checks run again.
 * 4. A red result whose every failure is a missing module pointing at a removed
 *    file is repaired by restoring those files and re-checking, up to
 *    MAX_REPAIR_ROUNDS times.
 * 5. Anything else is a hard fail: every removal is restored and nothing lands.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CheckStatus,
  loadProjectConfig,
  runBaselineChecks,
  runShellCommand,
  runStaticChecks,
  type BaselineVerdict,
  type CheckVerdict,
  type LogLevel,
} from '../core';
import { isScannedSource, pruneImportedRemovals, removedFilesReportedMissing } from './sweepImportGraph';

export const MAX_REPAIR_ROUNDS = 3;

export type RemovalGateOutcome =
  | { readonly kind: 'verified'; readonly removed: readonly string[]; readonly kept: readonly string[] }
  | { readonly kind: 'base_red'; readonly detail: string }
  | { readonly kind: 'hard_fail'; readonly detail: string };

export interface RemovalGateDeps {
  /** Every tracked file in the worktree, repo-relative. */
  readonly listTrackedFiles: () => readonly string[];
  readonly readSource: (filePath: string) => string | null;
  readonly checkBase: () => Promise<BaselineVerdict>;
  readonly runChecks: () => Promise<readonly CheckVerdict[]>;
  /** Deletes a file from the working tree, remembering it so `restoreFile` can put it back. */
  readonly deleteFile: (filePath: string) => void;
  readonly restoreFile: (filePath: string) => void;
  readonly log: (msg: string, level?: LogLevel) => void;
}

const LABEL = 'perIssueScenarioSweep gate';

function readScannedSources(deps: RemovalGateDeps): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of deps.listTrackedFiles()) {
    if (!isScannedSource(file)) continue;
    const content = deps.readSource(file);
    if (content !== null) sources.set(file, content);
  }
  return sources;
}

function failedOutput(verdicts: readonly CheckVerdict[]): string | null {
  const failed = verdicts.filter(verdict => verdict.status === CheckStatus.Failed);
  if (failed.length === 0) return null;
  return failed.map(verdict => `[${verdict.check}] ${verdict.command} (exit ${verdict.exitCode ?? 'none'})\n${verdict.output}`).join('\n');
}

function describeBase(verdict: BaselineVerdict): string {
  if (verdict.kind === 'checks_red') return verdict.failed.map(failure => `${failure.check}: ${failure.command} (exit ${failure.exitCode ?? 'none'})`).join('; ');
  if (verdict.kind === 'server_down') return 'dev server down';
  return 'green';
}

function restoreAll(files: Iterable<string>, deps: RemovalGateDeps): void {
  for (const file of files) deps.restoreFile(file);
}

export async function verifyRemoval(candidates: readonly string[], deps: RemovalGateDeps): Promise<RemovalGateOutcome> {
  const { remove, keep } = pruneImportedRemovals(candidates, readScannedSources(deps));
  if (keep.length > 0) deps.log(`${LABEL}: keeping ${keep.length} file(s) still imported by surviving code: ${keep.join(', ')}`, 'info');
  if (remove.length === 0) return { kind: 'verified', removed: [], kept: keep };

  const base = await deps.checkBase();
  if (base.kind !== 'green') return { kind: 'base_red', detail: describeBase(base) };

  const removed = new Set(remove);
  const kept = [...keep];
  for (const file of removed) deps.deleteFile(file);

  for (let round = 0; ; round++) {
    const output = failedOutput(await deps.runChecks());
    if (output === null) return { kind: 'verified', removed: remove.filter(file => removed.has(file)), kept };

    const restore = removedFilesReportedMissing(output, removed);
    if (restore === null || restore.length === 0 || round >= MAX_REPAIR_ROUNDS) {
      restoreAll(removed, deps);
      const why = round >= MAX_REPAIR_ROUNDS ? `still red after ${MAX_REPAIR_ROUNDS} repair round(s)` : 'a failure the sweep cannot repair by restoring files';
      return { kind: 'hard_fail', detail: `${why}\n${output}` };
    }

    deps.log(`${LABEL}: repair round ${round + 1} — restoring ${restore.length} removed file(s) still imported: ${restore.join(', ')}`, 'warn');
    for (const file of restore) {
      deps.restoreFile(file);
      removed.delete(file);
      kept.push(file);
    }
  }
}

/** Real collaborators bound to the sweep worktree: tracked files via `listTrackedFiles`, the repo's own `.adw/commands.md` checks. */
export function worktreeGateDeps(
  worktreePath: string,
  listTrackedFiles: () => readonly string[],
  log: (msg: string, level?: LogLevel) => void,
): RemovalGateDeps {
  const commands = loadProjectConfig(worktreePath).commands;
  const saved = new Map<string, { content: Buffer; mode: number }>();
  const absolute = (filePath: string): string => path.join(worktreePath, filePath);

  return {
    listTrackedFiles,
    readSource: (filePath) => {
      try {
        return fs.readFileSync(absolute(filePath), 'utf-8');
      } catch {
        return null;
      }
    },
    checkBase: () => runBaselineChecks({ commands, cwd: worktreePath, runProcess: runShellCommand }),
    runChecks: () => runStaticChecks(commands, worktreePath, runShellCommand),
    deleteFile: (filePath) => {
      const file = absolute(filePath);
      saved.set(filePath, { content: fs.readFileSync(file), mode: fs.statSync(file).mode });
      fs.rmSync(file);
    },
    restoreFile: (filePath) => {
      const entry = saved.get(filePath);
      if (!entry) return;
      fs.writeFileSync(absolute(filePath), entry.content, { mode: entry.mode });
      saved.delete(filePath);
    },
    log,
  };
}
