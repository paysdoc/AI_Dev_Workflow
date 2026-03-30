import { describe, it, expect } from 'vitest';
import { parseOwnerRepoFromUrl } from '../repoContext';

describe('parseOwnerRepoFromUrl', () => {
  // HTTPS URLs

  it('parses a standard HTTPS URL', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/owner/repo');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an HTTPS URL with .git suffix', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an HTTPS URL with a dotted repo name', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl');
    expect(result).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('parses an HTTPS URL with a dotted repo name and .git suffix', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl.git');
    expect(result).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('parses an HTTPS URL with a multi-dot repo name', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/org/my.repo.name');
    expect(result).toEqual({ owner: 'org', repo: 'my.repo.name' });
  });

  it('parses an HTTPS URL with a multi-dot repo name and .git suffix', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/org/my.repo.name.git');
    expect(result).toEqual({ owner: 'org', repo: 'my.repo.name' });
  });

  it('parses an HTTPS URL with a trailing slash', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/owner/repo/');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  // SSH URLs

  it('parses a standard SSH URL', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:owner/repo');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an SSH URL with .git suffix', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an SSH URL with a dotted repo name', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl');
    expect(result).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('parses an SSH URL with a dotted repo name and .git suffix', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl.git');
    expect(result).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('parses an SSH URL with a multi-dot repo name', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:org/my.repo.name');
    expect(result).toEqual({ owner: 'org', repo: 'my.repo.name' });
  });

  it('parses an SSH URL with a multi-dot repo name and .git suffix', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:org/my.repo.name.git');
    expect(result).toEqual({ owner: 'org', repo: 'my.repo.name' });
  });

  // Edge cases

  it('returns null for an unrecognised URL', () => {
    const result = parseOwnerRepoFromUrl('not-a-url');
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    const result = parseOwnerRepoFromUrl('');
    expect(result).toBeNull();
  });
});
