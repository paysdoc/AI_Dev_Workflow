/**
 * Step definitions for feature-758.feature
 *
 * Drives the REAL persistRemovalViaPr git flow (worktree creation, commit,
 * push) against a real temp git repo whose `origin` is a real bare remote
 * (local, no network) — the same real-git construction feature-735.steps.ts /
 * feature-739.steps.ts use. Only the gh-backed seams (findOpenSweepPr, openPr,
 * mergePr) and the default-branch name (which production resolves via
 * `gh repo view`) are faked; every git worktree/commit/push operation is real,
 * so the RED/GREEN signal comes from the real sync/branch/PR persistence code,
 * never a hand-mirrored stand-in.
 *
 * Self-contained module-private `ctx` per the feature file's step-definition
 * note — does NOT reach into feature-735's / feature-739's sweep step defs.
 *
 * Step phrases introduced here (novel for 758; see feature-758.feature's
 * "Vocabulary note" for the full gap list):
 *  - Given  "a per-issue scenario for issue {int} whose linked PR merged {int} days ago is committed on origin's default branch"
 *  - Given  "the cron host's local default branch is behind origin by a commit it has never fetched"
 *  - Given  "the cron host's local default branch is up to date with origin"
 *  - Given  "the push of the sweep's removal to origin will be rejected"
 *  - Given  "the sweep's first push of the removal to origin will be rejected"
 *  - When   "the per-issue scenario sweep runs on the cron host"
 *  - Then   "origin carries a sweep branch that omits the per-issue scenario for issue {int}"
 *  - Then   "the sweep branch on origin includes the origin commit the cron host had not fetched"
 *  - Then   "the cron host's local default branch carries no commit absent from origin's default branch"
 *  - Then   "origin's default branch tip is unchanged by the sweep"
 *  - Then   "a pull request is opened from the sweep branch into the default branch"
 *  - Then   "the sweep reports the push failure as an error"
 *
 * Registered phrases reused (not redefined here):
 *  - Given  "the ADW codebase is checked out"       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then   "the ADW TypeScript type-check passes"  → feature-504.steps.ts (T22)
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions } from '../../../adws/gitContext/types.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';
import { runPerIssueScenarioSweep } from '../../../adws/triggers/perIssueScenarioSweep.ts';
import { persistRemovalViaPr, SWEEP_BRANCH, type SweepBase } from '../../../adws/triggers/perIssueSweepPersist.ts';
import { Platform, type CodeHost, type BoundProviders } from '../../../adws/providers/types.ts';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';

/**
 * Every `runPerIssueScenarioSweep` call in this file fully overrides
 * `listFeatures`/`getMergedAt`/`listStepDefSiblings`/`readFeatureContent`/`persistRemoval`,
 * so `deps.boundary` is never dereferenced — this stand-in only needs to satisfy the type.
 */
function fakeBoundary(gitCtx: GitContext): LaunchBoundary {
  return {
    gitContext: gitCtx,
    repoId: { owner: 'test', repo: 'test', platform: Platform.GitHub },
    providers: {} as unknown as BoundProviders,
  };
}

const DAY_MS = 86_400_000;
const FIXED_NOW = new Date('2026-07-01T00:00:00Z');
const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;

function featureRelPath(issueNum: number): string {
  return `features/per-issue/feature-${issueNum}.feature`;
}

function siblingRelPath(issueNum: number): string {
  return `features/per-issue/step_definitions/feature-${issueNum}.steps.ts`;
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'adw-758-'));
}

/**
 * GitContext subclass allowing a per-instance push-failure injection — the
 * ONLY faked git seam, used to deterministically reproduce a rejected push.
 * Every other operation (worktree creation, commit, real push) is the real
 * GitContext implementation.
 */
class InjectablePushGitContext extends GitContext {
  readonly #shouldThrow: () => boolean;

  constructor(opts: GitContextOptions, shouldThrow: () => boolean) {
    super(opts);
    this.#shouldThrow = shouldThrow;
  }

