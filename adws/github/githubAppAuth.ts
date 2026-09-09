/**
 * Re-export shim — the wrapper lives in `adws/core/githubAppAuth.ts` since
 * #820; deleted with `gitContextFactory.ts` in #823.
 */
export { isGitHubAppConfigured, getInstallationToken } from '../core/githubAppAuth';
