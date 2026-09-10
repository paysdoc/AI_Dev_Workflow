/**
 * checkGitGhGuard.ts — CI guard: fail on direct git/gh shell-outs outside the
 * two structurally-exempt packages, on cwd-derived repo identity feeding a
 * GitContext construction, on ad-hoc provider/context construction outside
 * the launch-boundary allowlist, and on a framework import reaching into an
 * extractable package.
 *
 * Four independent rules:
 *
 *  - 'git-gh-shellout' — implemented in this file (`walkNode`/`extractGitGhCommand`).
 *  - 'cwd-derived-identity' (#769) — `adws/guard/identityRule.ts`.
 *  - 'unsanctioned-construction' (#795) — `adws/guard/constructionRule.ts`.
 *  - 'extraction-readiness' (#816) — `adws/guard/extractionRule.ts`. The only
 *    rule whose discovery walks *inside* EXEMPT_PACKAGES: it enforces that
 *    files in EXTRACTION_SCOPE import nothing outside EXTRACTABLE_SET, so the
 *    gitContext library extraction can be a pure file move. See that module's
 *    docblock for the widen-only scope-list contract.
 *
 * The exempt set is closed and named (EXEMPT_PACKAGES, #792): exactly two
 * packages may shell out — the git core (`adws/gitContext`), which may run
 * git commands, and the GitHub forge adapter (`adws/providers/github`), which
 * may issue gh commands by feeding command strings into the core's executor.
 * Any violation exits 1 (build fail).
 *
 * Run via: bunx tsx adws/checkGitGhGuard.ts
 * Exits 0 if no violations found, 1 if any violations are detected.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { Violation, ViolationRule } from './guard/violationTypes';
import { flagCwdDerivedIdentityUses } from './guard/identityRule';
import { flagUnsanctionedConstruction, hasGuardedConstruction, findStaleSanctionedEntries } from './guard/constructionRule';
import { flagFrameworkImports, EXTRACTION_SCOPE } from './guard/extractionRule';
import { printSanctionedConstructionSites, printExtractionScope } from './guard/guardReport';

export type { Violation, ViolationRule };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directory basenames never descended into — covers deps, build output, worktrees, and config. */
const EXEMPT_DIR_NAMES = new Set([
  'node_modules', 'dist', '.worktrees', '.claude',
  'features', // BDD step definitions legitimately use git/gh for fixture-repo setup
  'test',     // test-mock / test-utility files — same rationale
]);

/**
 * The closed, CI-enforced set of packages permitted to shell out. Exactly
 * two: the git core, which may run git commands, and the GitHub forge
 * adapter, which may issue gh commands by feeding command strings into the
 * core's executor (GitContext.exec) — never by spawning a process itself.
 */
export const EXEMPT_PACKAGES = [
  {
    dir: 'adws/gitContext',
    role: 'git core — the only package that may run git commands',
  },
  {
    dir: 'adws/providers/github',
    role: 'GitHub forge adapter — the only package whose gh call sites may feed the core executor',
  },
] as const;

/** True when `relPath` is one of EXEMPT_PACKAGES' directories, or a path beneath one. */
export function isExemptPackage(relPath: string): boolean {
  return EXEMPT_PACKAGES.some(({ dir }) => relPath === dir || relPath.startsWith(`${dir}/`));
}

/** Matches a git or gh command string: starts with 'git '/'gh ' or is exactly 'git'/'gh'. */
const GIT_GH_RE = /^(git|gh)(\s|$)/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanResult = { violations: Violation[]; scannedCount: number };

// ---------------------------------------------------------------------------
// I/O boundary — filesystem reads isolated here
// ---------------------------------------------------------------------------

/** Exported for tests: walks `startDir`, honouring EXEMPT_DIR_NAMES and the EXEMPT_PACKAGES exemption exactly as the CLI entry point does. */
export function collectTsFiles(startDir: string, repoRoot: string): string[] {
  const acc: string[] = [];
  visitDir(startDir, repoRoot, acc, pruneExemptPackages);
  return acc;
}

