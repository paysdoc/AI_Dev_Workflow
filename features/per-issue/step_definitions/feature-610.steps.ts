/**
 * BDD step definitions for feature-610.feature
 * app_docs living-docs: semantic routing + sibling collapse
 *
 * Design decisions:
 *  - The collapse routing (parse → findOwningEntries → collapseEntries → serialize) is driven
 *    IN-PROCESS using the registry module directly. The LLM-authored doc body is STUBBED —
 *    convergence counts are deterministic code, not prose.
 *  - A temp fixture directory seeds a conditional_docs.md plus app_docs/ module docs.
 *  - The semantic routing is supplied as test input (the sibling set + survivor docPath are
 *    seeded), not derived by an LLM, so collapse counts are pinned hermetically.
 *  - All assertions target PRODUCED artefacts (the written index and docs), never source files.
 *
 * Reused registered phrases:
 *  - Given 'the ADW codebase is checked out'    → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
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
  collapseEntries,
  upsertEntry,
  type ConditionalDocEntry,
  type ConditionalDocsRegistry,
} from '../../../adws/core/conditionalDocsRegistry.ts';

// ---------------------------------------------------------------------------
// Per-scenario state — reset in Before hook scoped to @adw-610
// ---------------------------------------------------------------------------

interface ScenarioState {
  fixtureDir: string;
  registry: ConditionalDocsRegistry;
  moduleDocs: Map<string, string>;
  preRunEntries: ConditionalDocEntry[];
  /** Entries that are "siblings" for collapse scenarios (pre-run snapshot) */
  siblingEntries: ConditionalDocEntry[];
  /** Stale description marker for §4 */
  staleDescription: string;
  /** Area being tested (path prefix) */
  area: string;
  /** For §1: the pre-existing entry's docPath */
  preExistingDocPath: string;
  /** Pre-run entry count for novel-area check */
  preRunEntryCount: number;
}

let state: ScenarioState = makeEmptyState();

function makeEmptyState(): ScenarioState {
  return {
    fixtureDir: '',
    registry: { preamble: '# Conditional Documentation\n\n', entries: [] },
    moduleDocs: new Map(),
    preRunEntries: [],
    siblingEntries: [],
    staleDescription: '',
    area: '',
    preExistingDocPath: '',
    preRunEntryCount: 0,
  };
}

Before({ tags: '@adw-610' }, function () {
  if (state.fixtureDir) {
    fs.rmSync(state.fixtureDir, { recursive: true, force: true });
  }
  state = makeEmptyState();
  state.fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-610-'));
  fs.mkdirSync(path.join(state.fixtureDir, '.adw'), { recursive: true });
  fs.mkdirSync(path.join(state.fixtureDir, 'app_docs'), { recursive: true });
});

