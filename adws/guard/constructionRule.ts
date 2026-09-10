/**
 * constructionRule.ts — the 'unsanctioned-construction' rule (#795).
 *
 * Flags direct construction of a forge provider (IssueTracker / CodeHost /
 * BoardManager implementation), the RepoContext factory, or a GitContext
 * factory, anywhere outside a file-scoped allowlist of sanctioned
 * construction sites. `buildLaunchBoundary` (adws/core/launchGitContext.ts)
 * resolves `{owner, repo}` exactly once and hands it to both a GitContext and
 * the BoundProviders triple — that is the one place identity selection is
 * allowed to happen. Everywhere else, a caller must receive providers from
 * the boundary rather than minting its own.
 *
 * The flagged-callee set is an EXPLICIT NAME SET, never a `create*` pattern:
 * near-misses that must NOT be caught are `createGhCommandRunner` and
 * `createGitHubTokenProvider` (auth/token plumbing, not a provider or
 * context) and `createIssueCmd`/`createPRCmd`/`createLabelCmd` (pure
 * command-string builders — command pattern, never touch identity). Function
 * *declarations* are never flagged, only call/new expressions — and only
 * when the callee is a BARE IDENTIFIER: property-access callees
 * (`deps.gitContextForRepo(…)`, `d.gitContextForRepo(…)`) are an injected
 * seam, exactly the pattern this PRD wants, and are deliberately unflagged.
 *
 * `adws/providers/github/**` (and `adws/gitContext/**`) never reach this
 * rule at all: `visitDir`'s `isExemptPackage` prunes both directories from
 * the whole-repo walk before any file is handed to `scanFiles`, so the
 * adapter package that DEFINES the provider factories needs no allowlist
 * entry of its own.
 *
 * ONE SHAPE IS NOT THIS RULE'S TO JUDGE (#844): a context constructor whose
 * identity argument is a direct identity read —
 * `gitContextForRepo(readLocalRepoIdentity(root))` — belongs to
 * `cwd-derived-identity`, which inspects that argument rather than the callee
 * name and fails a zero-argument read while passing an explicit root. This
 * rule defers via `isIdentityReadComposite` (identityRule.ts) so that
 * verdict stands either way; nothing else about the callee-name match
 * changes, and a construction fed anything but an identity read is flagged
 * exactly as before.
 */

import * as ts from 'typescript';
import type { Violation } from './violationTypes';
import { isIdentityReadComposite } from './identityRule';

// ---------------------------------------------------------------------------
// Flagged callee name sets
// ---------------------------------------------------------------------------

/** Forge provider implementation factories — an explicit name set, never a `create*` pattern. */
export const PROVIDER_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'createGitHubIssueTracker',
  'createGitHubCodeHost',
  'createGitHubBoardManager',
  'createGitLabCodeHost',
  'createGitLabBoardManager',
  'createJiraIssueTracker',
  'createJiraBoardManager',
]);

/**
 * The RepoContext factory, the GitContext factories, and the assembly
 * function — the retired names (`createRepoContext`, `mintBoundProviders`,
 * `gitContextFor*`) stay after #823 deletes their declarations: this is a
 * NAME-based AST match, not a file reference, and keeping them is what stops
 * a boundary-free construction path reintroduced under a familiar name
 * (PRD story 24; see `identityRule.ts`'s `getRepoInfo` precedent).
 */
export const CONTEXT_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'createRepoContext',
  'mintBoundProviders',
  'gitContextFor',
  'gitContextForSync',
  'gitContextForRepo',
  'forgeProviders',
]);

/** Matched only as a `ts.NewExpression` callee — `new GitContext(…)`. */
export const GIT_CONTEXT_CLASS_NAME = 'GitContext';

// ---------------------------------------------------------------------------
// Sanctioned-site allowlist
// ---------------------------------------------------------------------------

