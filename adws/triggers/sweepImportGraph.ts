/**
 * Pure import-graph helpers for the per-issue scenario sweep. A step-def file
 * belonging to a swept issue may still be imported by a surviving file (a later
 * issue reusing an earlier issue's helper), so the sweep must never remove a
 * file something it keeps still imports. Everything here works on repo-relative
 * POSIX paths and in-memory sources — no fs, no git.
 */

import * as path from 'path';

/** Extensions whose sources are scanned for relative imports. */
export const IMPORT_SCAN_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

const RESOLUTION_SUFFIXES: readonly string[] = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

// `from '…'` (import/export), side-effect `import '…'`, and dynamic `import('…')`.
const IMPORT_SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;

// tsc's non-pretty diagnostic for a missing module: `file(line,col): error TS2307: Cannot find module './x.ts' …`.
const MISSING_MODULE_RE = /^(.+?)\(\d+,\d+\): error TS2307: Cannot find module '([^']+)'/gm;

export function isScannedSource(filePath: string): boolean {
  return IMPORT_SCAN_EXTENSIONS.includes(path.posix.extname(filePath));
}

/** Relative module specifiers (`./x`, `../y.ts`) a source imports or re-exports. */
export function parseRelativeImports(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER_RE)].map(match => match[2]);
}

/** Resolves `specifier` as imported by `importer` against the known file set, or null when it names no known file. */
export function resolveImport(importer: string, specifier: string, knownFiles: ReadonlySet<string>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  for (const suffix of RESOLUTION_SUFFIXES) {
    if (knownFiles.has(base + suffix)) return base + suffix;
  }
  return null;
}

export interface PrunedRemoval {
  readonly remove: readonly string[];
  readonly keep: readonly string[];
}

/**
 * Splits `candidates` into the files safe to remove and the files a survivor
 * still imports, transitively: a kept file's own imports are kept too.
 * `sources` holds every scanned file in the tree, candidates included.
 */
export function pruneImportedRemovals(candidates: readonly string[], sources: ReadonlyMap<string, string>): PrunedRemoval {
  const knownFiles = new Set([...sources.keys(), ...candidates]);
  const pending = new Set(candidates);
  const queue = [...sources.keys()].filter(file => !pending.has(file));
  const keep: string[] = [];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const specifier of parseRelativeImports(sources.get(file) ?? '')) {
      const target = resolveImport(file, specifier, knownFiles);
      if (target === null || !pending.has(target)) continue;
      pending.delete(target);
      keep.push(target);
      queue.push(target);
    }
  }

  return { remove: candidates.filter(file => pending.has(file)), keep };
}

/**
 * Removed files that a failing check reports as missing modules. Returns null
 * when the output holds any missing-module error that does not point at a
 * removed file — that failure is not one the sweep can repair by restoring.
 */
export function removedFilesReportedMissing(output: string, removed: ReadonlySet<string>): string[] | null {
  const restore = new Set<string>();
  for (const [, importer, specifier] of output.matchAll(MISSING_MODULE_RE)) {
    const target = specifier.startsWith('.') ? resolveImport(importer.trim(), specifier, removed) : null;
    if (target === null) return null;
    restore.add(target);
  }
  return [...restore];
}
