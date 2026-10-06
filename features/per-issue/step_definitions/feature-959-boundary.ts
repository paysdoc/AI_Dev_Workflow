/**
 * What the cron rows do to feature-796's recording boundary: a take-over never runs git against
 * fixture paths, and the poll can be interrupted between the cron's filter and its take-over
 * decision.
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type { IssueTracker, RepoIdentifier } from '@paysdoc/devplatform';
import type { GitContext } from '@paysdoc/devplatform/git';

import { world796 } from '../../regression/step_definitions/feature-796.steps.ts';
import { requireBoundary } from '../../regression/step_definitions/feature-932-world.ts';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { readLocalRepoIdentity } from '../../../adws/core/localRepoIdentity.ts';
import { getSpawnLockFilePath } from '../../../adws/triggers/spawnGate.ts';
import { s } from './feature-959-world.ts';

function branchOfWorktree(real: GitContext, worktreePath: string): string | null {
  const match = [...s.workflows.values()].find((workflow) => real.worktreePathFor(workflow.branchName) === worktreePath);
  return match?.branchName ?? null;
}

/**
 * Resets are recorded and do nothing else; the worktree probe and the remote-branch read behind
 * `deriveStageFromRemote` get benign answers. A take-over that threw half-way would leave a lock
 * under this process's pid, which is the bug itself, and spoil later rows. A PR review's worktree
 * is located, never created.
 */
export function useBenignGitContext(): LaunchBoundary {
  const boundary = requireBoundary();
  if (s.boundaryWrapped) return boundary;

  const real = boundary.gitContext;
  s.gitDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-959-gitdir-'));
  s.tempDirs.push(s.gitDir);

  const benignAnswers = new Map<string | symbol, unknown>([
    ['resetWorktree', (worktreePath: string, branch: string) => { s.resets.push({ worktreePath, branch }); }],
    ['resolveGitDir', () => s.gitDir],
    ['currentBranchSymbolic', (worktreePath: string) => branchOfWorktree(real, worktreePath)],
    ['worktreeRegistration', () => 'healthy'],
    ['lsRemote', () => ''],
    ['ensureWorktree', (branch: string) => real.worktreePathFor(branch)],
  ]);
  const gitContext = new Proxy(real, {
    get(target, prop) {
      if (benignAnswers.has(prop)) return benignAnswers.get(prop);
      // The target is the receiver, too: `owner` and `repo` are getters over private fields, which a Proxy `this` cannot read.
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const wrapped: LaunchBoundary = {
    gitContext,
    repoId: boundary.repoId,
    get providers() {
      return boundary.providers;
    },
  };
  world796().boundary = wrapped;
  s.boundaryWrapped = true;
  return wrapped;
}

/**
 * `checkIssueEligibility` asks the recording tracker for the concurrency check's issue listing
 * after the poll's filter has run and before the take-over handler reads the state, which makes the
 * listing a hook between the two. The cron's own listing asks for labels; the concurrency check's
 * does not.
 */
export function fireOnceBetweenFilterAndDecision(trigger: () => void): void {
  const tracker = requireBoundary().providers.issueTracker as { listIssues: IssueTracker['listIssues'] };
  const listIssues = tracker.listIssues.bind(tracker);
  let cronListingSeen = false;
  s.triggerArmed = true;
  tracker.listIssues = (query) => {
    const issues = listIssues(query);
    if (query.fields.includes('labels')) {
      cronListingSeen = true;
    } else if (cronListingSeen && !s.triggerFired) {
      s.triggerFired = true;
      trigger();
    }
    return issues;
  };
}

/** The lock is keyed by repository: evaluateCandidate by the boundary's, the cron's own release by the cron module's. */
export function spawnLockIdentities(): RepoIdentifier[] {
  const { boundary } = world796();
  const identities = boundary ? [boundary.repoId] : [];
  try {
    return [...identities, readLocalRepoIdentity()];
  } catch {
    return identities;
  }
}

export function removeSpawnLocks(): void {
  for (const identity of spawnLockIdentities()) {
    for (const issueNumber of s.issues) fs.rmSync(getSpawnLockFilePath(identity, issueNumber), { force: true });
  }
}
