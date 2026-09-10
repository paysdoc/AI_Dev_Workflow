/**
 * identityRule.ts — the 'cwd-derived-identity' rule (#769), extracted from
 * `adws/checkGitGhGuard.ts` verbatim during the #795 module split.
 *
 * Flags a context-constructor call whose identity argument is cwd-derived:
 * either an inline zero-argument `getRepoInfo()` / `readLocalRepoInfo()`
 * call, or a local variable initialized from one. This is a COMPOSITION of
 * two individually-legal calls that the shellout rule cannot see (no raw
 * git/gh string), and which re-derives identity instead of threading a
 * launch-boundary GitContext. No path allowlist: legitimate self-host sites
 * pass an explicit REPO_ROOT argument instead, and launch boundaries resolve
 * identity only into a guarded-fallback local (`x ?? getRepoInfo()`), which
 * is a BinaryExpression initializer and so is never collected.
 *
 * Two constructor shapes are inspected (#823): `gitContextForRepo(x)` — the
 * first positional argument — and `forgeProviders({ identity: x })` — the
 * `identity` property of a first-argument object literal, bare or shorthand.
 * Both retired-or-not names stay in `CONTEXT_CONSTRUCTOR_NAMES` regardless of
 * whether a declaration still exists for them (PRD story 24).
 *
 * `readLocalRepoIdentity` (`adws/core/localRepoIdentity.ts`, #844) joined
 * `CWD_DERIVED_IDENTITY_FNS` alongside the two names above: introducing a new
 * cwd-derived identity reader without registering its name here would let the
 * composite it exists to catch go quietly unflagged rather than red.
 */

import * as ts from 'typescript';
import type { Violation } from './violationTypes';

/**
 * The three legitimate pre-context cwd reads; a zero-argument call to any of
 * them is cwd-derived identity. `getRepoInfo` stays in this set even after
 * #821 deletes its declaration (`adws/github/githubApi.ts`), and
 * `readLocalRepoInfo` stays even after #844 retires it in favour of
 * `readLocalRepoIdentity`: this is a name-based AST match against identifier
 * text, not a file reference, so retaining a retired name is what stops a
 * cwd-derived identity fallback of that name being reintroduced later. Only
 * `SANCTIONED_CONSTRUCTION_SITES` (constructionRule.ts) carries a stale-entry
 * ratchet — nothing here fails because a guarded name has no declaration left.
 */
export const CWD_DERIVED_IDENTITY_FNS = new Set(['getRepoInfo', 'readLocalRepoInfo', 'readLocalRepoIdentity']);

/** The context constructors whose identity argument this rule inspects — name-based, surviving both retired declarations (PRD story 24). */
export const CONTEXT_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set(['gitContextForRepo', 'forgeProviders']);

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

/** The matched constructor name when `expression` resolves to one of `CONTEXT_CONSTRUCTOR_NAMES`, bare or as a property access (an injected seam, e.g. `deps.forgeProviders(…)`); else null. */
function contextConstructorCalleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression) && CONTEXT_CONSTRUCTOR_NAMES.has(expression.text)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && CONTEXT_CONSTRUCTOR_NAMES.has(expression.name.text)) return expression.name.text;
  return null;
}

/**
 * `forgeProviders({ identity: <expr> })` / `forgeProviders({ identity })` —
 * returns `<expr>` (or the shorthand identifier itself, for `{ identity }`);
 * null when `firstArg` is not an object literal or carries no `identity`
 * property.
 */
function identityPropertyOf(firstArg: ts.Node): ts.Expression | null {
  if (!ts.isObjectLiteralExpression(firstArg)) return null;
  for (const prop of firstArg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'identity') {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'identity') {
      return prop.name;
    }
  }
  return null;
}

/** The expression this rule inspects for `calleeName`'s call: `gitContextForRepo`'s first positional argument, or `forgeProviders`'s `identity` property. */
function identityArgumentOf(calleeName: string, node: ts.CallExpression): ts.Expression | null {
  const [firstArg] = node.arguments;
  if (!firstArg) return null;
  return calleeName === 'forgeProviders' ? identityPropertyOf(firstArg) : firstArg;
}

