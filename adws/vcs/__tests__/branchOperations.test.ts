import { describe, it, expect } from 'vitest';
import { generateBranchName, validateSlug } from '../branchOperations';

describe('generateBranchName — assembly correctness', () => {
  it('assembles feature branch with hyphen separator', () => {
    expect(generateBranchName(42, 'add-user-auth', '/feature')).toBe('feature-issue-42-add-user-auth');
  });

  it('assembles bugfix branch', () => {
    expect(generateBranchName(42, 'fix-login-error', '/bug')).toBe('bugfix-issue-42-fix-login-error');
  });

  it('assembles chore branch', () => {
    expect(generateBranchName(42, 'update-deps', '/chore')).toBe('chore-issue-42-update-deps');
  });

  it('assembles review branch', () => {
    expect(generateBranchName(42, 'fix-failing-tests', '/pr_review')).toBe('review-issue-42-fix-failing-tests');
  });

  it('assembles adwinit branch', () => {
    expect(generateBranchName(42, 'init-project', '/adw_init')).toBe('adwinit-issue-42-init-project');
  });

  it('defaults to feature when issueType is omitted', () => {
    expect(generateBranchName(10, 'some-slug')).toBe('feature-issue-10-some-slug');
  });

  it('produces names parseable by the issue-number regex used in webhookHandlers', () => {
    const name = generateBranchName(455, 'json-reporter-findings', '/feature');
    expect(/issue-(\d+)/.exec(name)?.[1]).toBe('455');
  });

  it('rejects an invalid slug (throws) and does not assemble', () => {
    expect(() => generateBranchName(42, 'feature-already-prefixed', '/feature')).toThrow();
  });
});

describe('validateSlug — acceptance', () => {
  it('accepts a valid simple slug', () => {
    expect(validateSlug('add-user-auth')).toBe('add-user-auth');
  });

  it('accepts a valid slug with numbers', () => {
    expect(validateSlug('fix-oauth2-flow')).toBe('fix-oauth2-flow');
  });

  it('returns the slug unchanged when valid', () => {
    expect(validateSlug('update-dependencies')).toBe('update-dependencies');
  });
});

describe('validateSlug — rejection: empty / blank', () => {
  it('rejects empty string', () => {
    expect(() => validateSlug('')).toThrow(/empty/i);
  });

  it('rejects whitespace-only string', () => {
    expect(() => validateSlug('   ')).toThrow(/empty/i);
  });
});

describe('validateSlug — rejection: character constraints', () => {
  it('rejects slug with uppercase letters', () => {
    expect(() => validateSlug('HasCaps')).toThrow(/forbidden/i);
  });

  it('rejects slug with spaces', () => {
    expect(() => validateSlug('has space')).toThrow(/forbidden/i);
  });

  it('rejects slug with forward slash', () => {
    expect(() => validateSlug('bad/slug')).toThrow(/path separator/i);
  });

  it('rejects slug with backslash', () => {
    expect(() => validateSlug('bad\\slug')).toThrow(/path separator/i);
  });

  it('rejects slug with tilde (~)', () => {
    expect(() => validateSlug('bad~slug')).toThrow(/forbidden/i);
  });

  it('rejects slug with caret (^)', () => {
    expect(() => validateSlug('bad^slug')).toThrow(/forbidden/i);
  });

  it('rejects slug with colon (:)', () => {
    expect(() => validateSlug('bad:slug')).toThrow(/forbidden/i);
  });

  it('rejects slug with double-dot (..)', () => {
    expect(() => validateSlug('bad..slug')).toThrow(/forbidden/i);
  });
});

describe('validateSlug — rejection: structural constraints', () => {
  it('rejects slug starting with a hyphen', () => {
    expect(() => validateSlug('-bad-slug')).toThrow(/start or end/i);
  });

  it('rejects slug ending with a hyphen', () => {
    expect(() => validateSlug('bad-slug-')).toThrow(/start or end/i);
  });

  it('rejects slug with consecutive hyphens', () => {
    expect(() => validateSlug('bad--slug')).toThrow(/consecutive/i);
  });

  it('rejects slug longer than 50 characters', () => {
    const long = 'a'.repeat(51);
    expect(() => validateSlug(long)).toThrow(/50/);
  });

  it('accepts slug of exactly 50 characters', () => {
    const exact = 'a'.repeat(50);
    expect(validateSlug(exact)).toBe(exact);
  });
});

describe('validateSlug — rejection: forbidden prefixes (canonical)', () => {
  it('rejects slug starting with "feature-"', () => {
    expect(() => validateSlug('feature-my-slug')).toThrow(/prefix/i);
  });

  it('rejects slug starting with "bugfix-"', () => {
    expect(() => validateSlug('bugfix-my-slug')).toThrow(/prefix/i);
  });

  it('rejects slug starting with "chore-"', () => {
    expect(() => validateSlug('chore-my-slug')).toThrow(/prefix/i);
  });

  it('rejects slug starting with "review-"', () => {
    expect(() => validateSlug('review-my-slug')).toThrow(/prefix/i);
  });

  it('rejects slug starting with "adwinit-"', () => {
    expect(() => validateSlug('adwinit-my-slug')).toThrow(/prefix/i);
  });
});

describe('validateSlug — rejection: forbidden prefixes (aliases)', () => {
  it('rejects slug starting with "feat-"', () => {
    expect(() => validateSlug('feat-my-slug')).toThrow(/prefix/i);
  });

  it('rejects slug starting with "bug-"', () => {
    expect(() => validateSlug('bug-my-slug')).toThrow(/prefix/i);
  });

  it('rejects slug starting with "test-"', () => {
    expect(() => validateSlug('test-my-slug')).toThrow(/prefix/i);
  });
});

describe('validateSlug — rejection: issue-number segment', () => {
  it('rejects slug containing "issue-123"', () => {
    expect(() => validateSlug('issue-123-something')).toThrow(/issue-/i);
  });

  it('rejects a fully-prefixed slug returned by a drifted LLM', () => {
    expect(() => validateSlug('feature-issue-455-json-reporter-findings')).toThrow();
  });
});