After({ tags: '@adw-610' }, function () {
  if (state.fixtureDir) {
    fs.rmSync(state.fixtureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flushRegistry(): void {
  const content = serializeConditionalDocs(state.registry);
  fs.writeFileSync(path.join(state.fixtureDir, '.adw', 'conditional_docs.md'), content, 'utf-8');
}

function readRegistry(): ConditionalDocsRegistry {
  const p = path.join(state.fixtureDir, '.adw', 'conditional_docs.md');
  const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  return parseConditionalDocs(content);
}

function writeModuleDoc(docPath: string, content: string): void {
  const absPath = path.join(state.fixtureDir, docPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
}

function safeDocName(area: string): string {
  return area.replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '');
}

// ---------------------------------------------------------------------------
// Given — §1: semantic entry with deliberate glob miss
// ---------------------------------------------------------------------------

Given(
  'a conditional-docs index whose only entry for the area under {string} is described semantically but does not list {string} among its owned file globs',
  function (area: string, _touchedFile: string) {
    state.area = area;
    const areaName = safeDocName(area.replace(/\/$/, ''));
    const docPath = `app_docs/feature-610-${areaName}-module.md`;
    state.preExistingDocPath = docPath;

    // Deliberately seed a DIFFERENT glob that does NOT match the touched file
    const wrongGlob = `${area.replace(/\/$/, '')}/__old/**`;

    const entry: ConditionalDocEntry = {
      docPath,
      ownedGlobs: [wrongGlob],
      conditions: [`When working on the \`${area}\` state management module`],
    };

    state.registry = {
      preamble: '# Conditional Documentation\n\n',
      entries: [entry],
    };
    state.siblingEntries = [entry];

    writeModuleDoc(
      docPath,
      `# Module: ${areaName}\n\n## Overview\n\nState management module.\n\n## Responsibilities\n\n- Manages state.\n`,
    );
    flushRegistry();
    state.preRunEntryCount = state.registry.entries.length;
  },
);

// ---------------------------------------------------------------------------
// Given — §2: 3 siblings describing one area
// ---------------------------------------------------------------------------

Given(
  'a conditional-docs index with three sibling entries describing the same area under {string}',
  function (area: string) {
    state.area = area;
    const areaName = safeDocName(area.replace(/\/$/, ''));
    const siblings: ConditionalDocEntry[] = [
      {
        docPath: `app_docs/feature-610-${areaName}-v1.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/**`],
        conditions: [`When working on \`${area}\` module (v1)`],
      },
      {
        docPath: `app_docs/feature-610-${areaName}-v2.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/phase/**`],
        conditions: [`When working on \`${area}\` module (v2)`],
      },
      {
        docPath: `app_docs/feature-610-${areaName}-v3.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/records/**`],
        conditions: [`When working on \`${area}\` module (v3)`],
      },
    ];
    state.siblingEntries = siblings;
    state.registry = { preamble: '# Conditional Documentation\n\n', entries: [...siblings] };

    for (const sib of siblings) {
      writeModuleDoc(
        sib.docPath,
        `# Module: ${sib.docPath}\n\n## Overview\n\nSibling doc.\n`,
      );
    }
    flushRegistry();
    state.preRunEntryCount = state.registry.entries.length;
  },
);

// ---------------------------------------------------------------------------
// Given — §3: 3 siblings + N unrelated module entries
// ---------------------------------------------------------------------------

Given(
  'a conditional-docs index with three sibling entries describing the area under {string} alongside entries for {int} unrelated modules',
  function (area: string, unrelatedCount: number) {
    state.area = area;
    const areaName = safeDocName(area.replace(/\/$/, ''));
    const siblings: ConditionalDocEntry[] = [
      {
        docPath: `app_docs/feature-610-${areaName}-v1.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/**`],
        conditions: [`When working on \`${area}\` (v1)`],
      },
      {
        docPath: `app_docs/feature-610-${areaName}-v2.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/sub/**`],
        conditions: [`When working on \`${area}\` (v2)`],
      },
      {
        docPath: `app_docs/feature-610-${areaName}-v3.md`,
        ownedGlobs: [`${area.replace(/\/$/, '')}/extra/**`],
        conditions: [`When working on \`${area}\` (v3)`],
      },
    ];
    state.siblingEntries = siblings;

    const unrelated: ConditionalDocEntry[] = [];
    for (let i = 1; i <= unrelatedCount; i++) {
      const u: ConditionalDocEntry = {
        docPath: `app_docs/feature-610-unrelated${i}.md`,
        ownedGlobs: [`adws/unrelated${i}/**`],
        conditions: [`When working on unrelated module ${i}`],
      };
      unrelated.push(u);
      writeModuleDoc(u.docPath, `# Unrelated ${i}\n\n## Overview\n\nUnrelated.\n`);
    }

    state.preRunEntries = unrelated.map((e) => ({ ...e }));
    state.registry = {
      preamble: '# Conditional Documentation\n\n',
      entries: [...siblings, ...unrelated],
    };

    for (const sib of siblings) {
      writeModuleDoc(sib.docPath, `# Sibling\n\n## Overview\n\nSibling.\n`);
    }
    flushRegistry();
    state.preRunEntryCount = state.registry.entries.length;
  },
);

// ---------------------------------------------------------------------------
// Given — §4: single entry with stale description
// ---------------------------------------------------------------------------

