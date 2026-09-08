/**
 * BDD step definitions for feature-611.feature
 * app_docs living-docs post-write self-check guards (bloat + regrowth)
 *
 * Design decisions:
 *  - The self-check is driven IN-PROCESS via executeDocsPostWriteSelfCheck with
 *    injectable deps, the same way feature-609 drives convergence.
 *  - A temp fixture directory seeds .adw/conditional_docs.md (built via the
 *    registry module's serializeConditionalDocs) and the app_docs/ module docs.
 *  - Deps inject a capturing createIssue and log so routing/logging are
 *    observable without hitting real GitHub.
 *  - DOC_BLOAT_THRESHOLD_LINES is imported from the guards module — never
 *    hard-coded — so the fixture boundary tracks any retune.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  serializeConditionalDocs,
  type ConditionalDocEntry,
} from '../../../adws/core/conditionalDocsRegistry.ts';
import {
  DOC_BLOAT_THRESHOLD_LINES,
  type GuardFlags,
} from '../../../adws/core/docsGuards.ts';
import {
  executeDocsPostWriteSelfCheck,
  type DocsSelfCheckDeps,
  type RefactorFollowUp,
} from '../../../adws/phases/docsSelfCheck.ts';
import { Platform } from '../../../adws/providers/types.ts';

// ---------------------------------------------------------------------------
// Per-scenario state
// ---------------------------------------------------------------------------

interface ScenarioState {
  fixtureDir: string;
  entries: ConditionalDocEntry[];
  producedDocPaths: string[];
  selfCheckFlags: GuardFlags | null;
  selfCheckRouted: RefactorFollowUp[];
  logLines: string[];
}

let state: ScenarioState = makeEmpty();

function makeEmpty(): ScenarioState {
  return {
    fixtureDir: '',
    entries: [],
    producedDocPaths: [],
    selfCheckFlags: null,
    selfCheckRouted: [],
    logLines: [],
  };
}

Before({ tags: '@adw-611' }, function () {
  if (state.fixtureDir) fs.rmSync(state.fixtureDir, { recursive: true, force: true });
  state = makeEmpty();
  state.fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-611-'));
  fs.mkdirSync(path.join(state.fixtureDir, '.adw'), { recursive: true });
  fs.mkdirSync(path.join(state.fixtureDir, 'app_docs'), { recursive: true });
});

After({ tags: '@adw-611' }, function () {
  if (state.fixtureDir) fs.rmSync(state.fixtureDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeArea(areaPrefix: string): string {
  return areaPrefix.replace(/\/$/, '').replace(/\//g, '-');
}

function areaGlob(areaPrefix: string): string {
  return `${areaPrefix.replace(/\/$/, '')}/**`;
}

function writeEntry(entry: ConditionalDocEntry, lineCount: number): void {
  const lines = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`);
  const content = lines.join('\n') + '\n';
  const absPath = path.join(state.fixtureDir, entry.docPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
}

function flushRegistry(): void {
  const registry = {
    preamble: '# Conditional Documentation\n\n',
    entries: state.entries,
  };
  fs.writeFileSync(
    path.join(state.fixtureDir, '.adw', 'conditional_docs.md'),
    serializeConditionalDocs(registry),
    'utf-8',
  );
}

function addEntry(entry: ConditionalDocEntry, lineCount: number, isProduced: boolean): void {
  state.entries.push(entry);
  writeEntry(entry, lineCount);
  if (isProduced) state.producedDocPaths.push(entry.docPath);
  flushRegistry();
}

/** Find all entries whose ownedGlobs root matches the area prefix. */
function entriesForArea(areaPrefix: string): ConditionalDocEntry[] {
  const norm = areaPrefix.replace(/\/$/, '');
  return state.entries.filter((e) =>
    e.ownedGlobs.some((g) => {
      const root = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      return root === norm || root.startsWith(`${norm}/`) || norm.startsWith(`${root}/`);
    }),
  );
}

