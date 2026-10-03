/**
 * Lands a pull request the way GitHub does when it merges one. The shadow's forge has no git behind
 * it, so a merge only marks the pull request merged. A run whose repository stands in for the
 * remote needs more: the default branch must move to the head of the merged branch, and the
 * remote-tracking ref with it, or what the merge carried never reaches the branch the run's own
 * readers look at. The head branch is read from the pull request, so a merge lands even when the
 * process that made it deletes the branch straight afterwards.
 *
 * The repository must be on the pull request's base branch and the merge must fast-forward; a merge
 * that cannot land fails the call with a message, persisting and logging nothing, as a merge GitHub
 * refuses would. Opt-in: the shadow lands a merge only when `ADW_GH_LAND_PATH` names the repository.
 */

import { execFileSync } from 'child_process';

import { fail, type GhOutcome } from './ghShadowArgs.ts';
import type { GhPullRequest } from './ghShadowState.ts';

/** Runs git in one repository and returns its trimmed output; throws when git fails. */
export type GitRunner = (...args: string[]) => string;

const MERGE_PATH = /\/pulls\/(\d+)\/merge$/;

/** The real binary, as every fixture git call: under the git mock, a plain `git` may be a shadow. */
export function gitIn(repositoryPath: string): GitRunner {
  return (...args) => execFileSync(process.env['REAL_GIT_PATH'] ?? 'git', args, { cwd: repositoryPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** The merged pull request of a `pr merge` that changed the shadow's forge, and nothing for any other call. */
function mergedPullRequest(outcome: GhOutcome): GhPullRequest | undefined {
  const request = outcome.log?.request;
  if (outcome.exitCode !== 0 || request?.method !== 'PUT') return undefined;
  const number = MERGE_PATH.exec(request.path)?.[1];
  return number === undefined ? undefined : outcome.state?.pullRequests[number];
}

function land(git: GitRunner, { headRefName, baseRefName }: GhPullRequest): void {
  const current = git('symbolic-ref', '--short', 'HEAD');
  if (current !== baseRefName) throw new Error(`the repository is on "${current}", not on "${baseRefName}"`);
  git('merge', '--ff-only', '--quiet', headRefName);
  git('update-ref', `refs/remotes/origin/${baseRefName}`, baseRefName);
}

export function landMergedPullRequest(outcome: GhOutcome, git: GitRunner): GhOutcome {
  const pullRequest = mergedPullRequest(outcome);
  if (!pullRequest) return outcome;

  try {
    land(git, pullRequest);
    return outcome;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return fail(`gh shadow: could not land pull request #${pullRequest.number} (${pullRequest.headRefName} into ${pullRequest.baseRefName}): ${cause}`);
  }
}
