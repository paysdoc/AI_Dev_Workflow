/**
 * Step definitions for feature-739.feature
 *
 * Drives the production `runPerIssueScenarioSweep` in-process over a real temp
 * git repo whose `origin` is a real bare remote (local, no network) — the same
 * real-git temp-repo construction feature-735.steps.ts uses. `listFeatures` /
 * `listStepDefSiblings` / `readFeatureContent` are wired to the real
 * `GitContext` (or a plain fs read) over the fixture, and the injected
 * `persistRemoval` calls the real `GitContext.removeAndCommitPaths` +
 * `pushBranch` — only the GitHub-API-backed `getMergedAt` default is replaced
 * (with a fixed, per-issue merge date), and only `defaultBranch()` (which
 * shells to `gh`) is bypassed by reading the fixture's actual current branch
 * instead.
 *
 * Self-contained module-private `ctx` per the feature file's step-definition
 * note — does NOT reach into feature-735.steps.ts's ctx or step defs.
 *
 * Step phrases introduced here (not in vocabulary registry — novel for 739):
 *  - Given  "a per-issue scenario and its step-def sibling for issue {int}, whose linked PR merged {int} days ago, tagged {string}, are committed on the default branch"
 *  - When   "the promotion-aware per-issue scenario sweep runs over the repository"
 *  - Then   "the per-issue scenario for issue {int} is retained in the worktree"
 *  - Then   "the per-issue scenario for issue {int} is deleted from the worktree"
 *  - Then   "issue {int}'s step-def sibling is retained in the worktree"
 *  - Then   "the promotion-aware sweep creates no commit on the default branch"
 *  - Then   "the sweep's deletion commit records the removal of issue {int}'s scenario"
 *  - Then   "the sweep's deletion commit does not record any removal for issue {int}"
 *
 * Registered phrases reused (not redefined here):
 *  - Given  "the ADW codebase is checked out"       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then   "the ADW TypeScript type-check passes"  → feature-504.steps.ts (T22)
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions } from '../../../adws/gitContext/types.ts';
import { runPerIssueScenarioSweep } from '../../../adws/triggers/perIssueScenarioSweep.ts';

const DAY_MS = 86_400_000;
const FIXED_NOW = new Date('2026-07-01T00:00:00Z');
const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;

function featureRelPath(issueNum: number): string {
  return `features/per-issue/feature-${issueNum}.feature`;
}

function siblingRelPath(issueNum: number): string {
  return `features/per-issue/step_definitions/feature-${issueNum}.steps.ts`;
}

function makeFixtureCtx(workdir: string): GitContext {
  const opts: GitContextOptions = {
    owner: 'test', repo: 'test', selfHost: true,
    token: 'dummy-token-local-test',
    gitIdentity: { authorName: 'ADW Test', authorEmail: 'test@adw.test', committerName: 'ADW Test', committerEmail: 'test@adw.test' },
    frameworkRepoRoot: workdir, targetReposDir: tmpdir(),
  };
  return new GitContext(opts);
}

function listFixtureFeatures(gitCtx: GitContext, workdir: string): string[] {
  return gitCtx.lsFiles(workdir, 'features/per-issue').filter(p => FEATURE_FILENAME_RE.test(p.split('/').pop() ?? ''));
}

function listFixtureStepDefSiblings(gitCtx: GitContext, workdir: string, issueNum: number): string[] {
  return gitCtx
    .lsFiles(workdir, 'features/per-issue/step_definitions')
    .filter(p => (p.split('/').pop() ?? '').startsWith(`feature-${issueNum}.`));
}

interface SweepCtx {
  bareRemote: string;
  workdir: string;
  mergedAtByIssue: Map<number, Date>;
  headBeforeSweep: string;
}

const ctx: SweepCtx = { bareRemote: '', workdir: '', mergedAtByIssue: new Map(), headBeforeSweep: '' };

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'adw-739-'));
}

After({ tags: '@adw-739' }, function () {
  if (ctx.bareRemote) { rmSync(ctx.bareRemote, { recursive: true, force: true }); ctx.bareRemote = ''; }
  if (ctx.workdir) { rmSync(ctx.workdir, { recursive: true, force: true }); ctx.workdir = ''; }
  ctx.mergedAtByIssue.clear();
  ctx.headBeforeSweep = '';
});

// ── Given — repository setup ───────────────────────────────────────────────────

Given(
  'a per-issue scenario and its step-def sibling for issue {int}, whose linked PR merged {int} days ago, tagged {string}, are committed on the default branch',
  function (issueNum: number, daysAgoNum: number, tag: string) {
    if (!ctx.workdir) {
      ctx.bareRemote = makeWorkdir();
      ctx.workdir = makeWorkdir();

      git('git init --bare', ctx.bareRemote);
      git(`git clone "${ctx.bareRemote}" .`, ctx.workdir);
      git('git config user.email "adw@test.local"', ctx.workdir);
      git('git config user.name "ADW Test"', ctx.workdir);

      mkdirSync(join(ctx.workdir, 'features', 'per-issue', 'step_definitions'), { recursive: true });
    }

    ctx.mergedAtByIssue.set(issueNum, new Date(FIXED_NOW.getTime() - daysAgoNum * DAY_MS));

    const tagLine = tag === 'none' ? '' : `${tag}\n`;
    writeFileSync(
      join(ctx.workdir, featureRelPath(issueNum)),
      `${tagLine}Feature: per-issue scenario for issue ${issueNum}\n\n  Scenario: placeholder\n    Given a thing\n`,
    );
    writeFileSync(join(ctx.workdir, siblingRelPath(issueNum)), `// step definitions for issue ${issueNum}\n`);

    git('git add -A', ctx.workdir);
    git(`git commit -m "seed per-issue scenario for issue ${issueNum}"`, ctx.workdir);
    git('git push -u origin HEAD', ctx.workdir);
  },
);

// ── When ───────────────────────────────────────────────────────────────────────

When('the promotion-aware per-issue scenario sweep runs over the repository', async function () {
  const gitCtx = makeFixtureCtx(ctx.workdir);
  const branch = gitCtx.getCurrentBranch(ctx.workdir);
  ctx.headBeforeSweep = git('git rev-parse HEAD', ctx.workdir);

  await runPerIssueScenarioSweep({
    gitContext: gitCtx,
    now: FIXED_NOW,
    listFeatures: () => listFixtureFeatures(gitCtx, ctx.workdir),
    getMergedAt: async (issueNum: number) => ctx.mergedAtByIssue.get(issueNum) ?? null,
    listStepDefSiblings: (issueNum: number) => listFixtureStepDefSiblings(gitCtx, ctx.workdir, issueNum),
    readFeatureContent: (filePath: string) => {
      try {
        return readFileSync(join(ctx.workdir, filePath), 'utf-8');
      } catch {
        return null;
      }
    },
    persistRemoval: (paths: readonly string[]) => {
      const committed = gitCtx.removeAndCommitPaths(
        paths,
        'chore: sweep stale per-issue scenarios (>14d post-merge)',
        ctx.workdir,
      );
      if (committed) gitCtx.pushBranch(branch, ctx.workdir);
    },
    log: () => { /* no-op: keep test output quiet */ },
  });
});

