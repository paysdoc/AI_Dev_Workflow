import { describe, it, expect } from 'vitest';
import { parseOwnerRepoFromUrl } from '../repoContext';

describe('parseOwnerRepoFromUrl', () => {
  describe('HTTPS URLs', () => {
    it('parses standard repo name', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/AI_Dev_Workflow')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses standard repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/AI_Dev_Workflow.git')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses dotted repo name', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses dotted repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl.git')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses repo name with multiple dots', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/org/api.v2.staging.git')).toEqual({
        owner: 'org',
        repo: 'api.v2.staging',
      });
    });
  });

  describe('SSH URLs', () => {
    it('parses standard repo name', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/AI_Dev_Workflow')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses standard repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/AI_Dev_Workflow.git')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses dotted repo name', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses dotted repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl.git')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses repo name with multiple dots', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:org/api.v2.staging.git')).toEqual({
        owner: 'org',
        repo: 'api.v2.staging',
      });
    });
  });

  describe('edge cases', () => {
    it('returns null for unrecognised URL format', () => {
      expect(parseOwnerRepoFromUrl('not-a-url')).toBeNull();
    });
  });
});
