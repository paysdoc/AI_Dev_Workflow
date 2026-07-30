/**
 * checkLivingDocsIndex.ts — one-off migration acceptance gate
 *
 * Checks that the migrated .adw/conditional_docs.md and app_docs/ satisfy:
 *   1. Lossless round-trip through the registry module
 *   2. Doc↔entry bijection (no orphan docs, no dangling docPaths, no duplicate docPaths)
 *   3. No overlapping ownedGlobs between any two entries (regrowth guard)
 *   4. Entry count in a sane band [MIN_ENTRIES, MAX_ENTRIES]
 *
 * Run via: bunx tsx adws/checkLivingDocsIndex.ts
 * Exits 0 if all checks pass, 1 if any check fails.
 */

import * as fs from 'fs';
import * as path from 'path';
import { gitContextForRepo, readLocalRepoInfo } from './github/gitContextFactory';
import { REPO_ROOT } from './core';
import {
  parseConditionalDocs,
  serializeConditionalDocs,
  findOwningEntries,
  type ConditionalDocsRegistry,
} from './core/conditionalDocsRegistry.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_PATH = '.adw/conditional_docs.md';
const APP_DOCS_DIR = 'app_docs';
const MIN_ENTRIES = 25;
const MAX_ENTRIES = 60;

// ---------------------------------------------------------------------------
// I/O boundary — all filesystem reads isolated here
// ---------------------------------------------------------------------------

function readIndexContent(): string {
  if (!fs.existsSync(INDEX_PATH)) return '';
  return fs.readFileSync(INDEX_PATH, 'utf-8');
}

function listAppDocFiles(): string[] {
  if (!fs.existsSync(APP_DOCS_DIR)) return [];
  return fs
    .readdirSync(APP_DOCS_DIR)
    .filter((f) => f.startsWith('feature-') && f.endsWith('.md'))
    .map((f) => path.join(APP_DOCS_DIR, f));
}

function listTrackedFiles(): string[] {
  const ctx = gitContextForRepo(readLocalRepoInfo(REPO_ROOT), { selfHost: true });
  return ctx.lsFiles(process.cwd());
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

type CheckResult = { label: string; passed: boolean; detail?: string };

function checkRoundTrip(content: string, registry: ConditionalDocsRegistry): CheckResult {
  const label = 'Round-trip (parse → serialize === original)';
  const reserialized = serializeConditionalDocs(registry);
  if (reserialized === content) return { label, passed: true };
  const firstDiff = findFirstDiffLine(content, reserialized);
  return { label, passed: false, detail: `First divergence at line ${firstDiff}` };
}

function findFirstDiffLine(a: string, b: string): number {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    if (linesA[i] !== linesB[i]) return i + 1;
  }
  return maxLen + 1;
}

function checkBijection(
  registry: ConditionalDocsRegistry,
  appDocFiles: readonly string[],
): CheckResult[] {
  const label = 'Doc↔entry bijection';
  const entryDocPaths = registry.entries.map((e) => e.docPath);
  const appDocSet = new Set(appDocFiles);
  const entrySet = new Set(entryDocPaths);

  const danglingEntries = entryDocPaths.filter((p) => !appDocSet.has(p));
  const orphanDocs = appDocFiles.filter((p) => !entrySet.has(p));
  const duplicateEntries = findDuplicates(entryDocPaths);

  const results: CheckResult[] = [];

  results.push({
    label: `${label}: no dangling entry docPaths`,
    passed: danglingEntries.length === 0,
    detail:
      danglingEntries.length > 0
        ? `Dangling (entry exists, no file): ${danglingEntries.join(', ')}`
        : undefined,
  });

  results.push({
    label: `${label}: no orphan docs`,
    passed: orphanDocs.length === 0,
    detail:
      orphanDocs.length > 0
        ? `Orphan docs (file exists, no entry): ${orphanDocs.join(', ')}`
        : undefined,
  });

  results.push({
    label: `${label}: no duplicate docPaths`,
    passed: duplicateEntries.length === 0,
    detail:
      duplicateEntries.length > 0
        ? `Duplicate docPaths: ${duplicateEntries.join(', ')}`
        : undefined,
  });

  return results;
}

function findDuplicates(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) dups.add(p);
    seen.add(p);
  }
  return [...dups];
}

function checkNoOverlap(
  registry: ConditionalDocsRegistry,
  trackedFiles: readonly string[],
): CheckResult {
  const label = 'No overlapping ownedGlobs (regrowth guard)';
  const overlaps: string[] = [];

  for (const file of trackedFiles) {
    const owners = findOwningEntries(registry, [file]);
    if (owners.length >= 2) {
      overlaps.push(
        `"${file}" owned by: ${owners.map((e) => e.docPath).join(', ')}`,
      );
    }
  }

  if (overlaps.length === 0) return { label, passed: true };
  const preview = overlaps.slice(0, 5);
  const extra = overlaps.length > 5 ? ` … and ${overlaps.length - 5} more` : '';
  return {
    label,
    passed: false,
    detail: preview.join('\n  ') + extra,
  };
}

function checkCountSanity(count: number): CheckResult {
  const label = `Entry count in sane band [${MIN_ENTRIES}, ${MAX_ENTRIES}]`;
  if (count > MAX_ENTRIES) {
    return { label, passed: false, detail: `Count ${count} exceeds MAX_ENTRIES (${MAX_ENTRIES})` };
  }
  if (count < MIN_ENTRIES) {
    return {
      label,
      passed: false,
      detail: `Count ${count} is below MIN_ENTRIES (${MIN_ENTRIES}) — index may not be fully migrated`,
    };
  }
  return { label, passed: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printResult(result: CheckResult): void {
  const icon = result.passed ? '✔ PASS' : '✖ FAIL';
  console.log(`  ${icon}  ${result.label}`);
  if (!result.passed && result.detail) {
    console.log(`         ${result.detail.replace(/\n/g, '\n         ')}`);
  }
}

function run(): void {
  const content = readIndexContent();
  if (!content.trim()) {
    console.error('FAIL: .adw/conditional_docs.md is empty or missing');
    process.exit(1);
  }

  const registry = parseConditionalDocs(content);
  const appDocFiles = listAppDocFiles();
  const trackedFiles = listTrackedFiles();

  const roundTripResult = checkRoundTrip(content, registry);
  const bijectionResults = checkBijection(registry, appDocFiles);
  const overlapResult = checkNoOverlap(registry, trackedFiles);
  const countResult = checkCountSanity(registry.entries.length);

  const allResults = [roundTripResult, ...bijectionResults, overlapResult, countResult];
  const failures = allResults.filter((r) => !r.passed);

  console.log(`\nLiving Docs Index Check — ${registry.entries.length} entries, ${appDocFiles.length} docs\n`);
  for (const result of allResults) {
    printResult(result);
  }

  if (failures.length === 0) {
    console.log('\nAll checks passed.\n');
    process.exit(0);
  } else {
    console.log(`\n${failures.length} check(s) failed.\n`);
    process.exit(1);
  }
}

run();
