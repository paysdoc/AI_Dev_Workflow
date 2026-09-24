// Usage: bun run lint:comment-only [--base <ref>] <files...>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { buildLaunchBoundary } from './core/launchGitContext';
import type { LaunchBoundary } from './core/launchGitContext';

export type SourceKind = 'ts' | 'feature';

const TS_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

export function sourceKindOf(filePath: string): SourceKind | null {
  if (TS_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return 'ts';
  if (filePath.endsWith('.feature')) return 'feature';
  return null;
}

export function normalize(source: string, kind: SourceKind): readonly string[] {
  return kind === 'ts' ? normalizeTs(source) : normalizeFeature(source);
}

function normalizeTs(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return collectTokens(sourceFile, sourceFile);
}

// getChildren emits parser-produced leaf tokens, so regex literals and template tails get the
// parser's context-sensitive rescans; a raw scanner loop mis-tokenises both.
function collectTokens(node: ts.Node, sourceFile: ts.SourceFile): readonly string[] {
  const children = node.getChildren(sourceFile);
  if (children.length === 0) {
    return node.kind === ts.SyntaxKind.EndOfFileToken ? [] : [node.getText(sourceFile)];
  }
  return children
    .filter((child) => child.kind < ts.SyntaxKind.FirstJSDocNode || child.kind > ts.SyntaxKind.LastJSDocNode)
    .flatMap((child) => collectTokens(child, sourceFile));
}

const DOC_STRING_DELIMITERS: readonly string[] = ['"""', '```'];

interface FeatureFoldState {
  readonly lines: readonly string[];
  readonly openDelimiter: string | null;
}

function normalizeFeature(source: string): readonly string[] {
  const initial: FeatureFoldState = { lines: [], openDelimiter: null };
  return source.split(/\r?\n/).reduce(foldFeatureLine, initial).lines;
}

function foldFeatureLine(state: FeatureFoldState, rawLine: string): FeatureFoldState {
  const trimmed = rawLine.trim();
  const insideDocString = state.openDelimiter !== null;
  const isDelimiter = DOC_STRING_DELIMITERS.includes(trimmed);

  if (!insideDocString && !isDelimiter && (trimmed === '' || trimmed.startsWith('#'))) {
    return state;
  }

  const closesDocString = insideDocString && trimmed === state.openDelimiter;
  const opensDocString = !insideDocString && isDelimiter;

  return {
    lines: [...state.lines, trimmed],
    openDelimiter: closesDocString ? null : opensDocString ? trimmed : state.openDelimiter,
  };
}

export interface CommentOnlyInput {
  readonly file: string;
  readonly current: string | null;
  readonly base: string | null;
}

export type CommentOnlyViolationReason =
  | 'code-changed'
  | 'absent-at-base'
  | 'absent-in-working-tree'
  | 'unsupported-file-kind';

export interface CommentOnlyViolation {
  readonly file: string;
  readonly reason: CommentOnlyViolationReason;
}

export function findNonCommentChanges(inputs: readonly CommentOnlyInput[]): readonly CommentOnlyViolation[] {
  return inputs
    .map(classifyInput)
    .filter((violation): violation is CommentOnlyViolation => violation !== null);
}

function classifyInput(input: CommentOnlyInput): CommentOnlyViolation | null {
  const kind = sourceKindOf(input.file);
  if (kind === null) return { file: input.file, reason: 'unsupported-file-kind' };
  if (input.current === null) return { file: input.file, reason: 'absent-in-working-tree' };
  if (input.base === null) return { file: input.file, reason: 'absent-at-base' };

  const currentTokens = normalize(input.current, kind);
  const baseTokens = normalize(input.base, kind);
  const unchanged = currentTokens.length === baseTokens.length
    && currentTokens.every((token, i) => token === baseTokens[i]);

  return unchanged ? null : { file: input.file, reason: 'code-changed' };
}

export function formatCommentOnlyReport(
  violations: readonly CommentOnlyViolation[],
  baseRef: string,
  checkedCount: number,
): string[] {
  const header = `Comment-Only Guard — ${checkedCount} file(s) against ${baseRef}`;
  if (violations.length === 0) {
    return [header, `  ✔ PASS  every file differs from ${baseRef} only in comments and whitespace`];
  }
  return [
    header,
    `  ✖ FAIL  ${violations.length} file(s) changed beyond comments:`,
    ...violations.map((v) => `  ${v.file}  [${v.reason}]`),
  ];
}

export interface CommentOnlyArgs {
  readonly baseRef: string | null;
  readonly files: readonly string[];
}

interface ArgvFoldState {
  readonly files: readonly string[];
  readonly baseRef: string | null;
  readonly pendingBase: boolean;
}

export function parseCommentOnlyArgs(argv: readonly string[]): CommentOnlyArgs {
  const initial: ArgvFoldState = { files: [], baseRef: null, pendingBase: false };
  const result = argv.reduce(foldArg, initial);
  if (result.pendingBase) {
    throw new Error('Usage: bun run lint:comment-only [--base <ref>] <files...> (--base requires a value)');
  }
  return { baseRef: result.baseRef, files: result.files };
}

function foldArg(state: ArgvFoldState, arg: string): ArgvFoldState {
  if (state.pendingBase) return { ...state, baseRef: arg, pendingBase: false };
  if (arg === '--base') return { ...state, pendingBase: true };
  if (arg.startsWith('--base=')) return { ...state, baseRef: arg.slice('--base='.length) };
  return { ...state, files: [...state.files, arg] };
}

export interface CommentOnlyDeps {
  readonly readCurrent: (file: string) => string | null;
  readonly readAtRef: (ref: string, file: string) => string | null;
  readonly resolveDefaultBaseRef: () => string;
}

export function runCommentOnlyCheck(
  args: CommentOnlyArgs,
  deps: CommentOnlyDeps = defaultCommentOnlyDeps(),
): { exitCode: 0 | 1; lines: string[] } {
  if (args.files.length === 0) {
    return { exitCode: 1, lines: ['Usage: bun run lint:comment-only [--base <ref>] <files...>'] };
  }

  const baseRef = args.baseRef ?? deps.resolveDefaultBaseRef();
  const inputs: CommentOnlyInput[] = args.files.map((file) => ({
    file,
    current: deps.readCurrent(file),
    base: deps.readAtRef(baseRef, file),
  }));

  const violations = findNonCommentChanges(inputs);
  return {
    exitCode: violations.length > 0 ? 1 : 0,
    lines: formatCommentOnlyReport(violations, baseRef, inputs.length),
  };
}

function defaultCommentOnlyDeps(): CommentOnlyDeps {
  let boundary: LaunchBoundary | null = null;
  const getBoundary = (): LaunchBoundary => (boundary ??= buildLaunchBoundary(null));

  return {
    readCurrent: (file) => {
      const resolved = path.resolve(file);
      return fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf-8') : null;
    },
    readAtRef: (ref, file) => {
      const b = getBoundary();
      const relPath = path.relative(b.gitContext.basePath, path.resolve(file)).split(path.sep).join('/');
      try {
        return b.gitContext.show(ref, relPath);
      } catch {
        return null;
      }
    },
    resolveDefaultBaseRef: () => {
      const b = getBoundary();
      const defaultBranch = b.providers.codeHost.getDefaultBranch();
      b.gitContext.fetchRemote(defaultBranch, b.gitContext.basePath);
      return `origin/${defaultBranch}`;
    },
  };
}

function main(): void {
  let args: CommentOnlyArgs;
  try {
    args = parseCommentOnlyArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const { exitCode, lines } = runCommentOnlyCheck(args);
  for (const line of lines) console.log(line);
  process.exit(exitCode);
}

if (process.argv[1]?.includes('checkCommentOnly')) main();
