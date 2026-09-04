/**
 * Step definitions for feature-769.feature
 *
 * Drives the REAL `runPerIssueScenarioSweep` / `runPromotionSweep` / the cron
 * tick seams / the guard's `scanFiles` in-process, over two real temp git
 * repos (a "target" checkout and a "framework" checkout), each with a real
 * bare `origin` remote (local, no network) — the same real-git construction
 * feature-758.steps.ts / feature-740.steps.ts use. The injected `GitContext`
 * is a recording subclass (feature-758's `InjectablePushGitContext`
 * precedent) that overrides ONLY the three gh-backed seams (`defaultBranch`,
 * `fetchMergedPRs`, `listOpenIssues`) and records every operation asked of
 * it; every git operation (worktree creation, commit, push, ls-files) stays
 * real, so the GREEN signal comes from the real threaded production code,
 * never a hand-mirrored stand-in.
 *
 * `persistRemoval` (per-issue) and `fileIssue` (promotion) are injected as
 * whole replacements — not GitContext overrides — because their production
 * paths reach gh through free functions (`defaultFindPRByBranch`, `mergePR`,
 * `applyLabel`) that no context override can intercept. Every other default
 * (`listFeatures`, `readFeatureContent`, `getMergedAt`,
 * `listPerIssueFeatures`, `listStepDefSiblings`, `scenariosConfig`,
 * `loadVocabulary`, `loadStats`, `listPromotionIssues`, `tagAndCommit`) is
 * exercised for real — those defaults ARE the retargeting bug this issue
 * fixes, so injecting them would make the scenarios vacuous.
 *
 * Self-contained module-private `ctx` per the feature file's step-definition
 * note — does NOT reach into feature-735's / feature-739's / feature-758's
 * sweep step defs, nor feature-691's / feature-700's guard step defs.
 *
 * Registered phrases reused (not redefined here):
 *  - Given  'the ADW codebase is checked out'       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then   'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions } from '../../../adws/gitContext/types.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';
import { runPerIssueScenarioSweep } from '../../../adws/triggers/perIssueScenarioSweep.ts';
import { SWEEP_BRANCH } from '../../../adws/triggers/perIssueSweepPersist.ts';
import { runPromotionSweep } from '../../../adws/triggers/promotionSweep.ts';
import type { PromotionSweepReport } from '../../../adws/triggers/promotionSweep.ts';
import { runPerIssueScenarioSweepTick, runPromotionSweepTick } from '../../../adws/triggers/trigger_cron.ts';
import { scanFiles } from '../../../adws/checkGitGhGuard.ts';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { Platform, type BoundProviders, type IssueTracker, type CodeHost } from '../../../adws/providers/types.ts';

const DAY_MS = 86_400_000;

// ── Fixture repo plumbing ────────────────────────────────────────────────────

interface FixtureRepo {
  bareRemote: string;
  workdir: string;
  defaultBranchName: string;
  mergedAtByIssue: Map<number, Date>;
  shaBeforePass: string;
}

function featureRelPath(issueNum: number): string {
  return `features/per-issue/feature-${issueNum}.feature`;
}

function siblingRelPath(issueNum: number): string {
  return `features/per-issue/step_definitions/feature-${issueNum}.steps.ts`;
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeWorkdir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Seeds a real git repo at `workdir` (must already exist, empty) with a bare `origin` and one stale-candidate scenario. */
function seedFixtureRepo(workdir: string, issueNum: number, daysAgoNum: number): FixtureRepo {
  const bareRemote = makeWorkdir('adw-769-bare-');
  git('git init --bare', bareRemote);
  git(`git clone "${bareRemote}" .`, workdir);
  git('git config user.email "adw@test.local"', workdir);
  git('git config user.name "ADW Test"', workdir);

  mkdirSync(join(workdir, 'features', 'per-issue', 'step_definitions'), { recursive: true });

  const mergedAtByIssue = new Map<number, Date>();
  mergedAtByIssue.set(issueNum, new Date(Date.now() - daysAgoNum * DAY_MS));

  writeFileSync(
    join(workdir, featureRelPath(issueNum)),
    `Feature: per-issue scenario for issue ${issueNum}\n\n  Scenario: placeholder\n    Given a thing\n`,
  );
  writeFileSync(join(workdir, siblingRelPath(issueNum)), `// step definitions for issue ${issueNum}\n`);

  git('git add -A', workdir);
  git(`git commit -m "seed per-issue scenario for issue ${issueNum}"`, workdir);
  git('git push -u origin HEAD', workdir);

  const defaultBranchName = git('git branch --show-current', workdir);
  const shaBeforePass = git(`git rev-parse ${defaultBranchName}`, bareRemote);

  return { bareRemote, workdir, defaultBranchName, mergedAtByIssue, shaBeforePass };
}

