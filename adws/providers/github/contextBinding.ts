/**
 * Case-insensitive owner/repo cross-check shared by the three GitHub port
 * factories — refuses a `GitContext` bound to a different repository than
 * the caller's declared `RepoIdentifier`. Mirrors `sameRepoIdentity` in
 * `adws/core/repoIdentityCrossCheck.ts`, which the adapter cannot import.
 * `platform` is deliberately not compared.
 */

import type { GitContext } from '../../gitContext';
import type { RepoIdentifier } from '../types';

export function assertContextBoundTo(
  ctx: Pick<GitContext, 'owner' | 'repo'>,
  repoId: RepoIdentifier,
  factoryName: string,
): void {
  const sameOwner = ctx.owner.toLowerCase() === repoId.owner.toLowerCase();
  const sameRepo = ctx.repo.toLowerCase() === repoId.repo.toLowerCase();
  if (sameOwner && sameRepo) return;

  throw new Error(
    `${factoryName}: GitContext is bound to ${ctx.owner}/${ctx.repo} but repoId names ${repoId.owner}/${repoId.repo}`,
  );
}
