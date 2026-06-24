/**
 * checkGitGhGuard.ts — CI guard: fail on direct git/gh shell-outs outside GitContext
 *
 * Scans all .ts/.tsx sources (excluding adws/gitContext/** and other exempt paths)
 * for call expressions whose first argument is a git or gh command string. Detects
 * execSync('git …'), execWithRetry(`gh …`), execFileSync('git', […]), and any
 * other call shape by inspecting the command string, not the callee name.
 * Files on ALLOWLIST are skipped; any unallowlisted violation exits 1 (build fail).
 *
 * Run via: bunx tsx adws/checkGitGhGuard.ts
 * Exits 0 if no violations found, 1 if any violations are detected.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directory basenames never descended into — covers deps, build output, worktrees, and config. */
const EXEMPT_DIR_NAMES = new Set([
  'node_modules', 'dist', '.worktrees', '.claude',
  'features', // BDD step definitions legitimately use git/gh for fixture-repo setup
  'test',     // test-mock / test-utility files — same rationale
]);

/** Exact repo-relative path of the GitContext package; structurally exempt. */
const EXEMPT_PACKAGE_DIR = 'adws/gitContext';

/** Matches a git or gh command string: starts with 'git '/'gh ' or is exactly 'git'/'gh'. */
const GIT_GH_RE = /^(git|gh)(\s|$)/;

/**
 * Repo-relative paths allowed to shell out to git/gh directly.
 * Categories: bootstrap (permanent), diagnostic (permanent), residual (temporary).
 */
const ALLOWLIST: readonly string[] = [
  // bootstrap — cannot use GitContext before it exists
  'adws/core/launchGitContext.ts',        // gh auth token, git config user.name/email
  'adws/github/gitContextFactory.ts',     // git config, gh auth token, git remote get-url
  'adws/core/targetRepoManager.ts',       // git clone, git fetch, gh repo view
  'adws/core/upgradeClaim.ts',            // distributed lock: git fetch/worktree/commit/push
  'adws/github/githubAppAuth.ts',         // GitHub App token minting via gh

  // diagnostic — tooling / health-check scripts, non-hot-path
  'adws/healthCheckChecks.ts',            // git rev-parse/remote/status/config, gh auth/issue
  'adws/healthCheck.tsx',                 // gh repo view --json url

  // residual — migrate to GitContext methods (follow-up)
  'adws/adwPromotionSweep.tsx',                    // gh pr view/create, git <args> via execWithRetry
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Violation = { file: string; line: number; command: string };
type ScanResult = { violations: Violation[]; scannedCount: number };

// ---------------------------------------------------------------------------
// I/O boundary — filesystem reads isolated here
// ---------------------------------------------------------------------------

function collectTsFiles(startDir: string, repoRoot: string): string[] {
  const acc: string[] = [];
  visitDir(startDir, repoRoot, acc);
  return acc;
}

function visitDir(dir: string, repoRoot: string, acc: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      if (!EXEMPT_DIR_NAMES.has(entry.name) && relPath !== EXEMPT_PACKAGE_DIR) {
        visitDir(fullPath, repoRoot, acc);
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

// ---------------------------------------------------------------------------
// Pure scan core — no I/O
// ---------------------------------------------------------------------------

/**
 * Scans collected source files for direct git/gh shell-out calls outside the allowlist.
 * Reads each file from disk, parses with the TypeScript compiler API (AST-based, so
 * comments are never false-positives), and returns all violations found.
 */
export function scanFiles(relPaths: readonly string[], repoRoot: string): ScanResult {
  const allowed = new Set(ALLOWLIST);
  const violations: Violation[] = [];
  let scannedCount = 0;

  for (const relPath of relPaths) {
    if (allowed.has(relPath)) continue;
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
  return violations;
}

function walkNode(node: ts.Node, sourceFile: ts.SourceFile, violations: Violation[]): void {
  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    const cmd = extractGitGhCommand(node.arguments[0]);
    if (cmd !== null) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({ file: sourceFile.fileName, line: line + 1, command: cmd });
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const repoRoot = process.cwd();
  const allFiles = collectTsFiles(repoRoot, repoRoot);
  const { violations, scannedCount } = scanFiles(allFiles, repoRoot);

  console.log(
    `\nGit/GH CLI Guard — scanned ${scannedCount} files (${ALLOWLIST.length} allowlisted)\n`,
  );

  if (violations.length === 0) {
    console.log('  ✔ PASS  No direct git/gh shell-outs outside GitContext.\n');
    process.exit(0);
  }

  console.log(`  ✖ FAIL  ${violations.length} violation(s) detected:\n`);
  for (const { file, line, command } of violations) {
    console.log(`  ${file}:${line}  ${command}`);
  }
  console.log(
    '\n  Remedy: route through GitContext, or add to ALLOWLIST in adws/checkGitGhGuard.ts with justification.\n',
  );
  process.exit(1);
}

// Run main only when executed as a script, not when imported as a module.
if (process.argv[1]?.includes('checkGitGhGuard')) main();