function originTrackedFiles(fixture: FixtureRepo): string[] {
  return git(`git ls-tree -r --name-only ${fixture.defaultBranchName}`, fixture.bareRemote)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

function originDefaultShaNow(fixture: FixtureRepo): string {
  return git(`git rev-parse ${fixture.defaultBranchName}`, fixture.bareRemote);
}

// ── Recording GitContext + providers — the only faked seams are the three ────
// gh-backed reads (now provider methods, not GitContext methods: #797 moved
// defaultBranch/fetchMergedPRs/listOpenIssues off GitContext onto
// codeHost.getDefaultBranch/codeHost.listMergedPullRequests/issueTracker.listIssues).

interface RecordedOp {
  op: string;
  args: readonly unknown[];
}

class RecordingGitContext extends GitContext {
  readonly recordedOps: RecordedOp[] = [];

  override lsFiles(cwd: string, prefix?: string): string[] {
    this.recordedOps.push({ op: 'lsFiles', args: [cwd, prefix] });
    return super.lsFiles(cwd, prefix);
  }
}

function makeRecordingCodeHost(recordedOps: RecordedOp[], fixture: FixtureRepo): CodeHost {
  return {
    getDefaultBranch: () => {
      recordedOps.push({ op: 'defaultBranch', args: [] });
      return fixture.defaultBranchName;
    },
    listMergedPullRequests: (limit?: number) => {
      recordedOps.push({ op: 'fetchMergedPRs', args: [limit] });
      return [...fixture.mergedAtByIssue.entries()].map(([issueNum, mergedAt]) => ({
        body: `Closes #${issueNum}`,
        mergedAt: mergedAt.toISOString(),
      }));
    },
  } as unknown as CodeHost;
}

function makeRecordingIssueTracker(recordedOps: RecordedOp[]): IssueTracker {
  return {
    listIssues: (opts: unknown) => {
      recordedOps.push({ op: 'listOpenIssues', args: [opts] });
      return [];
    },
    createIssue: (title: string, body: string) => {
      // Never expected to fire: `fileIssue` is always injected wholesale in
      // these scenarios, bypassing makeDefaultDeps' issueTracker.createIssue entirely.
      recordedOps.push({ op: 'createIssue', args: [title, body] });
      return 1;
    },
  } as unknown as IssueTracker;
}

const GIT_IDENTITY = {
  authorName: 'ADW Test', authorEmail: 'test@adw.test',
  committerName: 'ADW Test', committerEmail: 'test@adw.test',
};

function makeRecordingBoundary(
  identity: Pick<GitContextOptions, 'owner' | 'repo' | 'selfHost' | 'frameworkRepoRoot' | 'targetReposDir'>,
  fixture: FixtureRepo,
): { gitContext: RecordingGitContext; boundary: LaunchBoundary } {
  const opts: GitContextOptions = { ...identity, tokenProvider: createLiteralTokenProvider('dummy-token-local-test'), gitIdentity: GIT_IDENTITY };
  const gitContext = new RecordingGitContext(opts);
  const boundary: LaunchBoundary = {
    gitContext,
    repoId: { owner: identity.owner, repo: identity.repo, platform: Platform.GitHub },
    providers: {
      issueTracker: makeRecordingIssueTracker(gitContext.recordedOps),
      codeHost: makeRecordingCodeHost(gitContext.recordedOps, fixture),
    } as unknown as BoundProviders,
  };
  return { gitContext, boundary };
}

// ── World ─────────────────────────────────────────────────────────────────────

interface Ctx {
  origCwd: string;
  targetReposDir: string | null;
  target: FixtureRepo | null;
  framework: FixtureRepo | null;
  gitContext: RecordingGitContext | null;
  boundary: LaunchBoundary | null;
  activeFixture: FixtureRepo | null;
  hasLaunchContext: boolean;
  removedPaths: string[] | null;
  promotionReport: PromotionSweepReport | null;
  fileIssueCalls: Array<{ title: string; body: string; labels: readonly string[] }>;
  capturedStdout: string;
  tickThrew: boolean;
  guardTmpRoot: string | null;
  guardResult: ReturnType<typeof scanFiles> | null;
  guardRepoPassed: boolean | null;
}

const ctx: Ctx = {
  origCwd: process.cwd(),
  targetReposDir: null,
  target: null,
  framework: null,
  gitContext: null,
  boundary: null,
  activeFixture: null,
  hasLaunchContext: false,
  removedPaths: null,
  promotionReport: null,
  fileIssueCalls: [],
  capturedStdout: '',
  tickThrew: false,
  guardTmpRoot: null,
  guardResult: null,
  guardRepoPassed: null,
};

Before({ tags: '@adw-769' }, function () {
  ctx.origCwd = process.cwd();
});

After({ tags: '@adw-769' }, function () {
  try { process.chdir(ctx.origCwd); } catch { /* best-effort */ }
  if (ctx.targetReposDir) rmSync(ctx.targetReposDir, { recursive: true, force: true });
  if (ctx.target) rmSync(ctx.target.bareRemote, { recursive: true, force: true });
  if (ctx.framework) {
    rmSync(ctx.framework.workdir, { recursive: true, force: true });
    rmSync(ctx.framework.bareRemote, { recursive: true, force: true });
  }
  if (ctx.guardTmpRoot) rmSync(ctx.guardTmpRoot, { recursive: true, force: true });

  ctx.targetReposDir = null;
  ctx.target = null;
  ctx.framework = null;
  ctx.gitContext = null;
  ctx.boundary = null;
  ctx.activeFixture = null;
  ctx.hasLaunchContext = false;
  ctx.removedPaths = null;
  ctx.promotionReport = null;
  ctx.fileIssueCalls = [];
  ctx.capturedStdout = '';
  ctx.tickThrew = false;
  ctx.guardTmpRoot = null;
  ctx.guardResult = null;
  ctx.guardRepoPassed = null;
});

// ── Given — two-checkout world ───────────────────────────────────────────────

Given(
  'a target repository checkout carrying a per-issue scenario for issue {int} whose linked PR merged {int} days ago',
  function (issueNum: number, daysAgoNum: number) {
    ctx.targetReposDir = makeWorkdir('adw-769-target-root-');
    const workdir = join(ctx.targetReposDir, 'adw-fixture', 'target-fixture');
    mkdirSync(workdir, { recursive: true });
    ctx.target = seedFixtureRepo(workdir, issueNum, daysAgoNum);
  },
);

Given(
  'a framework repository checkout carrying a per-issue scenario for issue {int} whose linked PR merged {int} days ago',
  function (issueNum: number, daysAgoNum: number) {
    const workdir = makeWorkdir('adw-769-framework-');
    ctx.framework = seedFixtureRepo(workdir, issueNum, daysAgoNum);
  },
);

Given('the cron process is working from the framework repository checkout', function () {
  assert.ok(ctx.framework, 'Expected a framework repository checkout to be set up first');
  process.chdir(ctx.framework.workdir);
});

Given('the cron holds a launch context for the target repository', function () {
  assert.ok(ctx.target, 'Expected a target repository checkout to be set up first');
  assert.ok(ctx.targetReposDir, 'Expected a target repos root to be set up first');
  ctx.activeFixture = ctx.target;
  const recording = makeRecordingBoundary(
    { owner: 'adw-fixture', repo: 'target-fixture', selfHost: false, frameworkRepoRoot: tmpdir(), targetReposDir: ctx.targetReposDir },
    ctx.target,
  );
  ctx.gitContext = recording.gitContext;
  ctx.boundary = recording.boundary;
  ctx.hasLaunchContext = true;
});

Given('the cron holds a self-host launch context for the framework repository', function () {
  assert.ok(ctx.framework, 'Expected a framework repository checkout to be set up first');
  ctx.activeFixture = ctx.framework;
  const recording = makeRecordingBoundary(
    { owner: 'adw-fixture', repo: 'framework-fixture', selfHost: true, frameworkRepoRoot: ctx.framework.workdir, targetReposDir: tmpdir() },
    ctx.framework,
  );
  ctx.gitContext = recording.gitContext;
  ctx.boundary = recording.boundary;
  ctx.hasLaunchContext = true;
});

Given('the cron holds no launch context', function () {
  ctx.gitContext = null;
  ctx.boundary = null;
  ctx.activeFixture = null;
  ctx.hasLaunchContext = false;
});

// ── When ──────────────────────────────────────────────────────────────────────

async function captureStdout(fn: () => Promise<void>): Promise<void> {
  const originalWrite = process.stdout.write;
  let buffer = '';
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    buffer += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
    ctx.capturedStdout = buffer;
  }
}

