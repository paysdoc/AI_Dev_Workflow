/**
 * Step definitions for feature-741.feature
 *
 * Drives the production `runPromotionSweep` in-process over a real temp git
 * repo whose `origin` is a real bare remote (local, no network) — the same
 * real-git temp-repo construction feature-740.steps.ts uses.
 * `listPerIssueFeatures` / `listStepDefSiblings` / `readFeatureContent` are
 * wired to the real `GitContext` (or a plain fs read) over the fixture, and
 * the marker-persist seam (`tagAndCommit`) calls the real
 * `GitContext.addAndCommitPaths` + `pushBranch` so a decline/withdraw write is
 * a genuine git artefact. The reconciliation query (`listPromotionIssues`) and
 * the issue filer (`fileIssue`) are injected fakes — no real `gh` call — the
 * filer records `(title, body, labels)` for the re-file Then-steps to read.
 *
 * Self-contained module-private `ctx` per the feature file's step-definition
 * note — does NOT reach into feature-740.steps.ts's or feature-739.steps.ts's
 * ctx or step defs.
 *
 * Step phrases introduced here (not in vocabulary registry — novel for 741,
 * see feature-741.feature's Vocabulary note for the full list).
 *
 * Registered phrases reused (not redefined here):
 *  - Given  'the ADW codebase is checked out'       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then   'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions } from '../../../adws/gitContext/types.ts';
import { runPromotionSweep } from '../../../adws/triggers/promotionSweep.ts';

const FIXED_NOW = new Date('2026-07-01T00:00:00Z');

interface FiledIssue {
  title: string;
  body: string;
  labels: readonly string[];
}

interface ReconciliationIssueSeed {
  number: number;
  body: string;
  state?: string;
  labels?: readonly { name: string }[];
}

interface SweepCtx {
  bareRemote: string;
  workdir: string;
  headBeforeSweep: string;
  reconciliationIssues: ReconciliationIssueSeed[];
  filedIssues: FiledIssue[];
  failingAction: 'issue-filing' | 'tag-commit' | null;
  sweepThrew: boolean;
}

const ctx: SweepCtx = {
  bareRemote: '', workdir: '', headBeforeSweep: '',
  reconciliationIssues: [], filedIssues: [], failingAction: null, sweepThrew: false,
};

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'adw-741-'));
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

function featureRelPath(issueNum: number): string {
  return `features/per-issue/feature-${issueNum}.feature`;
}

function stepDefRelPath(issueNum: number): string {
  return `features/per-issue/step_definitions/feature-${issueNum}.steps.ts`;
}

const VOCAB_REL_PATH = 'features/regression/vocabulary.md';

const VOCABULARY_FIXTURE = `## Observability Surfaces (Examples)
- promotion reconciliation sweep test artefact

## Given
| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-------------------|
| G1 | \`a promotion reconciliation test fixture is prepared\` | seeds the test fixture | mock-query | promotion reconciliation sweep test artefact |

## When
| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-------------------|
| W1 | \`the promotion reconciliation test fixture is exercised\` | exercises the fixture | mock-query | promotion reconciliation sweep test artefact |

## Then
| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-------------------|
| T1 | \`the promotion reconciliation test fixture reflects the outcome\` | asserts the outcome | mock-query | promotion reconciliation sweep test artefact |
`;

/** All three steps match registered phrases with all targets surfaced ⇒ score 3 (meets the bootstrap threshold of 3). */
function highScoringFeatureContent(issueNum: number): string {
  return [
    `Feature: fixture for issue ${issueNum}`,
    '',
    '  Scenario: fixture scenario',
    '    Given a promotion reconciliation test fixture is prepared',
    '    When the promotion reconciliation test fixture is exercised',
    '    Then the promotion reconciliation test fixture reflects the outcome',
    '',
  ].join('\n');
}

/** No step matches any registered phrase ⇒ score 0 (below the bootstrap threshold of 3). */
function lowScoringFeatureContent(issueNum: number): string {
  return [
    `Feature: fixture for issue ${issueNum}`,
    '',
    '  Scenario: fixture scenario',
    '    Given an entirely unregistered step happens',
    '',
  ].join('\n');
}

