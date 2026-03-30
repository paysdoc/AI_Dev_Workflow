/**
 * Cron repo identity resolution.
 *
 * Extracted from trigger_cron.ts so the logic is testable without
 * triggering the cron's module-level side effects (setInterval, process guard).
 */

import type { RepoInfo } from '../github/githubApi';
import type { TargetRepoInfo } from '../types/issueTypes';
import { parseTargetRepoArgs } from '../core/orchestratorCli';

export interface CronRepoResolution {
  repoInfo: RepoInfo;
  targetRepo: TargetRepoInfo | null;
}

/**
 * Resolves the cron process repo identity from CLI args.
 * When `--target-repo` is present, uses that; otherwise calls `fallback`.
 */
export function resolveCronRepo(args: string[], fallback: () => RepoInfo): CronRepoResolution {
  const argsCopy = [...args];
  const targetRepo = parseTargetRepoArgs(argsCopy);
  if (targetRepo) {
    return {
      repoInfo: { owner: targetRepo.owner, repo: targetRepo.repo },
      targetRepo,
    };
  }
  return { repoInfo: fallback(), targetRepo: null };
}

/**
 * Builds `--target-repo` / `--clone-url` args to pass to spawned workflows.
 *
 * @param repoInfo     - The resolved repo identity for this cron process.
 * @param targetRepo   - Parsed --target-repo info (if any).
 * @param fallbackCloneUrl - Called when targetRepo is null to obtain a clone URL (e.g. from local git remote).
 */
export function buildCronTargetRepoArgs(
  repoInfo: RepoInfo,
  targetRepo: TargetRepoInfo | null,
  fallbackCloneUrl: () => string | null,
): string[] {
  const fullName = `${repoInfo.owner}/${repoInfo.repo}`;
  const cloneUrl = targetRepo?.cloneUrl ?? fallbackCloneUrl();
  return cloneUrl
    ? ['--target-repo', fullName, '--clone-url', cloneUrl]
    : ['--target-repo', fullName];
}
