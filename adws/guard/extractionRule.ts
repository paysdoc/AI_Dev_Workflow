/**
 * extractionRule.ts — the 'extraction-readiness' rule (#816, PRD stories 11/12).
 *
 * Asserts that extraction of `adws/gitContext/` and `adws/providers/` into the
 * `@paysdoc/gitcontext` library repository (specs/prd/gitcontext-library-extraction.md)
 * can be a pure file move: a file inside the enforced scope may import only
 * Node built-ins, npm packages, and files inside the extractable set — never
 * the rest of the framework.
 *
 * Two lists, two different roles:
 *
 *  - `EXTRACTABLE_SET` — the ALLOWED IMPORT TARGET set. Fixed until extraction:
 *    the two directories that move together. A non-bare import from an
 *    in-scope file may resolve only into this set.
 *  - `EXTRACTION_SCOPE` — the ENFORCED FILE set. A strict subset of the
 *    extractable set: only the packages already known to be clean today.
 *    **WIDEN ONLY, NEVER NARROW.** Each de-tangling slice of the extraction
 *    PRD appends the package it cleaned in the same PR; no entry is ever
 *    removed. The whole rule (and this module) is deleted together with the
 *    extractable directories at the switchover issue (PRD stories 23/25),
 *    once EXTRACTION_SCOPE == EXTRACTABLE_SET.
 *
 * Deliberate near-misses that must NOT be flagged: bare npm-package and
 * Node-builtin specifiers (with or without the `node:` prefix) — resolved
 * identically in the library's new home, so no built-ins list is maintained;
 * `./` sibling imports; intra-set hops (`adws/gitContext` <-> `adws/providers`);
 * test files (`__tests__/**`, `*.test.ts` — excluded by the caller's
 * `isScannable`, never reach this rule); and comment/string mentions of a
 * framework path (AST-only detection, never text matching).
 */

import * as ts from 'typescript';
import * as path from 'path';
import type { Violation } from './violationTypes';

/** The directories that move together at extraction; the only permitted non-bare import targets from an in-scope file. */
export const EXTRACTABLE_SET = ['adws/gitContext', 'adws/providers'] as const;

/** One entry in the enforced scope list: a repo-relative file or directory, why it is clean, and which issue widened the scope to include it. */
export type ExtractionScopeEntry = { readonly path: string; readonly reason: string; readonly since: string };

/**
 * The subset of EXTRACTABLE_SET this rule enforces today. WIDEN ONLY, NEVER
 * NARROW — see module docblock. Initial content is exactly what is already
 * clean: the whole git core, and the single dependency-free providers file.
 * #817 appended the GitHub adapter's domain modules and mappers — the raw
 * GitHub payload shapes and the pure GitHub→port mapping layer, both typed
 * only against the adapter domain and the ports. #818 appended the GitLab
 * and Jira adapter packages, whole directories, once both stopped reading
 * process.env and importing adws/core. #819 appended the whole GitHub
 * adapter package plus the two clean sibling files beside it — everything
 * under adws/providers/** except repoContext.ts, which stayed framework
 * wiring until #823 replaced it with `forgeProviders()` and appended the
 * whole `adws/providers` directory — the fifth and final widening, after
 * which EXTRACTION_SCOPE == EXTRACTABLE_SET.
 */
export const EXTRACTION_SCOPE: readonly ExtractionScopeEntry[] = [
  { path: 'adws/gitContext', reason: 'git core — dependency-free since Phase A (#790–#797)', since: '#816' },
  { path: 'adws/providers/types.ts', reason: 'provider ports + domain shapes — zero imports', since: '#816' },
  { path: 'adws/providers/github/domain', reason: 'adapter-owned raw GitHub payload shapes — pure type declarations (#817)', since: '#817' },
  { path: 'adws/providers/github/mappers.ts', reason: 'GitHub→port mappers — typed only against the adapter domain and the ports (#817)', since: '#817' },
  { path: 'adws/providers/gitlab', reason: 'GitLab adapter — injected config + Logger port, no environment reads (#818)', since: '#818' },
  { path: 'adws/providers/jira', reason: 'Jira adapter — injected config + Logger port, no environment reads (#818)', since: '#818' },
  { path: 'adws/providers/github', reason: 'GitHub forge adapter — executor, ports and adapter-owned domain only; no legacy adws/github delegation, no adws/core logger, no context construction (#819)', since: '#819' },
  { path: 'adws/providers/workspaceValidation.ts', reason: 'fs-only workspace validators split out of repoContext.ts (#818) — swept into scope (#819)', since: '#819' },
  { path: 'adws/providers/index.ts', reason: 'provider package barrel — re-exports resolve inside the extractable set (#819)', since: '#819' },
  { path: 'adws/providers', reason: 'the whole provider package — forgeProviders() assembly module and every future top-level provider file; ADW wiring moved to adws/core (#823). EXTRACTION_SCOPE now equals EXTRACTABLE_SET', since: '#823' },
] as const;

/** True when `relPath` is one of EXTRACTABLE_SET's directories, or a path beneath one. */
export function isInExtractableSet(relPath: string): boolean {
  return EXTRACTABLE_SET.some((dir) => relPath === dir || relPath.startsWith(`${dir}/`));
}

