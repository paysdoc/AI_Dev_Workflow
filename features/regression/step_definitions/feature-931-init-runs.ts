/**
 * What the stubbed "/adw_init" agent of feature-931's upgrade harness found in its worktree, run by run: the files of ".adw/" as
 * they stood before the agent wrote any. Runs are kept by worktree, and a scenario's worktree is a directory of its own, so no
 * run of an earlier scenario is ever read. No hooks and no steps: any step file may import it.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The content of each file of ".adw/" the agent found, by path from the repository's root. */
export type AdwFilesFound = Readonly<Record<string, string>>;

const runsByWorktree = new Map<string, AdwFilesFound[]>();

export function recordInitRun(worktreePath: string): void {
  const adwDir = path.join(worktreePath, '.adw');
  const files = fs.existsSync(adwDir) ? fs.readdirSync(adwDir, { withFileTypes: true }).filter(entry => entry.isFile()) : [];
  const found = Object.fromEntries(files.map(({ name }) => [`.adw/${name}`, fs.readFileSync(path.join(adwDir, name), 'utf-8')]));
  runsByWorktree.set(worktreePath, [...(runsByWorktree.get(worktreePath) ?? []), found]);
}

/** What the agent found in each of its runs in the worktree, in order. */
export function initRunsIn(worktreePath: string): readonly AdwFilesFound[] {
  return runsByWorktree.get(worktreePath) ?? [];
}
