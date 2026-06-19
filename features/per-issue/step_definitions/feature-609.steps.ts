/**
 * BDD step definitions for feature-609.feature
 * app_docs living-docs convergence core — rewrite-in-place, no append
 *
 * Design decisions:
 *  - The convergence routing (parse → findOwning → upsert → serialize) is driven
 *    IN-PROCESS using the registry module directly. The LLM-authored doc body is
 *    STUBBED — convergence counts are deterministic code, not prose.
 *  - A temp fixture directory seeds a conditional_docs.md with owned globs plus
 *    the corresponding app_docs/ module docs (test INPUT, not this repo's sources).
 *  - All assertions target PRODUCED artefacts (the written index and docs), never
 *    source files. No assertion reads .claude/commands/document.md as text.
 *
 * Reused registered phrases:
 *  - Given 'the ADW codebase is checked out'   → ensureCronOnEveryEventSteps.ts (G18)
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
  findOwningEntry,
  upsertEntry,
  type ConditionalDocEntry,
  type ConditionalDocsRegistry,
} from '../../../adws/core/conditionalDocsRegistry.ts';

// ---------------------------------------------------------------------------
// Per-scenario state — reset in Before hook scoped to @adw-609
// ---------------------------------------------------------------------------

interface ScenarioState {
  fixtureDir: string;
  registry: ConditionalDocsRegistry;
  /** module docs present in fixture: docPath → content */
  moduleDocs: Map<string, string>;
  /** pre-run registry snapshot (for §4 sibling-preservation check) */
  preRunEntries: ConditionalDocEntry[];
}

let state: ScenarioState = makeEmptyState();

function makeEmptyState(): ScenarioState {
  return {
    fixtureDir: '',
    registry: { preamble: '# Conditional Documentation\n\n', entries: [] },
    moduleDocs: new Map(),
    preRunEntries: [],
  };
}

Before({ tags: '@adw-609' }, function () {
  if (state.fixtureDir) {
    fs.rmSync(state.fixtureDir, { recursive: true, force: true });
  }
  state = makeEmptyState();
  state.fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-609-'));
  fs.mkdirSync(path.join(state.fixtureDir, '.adw'), { recursive: true });
  fs.mkdirSync(path.join(state.fixtureDir, 'app_docs'), { recursive: true });
});

