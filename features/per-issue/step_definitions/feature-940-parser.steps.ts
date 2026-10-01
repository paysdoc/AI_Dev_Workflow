/**
 * §1 of feature-940.feature: drives the real `parseConditionalDocs`, `serializeConditionalDocs`
 * and `collapseEntries` in-process over index text the steps write by hand in canonical form.
 */

import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import {
  parseConditionalDocs,
  serializeConditionalDocs,
  collapseEntries,
  type ConditionalDocsRegistry,
} from '../../../adws/core/conditionalDocsRegistry.ts';
import {
  canonicalIndexText, conditionsFor, parserState, splitList, type IndexRow,
} from './feature-940-fixture.ts';

function requireParsed(): ConditionalDocsRegistry {
  assert.ok(parserState.registry, 'Expected the living-docs index text to have been parsed first');
  return parserState.registry;
}

function toRow(cells: Record<string, string>): IndexRow {
  return {
    docPath: cells['docPath'],
    owns: splitList(cells['owns'] ?? ''),
    decisions: splitList(cells['decisions'] ?? ''),
  };
}

Given('a living-docs index text, in canonical form, holding these entries:', function (table: DataTable) {
  parserState.rows = table.hashes().map(toRow);
  parserState.indexText = canonicalIndexText(parserState.rows);
});

When('the living-docs index text is parsed', function () {
  parserState.registry = parseConditionalDocs(parserState.indexText);
});

When('the living-docs index text is parsed and serialized again', function () {
  parserState.serialized = serializeConditionalDocs(parseConditionalDocs(parserState.indexText));
});

Then('the serialized index text is identical to the original', function () {
  assert.strictEqual(parserState.serialized, parserState.indexText);
});

Then('the parsed entries list these decision records:', function (table: DataTable) {
  const registry = requireParsed();
  const rows = table.hashes().map(toRow);
  assert.strictEqual(registry.entries.length, rows.length, 'Expected one parsed entry per row');
  rows.forEach((row, i) => {
    assert.strictEqual(registry.entries[i].docPath, row.docPath);
    assert.deepStrictEqual(
      registry.entries[i].decisions,
      [...row.decisions],
      `Expected the decision records of ${row.docPath}`,
    );
  });
});

Then('every parsed entry keeps exactly the Owns globs and Conditions it was written with', function () {
  const registry = requireParsed();
  assert.strictEqual(registry.entries.length, parserState.rows.length, 'Expected one parsed entry per written entry');
  parserState.rows.forEach((row, i) => {
    assert.deepStrictEqual(registry.entries[i].ownedGlobs, [...row.owns], `Owns globs of ${row.docPath}`);
    assert.deepStrictEqual(registry.entries[i].conditions, conditionsFor(row.docPath), `Conditions of ${row.docPath}`);
  });
});

When(
  'the entries for {string} and {string} in that index are collapsed into {string}',
  function (first: string, second: string, survivor: string) {
    const registry = parseConditionalDocs(parserState.indexText);
    const survivorEntry = registry.entries.find((e) => e.docPath === survivor);
    assert.ok(survivorEntry, `Expected the index to hold an entry for ${survivor}`);
    parserState.collapsed = collapseEntries(registry, [first, second], {
      docPath: survivor,
      conditions: survivorEntry.conditions,
    }).registry;
  },
);

Then(
  'the collapsed entry for {string} lists the decision records {string}, each once',
  function (docPath: string, records: string) {
    assert.ok(parserState.collapsed, 'Expected the entries to have been collapsed first');
    const surviving = parserState.collapsed.entries.filter((e) => e.docPath === docPath);
    assert.strictEqual(surviving.length, 1, `Expected exactly one entry for ${docPath}`);
    assert.deepStrictEqual([...surviving[0].decisions].sort(), splitList(records).sort());
  },
);