/** Descend predicate for the whole-repo walk: prunes EXEMPT_PACKAGES so git-gh-shellout/cwd-derived-identity/unsanctioned-construction never see the git core or the GitHub forge adapter. */
function pruneExemptPackages(entryName: string, relPath: string): boolean {
  return !EXEMPT_DIR_NAMES.has(entryName) && !isExemptPackage(relPath);
}

/** Descend predicate for the extraction-scope walk: does NOT prune EXEMPT_PACKAGES — this is the only discovery that looks inside them. */
function descendIntoScope(entryName: string): boolean {
  return !EXEMPT_DIR_NAMES.has(entryName);
}

function visitDir(dir: string, repoRoot: string, acc: string[], descend: (entryName: string, relPath: string) => boolean): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      if (descend(entry.name, relPath)) {
        visitDir(fullPath, repoRoot, acc, descend);
      }
      continue;
    }

    if (entry.isFile() && isScannable(entry.name, relPath)) {
      acc.push(relPath);
    }
  }
}

function isScannable(name: string, relPath: string): boolean {
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false;
  if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return false;
  if (relPath.includes('/__tests__/') || relPath.startsWith('__tests__/')) return false;
  return true;
}

/** One EXTRACTION_SCOPE entry's files: [] when missing from `repoRoot` (a BDD fixture tree or a renamed package — never a crash), [path] when it is a scannable file, or a full sub-walk when it is a directory. */
function collectScopeEntry(entryPath: string, repoRoot: string): string[] {
  const fullPath = path.join(repoRoot, entryPath);
  if (!fs.existsSync(fullPath)) return [];

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return isScannable(path.basename(entryPath), entryPath) ? [entryPath] : [];
  }

  const acc: string[] = [];
  visitDir(fullPath, repoRoot, acc, descendIntoScope);
  return acc;
}

/**
 * Exported for tests: collects every scannable file under EXTRACTION_SCOPE's
 * entries, each counted once. The only discovery that walks inside
 * EXEMPT_PACKAGES; a missing entry contributes no files rather than
 * throwing. De-duplicated because scope entries can overlap (since #823,
 * `adws/providers` is a superset of nine earlier `adws/providers/*` entries)
 * and a file must be scanned — and counted in `printExtractionScope` — once.
 */
export function collectExtractionScopeFiles(repoRoot: string): string[] {
  return [...new Set(EXTRACTION_SCOPE.flatMap(({ path: entryPath }) => collectScopeEntry(entryPath, repoRoot)))];
}

// ---------------------------------------------------------------------------
// Pure scan core — no I/O
// ---------------------------------------------------------------------------

/**
 * Scans collected source files for direct git/gh shell-out calls.
 * Reads each file from disk, parses with the TypeScript compiler API (AST-based, so
 * comments are never false-positives), and returns all violations found.
 */
export function scanFiles(relPaths: readonly string[], repoRoot: string): ScanResult {
  const violations: Violation[] = [];
  let scannedCount = 0;

  for (const relPath of relPaths) {
    scannedCount++;
    const source = fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
    violations.push(...scanSource(relPath, source));
  }

  return { violations, scannedCount };
}

function scanSource(filePath: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false);
  const violations: Violation[] = [];
  walkNode(sourceFile, sourceFile, violations);

  violations.push(...flagCwdDerivedIdentityUses(sourceFile));
  violations.push(...flagUnsanctionedConstruction(sourceFile, filePath));

  return violations;
}

// ── Rule: git-gh-shellout ────────────────────────────────────────────────────

function walkNode(node: ts.Node, sourceFile: ts.SourceFile, violations: Violation[]): void {
  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    const cmd = extractGitGhCommand(node.arguments[0]);
    if (cmd !== null) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({ file: sourceFile.fileName, line: line + 1, command: cmd, rule: 'git-gh-shellout' });
    }
  }
  ts.forEachChild(node, (child) => walkNode(child, sourceFile, violations));
}