  override pushBranch(branch: string, cwd: string): void {
    if (this.#shouldThrow()) {
      throw new Error('stale info; remote ref updated since checkout (injected for @adw-758)');
    }
    super.pushBranch(branch, cwd);
  }
}

function makeFixtureCtx(workdir: string, shouldThrowPush: () => boolean): GitContext {
  const opts: GitContextOptions = {
    owner: 'test', repo: 'test', selfHost: true,
    tokenProvider: createLiteralTokenProvider('dummy-token-local-test'),
    gitIdentity: { authorName: 'ADW Test', authorEmail: 'test@adw.test', committerName: 'ADW Test', committerEmail: 'test@adw.test' },
    frameworkRepoRoot: workdir, targetReposDir: tmpdir(),
  };
  return new InjectablePushGitContext(opts, shouldThrowPush);
}

function listFixtureFeatures(gitCtx: GitContext, worktreePath: string): string[] {
  return gitCtx.lsFiles(worktreePath, 'features/per-issue').filter(p => FEATURE_FILENAME_RE.test(p.split('/').pop() ?? ''));
}

function listFixtureStepDefSiblings(gitCtx: GitContext, worktreePath: string, issueNum: number): string[] {
  return gitCtx
    .lsFiles(worktreePath, 'features/per-issue/step_definitions')
    .filter(p => (p.split('/').pop() ?? '').startsWith(`feature-${issueNum}.`));
}

interface SweepCtx {
  bareRemote: string;
  hostWorkdir: string;
  advancerWorkdir: string;
  defaultBranchName: string;
  mergedAtByIssue: Map<number, Date>;
  advancedCommitSha: string;
  originDefaultShaAtWhenStart: string;
  sweepRunCount: number;
  pushFailureMode: 'none' | 'always' | 'first-only';
  openPrCalls: Array<{ head: string; base: string }>;
  mergePrCalls: number[];
  logEntries: Array<{ msg: string; level?: string }>;
}

const ctx: SweepCtx = {
  bareRemote: '',
  hostWorkdir: '',
  advancerWorkdir: '',
  defaultBranchName: '',
  mergedAtByIssue: new Map(),
  advancedCommitSha: '',
  originDefaultShaAtWhenStart: '',
  sweepRunCount: 0,
  pushFailureMode: 'none',
  openPrCalls: [],
  mergePrCalls: [],
  logEntries: [],
};

After({ tags: '@adw-758' }, function () {
  if (ctx.bareRemote) rmSync(ctx.bareRemote, { recursive: true, force: true });
  if (ctx.hostWorkdir) rmSync(ctx.hostWorkdir, { recursive: true, force: true });
  if (ctx.advancerWorkdir) rmSync(ctx.advancerWorkdir, { recursive: true, force: true });
  ctx.bareRemote = '';
  ctx.hostWorkdir = '';
  ctx.advancerWorkdir = '';
  ctx.defaultBranchName = '';
  ctx.mergedAtByIssue.clear();
  ctx.advancedCommitSha = '';
  ctx.originDefaultShaAtWhenStart = '';
  ctx.sweepRunCount = 0;
  ctx.pushFailureMode = 'none';
  ctx.openPrCalls = [];
  ctx.mergePrCalls = [];
  ctx.logEntries = [];
});

// ── Given — repository setup ───────────────────────────────────────────────────