Given(
  "a conditional-docs index whose single entry for the area under {string} carries a stale description that no longer reflects the module's current content",
  function (area: string) {
    state.area = area;
    state.staleDescription = 'STALE: This description is outdated and no longer accurate';
    const areaName = safeDocName(area.replace(/\/$/, ''));
    const docPath = `app_docs/feature-610-${areaName}-module.md`;
    state.preExistingDocPath = docPath;

    const entry: ConditionalDocEntry = {
      docPath,
      ownedGlobs: [`${area.replace(/\/$/, '')}/**`],
      conditions: [state.staleDescription],
    };

    state.registry = { preamble: '# Conditional Documentation\n\n', entries: [entry] };
    state.siblingEntries = [entry];

    writeModuleDoc(
      docPath,
      `# Module: ${areaName}\n\n## Overview\n\n${state.staleDescription}\n`,
    );
    flushRegistry();
    state.preRunEntryCount = state.registry.entries.length;
  },
);

// ---------------------------------------------------------------------------
// Given — §5: N unrelated modules, none owning the novel area
// ---------------------------------------------------------------------------

Given(
  '{int} unrelated modules, none of which owns the area under {string}',
  function (count: number, area: string) {
    state.area = area;
    const entries: ConditionalDocEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const u: ConditionalDocEntry = {
        docPath: `app_docs/feature-610-unrelated${i}.md`,
        ownedGlobs: [`adws/unrelated${i}/**`],
        conditions: [`When working on unrelated module ${i}`],
      };
      entries.push(u);
      writeModuleDoc(u.docPath, `# Unrelated ${i}\n\n## Overview\n\nUnrelated.\n`);
    }
    state.preRunEntries = entries.map((e) => ({ ...e }));
    state.registry = { preamble: '# Conditional Documentation\n\n', entries: [...entries] };
    flushRegistry();
    state.preRunEntryCount = state.registry.entries.length;
  },
);

Given(
  'a conditional-docs index describing {int} unrelated modules, none of which owns the area under {string}',
  function (count: number, area: string) {
    state.area = area;
    const entries: ConditionalDocEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const u: ConditionalDocEntry = {
        docPath: `app_docs/feature-610-unrelated${i}.md`,
        ownedGlobs: [`adws/unrelated${i}/**`],
        conditions: [`When working on unrelated module ${i}`],
      };
      entries.push(u);
      writeModuleDoc(u.docPath, `# Unrelated ${i}\n\n## Overview\n\nUnrelated.\n`);
    }
    state.preRunEntries = entries.map((e) => ({ ...e }));
    state.registry = { preamble: '# Conditional Documentation\n\n', entries: [...entries] };
    flushRegistry();
    state.preRunEntryCount = state.registry.entries.length;
  },
);

// ---------------------------------------------------------------------------
// When — /document agent documents a change (shared across §1–§5)
// ---------------------------------------------------------------------------

