/**
 * TokenProvider port — GitHub implementation.
 *
 * The first file of the forge adapter #792 will relocate wholesale. It owns
 * the resolution order (App installation token → PAT → `gh auth token`) and
 * the PAT-versus-installation-token decision, so the core does not: the core
 * only ever declares a forge-neutral {@link CredentialPurpose}.
 *
 * All sources are injected — this file reads no environment variable — and
 * wraps, rather than replaces, the existing pure {@link resolveContextToken}.
 */

import { resolveContextToken } from './tokenResolver';
import type { CredentialRequest, TokenProvider } from './types';

export interface GitHubTokenProviderInput {
  /** Candidate in the resolution order, after the App mint. */
  pat?: string | undefined;
  /**
   * Credential served to `'alternateIdentity'` requests. Absent (or
   * whitespace-only) → falls back to the resolved token, preserving
   * `runGraphQLInput`'s documented graceful fallback.
   */
  alternateIdentityPat?: string | undefined;
  isAppConfigured: () => boolean;
  /** Must throw loudly if the App is not installed on owner/repo (foreign identity). */
  mintInstallationToken: (owner: string, repo: string) => string;
  /** Returns `gh auth token` output, or empty string when gh is not configured. */
  ghAuthToken: () => string;
}

/**
 * Builds the port's GitHub implementation. Holds no memo of any kind — every
 * call re-enters `resolveContextToken`. The only caching on this path is
 * `appAuth.ts`'s expiry-aware installation-token cache, which lives inside
 * the credential source (where the PRD wants it), not here.
 */
export function createGitHubTokenProvider(input: GitHubTokenProviderInput): TokenProvider {
  return {
    credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv {
      const { owner, repo, purpose } = request;
      if (purpose === 'alternateIdentity' && input.alternateIdentityPat?.trim()) {
        return { GH_TOKEN: input.alternateIdentityPat };
      }
      return {
        GH_TOKEN: resolveContextToken({
          owner,
          repo,
          pat: input.pat,
          isAppConfigured: input.isAppConfigured,
          mintInstallationToken: input.mintInstallationToken,
          ghAuthToken: input.ghAuthToken,
        }),
      };
    },
  };
}
