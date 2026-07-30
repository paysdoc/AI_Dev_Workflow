/**
 * checkGitGhGuard.ts — CI guard: fail on direct git/gh shell-outs outside GitContext,
 * and on cwd-derived repo identity feeding a GitContext construction.
 *
 * Two independent rules:
 *
 *  - 'git-gh-shellout' — scans all .ts/.tsx sources (excluding adws/gitContext/**
 *    and other exempt paths) for call expressions whose first argument is a git
 *    or gh command string. Detects execSync('git …'), execWithRetry(`gh …`),
 *    execFileSync('git', […]), and any other call shape by inspecting the
 *    command string, not the callee name.
 *  - 'cwd-derived-identity' — flags `gitContextForRepo(…)` calls whose first
 *    argument is cwd-derived identity: either an inline zero-argument
 *    `getRepoInfo()` / `readLocalRepoInfo()` call, or a local variable
 *    initialized from one. This is a COMPOSITION of two individually-legal
 *    calls that the shellout rule cannot see (no raw git/gh string), and
 *    which re-derives identity instead of threading a launch-boundary
 *    GitContext. No path allowlist: legitimate self-host sites pass an
 *    explicit REPO_ROOT argument instead, and launch boundaries resolve
 *    identity only into a guarded-fallback local (`x ?? getRepoInfo()`),
 *    which is a BinaryExpression initializer and so is never collected.
 *
 * The only file exemption is the structurally-exempt package directory (EXEMPT_PACKAGE_DIR).
 * Any violation exits 1 (build fail).
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

/** The two legitimate pre-context cwd reads; a zero-argument call to either is cwd-derived identity. */
const CWD_DERIVED_IDENTITY_FNS = new Set(['getRepoInfo', 'readLocalRepoInfo']);

/** The boundary-free GitContext constructor whose argument the cwd-derived-identity rule inspects. */
const CONTEXT_CONSTRUCTOR_NAME = 'gitContextForRepo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViolationRule = 'git-gh-shellout' | 'cwd-derived-identity';
type Violation = { file: string; line: number; command: string; rule: ViolationRule };
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

  const cwdDerivedNames = collectCwdDerivedIdentityNames(sourceFile);
  violations.push(...flagCwdDerivedIdentityUses(sourceFile, cwdDerivedNames));

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

// ── Rule: cwd-derived-identity ───────────────────────────────────────────────

/** A zero-argument getRepoInfo()/readLocalRepoInfo() call — the two legitimate cwd reads. */
function isZeroArgCwdDerivedCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 0 &&
    ts.isIdentifier(node.expression) &&
    CWD_DERIVED_IDENTITY_FNS.has(node.expression.text)
  );
}

/**
 * Collects the names of local variables initialized directly from a
 * zero-argument cwd-derived identity read. File-scoped (a lint does not need
 * block scoping). A guarded-fallback initializer (`x ?? getRepoInfo()`) is a
 * BinaryExpression, not a CallExpression, so it is never collected here —
 * that is what keeps the guarded-fallback shape legal.
 */
function collectCwdDerivedIdentityNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isZeroArgCwdDerivedCall(node.initializer)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** True when `expression` resolves to the identifier `gitContextForRepo`, bare or as a property access. */
function isContextConstructorCallee(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === CONTEXT_CONSTRUCTOR_NAME;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === CONTEXT_CONSTRUCTOR_NAME;
  return false;
}

/** Readable shape string for the violation's `command` field. */
function describeCwdDerivedArg(arg: ts.Node): string {
  if (isZeroArgCwdDerivedCall(arg) && ts.isIdentifier(arg.expression)) return `${arg.expression.text}()`;
  if (ts.isIdentifier(arg)) return arg.text;
  return 'getRepoInfo()';
}

/**
 * Flags gitContextForRepo(…) calls whose first argument is cwd-derived
 * identity: an inline zero-argument read, or an identifier bound to one
 * earlier in the file. The local-variable form is essential — it is the
 * shape most call sites actually use.
 */
function flagCwdDerivedIdentityUses(sourceFile: ts.SourceFile, cwdDerivedNames: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && isContextConstructorCallee(node.expression)) {
      const [firstArg] = node.arguments;
      const isInlineRead = isZeroArgCwdDerivedCall(firstArg);
      const isCollectedIdentifier = ts.isIdentifier(firstArg) && cwdDerivedNames.has(firstArg.text);
      if (isInlineRead || isCollectedIdentifier) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          file: sourceFile.fileName,
          line: line + 1,
          command: `${CONTEXT_CONSTRUCTOR_NAME}(${describeCwdDerivedArg(firstArg)})`,
          rule: 'cwd-derived-identity',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const repoRoot = process.cwd();
  const allFiles = collectTsFiles(repoRoot, repoRoot);
  const { violations, scannedCount } = scanFiles(allFiles, repoRoot);

  console.log(
    `\nGit/GH CLI Guard — scanned ${scannedCount} files (0 allowlisted)\n`,
  );

  if (violations.length === 0) {
    console.log('  ✔ PASS  No direct git/gh shell-outs outside GitContext.\n');
    process.exit(0);
  }

  console.log(`  ✖ FAIL  ${violations.length} violation(s) detected:\n`);
  for (const { file, line, command, rule } of violations) {
    console.log(`  ${file}:${line}  [${rule}]  ${command}`);
  }
  console.log(
    '\n  Remedy (git-gh-shellout): route through GitContext, or place inside the adws/gitContext package.' +
    '\n  Remedy (cwd-derived-identity): thread the launch-boundary GitContext instead of re-deriving identity from cwd.\n',
  );
  process.exit(1);
}

// Run main only when executed as a script, not when imported as a module.
if (process.argv[1]?.includes('checkGitGhGuard')) main();