When(
  /^the \/document agent documents a change touching "([^"]+)"$/,
  function (touchedFile: string) {
    const reg = readRegistry();

    // §1: semantic route — the entry is not found by glob, so we use the
    //     pre-seeded sibling as the semantic owner (supplied as test input).
    const globMatches = findOwningEntries(reg, [touchedFile]);

    if (state.siblingEntries.length === 1 && globMatches.length === 0) {
      // §1: glob miss — semantic owner is the pre-existing entry (supplied as input)
      const semanticOwner = state.siblingEntries[0];
      const areaName = safeDocName(state.area.replace(/\/$/, ''));
      const newConditions = [
        `When working on the \`${state.area}\` module`,
        `When modifying \`${touchedFile}\``,
      ];
      const updatedEntry: ConditionalDocEntry = {
        docPath: semanticOwner.docPath,
        ownedGlobs: [...semanticOwner.ownedGlobs, `${state.area.replace(/\/$/, '')}/**`],
        conditions: newConditions,
      };
      writeModuleDoc(
        semanticOwner.docPath,
        `# Module: ${areaName}\n\n## Overview\n\nUpdated current-state reference.\n\n## Responsibilities\n\n- Handles ${touchedFile}\n`,
      );
      const updatedReg = upsertEntry(reg, updatedEntry);
      fs.writeFileSync(
        path.join(state.fixtureDir, '.adw', 'conditional_docs.md'),
        serializeConditionalDocs(updatedReg),
        'utf-8',
      );
      return;
    }

    if (state.siblingEntries.length > 1) {
      // §2/§3: collapse multiple siblings into one survivor
      const areaName = safeDocName(state.area.replace(/\/$/, ''));
      const survivorDocPath = state.siblingEntries[0].docPath;
      const allSiblingDocPaths = state.siblingEntries.map((e) => e.docPath);
      const newConditions = [
        `When working on the \`${state.area}\` module`,
        `When modifying \`${touchedFile}\``,
      ];

      const { registry: collapsed, prunedDocPaths } = collapseEntries(
        reg,
        allSiblingDocPaths,
        { docPath: survivorDocPath, conditions: newConditions },
      );

      // Write survivor doc
      writeModuleDoc(
        survivorDocPath,
        `# Module: ${areaName}\n\n## Overview\n\nMerged current-state reference.\n\n## Responsibilities\n\n- Handles ${touchedFile}\n`,
      );

      // Delete pruned doc files
      for (const pruned of prunedDocPaths) {
        const absPath = path.join(state.fixtureDir, pruned);
        if (fs.existsSync(absPath)) {
          fs.rmSync(absPath);
        }
      }

      fs.writeFileSync(
        path.join(state.fixtureDir, '.adw', 'conditional_docs.md'),
        serializeConditionalDocs(collapsed),
        'utf-8',
      );
      return;
    }

    if (state.siblingEntries.length === 1 && globMatches.length > 0) {
      // §4: single entry glob match — rewrite with regenerated description
      const owner = globMatches[0];
      const areaName = safeDocName(state.area.replace(/\/$/, ''));
      const regeneratedConditions = [
        `When working on the \`${state.area}\` module`,
        `When modifying \`${touchedFile}\``,
      ];
      const updatedEntry: ConditionalDocEntry = {
        docPath: owner.docPath,
        ownedGlobs: owner.ownedGlobs,
        conditions: regeneratedConditions,
      };
      writeModuleDoc(
        owner.docPath,
        `# Module: ${areaName}\n\n## Overview\n\nRegenerated current-state reference for ${state.area} module.\n\n## Responsibilities\n\n- Handles ${touchedFile}\n`,
      );
      const updatedReg = upsertEntry(reg, updatedEntry);
      fs.writeFileSync(
        path.join(state.fixtureDir, '.adw', 'conditional_docs.md'),
        serializeConditionalDocs(updatedReg),
        'utf-8',
      );
      return;
    }

    // §5: novel area — no glob matches, no siblings — create new
    const area = touchedFile.split('/').slice(0, -1).join('/');
    const safeName = safeDocName(area);
    const newDocPath = `app_docs/feature-610-${safeName}-module.md`;
    const ownedGlob = `${area}/**`;
    const newEntry: ConditionalDocEntry = {
      docPath: newDocPath,
      ownedGlobs: [ownedGlob],
      conditions: [`When working on \`${area}/\` module`],
    };
    writeModuleDoc(
      newDocPath,
      `# Module: ${safeName}\n\n## Overview\n\nNew module reference.\n\n## Responsibilities\n\n- Handles ${touchedFile}\n`,
    );
    const updatedReg = upsertEntry(reg, newEntry);
    fs.writeFileSync(
      path.join(state.fixtureDir, '.adw', 'conditional_docs.md'),
      serializeConditionalDocs(updatedReg),
      'utf-8',
    );
  },
);

// ---------------------------------------------------------------------------
// Then — assertions on produced artefacts
// ---------------------------------------------------------------------------

Then(
  'the conditional-docs index holds exactly one entry for the area under {string}',
  function (area: string) {
    const reg = readRegistry();
    const normalised = area.replace(/\/$/, '');
    const matching = reg.entries.filter(
      (e) =>
        e.ownedGlobs.some((g) => {
          const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
          return base === normalised || base.startsWith(normalised + '/');
        }) ||
        e.conditions.some((c) => c.includes(`\`${normalised}`)),
    );
    assert.strictEqual(
      matching.length,
      1,
      `Expected exactly 1 entry for area "${area}" but found ${matching.length}: [${matching.map((e) => e.docPath).join(', ')}]`,
    );
  },
);

