/**
 * githubAppAuth.test.ts — #701 export-surface assertions, relocated onto the
 * real module (#821; adws/github/githubAppAuth.ts is now a re-export shim).
 *
 * Verifies that the deleted writers are gone and the surviving exports resolve.
 * Intentionally behavioural — no source-text inspection.
 */

import { describe, it, expect } from 'vitest';
import * as githubAppAuth from '../githubAppAuth';

describe('githubAppAuth — env wrapper (#701)', () => {
  it('does not export activateGitHubAppAuth', () => {
    expect((githubAppAuth as Record<string, unknown>).activateGitHubAppAuth).toBeUndefined();
  });

  it('does not export refreshTokenIfNeeded', () => {
    expect((githubAppAuth as Record<string, unknown>).refreshTokenIfNeeded).toBeUndefined();
  });

  it('still exports isGitHubAppConfigured as a function', () => {
    expect(typeof githubAppAuth.isGitHubAppConfigured).toBe('function');
  });

  it('still exports getInstallationToken as a function', () => {
    expect(typeof githubAppAuth.getInstallationToken).toBe('function');
  });
});