Given(
  "a per-issue scenario for issue {int} whose linked PR merged {int} days ago is committed on origin's default branch",
  function (issueNum: number, daysAgoNum: number) {
    ctx.bareRemote = makeWorkdir();
    ctx.hostWorkdir = makeWorkdir();

    git('git init --bare', ctx.bareRemote);
    git(`git clone "${ctx.bareRemote}" .`, ctx.hostWorkdir);
    git('git config user.email "adw@test.local"', ctx.hostWorkdir);
    git('git config user.name "ADW Test"', ctx.hostWorkdir);

    mkdirSync(join(ctx.hostWorkdir, 'features', 'per-issue', 'step_definitions'), { recursive: true });

    ctx.mergedAtByIssue.set(issueNum, new Date(FIXED_NOW.getTime() - daysAgoNum * DAY_MS));

    writeFileSync(
      join(ctx.hostWorkdir, featureRelPath(issueNum)),
      `Feature: per-issue scenario for issue ${issueNum}\n\n  Scenario: placeholder\n    Given a thing\n`,
    );
    writeFileSync(join(ctx.hostWorkdir, siblingRelPath(issueNum)), `// step definitions for issue ${issueNum}\n`);

    git('git add -A', ctx.hostWorkdir);
    git(`git commit -m "seed per-issue scenario for issue ${issueNum}"`, ctx.hostWorkdir);
    git('git push -u origin HEAD', ctx.hostWorkdir);

    ctx.defaultBranchName = git('git branch --show-current', ctx.hostWorkdir);
  },
);

Given("the cron host's local default branch is behind origin by a commit it has never fetched", function () {
  ctx.advancerWorkdir = makeWorkdir();
  git(`git clone "${ctx.bareRemote}" .`, ctx.advancerWorkdir);
  git('git config user.email "adw@test.local"', ctx.advancerWorkdir);
  git('git config user.name "ADW Test"', ctx.advancerWorkdir);

  writeFileSync(join(ctx.advancerWorkdir, 'UNRELATED.md'), 'unrelated advance the host never fetched\n');
  git('git add -A', ctx.advancerWorkdir);
  git('git commit -m "advance origin independently of the cron host"', ctx.advancerWorkdir);
  git('git push -u origin HEAD', ctx.advancerWorkdir);

  ctx.advancedCommitSha = git('git rev-parse HEAD', ctx.advancerWorkdir);
  // Deliberately do NOT fetch this into ctx.hostWorkdir — the host must remain unaware,
  // reproducing the precise stale-base condition from the production incident.
});

Given("the cron host's local default branch is up to date with origin", function () {
  // No-op: no divergence is introduced here — the host clone already matches origin's
  // tip from the seed commit above. This is the clean-base counterpart used by §4 to
  // prove the direct-default-branch push is removed unconditionally, not just when stale.
});

Given("the push of the sweep's removal to origin will be rejected", function () {
  ctx.pushFailureMode = 'always';
});

Given("the sweep's first push of the removal to origin will be rejected", function () {
  ctx.pushFailureMode = 'first-only';
});

// ── When ───────────────────────────────────────────────────────────────────────

function bareRemoteDefaultSha(): string {
  return git(`git rev-parse ${ctx.defaultBranchName}`, ctx.bareRemote);
}

When('the per-issue scenario sweep runs on the cron host', async function () {
  if (ctx.sweepRunCount === 0) {
    ctx.originDefaultShaAtWhenStart = bareRemoteDefaultSha();
  }
  ctx.sweepRunCount += 1;
  const runIndex = ctx.sweepRunCount;

  const shouldThrowPush = () =>
    ctx.pushFailureMode === 'always' || (ctx.pushFailureMode === 'first-only' && runIndex === 1);

  const gitCtx = makeFixtureCtx(ctx.hostWorkdir, shouldThrowPush);

  try {
    gitCtx.removeWorktree(SWEEP_BRANCH);
  } catch {
    // nothing to clean up on the first run — expected
  }
  const worktreePath = gitCtx.createWorktreeForNewBranch(SWEEP_BRANCH, ctx.defaultBranchName);

  const base: SweepBase = {
    ctx: gitCtx,
    codeHost: {} as unknown as CodeHost,
    defaultBranch: ctx.defaultBranchName,
    sweepBranch: SWEEP_BRANCH,
    worktreePath,
    findOpenSweepPr: () => null,
    openPr: (head, baseBranch) => {
      ctx.openPrCalls.push({ head, base: baseBranch });
      return 1;
    },
    mergePr: (n) => {
      ctx.mergePrCalls.push(n);
      return { success: true };
    },
    log: (msg, level) => {
      ctx.logEntries.push({ msg, level });
    },
  };

  await runPerIssueScenarioSweep({
    boundary: fakeBoundary(gitCtx),
    now: FIXED_NOW,
    listFeatures: () => listFixtureFeatures(gitCtx, worktreePath),
    getMergedAt: async (issueNum: number) => ctx.mergedAtByIssue.get(issueNum) ?? null,
    listStepDefSiblings: (issueNum: number) => listFixtureStepDefSiblings(gitCtx, worktreePath, issueNum),
    readFeatureContent: (filePath: string) => {
      try {
        return readFileSync(join(worktreePath, filePath), 'utf-8');
      } catch {
        return null;
      }
    },
    persistRemoval: (paths: readonly string[]) => persistRemovalViaPr(paths, base),
    log: () => { /* no-op: keep test output quiet; assertions read ctx.logEntries (base.log) instead */ },
  });
});

