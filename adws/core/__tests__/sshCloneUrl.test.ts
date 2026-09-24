import { describe, it, expect } from 'vitest';
import { convertToSshUrl } from '../sshCloneUrl';

describe('convertToSshUrl — host-neutral HTTPS-to-SSH rewrite', () => {
  it.each([
    ['https://github.com/acme/webapp', 'git@github.com:acme/webapp.git'],
    ['https://github.com/acme/webapp.git', 'git@github.com:acme/webapp.git'],
    ['git@github.com:acme/webapp.git', 'git@github.com:acme/webapp.git'],
    ['ssh://git@github.com/acme/webapp.git', 'ssh://git@github.com/acme/webapp.git'],
    ['https://github.com/paysdoc/paysdoc.nl.git', 'git@github.com:paysdoc/paysdoc.nl.git'],
    ['https://github.com/paysdoc/paysdoc.nl', 'git@github.com:paysdoc/paysdoc.nl.git'],
    ['https://github.com/acme-corp/web-app.config', 'git@github.com:acme-corp/web-app.config.git'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(convertToSshUrl(input)).toBe(expected);
  });

  it('converts a non-GitHub HTTPS URL — host-neutral means it converts, unlike the GitHub-only helper it replaces', () => {
    expect(convertToSshUrl('https://gitlab.com/acme/webapp.git')).toBe('git@gitlab.com:acme/webapp.git');
  });

  it('converts a self-hosted forge HTTPS URL with no .git suffix', () => {
    expect(convertToSshUrl('https://forge.example/acme/webapp')).toBe('git@forge.example:acme/webapp.git');
  });

  it('passes through a URL with an explicit port', () => {
    expect(convertToSshUrl('https://github.com:8443/acme/webapp.git')).toBe('https://github.com:8443/acme/webapp.git');
  });

  it('passes through a three-segment path (e.g. a GitLab subgroup)', () => {
    const url = 'https://gitlab.com/group/subgroup/webapp.git';
    expect(convertToSshUrl(url)).toBe(url);
  });

  it('passes through http:// (not https://)', () => {
    const url = 'http://forge.example/acme/webapp.git';
    expect(convertToSshUrl(url)).toBe(url);
  });

  it('converts a credential-bearing HTTPS URL without the credential', () => {
    const result = convertToSshUrl('https://x-access-token:TOKEN@github.com/acme/webapp.git');
    expect(result).toBe('git@github.com:acme/webapp.git');
  });

  it('passes through a non-URL string rather than throwing', () => {
    expect(convertToSshUrl('not-a-url')).toBe('not-a-url');
  });
});
