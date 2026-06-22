import { describe, it, expect } from 'vitest';
import { crossCheckRepoIdentity, sameRepoIdentity, RepoIdentityMismatchError } from '../repoIdentityCrossCheck';
import type { RepoIdentity } from '../../types/agentTypes';

const ACME: RepoIdentity = { owner: 'acme', repo: 'webapp' };
const EVIL: RepoIdentity = { owner: 'evil', repo: 'webapp' };
const FORK: RepoIdentity = { owner: 'acme', repo: 'webapp-fork' };
const ACME_UPPER: RepoIdentity = { owner: 'Acme', repo: 'WebApp' };

describe('sameRepoIdentity()', () => {
  it('returns true for equal identities', () => {
    expect(sameRepoIdentity(ACME, { owner: 'acme', repo: 'webapp' })).toBe(true);
  });

  it('returns true for case-only differences', () => {
    expect(sameRepoIdentity(ACME, ACME_UPPER)).toBe(true);
  });

  it('returns false when owner differs', () => {
    expect(sameRepoIdentity(ACME, EVIL)).toBe(false);
  });

  it('returns false when repo differs', () => {
    expect(sameRepoIdentity(ACME, FORK)).toBe(false);
  });
});

describe('crossCheckRepoIdentity()', () => {
  it('does not throw when identities are equal', () => {
    expect(() => crossCheckRepoIdentity(ACME, { owner: 'acme', repo: 'webapp' })).not.toThrow();
  });

  it('does not throw when persisted is undefined (story 15 — no backfill)', () => {
    expect(() => crossCheckRepoIdentity(ACME, undefined)).not.toThrow();
  });

  it('does not throw on case-only difference (case-insensitive equality)', () => {
    expect(() => crossCheckRepoIdentity(ACME, ACME_UPPER)).not.toThrow();
  });

  it('throws RepoIdentityMismatchError when owner differs', () => {
    expect(() => crossCheckRepoIdentity(EVIL, ACME)).toThrow(RepoIdentityMismatchError);
  });

  it('throws RepoIdentityMismatchError when repo differs', () => {
    expect(() => crossCheckRepoIdentity(FORK, ACME)).toThrow(RepoIdentityMismatchError);
  });

  it('thrown error has correct name and carries both identities', () => {
    let caught: unknown;
    try { crossCheckRepoIdentity(EVIL, ACME); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(RepoIdentityMismatchError);
    const err = caught as RepoIdentityMismatchError;
    expect(err.name).toBe('RepoIdentityMismatchError');
    expect(err.launch).toEqual(EVIL);
    expect(err.persisted).toEqual(ACME);
    expect(err.message).toContain('evil/webapp');
    expect(err.message).toContain('acme/webapp');
  });

  it('error message names both identities (repo diff)', () => {
    let caught: unknown;
    try { crossCheckRepoIdentity(FORK, ACME); } catch (e) { caught = e; }
    const err = caught as RepoIdentityMismatchError;
    expect(err.message).toContain('acme/webapp-fork');
    expect(err.message).toContain('acme/webapp');
  });
});