function listFixtureFeatures(gitCtx: GitContext, workdir: string): string[] {
  return gitCtx.lsFiles(workdir, 'features/per-issue').filter(p => /^feature-\d+\.feature$/.test(p.split('/').pop() ?? ''));
}

function listFixtureStepDefSiblings(gitCtx: GitContext, workdir: string, issueNum: number): string[] {
  return gitCtx
    .lsFiles(workdir, 'features/per-issue/step_definitions')
    .filter(p => (p.split('/').pop() ?? '').startsWith(`feature-${issueNum}.`));
}

function ensureWorkdirInitialized(): void {
  if (ctx.workdir) return;
  ctx.bareRemote = makeWorkdir();
  ctx.workdir = makeWorkdir();

  git('git init --bare', ctx.bareRemote);
  git(`git clone "${ctx.bareRemote}" .`, ctx.workdir);
  git('git config user.email "adw@test.local"', ctx.workdir);
  git('git config user.name "ADW Test"', ctx.workdir);

  mkdirSync(join(ctx.workdir, 'features', 'per-issue', 'step_definitions'), { recursive: true });
  mkdirSync(join(ctx.workdir, 'features', 'regression'), { recursive: true });
  writeFileSync(join(ctx.workdir, VOCAB_REL_PATH), VOCABULARY_FIXTURE);
  writeFileSync(join(ctx.workdir, 'README.md'), '# fixture repo\n');

  git('git add -A', ctx.workdir);
  git('git commit -m "seed fixture repo (vocabulary + README)"', ctx.workdir);
  git('git push -u origin HEAD', ctx.workdir);
}

/** Seeds a candidate feature file (+ step-def sibling), optionally with a feature-level tag line prepended. */
function seedCandidate(issueNum: number, featureContent: string, tagLine: string | null): void {
  ensureWorkdirInitialized();

  const content = tagLine ? `${tagLine}\n${featureContent}` : featureContent;
  writeFileSync(join(ctx.workdir, featureRelPath(issueNum)), content);
  writeFileSync(join(ctx.workdir, stepDefRelPath(issueNum)), `// step definitions for issue ${issueNum}\n`);

  git('git add -A', ctx.workdir);
  git(`git commit -m "seed per-issue scenario for issue ${issueNum}"`, ctx.workdir);
  git('git push -u origin HEAD', ctx.workdir);
}

After({ tags: '@adw-741' }, function () {
  if (ctx.bareRemote) { rmSync(ctx.bareRemote, { recursive: true, force: true }); ctx.bareRemote = ''; }
  if (ctx.workdir) { rmSync(ctx.workdir, { recursive: true, force: true }); ctx.workdir = ''; }
  ctx.headBeforeSweep = '';
  ctx.reconciliationIssues = [];
  ctx.filedIssues = [];
  ctx.failingAction = null;
  ctx.sweepThrew = false;
});

// ── Given — repository setup ───────────────────────────────────────────────────

Given('a per-issue feature file for issue {int} carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch', function (issueNum: number) {
  seedCandidate(issueNum, highScoringFeatureContent(issueNum), '@promotion-suggested-2026-06-01');
});

Given('a high-scoring per-issue feature file for issue {int} carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch', function (issueNum: number) {
  seedCandidate(issueNum, highScoringFeatureContent(issueNum), '@promotion-suggested-2026-06-01');
});

Given('a low-scoring per-issue feature file for issue {int} carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch', function (issueNum: number) {
  seedCandidate(issueNum, lowScoringFeatureContent(issueNum), '@promotion-suggested-2026-06-01');
});

Given('a high-scoring per-issue feature file for issue {int} carrying a terminal "@promotion-declined" marker is tracked on the default branch', function (issueNum: number) {
  seedCandidate(issueNum, highScoringFeatureContent(issueNum), '@promotion-declined');
});