Then(
  'exactly one module doc covers the area under {string}',
  function (area: string) {
    const reg = readRegistry();
    const normalised = area.replace(/\/$/, '');
    const matchingEntries = reg.entries.filter(
      (e) =>
        e.ownedGlobs.some((g) => {
          const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
          return base === normalised || base.startsWith(normalised + '/');
        }) ||
        e.conditions.some((c) => c.includes(`\`${normalised}`)),
    );
    const existingDocs = matchingEntries.filter((e) =>
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
  'that one entry is the pre-existing entry, updated in place rather than appended alongside a new sibling',
  function () {
    const reg = readRegistry();
    const found = reg.entries.find((e) => e.docPath === state.preExistingDocPath);
    assert.ok(
      found,
      `Expected pre-existing entry "${state.preExistingDocPath}" to still exist but it was not found`,
    );
    assert.strictEqual(
      reg.entries.length,
      state.preRunEntryCount,
      `Expected entry count to remain ${state.preRunEntryCount} (in-place update), but got ${reg.entries.length}`,
    );
  },
);

Then(
  'the redundant sibling entries that described the area under {string} are pruned from the index',
  function (area: string) {
    const reg = readRegistry();
    const normalised = area.replace(/\/$/, '');
    const areaEntries = reg.entries.filter(
      (e) =>
        e.ownedGlobs.some((g) => {
          const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
          return base === normalised || base.startsWith(normalised + '/');
        }) ||
        e.conditions.some((c) => c.includes(`\`${normalised}`)),
    );
    assert.strictEqual(
      areaEntries.length,
      1,
      `Expected exactly 1 entry for area "${area}" after pruning, but found ${areaEntries.length}`,
    );
    // The redundant sibling docs should be gone from the fixture dir
    const siblingDocPaths = state.siblingEntries.slice(1).map((e) => e.docPath);
    for (const docPath of siblingDocPaths) {
      const absPath = path.join(state.fixtureDir, docPath);
      assert.ok(
        !fs.existsSync(absPath),
        `Expected pruned sibling doc "${docPath}" to be deleted but it still exists`,
      );
    }
  },
);

Then('every unrelated module entry is left unchanged', function () {
  const reg = readRegistry();
  for (const preEntry of state.preRunEntries) {
    const current = reg.entries.find((e) => e.docPath === preEntry.docPath);
    assert.ok(
      current,
      `Expected unrelated entry "${preEntry.docPath}" to survive but it was removed`,
    );
    assert.deepStrictEqual(
      current.ownedGlobs,
      preEntry.ownedGlobs,
      `Unrelated entry "${preEntry.docPath}" ownedGlobs changed`,
    );
    assert.deepStrictEqual(
      current.conditions,
      preEntry.conditions,
      `Unrelated entry "${preEntry.docPath}" conditions changed`,
    );
  }
});

Then(
  "the entry for the area under {string} carries a regenerated description reflecting the module's current content rather than the stale seeded text",
  function (area: string) {
    const reg = readRegistry();
    const normalised = area.replace(/\/$/, '');
    const entry = reg.entries.find(
      (e) =>
        e.ownedGlobs.some((g) => {
          const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
          return base === normalised || base.startsWith(normalised + '/');
        }),
    );
    assert.ok(entry, `No entry found for area "${area}"`);
    const hasStale = entry.conditions.some((c) => c.includes(state.staleDescription));
    assert.ok(
      !hasStale,
      `Entry for "${area}" still carries the stale description: "${state.staleDescription}"`,
    );
    assert.ok(
      entry.conditions.length > 0,
      `Entry for "${area}" has no conditions after regeneration`,
    );
  },
);

Then(
  /^the \/document agent creates exactly one new module doc and one new index entry for the area under "([^"]+)"$/,
  function (area: string) {
    const reg = readRegistry();
    const normalised = area.replace(/\/$/, '');
    const newEntries = reg.entries.filter(
      (e) =>
        e.ownedGlobs.some((g) => {
          const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
          return base === normalised || base.startsWith(normalised + '/');
        }) ||
        e.conditions.some((c) => c.includes(`\`${normalised}`)),
    );
    assert.strictEqual(
      newEntries.length,
      1,
      `Expected exactly 1 new entry for area "${area}" but found ${newEntries.length}`,
    );
    const docPath = newEntries[0].docPath;
    const absPath = path.join(state.fixtureDir, docPath);
    assert.ok(fs.existsSync(absPath), `Expected new module doc at "${docPath}" but it does not exist`);
    assert.strictEqual(
      reg.entries.length,
      state.preRunEntryCount + 1,
      `Expected entry count to grow by 1 (novel create), but went from ${state.preRunEntryCount} to ${reg.entries.length}`,
    );
  },
);
