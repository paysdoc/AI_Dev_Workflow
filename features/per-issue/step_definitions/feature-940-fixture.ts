/**
 * Shared fixtures for feature-940's step files. Every index text here is written by hand in the
 * canonical form, never through `serializeConditionalDocs`: that function is under test, and
 * text it built would round-trip by construction.
 *
 * NEVER RUNS THE REAL `/document` COMMAND OR THE REAL CLAUDE CLI — every input is a throwaway
 * fixture the steps write.
 */

import { After } from '@cucumber/cucumber';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

import type { ConditionalDocsRegistry } from '../../../adws/core/conditionalDocsRegistry.ts';

export interface IndexRow {
  readonly docPath: string;
  readonly owns: readonly string[];
  readonly decisions: readonly string[];
  /** Header written above the records; a misspelt one stands in for an unknown block. */
  readonly decisionsHeader?: string;
}

export const INDEX_PREAMBLE = '# Conditional Documentation\n\n';

export function splitList(cell: string): string[] {
  return cell.split(',').map((item) => item.trim()).filter(Boolean);
}

export function conditionsFor(docPath: string): string[] {
  return [`When working on ${docPath}`, `When debugging ${docPath}`];
}

export function canonicalEntryText(row: IndexRow): string {
  const lines = [`- ${row.docPath}`];
  if (row.owns.length > 0) lines.push('  - Owns:', ...row.owns.map((glob) => `    - ${glob}`));
  lines.push('  - Conditions:', ...conditionsFor(row.docPath).map((c) => `    - ${c}`));
  if (row.decisions.length > 0) {
    lines.push(`  - ${row.decisionsHeader ?? 'Decisions:'}`, ...row.decisions.map((d) => `    - ${d}`));
  }
  return lines.join('\n');
}

export function canonicalIndexText(rows: readonly IndexRow[]): string {
  return INDEX_PREAMBLE + rows.map(canonicalEntryText).join('\n\n') + '\n';
}

export const parserState: {
  indexText: string;
  rows: IndexRow[];
  registry: ConditionalDocsRegistry | null;
  serialized: string | null;
  collapsed: ConditionalDocsRegistry | null;
} = { indexText: '', rows: [], registry: null, serialized: null, collapsed: null };

export const gateState: { exitCode: number; stdout: string } = { exitCode: -1, stdout: '' };

const tempDirs: string[] = [];

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function writeFixtureFile(root: string, relPath: string, body: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

After({ tags: '@adw-940' }, function () {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  parserState.indexText = '';
  parserState.rows = [];
  parserState.registry = null;
  parserState.serialized = null;
  parserState.collapsed = null;
  gateState.exitCode = -1;
  gateState.stdout = '';
});