/** Applies the removal to the real sweep worktree production created, then pushes it straight onto origin's default branch (simulating a merged PR) — the only faked step is skipping the PR open/merge dance. */
async function recordingPersistRemoval(paths: readonly string[]): Promise<void> {
  const gitCtx = ctx.gitContext;
  const fixture = ctx.activeFixture;
  assert.ok(gitCtx && fixture, 'Expected an active launch context when persisting a removal');
  const worktreePath = gitCtx.worktreePathFor(SWEEP_BRANCH);
  const committed = gitCtx.removeAndCommitPaths(paths, 'chore: sweep (test fixture)', worktreePath);
  if (committed) {
    git(`git push origin HEAD:${fixture.defaultBranchName}`, worktreePath);
  }
}

When('the cron cycle runs the per-issue scenario sweep', async function () {
  if (!ctx.hasLaunchContext) {
    await captureStdout(async () => {
      try {
        await runPerIssueScenarioSweepTick(0, null);
        ctx.tickThrew = false;
      } catch {
        ctx.tickThrew = true;
      }
    });
    return;
  }

  assert.ok(ctx.boundary, 'Expected a launch context to be set up');
  ctx.removedPaths = await runPerIssueScenarioSweep({
    boundary: ctx.boundary,
    persistRemoval: recordingPersistRemoval,
  });
});

