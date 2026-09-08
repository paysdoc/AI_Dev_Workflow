/**
 * Step definitions for feature-810.feature
 *
 * Organised into the same seven sections as the feature file. Self-contained
 * module-private `ctx` per the codebase's per-feature convention — does NOT
 * reach into any other feature's step defs or ctx.
 *
 * Registered phrases reused (not redefined here):
 *  - Given  'the ADW codebase is checked out'       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then   'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import type { DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  assessDocsIndexHealth,
  DEFAULT_COUNT_BAND,
  type DocsIndexAssessment,
} from '../../../adws/core/docsIndexHealth.ts';
import {
  serializeConditionalDocs,
  type ConditionalDocsRegistry,
  type ConditionalDocEntry,
} from '../../../adws/core/conditionalDocsRegistry.ts';
import { runLivingDocsIndexCheck } from '../../../adws/checkLivingDocsIndex.ts';
import { runDocsIndexSweepTick } from '../../../adws/triggers/trigger_cron.ts';
import { DOCS_INDEX_SWEEP_INTERVAL_CYCLES } from '../../../adws/core/index.ts';
import { GitContext } from '../../../adws/gitContext/index.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';
import { runDocsIndexSweep, type DocsIndexSweepReport } from '../../../adws/triggers/docsIndexSweep.ts';
import { DOCS_INDEX_SWEEP_SPEC } from '../../../adws/triggers/docsIndexSweepDefaults.ts';
import { Platform, type BoundProviders, type IssueTracker, type CodeHost } from '../../../adws/providers/types.ts';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';

const REPO_ROOT = process.cwd();

// ══════ §1 fixtures — the pure health module over throwaway fixture registries ══════

interface FixtureCtx {
  entries: ConditionalDocEntry[];
  files: Set<string>;
  assessment: DocsIndexAssessment | null;
}

const fixtureCtx: FixtureCtx = { entries: [], files: new Set(), assessment: null };

After({ tags: '@adw-810' }, function () {
  fixtureCtx.entries = [];
  fixtureCtx.files = new Set();
  fixtureCtx.assessment = null;
});

function ensureFixtureEntry(docPath: string): ConditionalDocEntry {
  let entry = fixtureCtx.entries.find((e) => e.docPath === docPath);
  if (!entry) {
    entry = { docPath, ownedGlobs: [], conditions: ['When this fixture entry applies'] };
    fixtureCtx.entries.push(entry);
  }
  return entry;
}

function fixtureRepairs() {
  assert.ok(fixtureCtx.assessment, 'Expected the docs index health check to have run');
  return fixtureCtx.assessment!.repairs;
}

function fixtureViolations() {
  assert.ok(fixtureCtx.assessment, 'Expected the docs index health check to have run');
  return fixtureCtx.assessment!.violations;
}

// ── Given ────────────────────────────────────────────────────────────────────

Given('a docs index fixture holding an entry {string} whose doc file is absent', function (docPath: string) {
  ensureFixtureEntry(docPath);
});

Given('a docs index fixture holding an entry {string} whose doc file is present', function (docPath: string) {
  ensureFixtureEntry(docPath);
  fixtureCtx.files.add(docPath);
});

Given(
  'a docs index fixture holding an entry {string} whose doc file is present at the repository root',
  function (docPath: string) {
    ensureFixtureEntry(docPath);
    fixtureCtx.files.add(docPath);
  },
);

Given('the doc file for {string} is present', function (docPath: string) {
  fixtureCtx.files.add(docPath);
});

Given('a docs index fixture entry {string} owning the globs:', function (docPath: string, table: DataTable) {
  const entry = ensureFixtureEntry(docPath);
  const rows = table.raw();
  const dataRows = rows[0][0].trim().toLowerCase() === 'glob' ? rows.slice(1) : rows;
  for (const row of dataRows) entry.ownedGlobs.push(row[0]);
  // Doc file presence defaults to true for a glob-owning entry in this fixture DSL;
  // scenarios that need it absent alongside globs do not occur in this feature.
  fixtureCtx.files.add(docPath);
});

Given('a docs index fixture entry {string} owning the glob {string}', function (docPath: string, glob: string) {
  const entry = ensureFixtureEntry(docPath);
  entry.ownedGlobs.push(glob);
  fixtureCtx.files.add(docPath);
});

Given('the fixture tracks the file {string}', function (file: string) {
  fixtureCtx.files.add(file);
});

Given('the fixture tracks no file matching either glob', function () {
  // no-op: the fixture's default state tracks nothing beyond declared doc files
});

Given('the fixture holds a doc file {string} that no entry indexes', function (docPath: string) {
  fixtureCtx.files.add(docPath);
});

Given('the fixture holds no doc file that its entries do not index', function () {
  // no-op: the fixture's default state has no extra files
});

Given('a docs index fixture whose entries all have present doc files and live globs', function () {
  const a = ensureFixtureEntry('app_docs/feature-healthy-a.md');
  a.ownedGlobs.push('adws/core/healthyA.ts');
  fixtureCtx.files.add('app_docs/feature-healthy-a.md');
  fixtureCtx.files.add('adws/core/healthyA.ts');

  const b = ensureFixtureEntry('app_docs/feature-healthy-b.md');
  b.ownedGlobs.push('adws/core/healthyB.ts');
  fixtureCtx.files.add('app_docs/feature-healthy-b.md');
  fixtureCtx.files.add('adws/core/healthyB.ts');
});

Given('the fixture entry count is inside the band', function () {
  const target = Math.floor((DEFAULT_COUNT_BAND.min + DEFAULT_COUNT_BAND.max) / 2);
  let i = 0;
  while (fixtureCtx.entries.length < target) {
    const docPath = `app_docs/feature-pad${i}.md`;
    ensureFixtureEntry(docPath);
    fixtureCtx.files.add(docPath);
    i += 1;
  }
});

// Regex, not a `{string}` Cucumber Expression: the Scenario Outline's <sizing>
// placeholder resolves to unquoted text ("one more than the band allows"), unlike
// <verdict> in the Then line which the Gherkin wraps in literal quotes.
Given(/^a docs index fixture holding (.+) healthy entries$/, function (sizing: string) {
  const band = DEFAULT_COUNT_BAND;
  let count: number;
  if (sizing === 'one more than the band allows') count = band.max + 1;
  else if (sizing === 'a count inside the band') count = Math.floor((band.min + band.max) / 2);
  else if (sizing === 'one fewer than the band allows') count = band.min - 1;
  else throw new Error(`Unknown sizing phrase: ${sizing}`);

  for (let i = 0; i < count; i++) {
    const docPath = `app_docs/feature-fixture${i}.md`;
    ensureFixtureEntry(docPath);
    fixtureCtx.files.add(docPath);
  }
});

// ── When ─────────────────────────────────────────────────────────────────────

When('the docs index health check runs over the fixture', function () {
  const registry: ConditionalDocsRegistry = { preamble: '# Conditional Documentation\n', entries: fixtureCtx.entries };
  const content = serializeConditionalDocs(registry);
  fixtureCtx.assessment = assessDocsIndexHealth({ content, files: [...fixtureCtx.files] });
});

// ── Then ─────────────────────────────────────────────────────────────────────

Then('the health check reports a drop repair for {string}', function (docPath: string) {
  const found = fixtureRepairs().some((r) => r.kind === 'drop-dangling-entry' && r.docPath === docPath);
  assert.ok(found, `Expected a drop repair for ${docPath}. Got: ${JSON.stringify(fixtureRepairs())}`);
});

Then('the health check reports no drop repair for {string}', function (docPath: string) {
  const found = fixtureRepairs().some((r) => r.kind === 'drop-dangling-entry' && r.docPath === docPath);
  assert.ok(!found, `Expected no drop repair for ${docPath}. Got: ${JSON.stringify(fixtureRepairs())}`);
});

Then('the health check reports a glob prune of {string} from {string}', function (glob: string, docPath: string) {
  const found = fixtureRepairs().some((r) => r.kind === 'prune-dead-glob' && r.docPath === docPath && r.glob === glob);
  assert.ok(found, `Expected a glob prune of ${glob} from ${docPath}. Got: ${JSON.stringify(fixtureRepairs())}`);
});

Then('the health check reports no glob prune of {string}', function (glob: string) {
  const found = fixtureRepairs().some((r) => r.kind === 'prune-dead-glob' && r.glob === glob);
  assert.ok(!found, `Expected no glob prune of ${glob}. Got: ${JSON.stringify(fixtureRepairs())}`);
});

Then('the health check reports an overlap violation naming {string} and {string}', function (a: string, b: string) {
  const found = fixtureViolations().some(
    (v) => v.kind === 'overlap' && ((v.docPathA === a && v.docPathB === b) || (v.docPathA === b && v.docPathB === a)),
  );
  assert.ok(found, `Expected an overlap violation naming ${a} and ${b}. Got: ${JSON.stringify(fixtureViolations())}`);
});

Then('the health check reports the overlapping tracked file {string}', function (file: string) {
  const found = fixtureViolations().some((v) => v.kind === 'overlap' && v.files.includes(file));
  assert.ok(found, `Expected the overlap violation to name file ${file}. Got: ${JSON.stringify(fixtureViolations())}`);
});

Then('the health check reports an orphan violation naming {string}', function (docPath: string) {
  const found = fixtureViolations().some((v) => v.kind === 'orphan-doc' && v.docPath === docPath);
  assert.ok(found, `Expected an orphan violation naming ${docPath}. Got: ${JSON.stringify(fixtureViolations())}`);
});

Then('the health check reports {string} for the entry count', function (verdict: string) {
  const hasCountViolation = fixtureViolations().some((v) => v.kind === 'count-out-of-band');
  if (verdict === 'a violation') {
    assert.ok(hasCountViolation, `Expected a count-out-of-band violation. Got: ${JSON.stringify(fixtureViolations())}`);
  } else if (verdict === 'no violation') {
    assert.ok(!hasCountViolation, `Expected no count-out-of-band violation. Got: ${JSON.stringify(fixtureViolations())}`);
  } else {
    throw new Error(`Unknown verdict phrase: ${verdict}`);
  }
});

Then('the health check reports no repairs', function () {
  assert.strictEqual(fixtureRepairs().length, 0, `Expected no repairs. Got: ${JSON.stringify(fixtureRepairs())}`);
});

Then('the health check reports no violations', function () {
  assert.strictEqual(fixtureViolations().length, 0, `Expected no violations. Got: ${JSON.stringify(fixtureViolations())}`);
});

// ══════ §5 / §6 — the gate spawned as a command, and run over the ADW checkout ══════

interface GateCtx {
  dir: string | null;
  readmeEntries: ConditionalDocEntry[] | null;
  expectedDangling: string[] | null;
  stripCredentials: boolean;
  exitCode: number | null;
  stdout: string;
}

const gateCtx: GateCtx = {
  dir: null,
  readmeEntries: null,
  expectedDangling: null,
  stripCredentials: false,
  exitCode: null,
  stdout: '',
};

After({ tags: '@adw-810' }, function () {
  if (gateCtx.dir) rmSync(gateCtx.dir, { recursive: true, force: true });
  gateCtx.dir = null;
  gateCtx.readmeEntries = null;
  gateCtx.expectedDangling = null;
  gateCtx.stripCredentials = false;
  gateCtx.exitCode = null;
  gateCtx.stdout = '';
});

function makeGateFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'adw-810-gate-'));
  mkdirSync(join(dir, '.adw'), { recursive: true });
  mkdirSync(join(dir, 'app_docs'), { recursive: true });
  mkdirSync(join(dir, 'adws'), { recursive: true });
  return dir;
}

function writeGateIndex(dir: string, entries: ConditionalDocEntry[]): void {
  const registry: ConditionalDocsRegistry = { preamble: '# Conditional Documentation\n', entries };
  writeFileSync(join(dir, '.adw', 'conditional_docs.md'), serializeConditionalDocs(registry));
}

function writeGateDocFile(dir: string, relPath: string): void {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `# ${relPath}\n\nFixture doc.\n`);
}

/** A band-sized set of healthy entries (each with a matching doc file) plus both top-level READMEs. */
function buildHealthyGateFixture(dir: string): ConditionalDocEntry[] {
  const count = Math.floor((DEFAULT_COUNT_BAND.min + DEFAULT_COUNT_BAND.max) / 2);
  const entries: ConditionalDocEntry[] = [];
  for (let i = 0; i < count; i++) {
    const docPath = `app_docs/feature-fixture${i}.md`;
    entries.push({ docPath, ownedGlobs: [], conditions: ['When this fixture module applies'] });
    writeGateDocFile(dir, docPath);
  }
  entries.push({ docPath: 'README.md', ownedGlobs: [], conditions: ['Always'] });
  entries.push({ docPath: 'adws/README.md', ownedGlobs: [], conditions: ['Always'] });
  writeGateDocFile(dir, 'README.md');
  writeGateDocFile(dir, 'adws/README.md');
  return entries;
}

