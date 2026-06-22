import type { RepoIdentity } from '../types/agentTypes';

export class RepoIdentityMismatchError extends Error {
  readonly launch: RepoIdentity;
  readonly persisted: RepoIdentity;
  constructor(launch: RepoIdentity, persisted: RepoIdentity) {
    super(
      `Repo identity mismatch: launch=${launch.owner}/${launch.repo} persisted=${persisted.owner}/${persisted.repo}. Launch boundary is authoritative; refusing to resume against a divergent repo.`,
    );
    this.name = 'RepoIdentityMismatchError';
    this.launch = launch;
    this.persisted = persisted;
  }
}

export function sameRepoIdentity(a: RepoIdentity, b: RepoIdentity): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}

export function crossCheckRepoIdentity(launch: RepoIdentity, persisted: RepoIdentity | undefined): void {
  if (!persisted) return;
  if (sameRepoIdentity(launch, persisted)) return;
  throw new RepoIdentityMismatchError(launch, persisted);
}