Given('a closed-unmerged promotion issue exists linking back to issue {int}', function (issueNum: number) {
  ctx.reconciliationIssues.push({
    number: 900 + issueNum,
    body: `Promotes: feature-${issueNum}\n\nClosed without merging.`,
    state: 'CLOSED',
  });
});

Given('a blocked promotion issue carrying the "adw:blocked" label exists linking back to issue {int}', function (issueNum: number) {
  ctx.reconciliationIssues.push({
    number: 900 + issueNum,
    body: `Promotes: feature-${issueNum}\n\nEscalated to a human.`,
    state: 'OPEN',
    labels: [{ name: 'adw:blocked' }],
  });
});

Given('no promotion issue exists linking back to issue {int}', function (issueNum: number) {
  void issueNum;
  ensureWorkdirInitialized();
});

Given('the injected {string} reconciliation action fails transiently', function (failingAction: string) {
  assert.ok(
    failingAction === 'issue-filing' || failingAction === 'tag-commit',
    `Unknown failingAction: ${failingAction}`,
  );
  ctx.failingAction = failingAction as 'issue-filing' | 'tag-commit';
});

// ── When ───────────────────────────────────────────────────────────────────────

When('the promotion reconciliation sweep runs over the repository', async function () {
  const gitCtx = makeFixtureCtx(ctx.workdir);
  const branch = gitCtx.getCurrentBranch(ctx.workdir);
  ctx.headBeforeSweep = git('git rev-parse HEAD', ctx.workdir);

  try {
    await runPromotionSweep({
      gitContext: gitCtx,
      now: () => FIXED_NOW,
      listPerIssueFeatures: () => listFixtureFeatures(gitCtx, ctx.workdir),
      readFeatureContent: (filePath: string) => {
        try {
          return readFileSync(join(ctx.workdir, filePath), 'utf-8');
        } catch {
          return null;
        }
      },
      listStepDefSiblings: (issueNum: number) => listFixtureStepDefSiblings(gitCtx, ctx.workdir, issueNum),
      loadVocabulary: () => readFileSync(join(ctx.workdir, VOCAB_REL_PATH), 'utf-8'),
      loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 }),
      listPromotionIssues: () => ctx.reconciliationIssues,
      scenariosConfig: { perIssueDir: 'features/per-issue', regressionDir: 'features/regression/', vocabPath: VOCAB_REL_PATH },
      tagAndCommit: (filePath: string, newContent: string, message: string) => {
        if (ctx.failingAction === 'tag-commit') throw new Error('injected transient git failure');
        writeFileSync(join(ctx.workdir, filePath), newContent);
        const committed = gitCtx.addAndCommitPaths([filePath], message, ctx.workdir);
        if (committed) gitCtx.pushBranch(branch, ctx.workdir);
      },
      fileIssue: (spec) => {
        if (ctx.failingAction === 'issue-filing') throw new Error('injected transient gh failure');
        ctx.filedIssues.push(spec);
      },
      log: () => { /* no-op: keep test output quiet */ },
    });
  } catch {
    ctx.sweepThrew = true;
  }
});

// ── Then — marker assertions ─────────────────────────────────────────────────

function readCommittedFeature(issueNum: number): string {
  return readFileSync(join(ctx.workdir, featureRelPath(issueNum)), 'utf-8');
}

function suggestedTagTokens(content: string): string[] {
  return content.match(/@promotion-suggested-\d{4}-\d{2}-\d{2}/g) ?? [];
}

function declinedTokenPresent(content: string): boolean {
  return /@promotion-declined\b/.test(content);
}

Then('the per-issue feature file for issue {int} carries a "@promotion-declined" marker on the default branch', function (issueNum: number) {
  const content = readCommittedFeature(issueNum);
  assert.ok(declinedTokenPresent(content), `Expected ${featureRelPath(issueNum)} to carry @promotion-declined. Got:\n${content}`);
});

