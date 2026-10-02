/**
 * State shared by feature-934's step files, rebuilt before every scenario, and the two in-process
 * runs the scenarios drive: `runPromotionSweep` and `runPerIssueScenarioSweep`, both over a launch
 * boundary whose GitContext is bound to the cron host's checkout (a clone of the target) and whose
 * issue tracker and code host are the fakes of `feature-934-forge.ts`. Nothing reaches GitHub.
 */

import { After, Before } from '@cucumber/cucumber';
import { Platform } from '@paysdoc/devplatform';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';

import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { runPerIssueScenarioSweep } from '../../../adws/triggers/perIssueScenarioSweep.ts';
import { runPromotionSweep, type PromotionSweepReport } from '../../../adws/triggers/promotionSweep.ts';
import { createFakeForge, type FakeForge } from './feature-934-forge.ts';
import {
  createTarget,
  ensureHostCheckout,
  removeTarget,
  snapshotHost,
  type HostSnapshot,
  type Target,
} from './feature-934-target.ts';

interface World934 {
  target: Target | null;
  forge: FakeForge | null;
  /** The vocabulary registry path a Given configured; unset means the repository default. */
  vocabularyPath: string | null;
  /** The cron host's checkout as the promotion sweep found it. */
  hostAtStart: HostSnapshot | null;
  report: PromotionSweepReport | null;
  perIssueRemoved: string[] | null;
  nextPromotedFeature: number;
  historyFiles: number;
}

// Features promoted by the fixture's earlier promotion issues, far from any candidate's number.
const FIRST_PROMOTED_FEATURE = 7001;

function freshWorld(): World934 {
  return {
    target: null,
    forge: null,
    vocabularyPath: null,
    hostAtStart: null,
    report: null,
    perIssueRemoved: null,
    nextPromotedFeature: FIRST_PROMOTED_FEATURE,
    historyFiles: 0,
  };
}

export const world: World934 = freshWorld();

Before({ tags: '@adw-934' }, function () {
  Object.assign(world, freshWorld());
});

After({ tags: '@adw-934' }, function () {
  if (world.target) removeTarget(world.target);
  Object.assign(world, freshWorld());
});

export function startTarget(owner: string, repo: string, defaultBranch: string): void {
  world.target = createTarget(owner, repo, defaultBranch);
  world.forge = createFakeForge(world.target);
}

export function requireTarget(): Target {
  if (!world.target) throw new Error('Expected a promotion sweep target to have been set up first');
  return world.target;
}

export function requireForge(): FakeForge {
  if (!world.forge) throw new Error('Expected a promotion sweep target to have been set up first');
  return world.forge;
}

function buildBoundary(target: Target, forge: FakeForge): LaunchBoundary {
  const gitContext = new GitContext(
    {
      owner: target.owner,
      repo: target.repo,
      selfHost: false,
      tokenProvider: createLiteralTokenProvider('fixture-token'),
      gitIdentity: {
        authorName: 'ADW Fixture',
        authorEmail: 'adw-fixture@example.test',
        committerName: 'ADW Fixture',
        committerEmail: 'adw-fixture@example.test',
      },
      frameworkRepoRoot: process.cwd(),
      targetReposDir: target.hostsDir,
    },
    { logger: () => {} },
  );
  return {
    gitContext,
    repoId: { owner: target.owner, repo: target.repo, platform: Platform.GitHub },
    providers: { issueTracker: forge.issueTracker, codeHost: forge.codeHost },
  };
}

/** Takes the cron host's checkout if no Given has yet, notes how it stands, and runs the sweep over it. */
export async function runPromotionSweepOnTarget(): Promise<void> {
  const target = requireTarget();
  ensureHostCheckout(target);
  world.hostAtStart = snapshotHost(target);
  world.report = await runPromotionSweep({ boundary: buildBoundary(target, requireForge()) });
}

export async function runPerIssueSweepOnTarget(): Promise<void> {
  const target = requireTarget();
  ensureHostCheckout(target);
  world.perIssueRemoved = await runPerIssueScenarioSweep({ boundary: buildBoundary(target, requireForge()) });
}
