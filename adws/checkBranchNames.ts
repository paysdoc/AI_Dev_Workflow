/**
 * Fails when a branch name is written into non-test TypeScript or markdown under `adws/`, or into a
 * slash command under `.claude/commands/`. The base branch is resolved at run time (ADR-0019), so
 * neither code nor prompts name it.
 *
 * Run via: bunx tsx adws/checkBranchNames.ts [rootDir]
 * Exits 0 if no name is found, 1 if any is.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export interface BranchNameViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export const SCANNED_ROOTS = ['adws', '.claude/commands'] as const;

const SKIPPED_DIR_NAMES = new Set(['__tests__', 'node_modules', 'dist', '.worktrees']);

// Rules are regex literals, never strings: the TypeScript scan reads string literals, so this file
// would otherwise flag itself.
const BRANCH_LITERAL = /^(?:main|master|dev|develop)$/;

const TEXT_RULES: readonly RegExp[] = [
  /\b(?:origin|upstream)\/(?:main|master|dev|develop)(?![\w-])/,
  /\brefs\/(?:heads|remotes\/[\w.-]+)\/(?:main|master|dev|develop)(?![\w-])/,
  /`(?:main|master|dev|develop)`/,
  /\b(?:main|master|dev|develop)\s+branch(?:es)?\b/i,
  /\b(?:master|develop)\b/,
];

const REMEDY =
  'resolve the base branch at run time: codeHost.getDefaultBranch() in code; a defaultBranch argument, ' +
  'or the HEAD branch: line of git remote show origin, in a prompt (ADR-0019).';

export function namesBranch(text: string): boolean {
  return TEXT_RULES.some((rule) => rule.test(text));
}

function isStringText(node: ts.Node): node is ts.StringLiteral | ts.TemplateLiteralToken {
  return ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node);
}

function lineTextAt(sourceFile: ts.SourceFile, zeroBasedLine: number): string {
  const starts = sourceFile.getLineStarts();
  return sourceFile.text.slice(starts[zeroBasedLine], starts[zeroBasedLine + 1]).trim();
}

/** AST-based, so a comment that mentions a branch is never a violation. */
export function scanTypeScript(file: string, source: string): BranchNameViolation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const violations: BranchNameViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (isStringText(node) && (BRANCH_LITERAL.test(node.text) || namesBranch(node.text))) {
      const zeroBasedLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      violations.push({ file, line: zeroBasedLine + 1, text: lineTextAt(sourceFile, zeroBasedLine) });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/** Code spans and fenced blocks are scanned too: they are what agents run. */
export function scanMarkdown(file: string, source: string): BranchNameViolation[] {
  return source
    .split('\n')
    .flatMap((text, index) => (namesBranch(text) ? [{ file, line: index + 1, text: text.trim() }] : []));
}

function isScannable(name: string): boolean {
  if (/\.test\.tsx?$/.test(name)) return false;
  return /\.(?:ts|tsx|md)$/.test(name);
}

function visitEntry(repoRoot: string, relPath: string, entry: fs.Dirent): string[] {
  if (entry.isDirectory()) return SKIPPED_DIR_NAMES.has(entry.name) ? [] : walkDir(repoRoot, relPath);
  return entry.isFile() && isScannable(entry.name) ? [relPath] : [];
}

function walkDir(repoRoot: string, relDir: string): string[] {
  const dir = path.join(repoRoot, relDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => visitEntry(repoRoot, `${relDir}/${entry.name}`, entry));
}

/**
 * Repo-relative POSIX paths of the `.ts`, `.tsx` and `.md` files under `roots`. Tests are skipped:
 * fixtures inject a branch name as input and act on nothing.
 */
export function collectFiles(repoRoot: string, roots: readonly string[]): string[] {
  return roots.flatMap((root) => walkDir(repoRoot, root));
}

export function scanFiles(repoRoot: string, relPaths: readonly string[]): BranchNameViolation[] {
  return relPaths.flatMap((relPath) => {
    const source = fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
    return relPath.endsWith('.md') ? scanMarkdown(relPath, source) : scanTypeScript(relPath, source);
  });
}

/** A line that holds several names is one place to fix. */
function uniquePlaces(violations: readonly BranchNameViolation[]): BranchNameViolation[] {
  return [...new Map(violations.map((violation) => [`${violation.file}:${violation.line}`, violation])).values()];
}

export function runBranchNameCheck(rootDir: string): { exitCode: 0 | 1; lines: string[] } {
  const files = collectFiles(rootDir, SCANNED_ROOTS);
  const places = uniquePlaces(scanFiles(rootDir, files));
  const heading = `Branch-name check — scanned ${files.length} files`;

  if (places.length === 0) {
    return { exitCode: 0, lines: [heading, '', '  ✔ PASS  No file names a branch to act on.', ''] };
  }

  return {
    exitCode: 1,
    lines: [
      heading,
      '',
      `  ✖ FAIL  ${places.length} place(s) name a branch to act on:`,
      '',
      ...places.map(({ file, line, text }) => `  ${file}:${line}  ${text}`),
      '',
      `  Remedy: ${REMEDY}`,
      '',
    ],
  };
}

function main(): void {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  const { exitCode, lines } = runBranchNameCheck(rootDir);
  for (const line of lines) console.log(line);
  process.exit(exitCode);
}

// Run main only when executed as a script, not when imported as a module.
if (process.argv[1]?.includes('checkBranchNames')) main();
