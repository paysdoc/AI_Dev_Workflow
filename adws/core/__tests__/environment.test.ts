import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSafeSubprocessEnv } from '../environment.ts';

describe('getSafeSubprocessEnv', () => {
  let savedPat: string | undefined;
  let savedAlias: string | undefined;

  beforeEach(() => {
    savedPat = process.env.GITHUB_PAT;
    savedAlias = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  });

  afterEach(() => {
    if (savedPat !== undefined) {
      process.env.GITHUB_PAT = savedPat;
    } else {
      delete process.env.GITHUB_PAT;
    }
    if (savedAlias !== undefined) {
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = savedAlias;
    } else {
      delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    }
  });

  it('excludes GITHUB_PERSONAL_ACCESS_TOKEN even when set in process.env', () => {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_legacy';
    const result = getSafeSubprocessEnv();
    expect(result).not.toHaveProperty('GITHUB_PERSONAL_ACCESS_TOKEN');
  });

  it('forwards GITHUB_PAT when set in process.env', () => {
    process.env.GITHUB_PAT = 'ghp_canonical';
    const result = getSafeSubprocessEnv();
    expect(result.GITHUB_PAT).toBe('ghp_canonical');
  });
});
