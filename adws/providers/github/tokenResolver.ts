/**
 * Veracious token resolver — absorbed into the gitContext package (issue #700).
 *
 * Single canonical token resolution replacing the two prior resolvers
 * (`resolveToken` in gitContextFactory.ts, `resolveLaunchToken` in
 * launchGitContext.ts). Both fell through to process.env.GH_TOKEN — the
 * GH_TOKEN-bleed vector responsible for ~13 "wrong repo" incidents. This
 * resolver never reads process.env.GH_TOKEN as a token source (PRD story 2).
 *
 * All I/O is injected for hermetic testing.
 */

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface ResolveContextTokenInput {
  owner: string;
  repo: string;
  pat?: string | undefined;
  isAppConfigured: () => boolean;
  /** Must throw loudly if the App is not installed on owner/repo (foreign identity). */
  mintInstallationToken: (owner: string, repo: string) => string;
  /** Returns `gh auth token` output, or empty string when gh is not configured. */
  ghAuthToken: () => string;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a GitHub token bound to the specified owner/repo.
 *
 * Resolution order (guard-clause style):
 *   1. App configured → return mint bound to owner/repo; propagate any throw
 *      loudly (foreign/uninstalled identity = hard error, never substitute ambient)
 *   2. PAT set → return PAT
 *   3. `gh auth token` non-empty → return it
 *   4. Throw "no veracious token" — never fall back to process.env.GH_TOKEN
 *
 * process.env.GH_TOKEN is NEVER read here. The ambient-global fallthrough was
 * the root cause of the GH_TOKEN-bleed class (vestmatic #143/#181/#187). Any
 * token returned here is provably bound to the given owner/repo.
 */
export function resolveContextToken(input: ResolveContextTokenInput): string {
  const { owner, repo, pat, isAppConfigured, mintInstallationToken, ghAuthToken } = input;

  if (isAppConfigured()) {
    // Propagate loudly — foreign/uninstalled identity must fail at construction,
    // not silently adopt a wrong-repo ambient token.
    return mintInstallationToken(owner, repo);
  }

  if (pat?.trim()) return pat;

  const t = ghAuthToken();
  if (t.trim()) return t;

  throw new Error(`resolveContextToken: no veracious token for ${owner}/${repo}`);
}