After({ tags: '@adw-609' }, function () {
  if (state.fixtureDir) {
    fs.rmSync(state.fixtureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write the current registry state to .adw/conditional_docs.md */
function flushRegistry(): void {
  const content = serializeConditionalDocs(state.registry);
  fs.writeFileSync(path.join(state.fixtureDir, '.adw', 'conditional_docs.md'), content, 'utf-8');
}

/** Read the current registry from the fixture file */
function readRegistry(): ConditionalDocsRegistry {
  const p = path.join(state.fixtureDir, '.adw', 'conditional_docs.md');
  const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  return parseConditionalDocs(content);
}

/** Write a stub module doc file */
function writeModuleDoc(docPath: string, content: string): void {
  const absPath = path.join(state.fixtureDir, docPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
}

/** Simulate a /document convergence run over the given touched files.
 *  Finds the owning entry (or creates a novel one) and updates/creates the
 *  module doc + index entry. Doc body is a stub. */
function runDocumentConvergence(touchedFiles: string[]): void {
  const reg = readRegistry();
  const owning = findOwningEntry(reg, touchedFiles);

  if (owning) {
    // Rewrite owning doc in place — stub body (no history / changelog section)
    const stubBody = `# Module: ${owning.docPath}\n\n## Overview\n\nCurrent-state module reference.\n\n## Responsibilities\n\n- Handles ${touchedFiles[0]}\n\n## Contracts & Invariants\n\n- No changelog section.\n`;
    writeModuleDoc(owning.docPath, stubBody);

    // Ensure owned globs cover touched files
    const updatedGlobs = ensureGlobsCover(owning.ownedGlobs, touchedFiles);
    const updatedEntry: ConditionalDocEntry = {
      docPath: owning.docPath,
      ownedGlobs: updatedGlobs,
      conditions: owning.conditions.length > 0
        ? owning.conditions
        : [`When working on ${touchedFiles[0]}`],
    };
    const updatedReg = upsertEntry(reg, updatedEntry);
    const content = serializeConditionalDocs(updatedReg);
    fs.writeFileSync(
      path.join(state.fixtureDir, '.adw', 'conditional_docs.md'),
      content,
      'utf-8',
    );
  } else {
    // Novel area — create new doc + one new entry
    const area = touchedFiles[0].split('/').slice(0, -1).join('/');
    const safeName = area.replace(/\//g, '-');
    const newDocPath = `app_docs/feature-609-${safeName}-module.md`;
    const stubBody = `# Module: ${safeName}\n\n## Overview\n\nCurrent-state module reference.\n\n## Responsibilities\n\n- Handles ${touchedFiles[0]}\n\n## Contracts & Invariants\n\n- No changelog section.\n`;
    writeModuleDoc(newDocPath, stubBody);

    const ownedGlob = `${area}/**`;
    const newEntry: ConditionalDocEntry = {
      docPath: newDocPath,
      ownedGlobs: [ownedGlob],
      conditions: [`When working on \`${area}/\` module`],
    };
    const updatedReg = upsertEntry(reg, newEntry);
    const content = serializeConditionalDocs(updatedReg);
    fs.writeFileSync(
      path.join(state.fixtureDir, '.adw', 'conditional_docs.md'),
      content,
      'utf-8',
    );
  }
}

/** Returns globs ensuring all touchedFiles are covered (adds `area/**` if needed). */
function ensureGlobsCover(globs: string[], touchedFiles: string[]): string[] {
  const result = [...globs];
  for (const file of touchedFiles) {
    const area = file.split('/').slice(0, -1).join('/');
    const glob = `${area}/**`;
    const alreadyCovered = globs.some(
      (g) => fileMatchesGlob(g, file),
    );
    if (!alreadyCovered && !result.includes(glob)) {
      result.push(glob);
    }
  }
  return result;
}

function fileMatchesGlob(glob: string, filePath: string): boolean {
  const escapedLit = (ch: string): string => /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && i + 1 < glob.length && glob[i + 1] === '*') {
      pattern += '.*'; i += 2;
      if (i < glob.length && glob[i] === '/') i++;
    } else if (ch === '*') {
      pattern += '[^/]*'; i++;
    } else if (ch === '?') {
      pattern += '[^/]'; i++;
    } else {
      pattern += escapedLit(ch); i++;
    }
  }
  return new RegExp(`^${pattern}$`).test(filePath);
}

// ---------------------------------------------------------------------------
// §1 and §3 Given — index already owns an area
// ---------------------------------------------------------------------------

Given(
  'a conditional-docs index that already owns the area matched by glob {string} with a single module doc',
  function (glob: string) {
    // Extract area from glob (e.g. "adws/vcs/**" → "adws/vcs")
    const area = glob.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
    const docPath = `app_docs/feature-609-${area.replace(/\//g, '-')}-module.md`;

    state.registry = {
      preamble: '# Conditional Documentation\n\n',
      entries: [
        {
          docPath,
          ownedGlobs: [glob],
          conditions: [`When working on \`${area}/\` module`],
        },
      ],
    };
    const stubBody = `# Module: ${area}\n\n## Overview\n\nExisting current-state reference.\n\n## Responsibilities\n\n- Initial content.\n\n## Contracts & Invariants\n\n- No changelog.\n`;
    writeModuleDoc(docPath, stubBody);
    flushRegistry();
  },
);

// ---------------------------------------------------------------------------
// §4 Given — index owns an area alongside unrelated module entries
// ---------------------------------------------------------------------------

Given(
  'a conditional-docs index that owns the area matched by glob {string} alongside entries for {int} unrelated modules',
  function (glob: string, siblingCount: number) {
    const area = glob.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
    const docPath = `app_docs/feature-609-${area.replace(/\//g, '-')}-module.md`;

    const entries: ConditionalDocEntry[] = [
      { docPath, ownedGlobs: [glob], conditions: [`When working on \`${area}/\`  module`] },
    ];
    for (let i = 1; i <= siblingCount; i++) {
      const sibArea = `adws/sibling${i}`;
      const sibDoc = `app_docs/feature-609-sibling${i}-module.md`;
      entries.push({ docPath: sibDoc, ownedGlobs: [`${sibArea}/**`], conditions: [`When working on sibling${i}`] });
      writeModuleDoc(sibDoc, `# Sibling ${i}\n\n## Overview\n\nSibling module.\n`);
    }

    state.registry = { preamble: '# Conditional Documentation\n\n', entries };
    writeModuleDoc(docPath, `# Module: ${area}\n\n## Overview\n\nExisting.\n`);
    flushRegistry();

    // Snapshot pre-run state of sibling entries for §4 assertion
    state.preRunEntries = entries.slice(1).map((e) => ({ ...e }));
  },
);

// ---------------------------------------------------------------------------
// §2 and §5 Given — index has no entry owning an area
// ---------------------------------------------------------------------------

Given(
  'a conditional-docs index with no entry owning files under {string}',
  function (_areaPrefix: string) {
    // Seed a registry with unrelated entries only (none owning _areaPrefix)
    const unrelatedArea = 'adws/unrelated';
    state.registry = {
      preamble: '# Conditional Documentation\n\n',
      entries: [
        {
          docPath: 'app_docs/feature-609-unrelated-module.md',
          ownedGlobs: [`${unrelatedArea}/**`],
          conditions: ['When working on unrelated module'],
        },
      ],
    };
    writeModuleDoc(
      'app_docs/feature-609-unrelated-module.md',
      `# Unrelated\n\n## Overview\n\nUnrelated module.\n`,
    );
    flushRegistry();
  },
);

// ---------------------------------------------------------------------------
// When — /document run (convergence simulation)
// "/" is the alternation operator in Cucumber Expressions, so use regex
// ---------------------------------------------------------------------------

When(
  /^a \/document run documents a change touching "([^"]+)"$/,
  function (touchedFile: string) {
    runDocumentConvergence([touchedFile]);
  },
);

When(
  /^a second \/document run documents another change touching "([^"]+)"$/,
  function (touchedFile: string) {
    runDocumentConvergence([touchedFile]);
  },
);

