/**
 * identityRule.ts — the 'cwd-derived-identity' rule (#769), extracted from
 * `adws/checkGitGhGuard.ts` verbatim during the #795 module split.
 *
 * Flags `gitContextForRepo(…)` calls whose first argument is cwd-derived
 * identity: either an inline zero-argument `getRepoInfo()` /
 * `readLocalRepoInfo()` call, or a local variable initialized from one. This
 * is a COMPOSITION of two individually-legal calls that the shellout rule
 * cannot see (no raw git/gh string), and which re-derives identity instead
 * of threading a launch-boundary GitContext. No path allowlist: legitimate
 * self-host sites pass an explicit REPO_ROOT argument instead, and launch
 * boundaries resolve identity only into a guarded-fallback local
 * (`x ?? getRepoInfo()`), which is a BinaryExpression initializer and so is
 * never collected.
 */

import * as ts from 'typescript';
import type { Violation } from './violationTypes';

/**
 * The two legitimate pre-context cwd reads; a zero-argument call to either is
 * cwd-derived identity. `getRepoInfo` stays in this set even after #821
 * deletes its declaration (`adws/github/githubApi.ts`): this is a name-based
 * AST match against identifier text, not a file reference, so retaining the
 * name is what stops a cwd-derived identity fallback of that name being
 * reintroduced later. Only `SANCTIONED_CONSTRUCTION_SITES` (constructionRule.ts)
 * carries a stale-entry ratchet — nothing here fails because a guarded name
 * has no declaration left.
 */
export const CWD_DERIVED_IDENTITY_FNS = new Set(['getRepoInfo', 'readLocalRepoInfo']);

/** The boundary-free GitContext constructor whose argument the cwd-derived-identity rule inspects. */
export const CONTEXT_CONSTRUCTOR_NAME = 'gitContextForRepo';

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
 *
 * Single entry point: collects cwd-derived names itself, so callers need
 * only one call per file.
 */
export function flagCwdDerivedIdentityUses(sourceFile: ts.SourceFile): Violation[] {
  const cwdDerivedNames = collectCwdDerivedIdentityNames(sourceFile);
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