/** True when `relPath` is one of EXTRACTION_SCOPE's entries (file or directory), or a path beneath a directory entry. */
export function isInExtractionScope(relPath: string): boolean {
  return EXTRACTION_SCOPE.some(({ path: scopePath }) => relPath === scopePath || relPath.startsWith(`${scopePath}/`));
}

/** True when `specifier` is a relative, absolute, or `@adws/*`-aliased path — i.e. statically resolvable, as opposed to a bare npm/Node-builtin specifier. */
function isResolvableSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@adws/');
}

/**
 * Resolves a non-bare import specifier written in `importerRelPath` to a
 * repo-relative path. Returns null for bare specifiers (npm packages, Node
 * built-ins with or without the `node:` prefix) — these are never resolved
 * and never flagged, since they resolve identically in the library's new
 * home. Pure — no filesystem access; membership in EXTRACTABLE_SET is
 * decided by path-prefix matching, so extensions and directory/barrel
 * imports need no special handling here.
 */
export function resolveImportTarget(importerRelPath: string, specifier: string): string | null {
  if (!isResolvableSpecifier(specifier)) return null;

  if (specifier.startsWith('@adws/')) {
    return path.posix.normalize(specifier.replace(/^@adws\//, 'adws/'));
  }
  if (specifier.startsWith('/')) {
    return specifier;
  }

  const importerDir = path.posix.dirname(importerRelPath);
  return path.posix.normalize(path.posix.join(importerDir, specifier));
}

// ---------------------------------------------------------------------------
// AST: collecting import specifiers across every import/export/require shape
// ---------------------------------------------------------------------------

/** One statically-resolvable import specifier found in a source file, with its 1-based line. */
export type CollectedSpecifier = { readonly specifier: string; readonly line: number };

/** The literal string/no-substitution-template text of a node, or null when it is not a string literal. */
function literalTextOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** `import … from '…'` (including `import type`) and `import '…'` side-effect imports. */
function specifierOfImportDeclaration(node: ts.ImportDeclaration): string | null {
  return literalTextOf(node.moduleSpecifier);
}

/** `export … from '…'` and `export * from '…'` re-exports. */
function specifierOfExportDeclaration(node: ts.ExportDeclaration): string | null {
  return node.moduleSpecifier ? literalTextOf(node.moduleSpecifier) : null;
}

/** `import x = require('…')`. */
function specifierOfImportEquals(node: ts.ImportEqualsDeclaration): string | null {
  if (!ts.isExternalModuleReference(node.moduleReference)) return null;
  return literalTextOf(node.moduleReference.expression);
}

/** Dynamic `import('…')` and `require('…')` calls with a literal first argument. */
function specifierOfDynamicImport(node: ts.CallExpression): string | null {
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  if (!isDynamicImport && !isRequireCall) return null;
  if (node.arguments.length === 0) return null;
  return literalTextOf(node.arguments[0]);
}

/** Returns the literal specifier text carried by `node`, or null when `node` carries none (including non-literal dynamic imports, which cannot be resolved statically). */
function specifierOf(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node)) return specifierOfImportDeclaration(node);
  if (ts.isExportDeclaration(node)) return specifierOfExportDeclaration(node);
  if (ts.isImportEqualsDeclaration(node)) return specifierOfImportEquals(node);
  if (ts.isCallExpression(node)) return specifierOfDynamicImport(node);
  return null;
}

/**
 * Walks `sourceFile`'s AST and collects every statically-resolvable import
 * specifier, across import declarations (incl. `import type`), re-exports
 * (`export … from` / `export * from`), `import = require(…)`, dynamic
 * `import(…)`, and `require(…)`. Non-literal specifiers (e.g. `import(x)`)
 * are ignored — they cannot be resolved statically. AST-only: comments and
 * string constants that merely mention a path are never collected.
 */
export function collectImportSpecifiers(sourceFile: ts.SourceFile): ReadonlyArray<CollectedSpecifier> {
  const found: CollectedSpecifier[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== null) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({ specifier, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// ---------------------------------------------------------------------------
// Rule entry point
// ---------------------------------------------------------------------------

/** Builds the violation's `command` description: the raw specifier plus its resolved target. */
function describeEscapingImport(specifier: string, target: string): string {
  return `import '${specifier}' (resolves to ${target})`;
}

/**
 * Flags every import in `sourceFile` that resolves outside EXTRACTABLE_SET.
 * Guard clause first: a file outside EXTRACTION_SCOPE is never inspected —
 * since #823 the `adws/providers` entry covers the whole directory, so every
 * top-level provider file (present or future) is in scope.
 */
export function flagFrameworkImports(sourceFile: ts.SourceFile, relPath: string): Violation[] {
  if (!isInExtractionScope(relPath)) return [];

  return collectImportSpecifiers(sourceFile)
    .map(({ specifier, line }) => ({ specifier, line, target: resolveImportTarget(relPath, specifier) }))
    .filter((entry): entry is { specifier: string; line: number; target: string } => entry.target !== null && !isInExtractableSet(entry.target))
    .map(({ specifier, line, target }) => ({
      file: sourceFile.fileName,
      line,
      command: describeEscapingImport(specifier, target),
      rule: 'extraction-readiness' as const,
    }));
}
