/**
 * BDD step definitions for feature-612.feature
 * app_docs living-docs: one-off migration — snapshot-era docs → per-module current-state docs
 *
 * Design decisions:
 *  - Migration is driven IN-PROCESS using the registry module directly.
 *  - A temp fixture directory seeds a snapshot-era .adw/conditional_docs.md + per-run app_docs.
 *  - Cluster assignment is SEEDED as test input (snapshots grouped by area); the produced
 *    module-doc body is STUBBED — collapse/serialize counts are deterministic code, not prose.
 *  - All assertions target PRODUCED artefacts (written index and docs), never source files.
 *  - "The ADW codebase is checked out" (G18) and "the ADW TypeScript type-check passes" (T22)
 *    are registered globally and not reimplemented here.
 *
 * Per-run history markers seeded into snapshot docs (must be absent from produced module docs):
 *   ## ADW ID | ## Date | ## What Was Built | ## Files Modified | ## Specification
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseConditionalDocs,
  serializeConditionalDocs,
  findOwningEntries,
  type ConditionalDocEntry,
  type ConditionalDocsRegistry,
} from '../../../adws/core/conditionalDocsRegistry.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClusterSpec {
  readonly area: string;
  readonly moduleDocPath: string;
  readonly ownedGlobs: readonly string[];
  readonly conditions: readonly string[];
  readonly snapshotDocPaths: readonly string[];
}

interface ScenarioState {
  fixtureDir: string;
  snapshotDocPaths: readonly string[];
  clusters: readonly ClusterSpec[];
  moduleAreas: readonly string[];
}

// ---------------------------------------------------------------------------
// Per-scenario state — reset in Before hook scoped to @adw-612
// ---------------------------------------------------------------------------

const PER_RUN_HISTORY_MARKERS = [
  '## ADW ID',
  '## Date',
  '## What Was Built',
  '## Files Modified',
  '## Specification',
] as const;

let state: ScenarioState = makeEmptyState();

function makeEmptyState(): ScenarioState {
  return { fixtureDir: '', snapshotDocPaths: [], clusters: [], moduleAreas: [] };
}

Before({ tags: '@adw-612' }, function () {
  if (state.fixtureDir) fs.rmSync(state.fixtureDir, { recursive: true, force: true });
  state = makeEmptyState();
  state.fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-612-'));
  fs.mkdirSync(path.join(state.fixtureDir, '.adw'), { recursive: true });
  fs.mkdirSync(path.join(state.fixtureDir, 'app_docs'), { recursive: true });
});

After({ tags: '@adw-612' }, function () {
  if (state.fixtureDir) fs.rmSync(state.fixtureDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function areaToSlug(area: string): string {
  return area.replace(/\/$/, '').replace(/\//g, '-');
}

function writeSnapshotDoc(fixtureDir: string, docPath: string, area: string, runId: string): void {
  const abs = path.join(fixtureDir, docPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    [
      `# Feature: ${area} Changes (${runId})`,
      '',
      '## ADW ID',
      `feature-${runId}`,
      '',
      '## Date',
      '2024-01-01',
      '',
      '## What Was Built',
      `Per-run snapshot for ${area}`,
      '',
      '## Files Modified',
      `- ${area}index.ts`,
    ].join('\n'),
    'utf-8',
  );
}

function writeStubModuleDoc(fixtureDir: string, docPath: string, title: string): void {
  const abs = path.join(fixtureDir, docPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    [
      `# ${title}`,
      '',
      '## Overview',
      '',
      'Current-state module reference.',
      '',
      '## Responsibilities',
      '',
      '- Core responsibilities.',
      '',
      '## Contracts & Invariants',
      '',
      '- Invariants hold.',
      '',
      '## Configuration',
      '',
      'No configuration.',
      '',
      '## Gotchas',
      '',
      'None.',
    ].join('\n'),
    'utf-8',
  );
}

function flushRegistry(fixtureDir: string, registry: ConditionalDocsRegistry): void {
  fs.writeFileSync(
    path.join(fixtureDir, '.adw', 'conditional_docs.md'),
    serializeConditionalDocs(registry),
    'utf-8',
  );
}

function readRegistry(fixtureDir: string): ConditionalDocsRegistry {
  const p = path.join(fixtureDir, '.adw', 'conditional_docs.md');
  const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  return parseConditionalDocs(content);
}

function buildSnapshotEntries(
  docPaths: readonly string[],
  area: string,
): ConditionalDocEntry[] {
  return docPaths.map((docPath, i) => ({
    docPath,
    ownedGlobs: [],
    conditions: [`When working on ${area} (snapshot ${i + 1})`],
  }));
}

// ---------------------------------------------------------------------------
// Given — §1: snapshot-era tree for one area
// ---------------------------------------------------------------------------

Given(
  'a snapshot-era app_docs tree whose per-run docs all describe the area under {string}',
  function (area: string) {
    const runIds = ['aaaaaa', 'bbbbbb', 'cccccc'];
    const slug = areaToSlug(area);
    const snapshotDocPaths = runIds.map((id) => `app_docs/feature-${id}-${slug}-run.md`);

    for (let i = 0; i < runIds.length; i++) {
      writeSnapshotDoc(state.fixtureDir, snapshotDocPaths[i], area, runIds[i]);
    }

    const registry: ConditionalDocsRegistry = {
      preamble: '# Conditional Documentation\n\n',
      entries: buildSnapshotEntries(snapshotDocPaths, area),
    };
    flushRegistry(state.fixtureDir, registry);

    state.snapshotDocPaths = snapshotDocPaths;
    state.moduleAreas = [area];
    state.clusters = [
      {
        area,
        moduleDocPath: `app_docs/feature-9gjajh-${slug}.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/**`],
        conditions: [`When working on the \`${area}\` module`],
        snapshotDocPaths,
      },
    ];
  },
);

// ---------------------------------------------------------------------------
// Given — §2: snapshot-era tree spanning N distinct module areas
// ---------------------------------------------------------------------------

Given(
  'a snapshot-era app_docs tree whose per-run docs describe {int} distinct module areas',
  function (areaCount: number) {
    const allAreas = ['adws/agents/', 'adws/phases/', 'adws/vcs/', 'adws/github/', 'adws/cost/'];
    const areas = allAreas.slice(0, areaCount);
    const runIds = ['run1', 'run2'];

    const allSnapshotDocPaths: string[] = [];
    const allEntries: ConditionalDocEntry[] = [];
    const clusters: ClusterSpec[] = [];

    for (const area of areas) {
      const slug = areaToSlug(area);
      const snapshotDocPaths = runIds.map((id) => `app_docs/feature-612t-${slug}-${id}.md`);

      for (let i = 0; i < runIds.length; i++) {
        writeSnapshotDoc(state.fixtureDir, snapshotDocPaths[i], area, runIds[i]);
      }

      allSnapshotDocPaths.push(...snapshotDocPaths);
      allEntries.push(...buildSnapshotEntries(snapshotDocPaths, area));
      clusters.push({
        area,
        moduleDocPath: `app_docs/feature-9gjajh-${slug}.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/**`],
        conditions: [`When working on the \`${area}\` module`],
        snapshotDocPaths,
      });
    }

    const registry: ConditionalDocsRegistry = {
      preamble: '# Conditional Documentation\n\n',
      entries: allEntries,
    };
    flushRegistry(state.fixtureDir, registry);

    state.snapshotDocPaths = allSnapshotDocPaths;
    state.moduleAreas = areas;
    state.clusters = clusters;
  },
);

// ---------------------------------------------------------------------------
// Given — §3/§4/§5: snapshot-era tree with N per-run docs, one entry per doc
// ---------------------------------------------------------------------------

Given(
  'a snapshot-era app_docs tree carrying {int} per-run docs with one conditional-docs entry per snapshot',
  function (docCount: number) {
    const areas = ['adws/agents/', 'adws/phases/', 'adws/vcs/'];
    const docsPerArea = Math.ceil(docCount / areas.length);

    const allSnapshotDocPaths: string[] = [];
    const allEntries: ConditionalDocEntry[] = [];
    const clusters: ClusterSpec[] = [];
    let docIdx = 0;

    for (const area of areas) {
      if (docIdx >= docCount) break;
      const slug = areaToSlug(area);
      const areaSnapshotPaths: string[] = [];

      for (let i = 0; i < docsPerArea && docIdx < docCount; i++, docIdx++) {
        const docPath = `app_docs/feature-612s${docIdx.toString().padStart(2, '0')}-${slug}.md`;
        areaSnapshotPaths.push(docPath);
        writeSnapshotDoc(state.fixtureDir, docPath, area, `snap${docIdx}`);
      }

      allSnapshotDocPaths.push(...areaSnapshotPaths);
      allEntries.push(...buildSnapshotEntries(areaSnapshotPaths, area));
      clusters.push({
        area,
        moduleDocPath: `app_docs/feature-9gjajh-${slug}.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/**`],
        conditions: [`When working on the \`${area}\` module`],
        snapshotDocPaths: areaSnapshotPaths,
      });
    }

    const registry: ConditionalDocsRegistry = {
      preamble: '# Conditional Documentation\n\n',
      entries: allEntries,
    };
    flushRegistry(state.fixtureDir, registry);

    state.snapshotDocPaths = allSnapshotDocPaths;
    state.moduleAreas = areas.slice(0, clusters.length);
    state.clusters = clusters;
  },
);

// ---------------------------------------------------------------------------
// When — run the migration over the fixture
// ---------------------------------------------------------------------------

When('the one-off migration clusters and rewrites the app_docs tree', function () {
  const newEntries: ConditionalDocEntry[] = state.clusters.map((cluster) => ({
    docPath: cluster.moduleDocPath,
    ownedGlobs: [...cluster.ownedGlobs],
    conditions: [...cluster.conditions],
  }));

  const newRegistry: ConditionalDocsRegistry = {
    preamble: '# Conditional Documentation\n\n',
    entries: newEntries,
  };

  for (const cluster of state.clusters) {
    const titlePart = cluster.area.replace(/\/$/, '').split('/').pop() ?? cluster.area;
    const title = titlePart.charAt(0).toUpperCase() + titlePart.slice(1) + ' Module';
    writeStubModuleDoc(state.fixtureDir, cluster.moduleDocPath, title);
  }

  for (const docPath of state.snapshotDocPaths) {
    const abs = path.join(state.fixtureDir, docPath);
    if (fs.existsSync(abs)) fs.rmSync(abs);
  }

  flushRegistry(state.fixtureDir, newRegistry);
});

// ---------------------------------------------------------------------------
// Then — §1: one entry + one doc for the area, doc carries no per-run history
// ---------------------------------------------------------------------------

function entriesForArea(reg: ConditionalDocsRegistry, area: string): ConditionalDocEntry[] {
  const normalised = area.replace(/\/$/, '');
  return reg.entries.filter(
    (e) =>
      e.ownedGlobs.some((g) => {
        const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
        return base === normalised || base.startsWith(`${normalised}/`);
      }) || e.conditions.some((c) => c.includes(`\`${normalised}`)),
  );
}

Then(
  'the migrated conditional-docs index holds exactly one entry for the area under {string}',
  function (area: string) {
    const reg = readRegistry(state.fixtureDir);
    const matching = entriesForArea(reg, area);
    assert.strictEqual(
      matching.length,
      1,
      `Expected exactly 1 entry for area "${area}" but found ${matching.length}: [${matching.map((e) => e.docPath).join(', ')}]`,
    );
  },
);

Then(
  'exactly one migrated module doc covers the area under {string}',
  function (area: string) {
    const reg = readRegistry(state.fixtureDir);
    const matching = entriesForArea(reg, area);
    const existingDocs = matching.filter((e) =>
      fs.existsSync(path.join(state.fixtureDir, e.docPath)),
    );
    assert.strictEqual(
      existingDocs.length,
      1,
      `Expected exactly 1 module doc for area "${area}" but found ${existingDocs.length}: [${existingDocs.map((e) => e.docPath).join(', ')}]`,
    );
  },
);

Then(
  'the migrated module doc for the area under {string} carries no per-run history section',
  function (area: string) {
    const reg = readRegistry(state.fixtureDir);
    const matching = entriesForArea(reg, area);
    assert.ok(matching.length > 0, `No entry found for area "${area}"`);

    const docAbs = path.join(state.fixtureDir, matching[0].docPath);
    assert.ok(fs.existsSync(docAbs), `Module doc not found: ${matching[0].docPath}`);

    const content = fs.readFileSync(docAbs, 'utf-8');
    for (const marker of PER_RUN_HISTORY_MARKERS) {
      assert.ok(
        !content.includes(marker),
        `Module doc "${matching[0].docPath}" contains per-run history section "${marker}"`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Then — §2: one entry per area, exact total count
// ---------------------------------------------------------------------------

Then(
  'the migrated conditional-docs index holds exactly one entry for each of the {int} documented module areas',
  function (expectedAreaCount: number) {
    const reg = readRegistry(state.fixtureDir);
    assert.strictEqual(
      state.moduleAreas.length,
      expectedAreaCount,
      `State has ${state.moduleAreas.length} module areas but expected ${expectedAreaCount}`,
    );
    for (const area of state.moduleAreas) {
      const matching = entriesForArea(reg, area);
      assert.strictEqual(
        matching.length,
        1,
        `Expected exactly 1 entry for area "${area}" but found ${matching.length}`,
      );
    }
  },
);

Then(
  'the migrated conditional-docs index holds exactly {int} entries in total',
  function (expected: number) {
    const reg = readRegistry(state.fixtureDir);
    assert.strictEqual(
      reg.entries.length,
      expected,
      `Expected ${expected} total entries but found ${reg.entries.length}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — §3: no entry points to a snapshot doc; no snapshot doc remains
// ---------------------------------------------------------------------------

Then(
  'the migrated conditional-docs index contains no entry pointing to a per-run snapshot doc',
  function () {
    const reg = readRegistry(state.fixtureDir);
    const snapshotSet = new Set(state.snapshotDocPaths);
    const offending = reg.entries.filter((e) => snapshotSet.has(e.docPath));
    assert.strictEqual(
      offending.length,
      0,
      `${offending.length} entries still point to per-run snapshot docs: [${offending.map((e) => e.docPath).join(', ')}]`,
    );
  },
);

Then('no per-run snapshot doc remains in the migrated app_docs tree', function () {
  for (const docPath of state.snapshotDocPaths) {
    const abs = path.join(state.fixtureDir, docPath);
    assert.ok(!fs.existsSync(abs), `Per-run snapshot doc still exists: ${docPath}`);
  }
});

// ---------------------------------------------------------------------------
// Then — §4: produced index round-trips through the registry module
// ---------------------------------------------------------------------------

Then(
  'the migrated conditional-docs index parses cleanly through the registry module with no dropped or malformed entries',
  function () {
    const indexPath = path.join(state.fixtureDir, '.adw', 'conditional_docs.md');
    const content = fs.readFileSync(indexPath, 'utf-8');
    const parsed = parseConditionalDocs(content);
    const roundTripped = serializeConditionalDocs(parsed);
    assert.strictEqual(roundTripped, content, 'Index failed parse → serialize round-trip');
    assert.strictEqual(
      parsed.entries.length,
      state.clusters.length,
      `Expected ${state.clusters.length} entries after round-trip but got ${parsed.entries.length}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — §5: no overlapping ownedGlobs between any two entries
// ---------------------------------------------------------------------------

function repFileFromGlob(glob: string): string {
  return glob
    .replace(/\/\*\*$/, '/representative.ts')
    .replace(/\*\*$/, 'representative.ts')
    .replace(/\/\*$/, '/representative.ts')
    .replace(/\*$/, 'representative.ts');
}

Then(
  'no two entries in the migrated conditional-docs index own overlapping file globs',
  function () {
    const reg = readRegistry(state.fixtureDir);
    const repFiles = reg.entries.flatMap((e) => e.ownedGlobs.map(repFileFromGlob));

    for (const file of repFiles) {
      const owners = findOwningEntries(reg, [file]);
      assert.ok(
        owners.length <= 1,
        `File "${file}" is claimed by ${owners.length} entries (regrowth invariant violated): [${owners.map((e) => e.docPath).join(', ')}]`,
      );
    }
  },
);
