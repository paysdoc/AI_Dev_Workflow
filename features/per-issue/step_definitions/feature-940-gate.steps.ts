/**
 * §2-§4 of feature-940.feature: drives the real docs-index gate (`runLivingDocsIndexCheck`)
 * in-process over throwaway fixture repositories. The fixture index is written by hand in the
 * canonical form (`feature-940-fixture.ts`), so the serializer under test never builds its own
 * input. The ADW-checkout rows (§5) live in `feature-940-checkout.steps.ts`.
 */

import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { rmSync } from 'fs';
import { join } from 'path';

import { runLivingDocsIndexCheck } from '../../../adws/checkLivingDocsIndex.ts';
import {
  canonicalIndexText, gateState, makeTempDir, splitList, writeFixtureFile, type IndexRow,
} from './feature-940-fixture.ts';

const HEALTHY_DOC_COUNT = 40;

const repo: { root: string | null; rows: IndexRow[] } = { root: null, rows: [] };

After({ tags: '@adw-940' }, function () {
  repo.root = null;
  repo.rows = [];
});

function requireRoot(): string {
  assert.ok(repo.root, 'Expected a fixture repository to have been built first');
  return repo.root;
}

/** The file a record would have; a record with no file is linked to this same path. */
function adrFileName(record: string): string {
  return `${record}-record.md`;
}

function writeIndex(): void {
  writeFixtureFile(requireRoot(), '.adw/conditional_docs.md', canonicalIndexText(repo.rows));
}

function writeModuleDoc(docPath: string, body = `# ${docPath}\n`): void {
  writeFixtureFile(requireRoot(), docPath, body);
}

function moduleNameOf(docPath: string): string {
  return docPath.replace(/^.*\//, '').replace(/\.md$/, '').replace(/^feature-/, '');
}

/** A module the fixture lacks is added in full: its doc, one source file, and an entry owning that source. */
function ensureModule(docPath: string): void {
  if (repo.rows.some((row) => row.docPath === docPath)) return;
  const name = moduleNameOf(docPath);
  writeModuleDoc(docPath);
  writeFixtureFile(requireRoot(), `src/${name}/index.ts`, 'export {};\n');
  repo.rows.push({ docPath, owns: [`src/${name}/**`], decisions: [] });
}

function setEntryDecisions(docPath: string, decisions: string[], decisionsHeader?: string): void {
  ensureModule(docPath);
  repo.rows = repo.rows.map((row) => (row.docPath === docPath ? { ...row, decisions, decisionsHeader } : row));
  writeIndex();
}

function decisionsSection(records: string[]): string {
  const bullets = records.map((record) => `- [ADR-${record}](../specs/adr/${adrFileName(record)}) — Record ${record}`);
  return ['## Decisions', '', ...bullets, ''].join('\n');
}

Given('a fixture repository whose living-docs index and module docs are healthy', function () {
  repo.root = makeTempDir('adw-940-fixture-');
  repo.rows = [];
  for (let i = 0; i < HEALTHY_DOC_COUNT; i++) {
    const docPath = `app_docs/feature-fixture${i}.md`;
    repo.rows.push({ docPath, owns: [], decisions: [] });
    writeModuleDoc(docPath);
  }
  for (const docPath of ['README.md', 'adws/README.md']) {
    repo.rows.push({ docPath, owns: [], decisions: [] });
    writeModuleDoc(docPath);
  }
  writeIndex();
});

Given('the fixture repository holds the decision records {string}', function (records: string) {
  for (const record of splitList(records)) {
    writeFixtureFile(requireRoot(), `specs/adr/${adrFileName(record)}`, `# ADR-${record}\n`);
  }
});

Given('the fixture repository has no ADR directory', function () {
  rmSync(join(requireRoot(), 'specs', 'adr'), { recursive: true, force: true });
});

Given('the index entry for {string} carries a Decisions block listing {string}', function (docPath: string, records: string) {
  setEntryDecisions(docPath, splitList(records));
});

Given(
  'the index entry for {string} carries a block named {string} listing {string}',
  function (docPath: string, header: string, records: string) {
    setEntryDecisions(docPath, splitList(records), header);
  },
);

Given('the index entry for {string} carries no Decisions block', function (docPath: string) {
  setEntryDecisions(docPath, []);
});

Given('the module doc {string} has a Decisions section listing {string}', function (docPath: string, records: string) {
  ensureModule(docPath);
  writeModuleDoc(docPath, `# ${docPath}\n\n${decisionsSection(splitList(records))}`);
  writeIndex();
});

When('the module doc {string} is rewritten without its Decisions section', function (docPath: string) {
  writeModuleDoc(docPath, `# ${docPath}\n\nRewritten from the current source.\n`);
});

When('the docs-index gate is run over the fixture repository', function () {
  const { exitCode, lines } = runLivingDocsIndexCheck(requireRoot());
  gateState.exitCode = exitCode;
  gateState.stdout = lines.join('\n');
});

Then('the docs-index gate exits 0', function () {
  assert.strictEqual(gateState.exitCode, 0, `Expected exit 0. Report:\n${gateState.stdout}`);
});

Then('the docs-index gate fails', function () {
  assert.strictEqual(gateState.exitCode, 1, `Expected exit 1. Report:\n${gateState.stdout}`);
});

Then('the docs-index gate report names {string}', function (docPath: string) {
  assert.ok(gateState.stdout.includes(docPath), `Expected the report to name ${docPath}. Report:\n${gateState.stdout}`);
});

Then('the docs-index gate report names the decision records {string}', function (records: string) {
  for (const record of splitList(records)) {
    assert.match(
      gateState.stdout,
      new RegExp(`\\b${record}\\b`),
      `Expected the report to name record ${record}. Report:\n${gateState.stdout}`,
    );
  }
});

Then('the docs-index gate reports the index as non-canonical', function () {
  assert.ok(
    gateState.stdout.includes('non-canonical serialization'),
    `Expected a non-canonical serialization finding. Report:\n${gateState.stdout}`,
  );
});