// ── Then ───────────────────────────────────────────────────────────────────────

Then('the per-issue scenario for issue {int} is retained in the worktree', function (issueNum: number) {
  const p = join(ctx.workdir, featureRelPath(issueNum));
  assert.ok(existsSync(p), `Expected ${p} to be retained in the worktree`);
});

Then('the per-issue scenario for issue {int} is deleted from the worktree', function (issueNum: number) {
  const p = join(ctx.workdir, featureRelPath(issueNum));
  assert.ok(!existsSync(p), `Expected ${p} to be deleted from the worktree`);
});

Then("issue {int}'s step-def sibling is retained in the worktree", function (issueNum: number) {
  const p = join(ctx.workdir, siblingRelPath(issueNum));
  assert.ok(existsSync(p), `Expected ${p} to be retained in the worktree`);
});

Then('the promotion-aware sweep creates no commit on the default branch', function () {
  const headAfter = git('git rev-parse HEAD', ctx.workdir);
  assert.strictEqual(
    headAfter,
    ctx.headBeforeSweep,
    `Expected no new commit on the default branch; HEAD before=${ctx.headBeforeSweep} after=${headAfter}`,
  );
});

function deletionNameStatusLines(): string[] {
  const output = git('git show --name-status --pretty=format: HEAD', ctx.workdir);
  return output.split('\n').map(l => l.trim()).filter(Boolean);
}

Then("the sweep's deletion commit records the removal of issue {int}'s scenario", function (issueNum: number) {
  const lines = deletionNameStatusLines();
  const featurePath = featureRelPath(issueNum);
  assert.ok(
    lines.includes(`D\t${featurePath}`),
    `Expected HEAD to record deletion of ${featurePath}. Got:\n${lines.join('\n')}`,
  );
});

Then("the sweep's deletion commit does not record any removal for issue {int}", function (issueNum: number) {
  const lines = deletionNameStatusLines();
  const featurePath = featureRelPath(issueNum);
  assert.ok(
    !lines.includes(`D\t${featurePath}`),
    `Expected HEAD to NOT record deletion of ${featurePath}. Got:\n${lines.join('\n')}`,
  );
});
