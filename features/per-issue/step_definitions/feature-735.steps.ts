/**
 * Step definitions for feature-735.feature
 *
 * Drives the production `runPerIssueScenarioSweep` in-process over a real temp
 * git repo whose `origin` is a real bare remote (local, no network) — the same
 * real-git temp-repo construction feature-648 / feature-583 use. `listFeatures`
 * / `listStepDefSiblings` / `readFeatureContent` are wired to the real
 * `GitContext.lsFiles` (tracked index) / a plain fs read over the fixture, and
 * the injected `persistRemoval` calls the real `GitContext.removeAndCommitPaths`
 * + `pushBranch` — only the GitHub-API-backed `getMergedAt` default is replaced
 * (with a fixed, per-scenario merge date), and only `defaultBranch()` (which
 * shells to `gh`) is bypassed by reading the fixture's actual current branch
 * instead. All four base-dependent deps must stay fully injected here: since
 * #758, any one of them left to its production default would resolve a real
 * `SweepBase` (a real worktree + `gh` call) against this actual repo instead of
 * the fixture.
 *
 * Step phrases introduced here (not in vocabulary registry — novel for 735):
 *  - Given  "a per-issue feature and step-def sibling for issue {int} are committed on the repository's default branch"
 *  - Given  "issue {int}'s linked PR was merged {int} days ago"
 *  - When   "the per-issue scenario sweep runs over the repository" (also used as Given/And — see feature-735.feature §5;
 *           Cucumber matches step text regardless of keyword, so a When-registered step works under Given/And too)
 *  - Then   "the feature file for issue {int} is absent from the worktree"
 *  - Then   "the step-def sibling for issue {int} is absent from the worktree"
 *  - Then   "the feature file for issue {int} is retained in the worktree"
 *  - Then   "the step-def sibling for issue {int} is retained in the worktree"
 *  - Then   "the sweep commit on the default branch records the deletion of the feature file and step-def sibling for issue {int}"
 *  - Then   "the worktree has no uncommitted deletions"
 *  - Then   "the origin remote's default branch no longer carries the per-issue scenario for issue {int}"
 *  - Then   "the sweep creates no new commit on the default branch"
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
  issueNum: number;
  mergedAt: Date | null;
  headBeforeSweep: string;
}

const ctx: SweepCtx = { bareRemote: '', workdir: '', issueNum: 0, mergedAt: null, headBeforeSweep: '' };

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'adw-735-'));
}

After({ tags: '@adw-735' }, function () {
  if (ctx.bareRemote) { rmSync(ctx.bareRemote, { recursive: true, force: true }); ctx.bareRemote = ''; }
  if (ctx.workdir) { rmSync(ctx.workdir, { recursive: true, force: true }); ctx.workdir = ''; }
  ctx.issueNum = 0;
  ctx.mergedAt = null;
  ctx.headBeforeSweep = '';
});

// ── Given — repository setup ───────────────────────────────────────────────────

Given(
  "a per-issue feature and step-def sibling for issue {int} are committed on the repository's default branch",
  function (issueNum: number) {
    ctx.bareRemote = makeWorkdir();
    ctx.workdir = makeWorkdir();
    ctx.issueNum = issueNum;
    ctx.mergedAt = null;

    git('git init --bare', ctx.bareRemote);
    git(`git clone "${ctx.bareRemote}" .`, ctx.workdir);
    git('git config user.email "adw@test.local"', ctx.workdir);
    git('git config user.name "ADW Test"', ctx.workdir);

    mkdirSync(join(ctx.workdir, 'features', 'per-issue', 'step_definitions'), { recursive: true });
    writeFileSync(join(ctx.workdir, featureRelPath(issueNum)), `Feature: per-issue scenario for issue ${issueNum}\n`);
    writeFileSync(join(ctx.workdir, siblingRelPath(issueNum)), `// step definitions for issue ${issueNum}\n`);

    git('git add -A', ctx.workdir);
    git(`git commit -m "seed per-issue scenario for issue ${issueNum}"`, ctx.workdir);
    git('git push -u origin HEAD', ctx.workdir);
  },
);

Given("issue {int}'s linked PR was merged {int} days ago", function (issueNum: number, daysAgoNum: number) {
  ctx.issueNum = issueNum;
  ctx.mergedAt = new Date(FIXED_NOW.getTime() - daysAgoNum * DAY_MS);
});

// ── When ───────────────────────────────────────────────────────────────────────

When('the per-issue scenario sweep runs over the repository', async function () {
  const gitCtx = makeFixtureCtx(ctx.workdir);
  const branch = gitCtx.getCurrentBranch(ctx.workdir);
  ctx.headBeforeSweep = git('git rev-parse HEAD', ctx.workdir);

  await runPerIssueScenarioSweep({
    now: FIXED_NOW,
    listFeatures: () => listFixtureFeatures(gitCtx, ctx.workdir),
    getMergedAt: async (issueNum: number) => (issueNum === ctx.issueNum ? ctx.mergedAt : null),
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

Then('the feature file for issue {int} is absent from the worktree', function (issueNum: number) {
  const p = join(ctx.workdir, featureRelPath(issueNum));
  assert.ok(!existsSync(p), `Expected ${p} to be absent from the worktree`);
});

Then('the step-def sibling for issue {int} is absent from the worktree', function (issueNum: number) {
  const p = join(ctx.workdir, siblingRelPath(issueNum));
  assert.ok(!existsSync(p), `Expected ${p} to be absent from the worktree`);
});

Then('the feature file for issue {int} is retained in the worktree', function (issueNum: number) {
  const p = join(ctx.workdir, featureRelPath(issueNum));
  assert.ok(existsSync(p), `Expected ${p} to be retained in the worktree`);
});

Then('the step-def sibling for issue {int} is retained in the worktree', function (issueNum: number) {
  const p = join(ctx.workdir, siblingRelPath(issueNum));
  assert.ok(existsSync(p), `Expected ${p} to be retained in the worktree`);
});

Then(
  'the sweep commit on the default branch records the deletion of the feature file and step-def sibling for issue {int}',
  function (issueNum: number) {
    const output = git('git show --name-status --pretty=format: HEAD', ctx.workdir);
    const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
    const featurePath = featureRelPath(issueNum);
    const siblingPath = siblingRelPath(issueNum);
    assert.ok(
      lines.includes(`D\t${featurePath}`),
      `Expected HEAD to record deletion of ${featurePath}. Got:\n${output}`,
    );
    assert.ok(
      lines.includes(`D\t${siblingPath}`),
      `Expected HEAD to record deletion of ${siblingPath}. Got:\n${output}`,
    );
  },
);

Then('the worktree has no uncommitted deletions', function () {
  const status = git('git status --porcelain', ctx.workdir);
  assert.strictEqual(status.trim(), '', `Expected a clean worktree with no uncommitted deletions, got:\n${status}`);
});

Then(
  "the origin remote's default branch no longer carries the per-issue scenario for issue {int}",
  function (issueNum: number) {
    const branch = git('git branch --show-current', ctx.workdir);
    const tree = git(`git ls-tree -r --name-only ${branch}`, ctx.bareRemote);
    const paths = tree.split('\n').map(l => l.trim()).filter(Boolean);
    const featurePath = featureRelPath(issueNum);
    const siblingPath = siblingRelPath(issueNum);
    assert.ok(!paths.includes(featurePath), `Expected origin ${branch} to no longer carry ${featurePath}`);
    assert.ok(!paths.includes(siblingPath), `Expected origin ${branch} to no longer carry ${siblingPath}`);
  },
);

Then('the sweep creates no new commit on the default branch', function () {
  const headAfter = git('git rev-parse HEAD', ctx.workdir);
  assert.strictEqual(
    headAfter,
    ctx.headBeforeSweep,
    `Expected no new commit on the default branch; HEAD before=${ctx.headBeforeSweep} after=${headAfter}`,
  );
});