// ---------------------------------------------------------------------------
// Then — convergence assertions
// ---------------------------------------------------------------------------

Then(
  'the conditional-docs index contains exactly one entry owning files under {string}',
  function (areaPrefix: string) {
    const reg = readRegistry();
    const normalised = areaPrefix.endsWith('/') ? areaPrefix : areaPrefix + '/';
    const owning = reg.entries.filter(
      (e) => e.ownedGlobs.some((g) => {
        const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
        return base === normalised.replace(/\/$/, '') || g.startsWith(normalised) || g.startsWith(normalised.replace(/\/$/, ''));
      }),
    );
    assert.strictEqual(
      owning.length,
      1,
      `Expected exactly 1 entry owning "${areaPrefix}" but found ${owning.length}: [${owning.map((e) => e.docPath).join(', ')}]`,
    );
  },
);

Then(
  'exactly one module doc exists for the area owning files under {string}',
  function (areaPrefix: string) {
    const reg = readRegistry();
    const normalised = areaPrefix.endsWith('/') ? areaPrefix : areaPrefix + '/';
    const owningEntries = reg.entries.filter(
      (e) => e.ownedGlobs.some((g) => {
        const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
        return base === normalised.replace(/\/$/, '') || g.startsWith(normalised.replace(/\/$/, ''));
      }),
    );
    const existingDocs = owningEntries.filter((e) =>
      fs.existsSync(path.join(state.fixtureDir, e.docPath)),
    );
    assert.strictEqual(
      existingDocs.length,
      1,
      `Expected exactly 1 module doc for "${areaPrefix}" but found ${existingDocs.length}: [${existingDocs.map((e) => e.docPath).join(', ')}]`,
    );
  },
);

Then(
  'the module doc for the area owning files under {string} contains no per-feature history or changelog section',
  function (areaPrefix: string) {
    const reg = readRegistry();
    const normalised = areaPrefix.replace(/\/$/, '');
    const owning = reg.entries.find(
      (e) => e.ownedGlobs.some((g) => {
        const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
        return base === normalised;
      }),
    );
    assert.ok(owning, `No owning entry found for "${areaPrefix}"`);
    const absPath = path.join(state.fixtureDir, owning.docPath);
    assert.ok(fs.existsSync(absPath), `Module doc "${owning.docPath}" does not exist`);
    const content = fs.readFileSync(absPath, 'utf-8');
    const forbiddenPatterns = [
      /^##\s+(What Was Built|Files Modified|Changelog|History|Changes|ADW ID|Date)/im,
      /^\*\*ADW ID:\*\*/m,
      /^\*\*Date:\*\*/m,
    ];
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `Module doc "${owning.docPath}" contains a forbidden per-feature history / changelog section matching ${pattern}`,
      );
    }
  },
);

Then('the entries for the unrelated modules are preserved unchanged', function () {
  const reg = readRegistry();
  for (const preEntry of state.preRunEntries) {
    const current = reg.entries.find((e) => e.docPath === preEntry.docPath);
    assert.ok(
      current,
      `Expected sibling entry "${preEntry.docPath}" to still exist but it was removed`,
    );
    assert.deepStrictEqual(
      current.ownedGlobs,
      preEntry.ownedGlobs,
      `Sibling entry "${preEntry.docPath}" ownedGlobs changed unexpectedly`,
    );
    assert.deepStrictEqual(
      current.conditions,
      preEntry.conditions,
      `Sibling entry "${preEntry.docPath}" conditions changed unexpectedly`,
    );
  }
});

Then(
  'a new module doc and a single new index entry are created for the area owning files under {string}',
  function (areaPrefix: string) {
    const reg = readRegistry();
    const normalised = areaPrefix.replace(/\/$/, '');
    const newEntries = reg.entries.filter(
      (e) => e.ownedGlobs.some((g) => {
        const base = g.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
        return base === normalised || base.startsWith(normalised);
      }),
    );
    assert.strictEqual(
      newEntries.length,
      1,
      `Expected exactly 1 new entry for "${areaPrefix}" but found ${newEntries.length}`,
    );
    const docPath = newEntries[0].docPath;
    const absPath = path.join(state.fixtureDir, docPath);
    assert.ok(
      fs.existsSync(absPath),
      `Expected new module doc at "${docPath}" but it does not exist`,
    );
  },
);