When('the cron cycle runs the promotion sweep', async function () {
  if (!ctx.hasLaunchContext) {
    await captureStdout(async () => {
      try {
        await runPromotionSweepTick(0, null);
        ctx.tickThrew = false;
      } catch {
        ctx.tickThrew = true;
      }
    });
    return;
  }

  assert.ok(ctx.boundary, 'Expected a launch context to be set up');
  ctx.promotionReport = await runPromotionSweep({
    boundary: ctx.boundary,
    fileIssue: (spec) => {
      ctx.fileIssueCalls.push({ title: spec.title, body: spec.body, labels: spec.labels });
    },
  });
});

When('the git\\/gh guard scans a fixture source at {string} containing:', function (relPath: string, source: string) {
  ctx.guardTmpRoot = makeWorkdir('adw-769-guard-');
  const fullPath = join(ctx.guardTmpRoot, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, source);
  ctx.guardResult = scanFiles([relPath], ctx.guardTmpRoot);
});

When('the git\\/gh guard runs across the whole ADW repository', function () {
  try {
    execSync('bunx tsx adws/checkGitGhGuard.ts', { cwd: ctx.origCwd, encoding: 'utf-8', stdio: 'pipe' });
    ctx.guardRepoPassed = true;
  } catch {
    ctx.guardRepoPassed = false;
  }
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('the sweep removes the per-issue scenario for issue {int} from the target repository checkout', function (issueNum: number) {
  assert.ok(ctx.target, 'Expected a target fixture');
  const files = originTrackedFiles(ctx.target);
  assert.ok(!files.includes(featureRelPath(issueNum)), `Expected the target origin to omit ${featureRelPath(issueNum)}. Got:\n${files.join('\n')}`);
});

Then('the sweep removes the per-issue scenario for issue {int} from the framework repository checkout', function (issueNum: number) {
  assert.ok(ctx.framework, 'Expected a framework fixture');
  const files = originTrackedFiles(ctx.framework);
  assert.ok(!files.includes(featureRelPath(issueNum)), `Expected the framework origin to omit ${featureRelPath(issueNum)}. Got:\n${files.join('\n')}`);
});

Then('the framework repository checkout still tracks the per-issue scenario for issue {int}', function (issueNum: number) {
  assert.ok(ctx.framework, 'Expected a framework fixture');
  const files = originTrackedFiles(ctx.framework);
  assert.ok(files.includes(featureRelPath(issueNum)), `Expected the framework origin to still include ${featureRelPath(issueNum)}. Got:\n${files.join('\n')}`);
});

Then('the framework repository checkout carries no commit added by the pass', function () {
  assert.ok(ctx.framework, 'Expected a framework fixture');
  const shaAfter = originDefaultShaNow(ctx.framework);
  assert.strictEqual(
    shaAfter, ctx.framework.shaBeforePass,
    `Expected the framework origin's default branch tip unchanged; before=${ctx.framework.shaBeforePass} after=${shaAfter}`,
  );
});

Then("every repository operation the pass performed was issued through the cron's launch context", function () {
  assert.ok(ctx.gitContext, 'Expected an injected launch context');
  assert.ok(
    ctx.gitContext.recordedOps.length > 0,
    'Expected at least one repository operation recorded on the injected launch context',
  );
});

Then("the merged-PR lookup for issue {int} was issued through the cron's launch context", function (issueNum: number) {
  assert.ok(ctx.gitContext, 'Expected an injected launch context');
  // The fixture seeds exactly one candidate issue, so a fetchMergedPRs call is
  // unambiguously the merged-PR lookup for it.
  assert.ok(
    ctx.gitContext.recordedOps.some(o => o.op === 'fetchMergedPRs'),
    `Expected a fetchMergedPRs call (issue ${issueNum}'s merge-date lookup) on the injected context. Recorded: ${JSON.stringify(ctx.gitContext.recordedOps)}`,
  );
});

Then("the pass issued no repository operation outside the cron's launch context", function () {
  assert.ok(ctx.framework, 'Expected a framework fixture to serve as the "outside" proxy');
  const shaAfter = originDefaultShaNow(ctx.framework);
  assert.strictEqual(
    shaAfter, ctx.framework.shaBeforePass,
    'Expected the framework checkout (outside the injected launch context) to show no git activity from the pass',
  );
});

function reportMentionsFeature(report: PromotionSweepReport, issueNum: number): boolean {
  const marker = `feature-${issueNum}`;
  return (
    report.originated.includes(issueNum) ||
    report.redriven.includes(issueNum) ||
    report.declined.some(p => p.includes(marker)) ||
    report.withdrawn.some(p => p.includes(marker)) ||
    report.left.some(p => p.includes(marker))
  );
}

Then('the promotion sweep reports the per-issue scenario for issue {int} as a candidate from the target repository checkout', function (issueNum: number) {
  assert.ok(ctx.promotionReport, 'Expected a promotion sweep report');
  assert.ok(
    reportMentionsFeature(ctx.promotionReport, issueNum),
    `Expected the report to mention feature-${issueNum}. Got: ${JSON.stringify(ctx.promotionReport)}`,
  );
});

Then('the promotion sweep reports no candidate from the framework repository checkout', function () {
  assert.ok(ctx.promotionReport, 'Expected a promotion sweep report');
  assert.ok(ctx.framework, 'Expected a framework fixture');
  const frameworkIssueNum = [...ctx.framework.mergedAtByIssue.keys()][0];
  assert.ok(
    !reportMentionsFeature(ctx.promotionReport, frameworkIssueNum),
    `Expected the report NOT to mention feature-${frameworkIssueNum} (the framework's issue). Got: ${JSON.stringify(ctx.promotionReport)}`,
  );
});

Then("the promotion tracking issues were queried through the cron's launch context", function () {
  assert.ok(ctx.gitContext, 'Expected an injected launch context');
  assert.ok(
    ctx.gitContext.recordedOps.some(o => o.op === 'listOpenIssues'),
    `Expected a listOpenIssues call (the reconciliation query) on the injected context. Recorded: ${JSON.stringify(ctx.gitContext.recordedOps)}`,
  );
});

Then('the promotion sweep creates no issue in the framework repository', function () {
  assert.ok(ctx.framework, 'Expected a framework fixture');
  const marker = `feature-${[...ctx.framework.mergedAtByIssue.keys()][0]}`;
  assert.ok(
    !ctx.fileIssueCalls.some(c => c.title.includes(marker) || c.body.includes(marker)),
    `Expected no filed issue referencing ${marker}. Got: ${JSON.stringify(ctx.fileIssueCalls)}`,
  );
});

Then('the pass is skipped without touching any repository checkout', function () {
  assert.strictEqual(ctx.removedPaths, null, 'Expected the per-issue sweep never to have run');
  assert.strictEqual(ctx.promotionReport, null, 'Expected the promotion sweep never to have run');
  assert.ok(ctx.target, 'Expected a target fixture');
  assert.ok(ctx.framework, 'Expected a framework fixture');
  assert.strictEqual(
    originDefaultShaNow(ctx.target), ctx.target.shaBeforePass,
    'Expected the target checkout to show no git activity when the pass is skipped',
  );
  assert.strictEqual(
    originDefaultShaNow(ctx.framework), ctx.framework.shaBeforePass,
    'Expected the framework checkout to show no git activity when the pass is skipped',
  );
});

Then('the skipped pass is reported in the cron log', function () {
  assert.ok(
    ctx.capturedStdout.includes('no launch GitContext available'),
    `Expected the skip warning on captured stdout. Got:\n${ctx.capturedStdout}`,
  );
});

Then('the cron cycle completes without a thrown error', function () {
  assert.strictEqual(ctx.tickThrew, false, 'Expected the tick to resolve without throwing');
});

Then('the git\\/gh guard reports a violation in that fixture source', function () {
  assert.ok(ctx.guardResult, 'Expected a guard scan result');
  assert.ok(
    ctx.guardResult.violations.length > 0,
    `Expected at least one violation. Got: ${JSON.stringify(ctx.guardResult)}`,
  );
});

Then('the git\\/gh guard reports no violation in that fixture source', function () {
  assert.ok(ctx.guardResult, 'Expected a guard scan result');
  assert.strictEqual(
    ctx.guardResult.violations.length, 0,
    `Expected no violations. Got: ${JSON.stringify(ctx.guardResult.violations)}`,
  );
});

Then('the guard run reports no violations', function () {
  assert.strictEqual(ctx.guardRepoPassed, true, 'Expected the whole-repo git/gh guard run to exit 0 (no violations)');
});