/** First entry for the area — used for single-entry Given steps. */
function firstEntryForArea(areaPrefix: string): ConditionalDocEntry {
  const found = entriesForArea(areaPrefix);
  if (found.length === 0) throw new Error(`No entry owning area "${areaPrefix}"`);
  return found[0];
}

// ---------------------------------------------------------------------------
// Given steps
// ---------------------------------------------------------------------------

Given(
  'a written module doc for the area owning files under {string} whose size exceeds the bloat threshold',
  function (areaPrefix: string) {
    const entry: ConditionalDocEntry = {
      docPath: `app_docs/611-${safeArea(areaPrefix)}.md`,
      ownedGlobs: [areaGlob(areaPrefix)],
      conditions: [`When working on ${areaPrefix}`],
    };
    // DOC_BLOAT_THRESHOLD_LINES + 5: comfortably over the threshold, never hard-coded
    addEntry(entry, DOC_BLOAT_THRESHOLD_LINES + 5, true);
  },
);

Given(
  'a written module doc for the area owning files under {string} whose size is within the bloat threshold',
  function (areaPrefix: string) {
    const entry: ConditionalDocEntry = {
      docPath: `app_docs/611-${safeArea(areaPrefix)}.md`,
      ownedGlobs: [areaGlob(areaPrefix)],
      conditions: [`When working on ${areaPrefix}`],
    };
    addEntry(entry, 5, true);
  },
);

Given(
  'a conditional-docs index with two entries whose owned globs both match files under {string}',
  function (areaPrefix: string) {
    const entryA: ConditionalDocEntry = {
      docPath: `app_docs/611-${safeArea(areaPrefix)}-a.md`,
      ownedGlobs: [areaGlob(areaPrefix)],
      conditions: [`When working on ${areaPrefix} (A)`],
    };
    const entryB: ConditionalDocEntry = {
      docPath: `app_docs/611-${safeArea(areaPrefix)}-b.md`,
      ownedGlobs: [areaGlob(areaPrefix)],
      conditions: [`When working on ${areaPrefix} (B)`],
    };
    addEntry(entryA, 5, true);
    addEntry(entryB, 5, false);
  },
);

Given(
  'a conditional-docs index whose two entries own disjoint areas with no common file',
  function () {
    const entryA: ConditionalDocEntry = {
      docPath: 'app_docs/611-adws-vcs.md',
      ownedGlobs: ['adws/vcs/**'],
      conditions: ['When working on adws/vcs/'],
    };
    const entryB: ConditionalDocEntry = {
      docPath: 'app_docs/611-adws-core.md',
      ownedGlobs: ['adws/core/**'],
      conditions: ['When working on adws/core/'],
    };
    addEntry(entryA, 5, true);
    addEntry(entryB, 5, false);
  },
);

Given(
  'a second entry whose owned globs also match files under {string}',
  function (areaPrefix: string) {
    const entry: ConditionalDocEntry = {
      docPath: `app_docs/611-${safeArea(areaPrefix)}-b.md`,
      ownedGlobs: [areaGlob(areaPrefix)],
      conditions: [`When working on ${areaPrefix} (second)`],
    };
    addEntry(entry, 5, false);
  },
);

// ---------------------------------------------------------------------------
// When step
// ---------------------------------------------------------------------------

When('the post-write self-check runs', function () {
  const capturedLogs: string[] = [];

  const deps: DocsSelfCheckDeps = {
    readFile: (filePath) => fs.readFileSync(filePath, 'utf-8'),
    createIssue: (_title, _body) => 999,
    findExistingRefactorIssue: () => null,
    log: (message) => {
      capturedLogs.push(message);
    },
  };

  const result = executeDocsPostWriteSelfCheck(
    {
      worktreePath: state.fixtureDir,
      producedDocPaths: state.producedDocPaths,
      repoInfo: { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub },
    },
    deps,
  );

  state.selfCheckFlags = result.flags;
  state.selfCheckRouted = result.routed;
  state.logLines = capturedLogs;
});

