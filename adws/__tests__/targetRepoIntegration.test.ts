import { describe, it, expect, vi } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
  parseTargetRepoArgs: vi.fn(),
}));

// --- Tests for getRepoInfoFromUrl and getRepoInfoFromPayload ---
import { getRepoInfoFromUrl, getRepoInfoFromPayload } from '../github/githubApi';

describe('getRepoInfoFromUrl', () => {
  it('parses HTTPS GitHub URL', () => {
    const result = getRepoInfoFromUrl('https://github.com/myorg/myrepo.git');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo' });
  });

  it('parses HTTPS URL without .git suffix', () => {
    const result = getRepoInfoFromUrl('https://github.com/myorg/myrepo');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo' });
  });

  it('parses SSH GitHub URL', () => {
    const result = getRepoInfoFromUrl('git@github.com:myorg/myrepo.git');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo' });
  });

  it('parses SSH URL without .git suffix', () => {
    const result = getRepoInfoFromUrl('git@github.com:myorg/myrepo');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo' });
  });

  it('throws for invalid URL format', () => {
    expect(() => getRepoInfoFromUrl('not-a-url')).toThrow();
  });

  it('throws for empty string', () => {
    expect(() => getRepoInfoFromUrl('')).toThrow();
  });
});

describe('getRepoInfoFromPayload', () => {
  it('parses owner/repo format', () => {
    const result = getRepoInfoFromPayload('myorg/myrepo');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo' });
  });

  it('throws for invalid format without slash', () => {
    expect(() => getRepoInfoFromPayload('invalid')).toThrow();
  });

  it('throws for empty string', () => {
    expect(() => getRepoInfoFromPayload('')).toThrow();
  });

  it('throws for format with too many slashes', () => {
    expect(() => getRepoInfoFromPayload('a/b/c')).toThrow();
  });
});

// --- Tests for parseTargetRepoArgs ---
// We need the real implementation, so re-import from the actual module
vi.unmock('../core/utils');

import { parseTargetRepoArgs } from '../core/utils';

describe('parseTargetRepoArgs', () => {
  it('returns null when no --target-repo arg is present', () => {
    const args = ['42', '--issue-type', '/feature'];
    const result = parseTargetRepoArgs(args);
    expect(result).toBeNull();
    expect(args).toEqual(['42', '--issue-type', '/feature']);
  });

  it('parses --target-repo and --clone-url', () => {
    const args = ['42', '--target-repo', 'myorg/myrepo', '--clone-url', 'https://github.com/myorg/myrepo.git', '--issue-type', '/feature'];
    const result = parseTargetRepoArgs(args);
    expect(result).toEqual({
      owner: 'myorg',
      repo: 'myrepo',
      cloneUrl: 'https://github.com/myorg/myrepo.git',
    });
    // Args should have --target-repo and --clone-url stripped
    expect(args).toEqual(['42', '--issue-type', '/feature']);
  });

  it('defaults clone URL when --clone-url is not provided', () => {
    const args = ['42', '--target-repo', 'myorg/myrepo'];
    const result = parseTargetRepoArgs(args);
    expect(result).toEqual({
      owner: 'myorg',
      repo: 'myrepo',
      cloneUrl: 'https://github.com/myorg/myrepo.git',
    });
    expect(args).toEqual(['42']);
  });

  it('strips args from the array (mutation)', () => {
    const args = ['--target-repo', 'a/b', '--clone-url', 'https://x.com', '99'];
    parseTargetRepoArgs(args);
    expect(args).toEqual(['99']);
  });

  it('exits with error for missing value after --target-repo', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const args = ['--target-repo'];
    expect(() => parseTargetRepoArgs(args)).toThrow('exit');

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('exits with error for invalid owner/repo format', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const args = ['--target-repo', 'invalid-no-slash'];
    expect(() => parseTargetRepoArgs(args)).toThrow('exit');

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

// --- Tests for webhook trigger repo extraction ---

describe('extractTargetRepoArgs (webhook pattern)', () => {
  // Test the pattern used in trigger_webhook.ts for extracting repo info from payloads
  function extractTargetRepoArgs(body: Record<string, unknown>): string[] {
    const repository = body.repository as Record<string, unknown> | undefined;
    if (!repository) return [];

    const fullName = repository.full_name as string | undefined;
    const cloneUrl = (repository.clone_url as string | undefined) || (repository.html_url as string | undefined);

    if (!fullName || !cloneUrl) return [];

    return ['--target-repo', fullName, '--clone-url', cloneUrl];
  }

  it('extracts repo info from a full webhook payload', () => {
    const payload = {
      action: 'opened',
      issue: { number: 42 },
      repository: {
        full_name: 'myorg/myrepo',
        clone_url: 'https://github.com/myorg/myrepo.git',
        html_url: 'https://github.com/myorg/myrepo',
      },
    };

    const result = extractTargetRepoArgs(payload);
    expect(result).toEqual([
      '--target-repo', 'myorg/myrepo',
      '--clone-url', 'https://github.com/myorg/myrepo.git',
    ]);
  });

  it('falls back to html_url when clone_url is missing', () => {
    const payload = {
      repository: {
        full_name: 'myorg/myrepo',
        html_url: 'https://github.com/myorg/myrepo',
      },
    };

    const result = extractTargetRepoArgs(payload);
    expect(result).toEqual([
      '--target-repo', 'myorg/myrepo',
      '--clone-url', 'https://github.com/myorg/myrepo',
    ]);
  });

  it('returns empty array when no repository field', () => {
    const payload = { action: 'opened', issue: { number: 42 } };
    const result = extractTargetRepoArgs(payload);
    expect(result).toEqual([]);
  });

  it('returns empty array when repository has no full_name', () => {
    const payload = {
      repository: { clone_url: 'https://github.com/myorg/myrepo.git' },
    };
    const result = extractTargetRepoArgs(payload);
    expect(result).toEqual([]);
  });
});
