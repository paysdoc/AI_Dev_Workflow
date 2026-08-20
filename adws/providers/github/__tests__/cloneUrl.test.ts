import { describe, it, expect } from 'vitest';
import { convertToSshUrl } from '../cloneUrl';

describe('convertToSshUrl', () => {
  it('converts HTTPS GitHub URL to SSH', () => {
    const result = convertToSshUrl('https://github.com/acme/webapp');
    expect(result).toBe('git@github.com:acme/webapp.git');
  });

  it('converts HTTPS URL with .git suffix', () => {
    const result = convertToSshUrl('https://github.com/acme/webapp.git');
    expect(result).toBe('git@github.com:acme/webapp.git');
  });

  it('returns an already-SSH URL unchanged', () => {
    const sshUrl = 'git@github.com:acme/webapp.git';
    expect(convertToSshUrl(sshUrl)).toBe(sshUrl);
  });

  it('returns a non-GitHub HTTPS URL unchanged', () => {
    const url = 'https://gitlab.com/acme/webapp.git';
    expect(convertToSshUrl(url)).toBe(url);
  });

  // Issue #779: convertToSshUrl's old regex was fully anchored, so a dotted
  // name failed to match and the function silently returned the HTTPS URL
  // unchanged instead of converting it.
  it('converts a dotted-name HTTPS URL with .git suffix to SSH', () => {
    const result = convertToSshUrl('https://github.com/paysdoc/paysdoc.nl.git');
    expect(result).toBe('git@github.com:paysdoc/paysdoc.nl.git');
  });

  it('converts a dotted-name HTTPS URL without .git suffix to SSH', () => {
    const result = convertToSshUrl('https://github.com/paysdoc/paysdoc.nl');
    expect(result).toBe('git@github.com:paysdoc/paysdoc.nl.git');
  });

  // New (issue #793): clone-URL construction cases moving into this package.
  it('returns an ssh:// scheme GitHub URL unchanged rather than double-converting', () => {
    const url = 'ssh://git@github.com/acme/webapp.git';
    expect(convertToSshUrl(url)).toBe(url);
  });

  it('converts an owner/repo pair containing hyphens and dots', () => {
    const result = convertToSshUrl('https://github.com/acme-corp/web-app.config');
    expect(result).toBe('git@github.com:acme-corp/web-app.config.git');
  });

  it('returns an empty string unchanged rather than producing a malformed SSH URL', () => {
    expect(convertToSshUrl('')).toBe('');
  });
});