// ---------------------------------------------------------------------------
// Then steps
// ---------------------------------------------------------------------------

Then(
  'the self-check emits a bloat flag for the area owning files under {string}',
  function (areaPrefix: string) {
    assert.ok(state.selfCheckFlags, 'self-check has not run yet');
    const entry = firstEntryForArea(areaPrefix);
    const found = state.selfCheckFlags.bloat.some((f) => f.docPath === entry.docPath);
    assert.ok(
      found,
      `Expected bloat flag for "${entry.docPath}" but got: [${state.selfCheckFlags.bloat.map((f) => f.docPath).join(', ')}]`,
    );
  },
);

Then(
  'the self-check emits no bloat flag for the area owning files under {string}',
  function (areaPrefix: string) {
    assert.ok(state.selfCheckFlags, 'self-check has not run yet');
    const entry = firstEntryForArea(areaPrefix);
    const found = state.selfCheckFlags.bloat.some((f) => f.docPath === entry.docPath);
    assert.ok(
      !found,
      `Expected NO bloat flag for "${entry.docPath}" but one was emitted`,
    );
  },
);

Then(
  'the self-check emits a regrowth flag naming the two overlapping entries for files under {string}',
  function (areaPrefix: string) {
    assert.ok(state.selfCheckFlags, 'self-check has not run yet');
    const areaEntries = entriesForArea(areaPrefix);
    assert.ok(
      areaEntries.length >= 2,
      `Expected >= 2 entries for area "${areaPrefix}" but found ${areaEntries.length}`,
    );
    const docPaths = new Set(areaEntries.map((e) => e.docPath));
    const found = state.selfCheckFlags.regrowth.some(
      (f) => docPaths.has(f.docPathA) && docPaths.has(f.docPathB),
    );
    assert.ok(
      found,
      `Expected regrowth flag naming two entries for "${areaPrefix}" but got: ${JSON.stringify(state.selfCheckFlags.regrowth)}`,
    );
  },
);

Then('the self-check emits no regrowth flag', function () {
  assert.ok(state.selfCheckFlags, 'self-check has not run yet');
  assert.strictEqual(
    state.selfCheckFlags.regrowth.length,
    0,
    `Expected no regrowth flags but got: ${JSON.stringify(state.selfCheckFlags.regrowth)}`,
  );
});

Then(
  'the bloat flag is routed to a refactor follow-up for the area owning files under {string}',
  function (areaPrefix: string) {
    const entry = firstEntryForArea(areaPrefix);
    const found = state.selfCheckRouted.some(
      (r) =>
        r.docPath === entry.docPath &&
        r.ownedGlobs.some((g) => g.includes(areaPrefix.replace(/\/$/, ''))),
    );
    assert.ok(
      found,
      `Expected refactor follow-up for "${entry.docPath}" area "${areaPrefix}" but got: ${JSON.stringify(state.selfCheckRouted)}`,
    );
  },
);

Then(
  'the self-check logs a bloat flag for the area owning files under {string}',
  function (areaPrefix: string) {
    const entry = firstEntryForArea(areaPrefix);
    const found = state.logLines.some(
      (l) => l.includes('bloat') && l.includes(entry.docPath),
    );
    assert.ok(
      found,
      `Expected a log line with "bloat" and "${entry.docPath}" but got:\n${state.logLines.join('\n')}`,
    );
  },
);

Then(
  'the self-check logs a regrowth flag for the two overlapping entries for files under {string}',
  function (areaPrefix: string) {
    const areaEntries = entriesForArea(areaPrefix);
    const docPaths = areaEntries.map((e) => e.docPath);
    const found = state.logLines.some(
      (l) => l.includes('regrowth') && docPaths.some((dp) => l.includes(dp)),
    );
    assert.ok(
      found,
      `Expected a log line with "regrowth" naming an entry for "${areaPrefix}" but got:\n${state.logLines.join('\n')}`,
    );
  },
);
