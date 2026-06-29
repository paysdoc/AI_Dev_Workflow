/**
 * githubAppAuth.test.ts — #701 shim behavioural assertions.
 *
 * Verifies that the deleted writers are gone and the re-exports still resolve.
 * Intentionally behavioural — no source-text inspection.
 */

import { describe, it, expect } from 'vitest';
import * as githubAppAuth from '../githubAppAuth';

describe('githubAppAuth — pure re-export shim (#701)', () => {
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