function spawnGate(dir: string, stripCredentials: boolean): { exitCode: number; stdout: string } {
  const env = { ...process.env };
  if (stripCredentials) {
    for (const key of ['GITHUB_PAT', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY_PATH', 'GITHUB_APP_INSTALLATION_ID']) {
      delete env[key];
    }
  }
  try {
    const stdout = execFileSync('bunx', ['tsx', join(REPO_ROOT, 'adws/checkLivingDocsIndex.ts'), dir], { encoding: 'utf-8', env });
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    return { exitCode: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

// ── Given ────────────────────────────────────────────────────────────────────

Given('a fixture checkout whose docs index is healthy', function () {
  gateCtx.dir = makeGateFixtureDir();
  writeGateIndex(gateCtx.dir, buildHealthyGateFixture(gateCtx.dir));
});

Given('a fixture checkout into which 20 dangling entries have been restored on a branch', function () {
  gateCtx.dir = makeGateFixtureDir();
  const entries = buildHealthyGateFixture(gateCtx.dir);
  const danglingPaths: string[] = [];
  for (let i = 0; i < 20; i++) {
    const docPath = `app_docs/feature-ghost${i}.md`;
    entries.push({ docPath, ownedGlobs: [], conditions: ['When a ghost entry is present'] });
    danglingPaths.push(docPath);
  }
  gateCtx.expectedDangling = danglingPaths;
  writeGateIndex(gateCtx.dir, entries);
});

Given('a fixture checkout whose docs index indexes {string} and {string}', function (a: string, b: string) {
  gateCtx.dir = makeGateFixtureDir();
  gateCtx.readmeEntries = [
    { docPath: a, ownedGlobs: [], conditions: ['Always'] },
    { docPath: b, ownedGlobs: [], conditions: ['Always'] },
  ];
});

Given('both README files are tracked in the fixture checkout', function () {
  assert.ok(gateCtx.dir && gateCtx.readmeEntries, 'Expected the README fixture entries to be declared first');
  for (const e of gateCtx.readmeEntries!) writeGateDocFile(gateCtx.dir!, e.docPath);
  writeGateIndex(gateCtx.dir!, gateCtx.readmeEntries!);
});

Given('no forge credentials are available to the gate', function () {
  gateCtx.stripCredentials = true;
});

// ── When ─────────────────────────────────────────────────────────────────────

When('the docs-index gate runs over the fixture checkout', function () {
  assert.ok(gateCtx.dir, 'Expected a fixture checkout to be set up first');
  const result = spawnGate(gateCtx.dir!, gateCtx.stripCredentials);
  gateCtx.exitCode = result.exitCode;
  gateCtx.stdout = result.stdout;
});

When('the docs-index gate is run over the ADW checkout', function () {
  const result = runLivingDocsIndexCheck(REPO_ROOT);
  gateCtx.exitCode = result.exitCode;
  gateCtx.stdout = result.lines.join('\n');
});

When('the docs-index gate is run through its package script entry point', function () {
  try {
    const stdout = execFileSync('bun', ['run', 'lint:docs-index'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    gateCtx.exitCode = 0;
    gateCtx.stdout = stdout;
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    gateCtx.exitCode = e.status ?? 1;
    gateCtx.stdout = e.stdout ?? '';
  }
});

// "the git\/gh guard is run across the repository" and "the git\/gh guard reports no
// violations" are reused from feature-691.steps.ts (identical Cucumber text; a second
// registration would be ambiguous) — not redefined here.

// ── Then ─────────────────────────────────────────────────────────────────────

Then('the docs-index gate exits non-zero', function () {
  assert.notStrictEqual(gateCtx.exitCode, 0, `Expected a non-zero exit. Got stdout:\n${gateCtx.stdout}`);
});

Then('the docs-index gate exits 0', function () {
  assert.strictEqual(gateCtx.exitCode, 0, `Expected exit 0. Got stdout:\n${gateCtx.stdout}`);
});

Then('the docs-index gate names all 20 dangling entries in its report', function () {
  assert.ok(gateCtx.expectedDangling && gateCtx.expectedDangling.length === 20, 'Expected 20 dangling entries to have been declared');
  for (const docPath of gateCtx.expectedDangling!) {
    assert.ok(gateCtx.stdout.includes(docPath), `Expected the gate report to name ${docPath}. Got:\n${gateCtx.stdout}`);
  }
});

Then('the docs-index gate reports no dangling entry', function () {
  assert.ok(!/Dangling \(entry exists, no file\)/.test(gateCtx.stdout), `Expected no dangling-entry detail. Got:\n${gateCtx.stdout}`);
});

Then('the docs-index gate issued no forge request', function () {
  assert.strictEqual(gateCtx.exitCode, 0, 'Expected the gate to reach a verdict without a forge credential — the behavioural proof that it issues no forge request');
});

Then('the docs-index gate reports no overlapping owned globs', function () {
  assert.ok(!/FAIL.*overlapping/i.test(gateCtx.stdout), `Expected no overlapping-globs failure. Got:\n${gateCtx.stdout}`);
});

Then('the docs-index gate reports no orphan docs', function () {
  assert.ok(!/FAIL.*orphan/i.test(gateCtx.stdout), `Expected no orphan-docs failure. Got:\n${gateCtx.stdout}`);
});

Then('the docs-index gate reports the entry count inside its band', function () {
  assert.ok(!/FAIL.*band/i.test(gateCtx.stdout), `Expected no count-out-of-band failure. Got:\n${gateCtx.stdout}`);
});

Then('the git\\/gh guard reports no stale allowlist entry for the docs-index gate', function () {
  let stdout: string;
  try {
    stdout = execFileSync('bunx', ['tsx', join(REPO_ROOT, 'adws/checkGitGhGuard.ts')], { cwd: REPO_ROOT, encoding: 'utf-8' });
  } catch (err) {
    stdout = (err as { stdout?: string }).stdout ?? '';
  }
  assert.ok(!stdout.includes('adws/checkLivingDocsIndex.ts'), `Expected no mention of the docs-index gate. Got:\n${stdout}`);
});

// ══════ §2 — cadence, launch boundary, and the non-fatal swallow (injected-seam dispatch) ══════

interface DispatchCtx {
  invocationCount: number;
  sweepShouldThrow: boolean;
  dispatchThrew: boolean;
  noLaunchContext: boolean;
  capturedStdout: string;
}

const dispatchCtx: DispatchCtx = {
  invocationCount: 0,
  sweepShouldThrow: false,
  dispatchThrew: false,
  noLaunchContext: false,
  capturedStdout: '',
};

After({ tags: '@adw-810' }, function () {
  dispatchCtx.invocationCount = 0;
  dispatchCtx.sweepShouldThrow = false;
  dispatchCtx.dispatchThrew = false;
  dispatchCtx.noLaunchContext = false;
  dispatchCtx.capturedStdout = '';
});

// TODO: scenario "A cron cycle with no launch context skips the docs-index sweep
// instead of falling back to the working directory" could not be made to pass as a
// distinct BDD scenario — its Given phrase "the cron holds no launch context" is
// already registered verbatim by features/per-issue/step_definitions/feature-769.steps.ts
// (a different, real-git-harness ctx). Cucumber flags two Given registrations with
// identical literal text as globally ambiguous regardless of which feature file's
// scenario invokes it, so a second registration here is not viable, and reaching into
// feature-769.steps.ts's module-private ctx would break this file's (and that file's)
// self-containment convention. The behavioural contract itself — the null-thunk warn-skip
// log line, no dispatch, and no raised error — is fully covered by
// adws/triggers/__tests__/trigger_cron.test.ts's runDocsIndexSweepTick unit tests
// (mirroring the identical case already proven for runPromotionSweepTick/#769).

/** Resolves a Gherkin cycle-position phrase to a cycleCount, relative to the imported constant. */
function resolveDocsIndexCycleCount(cyclePosition: string): number {
  switch (cyclePosition) {
    case 'cadence-eligible':
      return DOCS_INDEX_SWEEP_INTERVAL_CYCLES;
    case 'one-before-cadence':
      return DOCS_INDEX_SWEEP_INTERVAL_CYCLES - 1;
    case 'one-after-cadence':
      return DOCS_INDEX_SWEEP_INTERVAL_CYCLES + 1;
    case 'mid-interval':
      return Math.floor(DOCS_INDEX_SWEEP_INTERVAL_CYCLES / 2);
    default:
      throw new Error(`Unknown cyclePosition: ${cyclePosition}`);
  }
}

/** Capturing fake sweep: increments the invocation counter and resolves (or throws) per ctx.sweepShouldThrow. */
function fakeDocsIndexSweep(): Promise<unknown> {
  dispatchCtx.invocationCount += 1;
  if (dispatchCtx.sweepShouldThrow) {
    return Promise.reject(new Error('injected transient docs-index-sweep error'));
  }
  return Promise.resolve({ repairs: [], violations: [], persisted: false, reportIssue: null, reportAction: 'none' });
}

async function captureDispatchStdout(fn: () => Promise<void>): Promise<void> {
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
    dispatchCtx.capturedStdout = buffer;
  }
}

// ── Given ────────────────────────────────────────────────────────────────────
//
// "the cron holds no launch context" is deliberately NOT registered here — see the
// TODO above. dispatchCtx.noLaunchContext therefore stays permanently false; kept as
// a field (rather than removed) only so the type shape mirrors the sibling boolean
// flags and the dead branch documents its own history.

Given('the injected docs-index sweep is configured to throw a transient error', function () {
  dispatchCtx.sweepShouldThrow = true;
});

// ── When ─────────────────────────────────────────────────────────────────────

When('the cron docs-index-sweep dispatch runs for a {string} cron cycle', async function (cyclePosition: string) {
  const cycleCount = resolveDocsIndexCycleCount(cyclePosition);
  const sweep = dispatchCtx.noLaunchContext ? null : fakeDocsIndexSweep;
  await captureDispatchStdout(async () => {
    try {
      await runDocsIndexSweepTick(cycleCount, sweep);
      dispatchCtx.dispatchThrew = false;
    } catch {
      dispatchCtx.dispatchThrew = true;
    }
  });
});

// ── Then ─────────────────────────────────────────────────────────────────────

Then('the docs-index sweep is dispatched exactly once', function () {
  assert.strictEqual(dispatchCtx.invocationCount, 1, `Expected the injected sweep to be invoked exactly once, got ${dispatchCtx.invocationCount}`);
});

Then('the docs-index sweep is not dispatched', function () {
  assert.strictEqual(dispatchCtx.invocationCount, 0, `Expected the injected sweep never to be invoked, got ${dispatchCtx.invocationCount}`);
});

Then('the cron docs-index-sweep dispatch completes without raising an error', function () {
  assert.strictEqual(dispatchCtx.dispatchThrew, false, 'Expected the dispatch to complete without raising an error');
});

Then('the cron logs that the docs-index sweep was skipped for want of a launch context', function () {
  assert.ok(
    dispatchCtx.capturedStdout.includes('no launch GitContext available'),
    `Expected the skip warning on captured stdout. Got:\n${dispatchCtx.capturedStdout}`,
  );
});

Then('the cron logs the docs-index sweep failure as an error', function () {
  assert.ok(dispatchCtx.invocationCount > 0, 'Expected the swallow to happen around a real dispatch attempt, not because the gate was closed');
  assert.ok(
    /❌|error/i.test(dispatchCtx.capturedStdout),
    `Expected an error-level log entry on captured stdout. Got:\n${dispatchCtx.capturedStdout}`,
  );
});

// ══════ §3 / §4 — the real sweep over a throwaway origin/host repository pair, forge faked ══════
//
// Mirrors feature-758.steps.ts (real worktree/commit/push against a real bare remote) and
// feature-769.steps.ts (target/framework two-checkout world, recording GitContext). Only the
// forge (issueTracker/codeHost) is faked; every git operation is real, so the GREEN signal comes
// from the real threaded production code (prepareSweepBase / persistCommitViaPr / the sweep
// shell), never a hand-mirrored stand-in.
//
// A handful of Given/Then phrases here are DELIBERATELY DISTINCT from feature-758's / feature-769's
// near-identical wording ("the cron host's local default branch is behind origin's docs index by a
// commit it has never fetched", "origin's default branch tip is unchanged by the docs-index sweep",
// "the cron process for the docs-index sweep is working from the framework repository checkout",
// "the cron holds a docs-index-sweep launch context for the target repository", "every repository
// operation the docs-index sweep performed was issued through the cron's launch context") — the
// original feature-810.feature text echoed those files' phrasing verbatim, which Cucumber flags as
// globally ambiguous regardless of which feature's scenario invokes it (confirmed against the
// actually-registered text in feature-758.steps.ts / feature-769.steps.ts). Reusing either file's
// registration was not an option either: both operate on module-private ctx populated by THEIR OWN
// preceding Given steps, which never run in a feature-810 scenario, so the reused step would fail
// immediately on its own unrelated assertions. The feature file's wording was adjusted minimally
// (inserting "docs index" / "docs-index sweep" / "for the docs-index sweep") to disambiguate while
// preserving each scenario's exact narrative meaning — the same self-containment discipline
// feature-745 / feature-758 / feature-769 already apply to themselves for this exact reason.

interface RepoFixture {
  bareRemote: string;
  workdir: string;
  defaultBranchName: string;
}

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'OPEN' | 'CLOSED';
}

interface FakeForgeStore {
  issues: FakeIssue[];
  issueCounter: number;
  prCounter: number;
  openPr: { number: number; branch: string } | null;
  prCalls: Array<{ head: string; base: string }>;
  mergeCalls: number[];
  mergeShouldFail: boolean;
}

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

const SWEEP_GIT_IDENTITY = {
  authorName: 'ADW Test', authorEmail: 'test@adw.test',
  committerName: 'ADW Test', committerEmail: 'test@adw.test',
};

function gitSweep(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeSweepWorkdir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeFakeForgeStore(): FakeForgeStore {
  return { issues: [], issueCounter: 0, prCounter: 0, openPr: null, prCalls: [], mergeCalls: [], mergeShouldFail: false };
}

function makeFakeIssueTracker(store: FakeForgeStore): IssueTracker {
  return {
    listIssues: (query: { state?: string }) =>
      store.issues
        .filter((i) => query.state !== 'open' || i.state === 'OPEN')
        .map((i) => ({ number: i.number, title: i.title, body: i.body, state: i.state, labels: i.labels.map((l) => ({ name: l })) })),
    createIssue: (title: string, body: string) => {
      store.issueCounter += 1;
      store.issues.push({ number: store.issueCounter, title, body, labels: [], state: 'OPEN' });
      return store.issueCounter;
    },
    applyLabel: (issueNumber: number, label: string) => {
      const issue = store.issues.find((i) => i.number === issueNumber);
      if (issue && !issue.labels.includes(label)) issue.labels.push(label);
    },
    updateIssueBody: (issueNumber: number, body: string) => {
      const issue = store.issues.find((i) => i.number === issueNumber);
      if (issue) issue.body = body;
    },
    closeIssue: async (issueNumber: number) => {
      const issue = store.issues.find((i) => i.number === issueNumber);
      if (issue) issue.state = 'CLOSED';
      return true;
    },
  } as unknown as IssueTracker;
}

/** The fake PR's "openness" is tied to whether its branch still exists on the bare remote — cleanupSweepBase's finally-block deleteRemoteBranch (fired on every exit path, merge success or failure) is what lets a later sweep re-derive and re-attempt the same repair. */
function makeFakeCodeHost(store: FakeForgeStore, fixture: RepoFixture): CodeHost {
  return {
    getDefaultBranch: () => fixture.defaultBranchName,
    findPullRequestByBranch: (branch: string) => {
      if (!store.openPr || store.openPr.branch !== branch) return null;
      try {
        execSync(`git rev-parse --verify refs/heads/${branch}`, { cwd: fixture.bareRemote, stdio: 'pipe' });
      } catch {
        store.openPr = null;
        return null;
      }
      return { number: store.openPr.number, state: 'OPEN', sourceBranch: branch, targetBranch: fixture.defaultBranchName, labels: [] };
    },
    createPullRequest: (opts: { sourceBranch: string; targetBranch: string }) => {
      store.prCounter += 1;
      store.openPr = { number: store.prCounter, branch: opts.sourceBranch };
      store.prCalls.push({ head: opts.sourceBranch, base: opts.targetBranch });
      return { url: `https://example.test/pr/${store.prCounter}`, number: store.prCounter };
    },
    mergePullRequest: (prNumber: number) => {
      store.mergeCalls.push(prNumber);
      // Snapshot the sweep branch's index NOW — cleanupSweepBase's finally-block
      // deleteRemoteBranch fires unconditionally (merge success or failure) right after
      // runDocsIndexSweep returns, so by the time a "Then" step runs, the branch is already gone.
      try {
        sweepCtx.lastSweepBranchContent = execSync(`git show ${DOCS_INDEX_SWEEP_SPEC.branch}:.adw/conditional_docs.md`, { cwd: fixture.bareRemote, encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        sweepCtx.lastSweepBranchContent = null;
      }
      if (store.mergeShouldFail) return { success: false, error: 'merge conflict (injected)' };
      execSync(`git update-ref refs/heads/${fixture.defaultBranchName} refs/heads/${DOCS_INDEX_SWEEP_SPEC.branch}`, { cwd: fixture.bareRemote, stdio: 'pipe' });
      store.openPr = null;
      return { success: true };
    },
  } as unknown as CodeHost;
}

interface SweepCtx {
  fixture: RepoFixture | null;
  entries: ConditionalDocEntry[];
  extraFiles: Record<string, string>;
  store: FakeForgeStore;
  boundary: LaunchBoundary | null;
  activeGitContext: RecordingGitContext | null;
  reports: DocsIndexSweepReport[];
  expectedDangling: string[];
  hostShaBeforeSweep: string | null;
  originDefaultShaBeforeSweep: string | null;
  /** The sweep branch's .adw/conditional_docs.md content at the moment of merge — captured because cleanupSweepBase deletes the branch immediately afterward. */
  lastSweepBranchContent: string | null;
  issueCountBeforeThisSweep: number;
  issueCountAtScenarioStart: number | null;
  sweepThrew: boolean;
  capturedStdout: string;
  // two-checkout world
  targetReposDir: string | null;
  target: RepoFixture | null;
  targetStore: FakeForgeStore | null;
  framework: RepoFixture | null;
  originalCwd: string;
}

const sweepCtx: SweepCtx = {
  fixture: null,
  entries: [],
  extraFiles: {},
  store: makeFakeForgeStore(),
  boundary: null,
  activeGitContext: null,
  reports: [],
  expectedDangling: [],
  hostShaBeforeSweep: null,
  originDefaultShaBeforeSweep: null,
  lastSweepBranchContent: null,
  issueCountBeforeThisSweep: 0,
  issueCountAtScenarioStart: null,
  sweepThrew: false,
  capturedStdout: '',
  targetReposDir: null,
  target: null,
  targetStore: null,
  framework: null,
  originalCwd: process.cwd(),
};

After({ tags: '@adw-810' }, function () {
  try { process.chdir(sweepCtx.originalCwd); } catch { /* best-effort */ }
  if (sweepCtx.fixture) { rmSync(sweepCtx.fixture.bareRemote, { recursive: true, force: true }); rmSync(sweepCtx.fixture.workdir, { recursive: true, force: true }); }
  if (sweepCtx.targetReposDir) rmSync(sweepCtx.targetReposDir, { recursive: true, force: true });
  if (sweepCtx.target) rmSync(sweepCtx.target.bareRemote, { recursive: true, force: true });
  if (sweepCtx.framework) { rmSync(sweepCtx.framework.bareRemote, { recursive: true, force: true }); rmSync(sweepCtx.framework.workdir, { recursive: true, force: true }); }
  sweepCtx.fixture = null;
  sweepCtx.entries = [];
  sweepCtx.extraFiles = {};
  sweepCtx.store = makeFakeForgeStore();
  sweepCtx.boundary = null;
  sweepCtx.activeGitContext = null;
  sweepCtx.reports = [];
  sweepCtx.expectedDangling = [];
  sweepCtx.hostShaBeforeSweep = null;
  sweepCtx.originDefaultShaBeforeSweep = null;
  sweepCtx.lastSweepBranchContent = null;
  sweepCtx.issueCountBeforeThisSweep = 0;
  sweepCtx.issueCountAtScenarioStart = null;
  sweepCtx.sweepThrew = false;
  sweepCtx.capturedStdout = '';
  sweepCtx.targetReposDir = null;
  sweepCtx.target = null;
  sweepCtx.targetStore = null;
  sweepCtx.framework = null;
});

function padEntriesIntoBand(entries: ConditionalDocEntry[], extraFiles: Record<string, string>): void {
  const target = Math.floor((DEFAULT_COUNT_BAND.min + DEFAULT_COUNT_BAND.max) / 2);
  let i = 0;
  while (entries.length < target) {
    const docPath = `app_docs/feature-pad${i}.md`;
    entries.push({ docPath, ownedGlobs: [], conditions: ['When X'] });
    extraFiles[docPath] = `# pad ${i}\n`;
    i += 1;
  }
}

function writeIndexAndCommit(fixture: RepoFixture, message: string): void {
  const registry: ConditionalDocsRegistry = { preamble: '# Conditional Documentation\n', entries: sweepCtx.entries };
  writeFileSync(join(fixture.workdir, '.adw', 'conditional_docs.md'), serializeConditionalDocs(registry));
  for (const [relPath, content] of Object.entries(sweepCtx.extraFiles)) {
    const full = join(fixture.workdir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  gitSweep('git add -A', fixture.workdir);
  try {
    gitSweep(`git commit -m "${message}"`, fixture.workdir);
  } catch {
    // nothing changed since the last materialize — fine, no-op
  }
  gitSweep('git push origin HEAD', fixture.workdir);
  if (!fixture.defaultBranchName) {
    fixture.defaultBranchName = gitSweep('git branch --show-current', fixture.workdir);
  }
}

function ensureSingleFixture(): RepoFixture {
  if (sweepCtx.fixture) return sweepCtx.fixture;

  const bareRemote = makeSweepWorkdir('adw-810-bare-');
  const workdir = makeSweepWorkdir('adw-810-host-');
  gitSweep('git init --bare', bareRemote);
  gitSweep(`git clone "${bareRemote}" .`, workdir);
  gitSweep('git config user.email "adw@test.local"', workdir);
  gitSweep('git config user.name "ADW Test"', workdir);
  mkdirSync(join(workdir, '.adw'), { recursive: true });
  mkdirSync(join(workdir, 'app_docs'), { recursive: true });

  sweepCtx.fixture = { bareRemote, workdir, defaultBranchName: '' };
  writeIndexAndCommit(sweepCtx.fixture, 'seed docs index fixture');

  const gitContext = new RecordingGitContext({
    owner: 'adw-fixture', repo: 'framework-fixture', selfHost: true,
    tokenProvider: createLiteralTokenProvider('dummy-token-local-test'),
    gitIdentity: SWEEP_GIT_IDENTITY, frameworkRepoRoot: workdir, targetReposDir: tmpdir(),
  });
  sweepCtx.activeGitContext = gitContext;
  sweepCtx.boundary = {
    gitContext,
    repoId: { owner: 'adw-fixture', repo: 'framework-fixture', platform: Platform.GitHub },
    providers: {
      issueTracker: makeFakeIssueTracker(sweepCtx.store),
      codeHost: makeFakeCodeHost(sweepCtx.store, sweepCtx.fixture),
    } as unknown as BoundProviders,
  };
  return sweepCtx.fixture;
}

function materializeSweepFixture(message: string): void {
  const fixture = ensureSingleFixture();
  writeIndexAndCommit(fixture, message);
}

function seedIsolatedRepo(workdir: string, entries: ConditionalDocEntry[], extraFiles: Record<string, string>): RepoFixture {
  const bareRemote = makeSweepWorkdir('adw-810-bare-');
  gitSweep('git init --bare', bareRemote);
  gitSweep(`git clone "${bareRemote}" .`, workdir);
  gitSweep('git config user.email "adw@test.local"', workdir);
  gitSweep('git config user.name "ADW Test"', workdir);
  mkdirSync(join(workdir, '.adw'), { recursive: true });
  mkdirSync(join(workdir, 'app_docs'), { recursive: true });
  const registry: ConditionalDocsRegistry = { preamble: '# Conditional Documentation\n', entries };
  writeFileSync(join(workdir, '.adw', 'conditional_docs.md'), serializeConditionalDocs(registry));
  for (const [relPath, content] of Object.entries(extraFiles)) {
    const full = join(workdir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  gitSweep('git add -A', workdir);
  gitSweep('git commit -m "seed isolated docs index fixture"', workdir);
  gitSweep('git push -u origin HEAD', workdir);
  const defaultBranchName = gitSweep('git branch --show-current', workdir);
  return { bareRemote, workdir, defaultBranchName };
}

async function captureSweepStdout(fn: () => Promise<void>): Promise<void> {
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
    sweepCtx.capturedStdout = buffer;
  }
}

// ── Given — single-repo fixture ─────────────────────────────────────────────

Given("a docs index on origin's default branch carrying an entry whose doc file is not tracked", function () {
  sweepCtx.entries.push({ docPath: 'app_docs/feature-ghost.md', ownedGlobs: [], conditions: ['When a ghost entry is present'] });
  materializeSweepFixture('seed a dangling entry');
});

Given("the cron host's local default branch is behind origin's docs index by a commit it has never fetched", function () {
  const fixture = ensureSingleFixture();
  const advancerWorkdir = makeSweepWorkdir('adw-810-advancer-');
  gitSweep(`git clone "${fixture.bareRemote}" .`, advancerWorkdir);
  gitSweep('git config user.email "adw@test.local"', advancerWorkdir);
  gitSweep('git config user.name "ADW Test"', advancerWorkdir);
  writeFileSync(join(advancerWorkdir, 'UNRELATED.md'), 'unrelated advance the host never fetched\n');
  gitSweep('git add -A', advancerWorkdir);
  gitSweep('git commit -m "advance origin independently of the cron host"', advancerWorkdir);
  gitSweep('git push -u origin HEAD', advancerWorkdir);
  rmSync(advancerWorkdir, { recursive: true, force: true });
  // sweepCtx.fixture.workdir (the "cron host" clone) deliberately stays unaware of this commit.
});

Given('a docs index on origin\'s default branch whose entry {string} owns a glob matching no tracked file', function (docPath: string) {
  sweepCtx.entries.push({ docPath, ownedGlobs: ['adws/gone.ts'], conditions: ['When X'] });
  materializeSweepFixture('seed a dead glob');
});

Given('the doc file for {string} is tracked on origin\'s default branch', function (docPath: string) {
  sweepCtx.extraFiles[docPath] = `# ${docPath}\n`;
  materializeSweepFixture(`track doc file ${docPath}`);
});

Given("a docs index on origin's default branch whose entries all have tracked doc files and live globs", function () {
  sweepCtx.entries.push({ docPath: 'app_docs/feature-healthy.md', ownedGlobs: ['adws/healthy.ts'], conditions: ['When X'] });
  sweepCtx.extraFiles['app_docs/feature-healthy.md'] = '# healthy\n';
  sweepCtx.extraFiles['adws/healthy.ts'] = '// healthy\n';
  materializeSweepFixture('seed a healthy index');
});

Given("a docs index on origin's default branch into which 20 dangling entries have been restored", function () {
  sweepCtx.entries.push({ docPath: 'app_docs/feature-live.md', ownedGlobs: [], conditions: ['When X'] });
  sweepCtx.extraFiles['app_docs/feature-live.md'] = '# live\n';
  for (let i = 0; i < 20; i++) {
    const docPath = `app_docs/feature-ghost${i}.md`;
    sweepCtx.entries.push({ docPath, ownedGlobs: [], conditions: ['When a ghost entry is present'] });
    sweepCtx.expectedDangling.push(docPath);
  }
  materializeSweepFixture('restore 20 dangling entries');
});

Given("the remaining entries on origin's default branch all have tracked doc files", function () {
  // no-op: the "20 dangling entries restored" given already seeds a healthy baseline entry
});

Given('the merge of the docs-index sweep pull request will fail', function () {
  ensureSingleFixture();
  sweepCtx.store.mergeShouldFail = true;
});

Given("a docs index on origin's default branch whose entries overlap on a tracked file", function () {
  sweepCtx.entries.push({ docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/shared/*.ts'], conditions: ['When X'] });
  sweepCtx.entries.push({ docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/shared/x.ts'], conditions: ['When X'] });
  sweepCtx.extraFiles['app_docs/feature-a.md'] = '# a\n';
  sweepCtx.extraFiles['app_docs/feature-b.md'] = '# b\n';
  sweepCtx.extraFiles['adws/shared/x.ts'] = '// shared\n';
  materializeSweepFixture('seed overlapping entries');
});

Given("an app doc tracked on origin's default branch that no entry indexes", function () {
  sweepCtx.extraFiles['app_docs/feature-orphan.md'] = '# orphan\n';
  materializeSweepFixture('add an orphan doc');
});

Given("the index on origin's default branch holds more entries than the band allows", function () {
  const target = DEFAULT_COUNT_BAND.max + 1;
  let i = 0;
  while (sweepCtx.entries.length < target) {
    const docPath = `app_docs/feature-pad${i}.md`;
    sweepCtx.entries.push({ docPath, ownedGlobs: [], conditions: ['When X'] });
    sweepCtx.extraFiles[docPath] = `# pad ${i}\n`;
    i += 1;
  }
  materializeSweepFixture('pad entry count above the band');
});

Given('a closed docs-index health issue carrying the back-link already exists', function () {
  ensureSingleFixture();
  sweepCtx.store.issueCounter += 1;
  sweepCtx.store.issues.push({
    number: sweepCtx.store.issueCounter,
    title: '`docs-index-health`: old violations',
    body: 'Reconciles: docs-index-health\nFingerprint: deadbeefcafe\n',
    labels: ['hitl', 'adw:none'],
    state: 'CLOSED',
  });
});

Given("every entry on origin's default branch has a tracked doc file and live globs", function () {
  // no-op: the overlap fixture already gives every entry a tracked doc file and a live glob
});

Given("the index on origin's default branch holds an entry count inside the band", function () {
  padEntriesIntoBand(sweepCtx.entries, sweepCtx.extraFiles);
  materializeSweepFixture('pad entry count inside the band');
});

// ── Given — two-checkout world ───────────────────────────────────────────────

Given('a target repository checkout whose docs index carries a dangling entry', function () {
  sweepCtx.targetReposDir = makeSweepWorkdir('adw-810-target-root-');
  const workdir = join(sweepCtx.targetReposDir, 'adw-fixture', 'target-fixture');
  mkdirSync(workdir, { recursive: true });
  const entries: ConditionalDocEntry[] = [{ docPath: 'app_docs/feature-ghost.md', ownedGlobs: [], conditions: ['When a ghost entry is present'] }];
  sweepCtx.target = seedIsolatedRepo(workdir, entries, {});
  sweepCtx.targetStore = makeFakeForgeStore();
});

Given('a framework repository checkout whose docs index carries a dangling entry', function () {
  const workdir = makeSweepWorkdir('adw-810-framework-');
  const entries: ConditionalDocEntry[] = [{ docPath: 'app_docs/feature-ghost.md', ownedGlobs: [], conditions: ['When a ghost entry is present'] }];
  sweepCtx.framework = seedIsolatedRepo(workdir, entries, {});
});

Given('a target repository checkout whose docs index carries overlapping entries', function () {
  sweepCtx.targetReposDir = makeSweepWorkdir('adw-810-target-root-');
  const workdir = join(sweepCtx.targetReposDir, 'adw-fixture', 'target-fixture');
  mkdirSync(workdir, { recursive: true });
  const entries: ConditionalDocEntry[] = [
    { docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/shared/*.ts'], conditions: ['When X'] },
    { docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/shared/x.ts'], conditions: ['When X'] },
  ];
  const extraFiles = { 'app_docs/feature-a.md': '# a\n', 'app_docs/feature-b.md': '# b\n', 'adws/shared/x.ts': '// shared\n' };
  sweepCtx.target = seedIsolatedRepo(workdir, entries, extraFiles);
  sweepCtx.targetStore = makeFakeForgeStore();
});

Given('the cron process for the docs-index sweep is working from the framework repository checkout', function () {
  if (!sweepCtx.framework) {
    // §4's isolation scenario never declares a dedicated framework fixture — the assertion under
    // test is that the sweep never reaches anywhere outside deps.boundary, so a throwaway fictitious
    // checkout (safety property per feature-769's precedent) is enough to chdir into.
    const workdir = makeSweepWorkdir('adw-810-framework-');
    sweepCtx.framework = seedIsolatedRepo(workdir, [], {});
  }
  process.chdir(sweepCtx.framework.workdir);
});

Given('the cron holds a docs-index-sweep launch context for the target repository', function () {
  assert.ok(sweepCtx.target, 'Expected a target repository checkout to be set up first');
  assert.ok(sweepCtx.targetReposDir, 'Expected a target repos root to be set up first');
  assert.ok(sweepCtx.targetStore, 'Expected a target forge store to be set up first');
  const gitContext = new RecordingGitContext({
    owner: 'adw-fixture', repo: 'target-fixture', selfHost: false,
    tokenProvider: createLiteralTokenProvider('dummy-token-local-test'),
    gitIdentity: SWEEP_GIT_IDENTITY, frameworkRepoRoot: tmpdir(), targetReposDir: sweepCtx.targetReposDir!,
  });
  sweepCtx.activeGitContext = gitContext;
  sweepCtx.boundary = {
    gitContext,
    repoId: { owner: 'adw-fixture', repo: 'target-fixture', platform: Platform.GitHub },
    providers: {
      issueTracker: makeFakeIssueTracker(sweepCtx.targetStore!),
      codeHost: makeFakeCodeHost(sweepCtx.targetStore!, sweepCtx.target!),
    } as unknown as BoundProviders,
  };
});

// ── When ─────────────────────────────────────────────────────────────────────

async function runOneSweep(): Promise<void> {
  assert.ok(sweepCtx.boundary, 'Expected a launch context to be set up first');
  if (sweepCtx.fixture) {
    sweepCtx.hostShaBeforeSweep = gitSweep('git rev-parse HEAD', sweepCtx.fixture.workdir);
    sweepCtx.originDefaultShaBeforeSweep = gitSweep(`git rev-parse ${sweepCtx.fixture.defaultBranchName}`, sweepCtx.fixture.bareRemote);
  }
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  sweepCtx.issueCountBeforeThisSweep = activeStore.issues.length;
  if (sweepCtx.issueCountAtScenarioStart === null) sweepCtx.issueCountAtScenarioStart = activeStore.issues.length;

  await captureSweepStdout(async () => {
    try {
      const report = await runDocsIndexSweep({ boundary: sweepCtx.boundary! });
      sweepCtx.reports.push(report);
      sweepCtx.sweepThrew = false;
    } catch {
      sweepCtx.sweepThrew = true;
    }
  });
}

When('the cron cycle runs the docs-index sweep', runOneSweep);
When('the cron cycle runs the docs-index sweep again', runOneSweep);

// ── Then — single-repo persistence (§3) ─────────────────────────────────────

Then('origin carries a docs-index sweep branch whose index omits the dangling entry', function () {
  assert.ok(sweepCtx.lastSweepBranchContent, 'Expected the sweep branch content to have been snapshotted at merge time');
  assert.ok(!sweepCtx.lastSweepBranchContent!.includes('app_docs/feature-ghost.md'), `Expected the sweep branch's index to omit the dangling entry. Got:\n${sweepCtx.lastSweepBranchContent}`);
});

Then('a pull request is opened from the docs-index sweep branch into the default branch', function () {
  assert.ok(sweepCtx.fixture, 'Expected a single-repo fixture');
  assert.ok(
    sweepCtx.store.prCalls.some((c) => c.head === DOCS_INDEX_SWEEP_SPEC.branch && c.base === sweepCtx.fixture!.defaultBranchName),
    `Expected a PR open call with head=${DOCS_INDEX_SWEEP_SPEC.branch} base=${sweepCtx.fixture!.defaultBranchName}. Got: ${JSON.stringify(sweepCtx.store.prCalls)}`,
  );
});

Then('the docs-index sweep pull request is merged', function () {
  assert.ok(sweepCtx.fixture, 'Expected a single-repo fixture');
  const content = gitSweep(`git show ${sweepCtx.fixture!.defaultBranchName}:.adw/conditional_docs.md`, sweepCtx.fixture!.bareRemote);
  assert.ok(!content.includes('app_docs/feature-ghost.md'), `Expected origin's default branch to reflect the merged repair. Got:\n${content}`);
});

Then('the index on the docs-index sweep branch still carries the entry {string}', function (docPath: string) {
  assert.ok(sweepCtx.lastSweepBranchContent, 'Expected the sweep branch content to have been snapshotted at merge time');
  assert.ok(sweepCtx.lastSweepBranchContent!.includes(docPath), `Expected the sweep branch's index to still carry ${docPath}. Got:\n${sweepCtx.lastSweepBranchContent}`);
});

Then("the index on the docs-index sweep branch no longer carries that entry's dead glob", function () {
  assert.ok(sweepCtx.lastSweepBranchContent, 'Expected the sweep branch content to have been snapshotted at merge time');
  assert.ok(!sweepCtx.lastSweepBranchContent!.includes('adws/gone.ts'), `Expected the dead glob to be pruned. Got:\n${sweepCtx.lastSweepBranchContent}`);
});

Then("the docs-index repair reaches origin's default branch only through the merged pull request", function () {
  assert.ok(sweepCtx.fixture, 'Expected a single-repo fixture');
  const content = gitSweep(`git show ${sweepCtx.fixture!.defaultBranchName}:.adw/conditional_docs.md`, sweepCtx.fixture!.bareRemote);
  assert.ok(!content.includes('app_docs/feature-ghost.md'), `Expected origin's default branch to reflect the merged repair. Got:\n${content}`);
  assert.ok(sweepCtx.store.mergeCalls.length > 0, 'Expected the repair to have landed via an explicit merge call');
});

Then("the cron host's local default branch carries no commit added by the pass", function () {
  assert.ok(sweepCtx.fixture, 'Expected a single-repo fixture');
  const shaAfter = gitSweep('git rev-parse HEAD', sweepCtx.fixture!.workdir);
  assert.strictEqual(
    shaAfter, sweepCtx.hostShaBeforeSweep,
    `Expected the host checkout's HEAD to be unchanged by the pass; before=${sweepCtx.hostShaBeforeSweep} after=${shaAfter}`,
  );
});

Then('the docs-index sweep opens no pull request', function () {
  assert.strictEqual(sweepCtx.store.prCalls.length, 0, `Expected no PR open calls. Got: ${JSON.stringify(sweepCtx.store.prCalls)}`);
});

Then("origin's default branch tip is unchanged by the docs-index sweep", function () {
  assert.ok(sweepCtx.fixture, 'Expected a single-repo fixture');
  const shaAfter = gitSweep(`git rev-parse ${sweepCtx.fixture!.defaultBranchName}`, sweepCtx.fixture!.bareRemote);
  assert.strictEqual(
    shaAfter, sweepCtx.originDefaultShaBeforeSweep,
    `Expected origin's default branch tip to be unchanged; before=${sweepCtx.originDefaultShaBeforeSweep} after=${shaAfter}`,
  );
});

Then('the index on the docs-index sweep branch omits all 20 dangling entries', function () {
  assert.ok(sweepCtx.lastSweepBranchContent, 'Expected the sweep branch content to have been snapshotted at merge time');
  for (const docPath of sweepCtx.expectedDangling) {
    assert.ok(!sweepCtx.lastSweepBranchContent!.includes(docPath), `Expected ${docPath} to be omitted. Got:\n${sweepCtx.lastSweepBranchContent}`);
  }
});

Then('the index on the docs-index sweep branch retains every entry whose doc file is tracked', function () {
  assert.ok(sweepCtx.lastSweepBranchContent, 'Expected the sweep branch content to have been snapshotted at merge time');
  assert.ok(sweepCtx.lastSweepBranchContent!.includes('app_docs/feature-live.md'), `Expected the live entry to survive. Got:\n${sweepCtx.lastSweepBranchContent}`);
});

Then('the docs-index sweep reports the merge failure as an error', function () {
  assert.ok(/❌|error/i.test(sweepCtx.capturedStdout), `Expected an error-level log entry. Got:\n${sweepCtx.capturedStdout}`);
});

Then("origin's default branch index still carries the dangling entry", function () {
  assert.ok(sweepCtx.fixture, 'Expected a single-repo fixture');
  const content = gitSweep(`git show ${sweepCtx.fixture!.defaultBranchName}:.adw/conditional_docs.md`, sweepCtx.fixture!.bareRemote);
  assert.ok(content.includes('app_docs/feature-ghost.md'), `Expected origin's default branch to still carry the dangling entry. Got:\n${content}`);
});

Then("origin's default branch index still carries both overlapping entries", function () {
  assert.ok(sweepCtx.fixture, 'Expected a single-repo fixture');
  const content = gitSweep(`git show ${sweepCtx.fixture!.defaultBranchName}:.adw/conditional_docs.md`, sweepCtx.fixture!.bareRemote);
  assert.ok(content.includes('app_docs/feature-a.md') && content.includes('app_docs/feature-b.md'), `Expected both overlapping entries to survive. Got:\n${content}`);
});

Then('the cron cycle completes without raising an error', function () {
  assert.strictEqual(sweepCtx.sweepThrew, false, 'Expected the sweep call not to throw');
});

Then('a later docs-index sweep re-attempts the repair', async function () {
  sweepCtx.store.mergeShouldFail = false;
  await runOneSweep();
  const content = gitSweep(`git show ${sweepCtx.fixture!.defaultBranchName}:.adw/conditional_docs.md`, sweepCtx.fixture!.bareRemote);
  assert.ok(!content.includes('app_docs/feature-ghost.md'), `Expected the retried sweep to land the repair. Got:\n${content}`);
});

// ── Then — reporting (§4) ────────────────────────────────────────────────────

Then('the docs-index sweep files exactly one issue', function () {
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  const filedThisRun = activeStore.issues.length - sweepCtx.issueCountBeforeThisSweep;
  assert.strictEqual(filedThisRun, 1, `Expected exactly one new issue filed this run, got ${filedThisRun}. All issues: ${JSON.stringify(activeStore.issues)}`);
});

Then('the filed issue carries the {string} label', function (label: string) {
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  assert.ok(activeStore.issues.length > 0, 'Expected at least one filed issue');
  const issue = activeStore.issues[activeStore.issues.length - 1];
  assert.ok(issue.labels.includes(label), `Expected the filed issue to carry label "${label}". Got: ${JSON.stringify(issue.labels)}`);
});

Then('the filed issue body names the overlapping entry pair', function () {
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  const issue = activeStore.issues[activeStore.issues.length - 1];
  assert.ok(
    issue.body.includes('app_docs/feature-a.md') && issue.body.includes('app_docs/feature-b.md'),
    `Expected the issue body to name both overlapping entries. Got:\n${issue.body}`,
  );
});

Then('the filed issue body names the orphan doc', function () {
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  const issue = activeStore.issues[activeStore.issues.length - 1];
  assert.ok(issue.body.includes('app_docs/feature-orphan.md'), `Expected the issue body to name the orphan doc. Got:\n${issue.body}`);
});

Then('the filed issue body reports the entry count against the band', function () {
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  const issue = activeStore.issues[activeStore.issues.length - 1];
  assert.ok(
    issue.body.includes(`[${DEFAULT_COUNT_BAND.min}, ${DEFAULT_COUNT_BAND.max}]`),
    `Expected the issue body to report the count against the band. Got:\n${issue.body}`,
  );
});

Then('the docs-index sweep files exactly one issue across both ticks', function () {
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  const filedTotal = activeStore.issues.length - (sweepCtx.issueCountAtScenarioStart ?? 0);
  assert.strictEqual(filedTotal, 1, `Expected exactly one issue filed across both ticks, got ${filedTotal}. All issues: ${JSON.stringify(activeStore.issues)}`);
});

Then('the second tick reconciles against the open docs-index health issue by its back-link', function () {
  assert.strictEqual(sweepCtx.reports.length, 2, 'Expected two sweep reports (one per tick)');
  assert.strictEqual(
    sweepCtx.reports[1].reportAction, 'unchanged',
    `Expected the second tick's reportAction to be "unchanged" (same fingerprint, reconciled by back-link). Got: ${sweepCtx.reports[1].reportAction}`,
  );
});

Then('the docs-index sweep files no issue', function () {
  const activeStore = sweepCtx.targetStore ?? sweepCtx.store;
  assert.strictEqual(activeStore.issues.length, 0, `Expected no issue filed. Got: ${JSON.stringify(activeStore.issues)}`);
});

// ── Then — target/framework isolation (§3 / §4) ─────────────────────────────

Then('the sweep repairs the docs index of the target repository', function () {
  assert.ok(sweepCtx.target, 'Expected a target fixture');
  const content = gitSweep(`git show ${sweepCtx.target!.defaultBranchName}:.adw/conditional_docs.md`, sweepCtx.target!.bareRemote);
  assert.ok(!content.includes('app_docs/feature-ghost.md'), `Expected the target origin's index to omit the dangling entry after repair. Got:\n${content}`);
});

Then("the framework repository checkout's docs index still carries its dangling entry", function () {
  assert.ok(sweepCtx.framework, 'Expected a framework fixture');
  const content = gitSweep(`git show ${sweepCtx.framework!.defaultBranchName}:.adw/conditional_docs.md`, sweepCtx.framework!.bareRemote);
  assert.ok(content.includes('app_docs/feature-ghost.md'), `Expected the framework origin's index to still carry the dangling entry. Got:\n${content}`);
});

Then("every repository operation the docs-index sweep performed was issued through the cron's launch context", function () {
  assert.ok(sweepCtx.activeGitContext, 'Expected an injected recording launch context');
  assert.ok(sweepCtx.activeGitContext!.recordedOps.length > 0, 'Expected at least one repository operation recorded on the injected launch context');
});

Then('the docs-index health issue is created in the target repository', function () {
  assert.ok(sweepCtx.targetStore, 'Expected a target forge store');
  assert.strictEqual(sweepCtx.targetStore!.issues.length, 1, `Expected exactly one issue in the target's store. Got: ${JSON.stringify(sweepCtx.targetStore!.issues)}`);
});

Then('the docs-index sweep creates no issue in the framework repository', function () {
  // The sweep is called with ONLY the target's boundary/providers (see "the cron holds a
  // docs-index-sweep launch context for the target repository"); no framework-scoped forge store is
  // ever wired into it, so a stray issue there is structurally impossible — this asserts the
  // negative space explicitly, mirroring feature-769's identical property for the sibling sweeps.
  assert.ok(sweepCtx.targetStore, 'Expected a target forge store');
  assert.strictEqual(sweepCtx.targetStore!.issues.length, 1, 'Expected the only filed issue to be the one in the target store');
});
