/**
 * checkLivingDocsIndex.test.ts — runLivingDocsIndexCheck() over real
 * fs.mkdtempSync fixtures (no mocks): the gate is a filesystem walk, so its
 * correctness is best proven against a real directory tree, including the
 * "a directory literally named agents/logs can legitimately exist nested
 * under a source package (adws/agents/, adws/phases/logs/)" case that a
 * mocked fs would hide.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { runLivingDocsIndexCheck } from '../checkLivingDocsIndex';
import { serializeConditionalDocs, type ConditionalDocsRegistry, type ConditionalDocEntry } from '../core/conditionalDocsRegistry';
import { DEFAULT_COUNT_BAND } from '../core/docsIndexHealth';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeFixtureDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-checkLivingDocsIndex-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, '.adw'), { recursive: true });
  mkdirSync(path.join(dir, 'app_docs'), { recursive: true });
  mkdirSync(path.join(dir, 'adws'), { recursive: true });
  return dir;
}

function writeDocFile(dir: string, relPath: string): void {
  const full = path.join(dir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, `# ${relPath}\n`);
}

function writeIndex(dir: string, entries: ConditionalDocEntry[]): void {
  const registry: ConditionalDocsRegistry = { preamble: '# Conditional Documentation\n', entries };
  fs.writeFileSync(path.join(dir, '.adw', 'conditional_docs.md'), serializeConditionalDocs(registry));
}

function healthyEntries(dir: string): ConditionalDocEntry[] {
  const count = Math.floor((DEFAULT_COUNT_BAND.min + DEFAULT_COUNT_BAND.max) / 2);
  const entries: ConditionalDocEntry[] = [];
  for (let i = 0; i < count; i++) {
    const docPath = `app_docs/feature-fixture${i}.md`;
    entries.push({ docPath, ownedGlobs: [], conditions: ['When X'] });
    writeDocFile(dir, docPath);
  }
  entries.push({ docPath: 'README.md', ownedGlobs: [], conditions: ['Always'] });
  entries.push({ docPath: 'adws/README.md', ownedGlobs: [], conditions: ['Always'] });
  writeDocFile(dir, 'README.md');
  writeDocFile(dir, 'adws/README.md');
  return entries;
}

describe('runLivingDocsIndexCheck', () => {
  it('exits 0 over a healthy fixture, and the top-level READMEs are not reported dangling', () => {
    const dir = makeFixtureDir();
    writeIndex(dir, healthyEntries(dir));

    const { exitCode, lines } = runLivingDocsIndexCheck(dir);

    expect(exitCode).toBe(0);
    expect(lines.join('\n')).not.toMatch(/Dangling \(entry exists, no file\)/);
  });

  it('exits 1 and names all 20 dangling entries when 20 are restored', () => {
    const dir = makeFixtureDir();
    const entries = healthyEntries(dir);
    const expected: string[] = [];
    for (let i = 0; i < 20; i++) {
      const docPath = `app_docs/feature-ghost${i}.md`;
      entries.push({ docPath, ownedGlobs: [], conditions: ['When a ghost entry is present'] });
      expected.push(docPath);
    }
    writeIndex(dir, entries);

    const { exitCode, lines } = runLivingDocsIndexCheck(dir);
    const report = lines.join('\n');

    expect(exitCode).toBe(1);
    for (const docPath of expected) expect(report).toContain(docPath);
  });

  it('exits 0 with a WARN line when the only finding is a dead glob', () => {
    const dir = makeFixtureDir();
    const entries = healthyEntries(dir);
    entries.push({ docPath: 'app_docs/feature-deadglob.md', ownedGlobs: ['adws/gone.ts'], conditions: ['When X'] });
    writeDocFile(dir, 'app_docs/feature-deadglob.md');
    writeIndex(dir, entries);

    const { exitCode, lines } = runLivingDocsIndexCheck(dir);
    const report = lines.join('\n');

    expect(exitCode).toBe(0);
    expect(report).toMatch(/⚠ WARN/);
    expect(report).toContain('adws/gone.ts');
  });

  it('exits 1 on an overlapping Owns: glob pair', () => {
    const dir = makeFixtureDir();
    const entries = healthyEntries(dir);
    entries.push({ docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/shared/*.ts'], conditions: ['When X'] });
    entries.push({ docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/shared/x.ts'], conditions: ['When X'] });
    writeDocFile(dir, 'app_docs/feature-a.md');
    writeDocFile(dir, 'app_docs/feature-b.md');
    writeDocFile(dir, 'adws/shared/x.ts'); // a tracked (non-doc) source file the globs both own
    writeIndex(dir, entries);

    const { exitCode } = runLivingDocsIndexCheck(dir);

    expect(exitCode).toBe(1);
  });

  it('exits 1 when the index is missing', () => {
    const dir = makeFixtureDir();

    const { exitCode, lines } = runLivingDocsIndexCheck(dir);

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('empty or missing');
  });

  it('does not prune a nested directory that merely shares a basename with a top-level runtime-state dir (adws/agents/, adws/phases/logs/)', () => {
    const dir = makeFixtureDir();
    const entries = healthyEntries(dir);
    entries.push({ docPath: 'app_docs/feature-agents.md', ownedGlobs: ['adws/agents/realAgent.ts'], conditions: ['When X'] });
    writeDocFile(dir, 'app_docs/feature-agents.md');
    writeDocFile(dir, 'adws/agents/realAgent.ts');
    writeIndex(dir, entries);

    const { exitCode, lines } = runLivingDocsIndexCheck(dir);

    expect(exitCode).toBe(0);
    expect(lines.join('\n')).not.toContain('adws/agents/realAgent.ts');
  });
});