Then('the per-issue feature file for issue {int} still carries the "@promotion-declined" marker on the default branch', function (issueNum: number) {
  const content = readCommittedFeature(issueNum);
  assert.ok(declinedTokenPresent(content), `Expected ${featureRelPath(issueNum)} to still carry @promotion-declined. Got:\n${content}`);
});

Then('the per-issue feature file for issue {int} carries no "@promotion-declined" marker on the default branch', function (issueNum: number) {
  const content = readCommittedFeature(issueNum);
  assert.ok(!declinedTokenPresent(content), `Expected ${featureRelPath(issueNum)} to carry no @promotion-declined marker. Got:\n${content}`);
});

Then('the per-issue feature file for issue {int} carries no "@promotion-suggested-" tag on the default branch', function (issueNum: number) {
  const tokens = suggestedTagTokens(readCommittedFeature(issueNum));
  assert.strictEqual(tokens.length, 0, `Expected no @promotion-suggested- tag, found ${tokens.length}: ${tokens.join(', ')}`);
});

Then('the per-issue feature file for issue {int} still carries exactly one "@promotion-suggested-" tag on the default branch', function (issueNum: number) {
  const tokens = suggestedTagTokens(readCommittedFeature(issueNum));
  assert.strictEqual(tokens.length, 1, `Expected exactly one @promotion-suggested- tag, found ${tokens.length}: ${tokens.join(', ')}`);
});

// ── Then — issue assertions ──────────────────────────────────────────────────

Then('the promotion reconciliation sweep files exactly one promotion issue for issue {int}', function (issueNum: number) {
  assert.strictEqual(ctx.filedIssues.length, 1, `Expected exactly one filed issue, got ${ctx.filedIssues.length}`);
  assert.ok(
    ctx.filedIssues[0].body.includes(`Promotes: feature-${issueNum}`),
    `Expected the filed issue body to carry "Promotes: feature-${issueNum}". Got:\n${ctx.filedIssues[0].body}`,
  );
});

Then('the promotion reconciliation sweep files no promotion issue', function () {
  assert.strictEqual(ctx.filedIssues.length, 0, `Expected no filed issue, got ${ctx.filedIssues.length}`);
});

Then('the re-filed promotion issue carries the labels {string}, {string} and {string}', function (l1: string, l2: string, l3: string) {
  assert.ok(ctx.filedIssues.length > 0, 'Expected a re-filed promotion issue to inspect labels');
  assert.deepStrictEqual([...ctx.filedIssues[0].labels].sort(), [l1, l2, l3].sort());
});

Then('the re-filed promotion issue body carries a {string} marker', function (marker: string) {
  assert.ok(ctx.filedIssues.length > 0, 'Expected a re-filed promotion issue to inspect its body');
  assert.ok(ctx.filedIssues[0].body.includes(marker), `Expected the re-filed issue body to contain "${marker}". Got:\n${ctx.filedIssues[0].body}`);
});

// ── Then — blocked-issue / commit / error assertions ─────────────────────────

Then('the promotion reconciliation sweep leaves the blocked promotion issue for issue {int} untouched', function (issueNum: number) {
  // `fileIssue` (files a brand-new issue) is the shell's only issue-mutating seam — it has
  // no close/comment/label call against an EXISTING tracking issue at all, so confirming zero
  // filer calls is a complete proof the blocked tracker (issue 900+N here) was left untouched.
  void issueNum;
  assert.strictEqual(ctx.filedIssues.length, 0, `Expected no promotion-issue mutation, got ${ctx.filedIssues.length} filed issue(s)`);
});

Then('the promotion reconciliation sweep makes no commit on the default branch', function () {
  const headAfter = git('git rev-parse HEAD', ctx.workdir);
  assert.strictEqual(
    headAfter,
    ctx.headBeforeSweep,
    `Expected no new commit on the default branch; HEAD before=${ctx.headBeforeSweep} after=${headAfter}`,
  );
});

Then('the promotion reconciliation sweep completes without raising an error', function () {
  assert.strictEqual(ctx.sweepThrew, false, 'Expected the sweep to complete without raising an error');
});