// ── Then ───────────────────────────────────────────────────────────────────────

function bareRemoteHasBranch(branch: string): boolean {
  try {
    git(`git rev-parse --verify refs/heads/${branch}`, ctx.bareRemote);
    return true;
  } catch {
    return false;
  }
}

function sweepBranchTreeFiles(): string[] {
  return git(`git ls-tree -r --name-only ${SWEEP_BRANCH}`, ctx.bareRemote)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

Then('origin carries a sweep branch that omits the per-issue scenario for issue {int}', function (issueNum: number) {
  assert.ok(bareRemoteHasBranch(SWEEP_BRANCH), `Expected origin to carry a "${SWEEP_BRANCH}" branch`);
  const files = sweepBranchTreeFiles();
  const featurePath = featureRelPath(issueNum);
  assert.ok(!files.includes(featurePath), `Expected ${SWEEP_BRANCH} on origin to omit ${featurePath}. Got:\n${files.join('\n')}`);
});

Then('the sweep branch on origin includes the origin commit the cron host had not fetched', function () {
  assert.ok(ctx.advancedCommitSha, 'Expected the advanced commit SHA to have been captured');
  try {
    git(`git merge-base --is-ancestor ${ctx.advancedCommitSha} ${SWEEP_BRANCH}`, ctx.bareRemote);
  } catch {
    assert.fail(`Expected ${ctx.advancedCommitSha} to be an ancestor of ${SWEEP_BRANCH} on origin`);
  }
});

Then("the cron host's local default branch carries no commit absent from origin's default branch", function () {
  git('git fetch origin', ctx.hostWorkdir);
  const aheadOfOrigin = git(`git rev-list origin/${ctx.defaultBranchName}..${ctx.defaultBranchName}`, ctx.hostWorkdir);
  assert.strictEqual(aheadOfOrigin, '', `Expected no local commits absent from origin. Got:\n${aheadOfOrigin}`);
});

Then("origin's default branch tip is unchanged by the sweep", function () {
  const shaAfter = bareRemoteDefaultSha();
  assert.strictEqual(
    shaAfter,
    ctx.originDefaultShaAtWhenStart,
    `Expected origin's default branch tip to be unchanged; before=${ctx.originDefaultShaAtWhenStart} after=${shaAfter}`,
  );
});

Then('a pull request is opened from the sweep branch into the default branch', function () {
  assert.ok(
    ctx.openPrCalls.some(c => c.head === SWEEP_BRANCH && c.base === ctx.defaultBranchName),
    `Expected a PR open call with head=${SWEEP_BRANCH} base=${ctx.defaultBranchName}. Got: ${JSON.stringify(ctx.openPrCalls)}`,
  );
});

Then('the sweep reports the push failure as an error', function () {
  assert.ok(
    ctx.logEntries.some(e => e.level === 'error'),
    `Expected an error-level log entry. Got: ${JSON.stringify(ctx.logEntries)}`,
  );
});
