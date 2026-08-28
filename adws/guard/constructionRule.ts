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
 */

import * as ts from 'typescript';
import type { Violation } from './violationTypes';

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

/** The RepoContext factory and the GitContext factories. */
export const CONTEXT_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'createRepoContext',
  'mintBoundProviders',
  'gitContextFor',
  'gitContextForSync',
  'gitContextForRepo',
]);

/** Matched only as a `ts.NewExpression` callee — `new GitContext(…)`. */
export const GIT_CONTEXT_CLASS_NAME = 'GitContext';

// ---------------------------------------------------------------------------
// Sanctioned-site allowlist
// ---------------------------------------------------------------------------

/**
 * The file-scoped allowlist of sites permitted to construct a provider or a
 * context, split into two halves:
 *
 *  - PERMANENT (2, no `owner`) — the launch boundary and the mint
 *    implementation it delegates to. Nothing will ever remove these.
 *  - TRANSITIONAL (owned by #796 or #797) — the not-yet-migrated call sites
 *    #794 deliberately left behind. Each entry is deleted the moment its
 *    file's migration slice lands; the stale-entry ratchet in
 *    `checkGitGhGuard.ts`'s `main()` enforces that deletion. NOTHING MAY
 *    EVER BE ADDED TO THE TRANSITIONAL HALF — a new construction site must
 *    call `buildLaunchBoundary`, not join this list.
 *
 * #796 owns the non-boundary `gitContextFor`/`gitContextForSync`/
 * `gitContextForRepo` call-site migration (the context factories, including
 * the module that defines them); #797 owns the non-boundary
 * `createRepoContext`/`createGitHubCodeHost` call-site migration (the
 * provider/RepoContext factories) — the five sites #794 explicitly left
 * behind (PRD Implementation Decisions, "Launch boundary").
 */
export const SANCTIONED_CONSTRUCTION_SITES = [
  // ── Permanent (2) ──────────────────────────────────────────────────────
  { file: 'adws/core/launchGitContext.ts', reason: 'the launch boundary: the one sanctioned construction site (PRD story 6)' },
  { file: 'adws/providers/repoContext.ts', reason: 'the mint implementation the boundary delegates to' },

  // ── Transitional (#796 — gitContextFor*/GitContext factory call sites) ──
  { file: 'adws/github/gitContextFactory.ts', reason: 'defines gitContextFor/gitContextForSync/gitContextForRepo via new GitContext(...)', owner: '#796' },
  { file: 'adws/checkLivingDocsIndex.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/core/orchestratorLib.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/core/remoteReconcile.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/core/targetRepoManager.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/core/upgradeClaim.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/github/githubApi.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/github/hitlBoardNotifier.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/github/issueApi.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/github/linkedPrDetector.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/github/prApi.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/github/prCommentDetector.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/github/projectBoardApi.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/healthCheck.tsx', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/phases/branchIdentityFallback.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/phases/buildPhase.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/phases/documentPhase.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/phases/prPhase.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/phases/reviewPhase.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/phases/scenarioFixPhase.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/autoMergeHandler.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/cancelHandler.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/concurrencyGuard.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/devServerJanitor.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/issueClosedUnblockRouter.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/takeoverHandler.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/trigger_cron.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/trigger_webhook.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/webhookGatekeeper.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/triggers/webhookHandlers.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/vcs/branchOperations.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },
  { file: 'adws/vcs/worktreeOperations.ts', reason: 'non-boundary gitContextForRepo call site', owner: '#796' },

  // ── Transitional (#797 — createRepoContext/createGitHubCodeHost call sites left behind by #794) ──
  { file: 'adws/phases/prReviewPhase.ts', reason: 'createRepoContext for provider-agnostic PR-review comments', owner: '#797' },
  { file: 'adws/phases/workflowInit.ts', reason: 'createRepoContext at workflow init, reusing boundary providers when identity matches', owner: '#797' },
  { file: 'adws/triggers/pauseQueueScanner.ts', reason: 'createRepoContext at four best-effort error-comment sites', owner: '#797' },
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
  if (ts.isCallExpression(node) && isFlaggedProviderOrContextCallee(node.expression)) {
    return `${(node.expression as ts.Identifier).text}(…)`;
  }
  return null;
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