/**
 * True when `node` is a context-constructor call whose identity argument is a
 * direct identity READ — `gitContextForRepo(readLocalRepoIdentity(…))` or
 * `forgeProviders({ identity: getRepoInfo(…) })`, with or without arguments.
 *
 * This composite is adjudicated by THIS rule alone, and `constructionRule.ts`
 * defers on it (that module's only import from here). Both rules inspect the
 * same argument position, but only this one reads the argument: an identity
 * read taking no argument is cwd-derived and fails; one given an explicit
 * root is the sanctioned pre-context read that entry points make
 * (`healthCheck.tsx`'s `readLocalRepoIdentity(REPO_ROOT)`, #844) and passes.
 * Were the construction rule to flag the composite regardless — as it does
 * every other construction, by callee name alone — the passing half would be
 * unwritable anywhere except the two sanctioned files, and this rule's "an
 * explicit root is legal" verdict would be unobservable outside them.
 *
 * Deferral costs the construction rule nothing it was holding alone: the
 * failing half still fails here, under the rule that names the actual defect.
 */
export function isIdentityReadComposite(node: ts.CallExpression): boolean {
  const calleeName = contextConstructorCalleeName(node.expression);
  if (!calleeName) return false;
  const identityArg = identityArgumentOf(calleeName, node);
  if (!identityArg || !ts.isCallExpression(identityArg)) return false;
  return ts.isIdentifier(identityArg.expression) && CWD_DERIVED_IDENTITY_FNS.has(identityArg.expression.text);
}

/** Readable shape string for the violation's `command` field. */
function describeCwdDerivedArg(arg: ts.Node): string {
  if (isZeroArgCwdDerivedCall(arg) && ts.isIdentifier(arg.expression)) return `${arg.expression.text}()`;
  if (ts.isIdentifier(arg)) return arg.text;
  return 'getRepoInfo()';
}

/** Builds the violation's `command` field for the matched constructor shape. */
function describeViolation(calleeName: string, arg: ts.Node): string {
  const argText = describeCwdDerivedArg(arg);
  return calleeName === 'forgeProviders' ? `forgeProviders({ identity: ${argText} })` : `${calleeName}(${argText})`;
}

/**
 * Inspects a single call expression against `cwdDerivedNames`; returns the
 * Violation when it matches a context-constructor call with a cwd-derived
 * identity argument (inline zero-argument read, or a bound identifier), else
 * null.
 */
function inspectConstructorCall(node: ts.CallExpression, cwdDerivedNames: Set<string>, sourceFile: ts.SourceFile): Violation | null {
  if (node.arguments.length === 0) return null;
  const calleeName = contextConstructorCalleeName(node.expression);
  if (!calleeName) return null;
  const identityArg = identityArgumentOf(calleeName, node);
  if (!identityArg) return null;
  const isInlineRead = isZeroArgCwdDerivedCall(identityArg);
  const isCollectedIdentifier = ts.isIdentifier(identityArg) && cwdDerivedNames.has(identityArg.text);
  if (!isInlineRead && !isCollectedIdentifier) return null;
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: sourceFile.fileName,
    line: line + 1,
    command: describeViolation(calleeName, identityArg),
    rule: 'cwd-derived-identity',
  };
}

/**
 * Flags context-constructor calls whose identity argument is cwd-derived: an
 * inline zero-argument read, or an identifier bound to one earlier in the
 * file. The local-variable form is essential — it is the shape most call
 * sites actually use.
 *
 * Single entry point: collects cwd-derived names itself, so callers need
 * only one call per file.
 */
export function flagCwdDerivedIdentityUses(sourceFile: ts.SourceFile): Violation[] {
  const cwdDerivedNames = collectCwdDerivedIdentityNames(sourceFile);
  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const violation = inspectConstructorCall(node, cwdDerivedNames, sourceFile);
      if (violation) violations.push(violation);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}
