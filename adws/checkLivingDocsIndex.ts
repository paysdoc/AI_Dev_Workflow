/**
 * checkLivingDocsIndex.ts — CI gate over the docs-index health module.
 *
 * `bun run lint:docs-index`, wired into `.github/workflows/git-cli-guard.yml`
 * on every `pull_request` and `push`. Credential-free: lists repo files with
 * a filesystem walk instead of `git ls-files`, so it constructs no
 * GitContext and needs no forge access — it runs in a bare CI checkout.
 * Every check is shared with `adws/core/docsIndexHealth.ts`, the same module
 * the cron sweep (`docsIndexSweep.ts`) uses, so the gate and the sweep can
 * never drift apart.
 *
 * A dangling entry or any judgement-required violation (non-canonical
 * serialization, a duplicate docPath, an orphan doc, an overlapping
 * `Owns:` glob, an entry count outside the band) fails the gate. A dead
 * `Owns:` glob is a non-fatal WARNING — a chore PR that renames a file must
 * not be blocked; the sweep prunes it within one cadence.
 *
 * Run via: bunx tsx adws/checkLivingDocsIndex.ts [rootDir]
 * Exits 0 if the index is clean (warnings aside), 1 otherwise.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  assessDocsIndexHealth,
  DEFAULT_COUNT_BAND,
  isFeatureDocPath,
  formatRepair,
  formatViolation,
  type DocsIndexRepair,
} from './core/docsIndexHealth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_PATH = '.adw/conditional_docs.md';

/** Directory basenames never descended into, at ANY depth — never legitimate source directory names. */
const IGNORED_DIR_NAMES_ANYWHERE = new Set(['.git', 'node_modules']);

/**
 * Directory basenames never descended into, but ONLY at the repo root — runtime/build
 * state whose name legitimately recurs as a source subdirectory elsewhere (e.g.
 * `adws/agents/` — agent implementations — vs. the root `agents/` runtime state dir;
 * `adws/phases/logs/` vs. the root `logs/` dir). Matching these by bare basename
 * anywhere in the tree would wrongly prune real source directories from the walk.
 */
const IGNORED_TOP_LEVEL_DIRS = new Set(['.worktrees', 'dist', 'coverage', 'logs', 'agents']);

// ---------------------------------------------------------------------------
// I/O boundary — all filesystem reads isolated here
// ---------------------------------------------------------------------------

function readIndexContent(rootDir: string): string {
  const full = path.join(rootDir, INDEX_PATH);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf-8');
}

/** Recursive filesystem walk, returning posix root-relative paths. In a CI checkout this is exactly the tracked set; locally the only difference is untracked files, which cannot mask a dangling entry or an overlap. */
export function listRepoFiles(rootDir: string): string[] {
  const acc: string[] = [];
  visitDir(rootDir, rootDir, acc);
  return acc;
}

function visitDir(dir: string, rootDir: string, acc: string[]): void {
  for (const dirEntry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, dirEntry.name);
    if (dirEntry.isDirectory()) {
      const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      if (IGNORED_DIR_NAMES_ANYWHERE.has(dirEntry.name) || IGNORED_TOP_LEVEL_DIRS.has(relPath)) continue;
      visitDir(fullPath, rootDir, acc);
      continue;
    }
    if (dirEntry.isFile()) {
      acc.push(path.relative(rootDir, fullPath).split(path.sep).join('/'));
    }
  }
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function pushCheck(lines: string[], label: string, passed: boolean, detail: string | undefined): void {
  lines.push(`  ${passed ? '✔ PASS' : '✖ FAIL'}  ${label}`);
  if (!passed && detail) lines.push(`         ${detail.replace(/\n/g, '\n         ')}`);
}

// ---------------------------------------------------------------------------
// Runner — exported for tests and the CLI entry point below
// ---------------------------------------------------------------------------

export function runLivingDocsIndexCheck(rootDir: string): { exitCode: 0 | 1; lines: string[] } {
  const content = readIndexContent(rootDir);
  if (!content.trim()) {
    return { exitCode: 1, lines: ['FAIL: .adw/conditional_docs.md is empty or missing'] };
  }

  const files = listRepoFiles(rootDir);
  const { registry, repairs, violations } = assessDocsIndexHealth({ content, files }, DEFAULT_COUNT_BAND);

  const isKind = <K extends DocsIndexRepair['kind']>(kind: K) =>
    (r: DocsIndexRepair): r is Extract<DocsIndexRepair, { kind: K }> => r.kind === kind;
  const danglingRepairs = repairs.filter(isKind('drop-dangling-entry'));
  const deadGlobRepairs = repairs.filter(isKind('prune-dead-glob'));

  const nonCanonical = violations.filter((v) => v.kind === 'non-canonical');
  const duplicates = violations.filter((v) => v.kind === 'duplicate-entry');
  const orphans = violations.filter((v) => v.kind === 'orphan-doc');
  const overlaps = violations.filter((v) => v.kind === 'overlap');
  const countViolations = violations.filter((v) => v.kind === 'count-out-of-band');

  const docCount = files.filter(isFeatureDocPath).length;
  const lines: string[] = [`Living Docs Index Check — ${registry.entries.length} entries, ${docCount} docs`, ''];

  pushCheck(lines, 'Round-trip (parse → serialize === original)', nonCanonical.length === 0, nonCanonical.map(formatViolation).join('\n') || undefined);

  pushCheck(
    lines,
    'Doc↔entry bijection: no dangling entry docPaths',
    danglingRepairs.length === 0,
    danglingRepairs.length > 0 ? `Dangling (entry exists, no file): ${danglingRepairs.map((r) => r.docPath).join(', ')}` : undefined,
  );

  pushCheck(
    lines,
    'Doc↔entry bijection: no orphan docs',
    orphans.length === 0,
    orphans.length > 0 ? `Orphan docs (file exists, no entry): ${orphans.map((v) => v.docPath).join(', ')}` : undefined,
  );

  pushCheck(
    lines,
    'Doc↔entry bijection: no duplicate docPaths',
    duplicates.length === 0,
    duplicates.length > 0 ? `Duplicate docPaths: ${duplicates.map((v) => v.docPath).join(', ')}` : undefined,
  );

  pushCheck(
    lines,
    'No overlapping ownedGlobs (regrowth guard)',
    overlaps.length === 0,
    overlaps.length > 0 ? overlaps.map(formatViolation).join('\n') : undefined,
  );

  pushCheck(
    lines,
    `Entry count in sane band [${DEFAULT_COUNT_BAND.min}, ${DEFAULT_COUNT_BAND.max}]`,
    countViolations.length === 0,
    countViolations.length > 0 ? countViolations.map(formatViolation).join('\n') : undefined,
  );

  if (deadGlobRepairs.length > 0) {
    lines.push('');
    lines.push(`  ⚠ WARN  ${deadGlobRepairs.length} dead Owns: glob(s) — non-fatal, repaired by the next docs-index sweep:`);
    for (const repair of deadGlobRepairs) lines.push(`         ${formatRepair(repair)}`);
  }

  const failed = danglingRepairs.length > 0 || violations.length > 0;
  lines.push('');
  lines.push(failed ? 'FAIL: the living-docs index needs repair.' : 'All checks passed.');

  return { exitCode: failed ? 1 : 0, lines };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  const { exitCode, lines } = runLivingDocsIndexCheck(rootDir);
  for (const line of lines) console.log(line);
  process.exit(exitCode);
}

// Run main only when executed as a script, not when imported as a module.
if (process.argv[1]?.includes('checkLivingDocsIndex')) main();
