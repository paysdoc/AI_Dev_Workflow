/**
 * What a manifest may not write. A manifest stands in for what an agent leaves in the worktree, so
 * it must never produce what a Then step reads as the system's own output: the top-level state
 * file, anything under `agents/`, or anything beyond the worktree, which is how a manifest would
 * reach the checkout's own `agents/`. Pure: no I/O.
 */

import { relative, resolve, sep } from 'path';
import type { Manifest } from './manifestSchema.ts';

const STATE_FILE = '.adw/state.json';
const AGENTS_DIR = 'agents';

export class ManifestRefusalError extends Error {
  readonly refusedPaths: readonly string[];

  constructor(manifestPath: string, refusedPaths: readonly string[]) {
    super(
      `manifestInterpreter: refused manifest at ${manifestPath}: it would write ${refusedPaths.join(', ')}, which a Then step reads as the system's output`,
    );
    this.name = 'ManifestRefusalError';
    this.refusedPaths = refusedPaths;
  }
}

/** POSIX and relative to the worktree, with `..` leading a path that lies outside it. */
function relativeToWorktree(declared: string, worktreePath: string): string {
  return relative(worktreePath, resolve(worktreePath, declared)).split(sep).join('/');
}

function isRefused(declared: string, worktreePath: string): boolean {
  const relativePath = relativeToWorktree(declared, worktreePath);
  if (relativePath === '..' || relativePath.startsWith('../')) return true;
  return relativePath === STATE_FILE || relativePath === AGENTS_DIR || relativePath.startsWith(`${AGENTS_DIR}/`);
}

function editPaths(edits: Manifest['edits'] | undefined): string[] {
  return (edits ?? []).map((edit) => edit.path);
}

/** Every path the manifest could write or remove, whichever prompt selects it. */
function declaredPaths(manifest: Pick<Manifest, 'edits' | 'deletes' | 'byCommand'>): string[] {
  const entries = Object.values(manifest.byCommand ?? {});
  return [...editPaths(manifest.edits), ...(manifest.deletes ?? []), ...entries.flatMap((entry) => editPaths(entry.edits))];
}

/** The declared spelling of each refused path, once, in declaration order. */
export function findRefusedPaths(
  manifest: Pick<Manifest, 'edits' | 'deletes' | 'byCommand'>,
  worktreePath: string,
): string[] {
  return [...new Set(declaredPaths(manifest).filter((declared) => isRefused(declared, worktreePath)))];
}