function extractGitGhCommand(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) && GIT_GH_RE.test(node.text)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node) && GIT_GH_RE.test(node.text)) return node.text;
  if (ts.isTemplateExpression(node) && GIT_GH_RE.test(node.head.text)) {
    return node.head.text + '${...}';
  }
  return null;
}

// ── Rule: extraction-readiness ──────────────────────────────────────────────

/** Exported for tests: runs ONLY the extraction-readiness rule over `relPaths`. scanFiles/scanSource (the other three rules) are untouched by this function. */
export function scanExtractionScope(relPaths: readonly string[], repoRoot: string): ScanResult {
  const violations: Violation[] = [];
  let scannedCount = 0;

  for (const relPath of relPaths) {
    scannedCount++;
    const source = fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
    const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, false);
    violations.push(...flagFrameworkImports(sourceFile, relPath));
  }

  return { violations, scannedCount };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** I/O: re-reads and re-parses every scanned file to test `hasGuardedConstruction`, kept separate from `scanFiles` so its `(relPaths, repoRoot)` signature never changes. */
function collectConstructionSeenFiles(relPaths: readonly string[], repoRoot: string): Set<string> {
  const seen = new Set<string>();
  for (const relPath of relPaths) {
    const source = fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
    const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, false);
    if (hasGuardedConstruction(sourceFile)) seen.add(relPath);
  }
  return seen;
}

function main(): void {
  const repoRoot = process.cwd();
  const allFiles = collectTsFiles(repoRoot, repoRoot);
  const { violations, scannedCount } = scanFiles(allFiles, repoRoot);
  const staleEntries = findStaleSanctionedEntries(collectConstructionSeenFiles(allFiles, repoRoot));
  const extraction = scanExtractionScope(collectExtractionScopeFiles(repoRoot), repoRoot);
  const allViolations = [...violations, ...extraction.violations];

  console.log(
    `\nGit/GH CLI Guard — scanned ${scannedCount} files (0 allowlisted)\n`,
  );
  console.log('  Exempt packages (2):');
  for (const { dir, role } of EXEMPT_PACKAGES) {
    console.log(`    ${dir} — ${role}`);
  }
  console.log('');
  printSanctionedConstructionSites();
  printExtractionScope(extraction.scannedCount);

  if (allViolations.length === 0 && staleEntries.length === 0) {
    console.log('  ✔ PASS  No direct git/gh shell-outs outside the exempt packages.');
    console.log('  ✔ PASS  Extraction scope imports nothing outside adws/gitContext and adws/providers.\n');
    process.exit(0);
  }

  if (allViolations.length > 0) {
    console.log(`  ✖ FAIL  ${allViolations.length} violation(s) detected:\n`);
    for (const { file, line, command, rule } of allViolations) {
      console.log(`  ${file}:${line}  [${rule}]  ${command}`);
    }
    console.log(
      '\n  Remedy (git-gh-shellout): route through GitContext, or place inside adws/gitContext (git) or adws/providers/github (gh).' +
      '\n  Remedy (cwd-derived-identity): thread the launch-boundary GitContext instead of re-deriving identity from cwd.' +
      '\n  Remedy (unsanctioned-construction): receive providers from buildLaunchBoundary(...) instead of constructing them; the boundary is the only sanctioned construction site.' +
      '\n  Remedy (extraction-readiness): an extractable package may import only Node built-ins, npm packages, and files inside adws/gitContext or adws/providers — inject the dependency through a port (TokenProvider/Logger/config) or move the needed shape into the extractable set; never narrow EXTRACTION_SCOPE.\n',
    );
  }

  if (staleEntries.length > 0) {
    console.log(`  ✖ FAIL  ${staleEntries.length} stale transitional entr${staleEntries.length === 1 ? 'y' : 'ies'} in the sanctioned construction sites list:\n`);
    for (const file of staleEntries) {
      console.log(`  Remove the stale transitional entry — ${file} no longer constructs a provider or context (#796).`);
    }
    console.log('');
  }

  process.exit(1);
}

// Run main only when executed as a script, not when imported as a module.
if (process.argv[1]?.includes('checkGitGhGuard')) main();