/**
 * The file-scoped allowlist of sites permitted to construct a provider or a
 * context — exactly two PERMANENT entries (no `owner`), the launch boundary
 * and the assembly module it calls. Nothing will ever remove these, and
 * NOTHING MAY EVER BE ADDED TO THIS LIST — a new construction site must call
 * `buildLaunchBoundary`, not join it.
 *
 * #823 took the SUNSET half to zero: `adws/providers/repoContext.ts` (the
 * mint implementation) and `adws/github/gitContextFactory.ts` (the last
 * `gitContextFor*`/`GitContext` factory definition) are both deleted, their
 * construction role absorbed into `adws/providers/forgeProviders.ts`. Before
 * that, #822 had already retired every #796-migration-wave transitional
 * entry — the worktree-owning phases, `orchestratorLib`, `healthCheck`,
 * `worktreeOperations`, and the five trigger files that used to call
 * `gitContextForSync`/`gitContextForRepo` directly all take a threaded
 * GitContext now — and #821 deleted the legacy `adws/github/*` free-function
 * layer outright, so no entry in this list is owned by #821, #822 or #797
 * any longer.
 */
export const SANCTIONED_CONSTRUCTION_SITES = [
  { file: 'adws/core/launchGitContext.ts', reason: 'the launch boundary: constructs the one GitContext and calls forgeProviders (PRD story 6)' },
  { file: 'adws/providers/forgeProviders.ts', reason: 'the assembly module: the only site that calls the adapter factories' },
] as const;

/** True when `relPath` exactly matches a sanctioned site. Exact path match only — a directory prefix is never sanctioned. */
export function isSanctionedConstructionSite(relPath: string): boolean {
  return SANCTIONED_CONSTRUCTION_SITES.some(({ file }) => file === relPath);
}

// ---------------------------------------------------------------------------
// AST detection
// ---------------------------------------------------------------------------

function isFlaggedProviderOrContextCallee(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && (PROVIDER_CONSTRUCTORS.has(expression.text) || CONTEXT_CONSTRUCTORS.has(expression.text));
}

function isGitContextClassCallee(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === GIT_CONTEXT_CLASS_NAME;
}

/** Returns the violation's `command` description when `node` is a flagged construction, else null. */
function describeUnsanctionedConstructionNode(node: ts.Node): string | null {
  if (ts.isNewExpression(node) && isGitContextClassCallee(node.expression)) {
    return 'new GitContext(…)';
  }
  if (!ts.isCallExpression(node) || !isFlaggedProviderOrContextCallee(node.expression)) return null;
  // A context constructor fed a direct identity READ is the one composite this
  // rule does not adjudicate: `cwd-derived-identity` inspects the same argument
  // and decides it by arity — no argument fails there, an explicit root passes.
  // See `isIdentityReadComposite`'s docblock for why flagging it here too would
  // make the passing half unwritable. Every other construction, including
  // `gitContextForRepo(threadedIdentity)`, is flagged by callee name alone.
  if (isIdentityReadComposite(node)) return null;
  return `${(node.expression as ts.Identifier).text}(…)`;
}

/**
 * Flags unsanctioned provider/context construction in `sourceFile`. Guard
 * clause first: a sanctioned site is never walked, keeping the allowlist a
 * single, greppable decision.
 */
export function flagUnsanctionedConstruction(sourceFile: ts.SourceFile, relPath: string): Violation[] {
  if (isSanctionedConstructionSite(relPath)) return [];

  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    const command = describeUnsanctionedConstructionNode(node);
    if (command !== null) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({ file: sourceFile.fileName, line: line + 1, command, rule: 'unsanctioned-construction' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/**
 * True when `sourceFile` contains at least one construction this rule would
 * flag, IGNORING the allowlist — used only by `main()` to detect when a
 * transitional entry's file has stopped constructing anything (the
 * self-cleaning ratchet). Kept separate from `flagUnsanctionedConstruction`
 * so `scanFiles`'s `(relPaths, repoRoot)` signature never has to change.
 */
export function hasGuardedConstruction(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (describeUnsanctionedConstructionNode(node) !== null) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Every TRANSITIONAL entry whose file is not in `seenFiles` — i.e. an entry
 * that no longer constructs a provider or context and should be deleted.
 * Permanent entries are never reported stale: they exist by design, not as
 * migration debt. Pure, no I/O.
 */
export function findStaleSanctionedEntries(seenFiles: ReadonlySet<string>): readonly string[] {
  return SANCTIONED_CONSTRUCTION_SITES
    .filter((site) => 'owner' in site)
    .map((site) => site.file)
    .filter((file) => !seenFiles.has(file));
}
