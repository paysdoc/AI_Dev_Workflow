import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { makeDocsIndexSweepDefaults } from '../docsIndexSweepDefaults';
import type { SweepBase } from '../perIssueSweepPersist';
import type { LaunchBoundary } from '../../core';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeBoundary(): LaunchBoundary {
  return { gitContext: { selfHost: false }, providers: { issueTracker: {} } } as unknown as LaunchBoundary;
}

function worktreeWith(files: Record<string, string>): SweepBase {
  const dir = mkdtempSync(join(tmpdir(), 'adw-docsIndexSweepDefaults-'));
  tempDirs.push(dir);
  for (const [relPath, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, relPath)), { recursive: true });
    writeFileSync(join(dir, relPath), body);
  }
  return { worktreePath: dir } as unknown as SweepBase;
}

describe('makeDocsIndexSweepDefaults — readDoc', () => {
  it('reads a doc from the sweep worktree', () => {
    const base = worktreeWith({ 'app_docs/feature-a.md': '# A\n' });

    const { readDoc } = makeDocsIndexSweepDefaults(makeBoundary(), () => base);

    expect(readDoc('app_docs/feature-a.md')).toBe('# A\n');
  });

  it('returns null for a doc the worktree does not hold', () => {
    const base = worktreeWith({});

    const { readDoc } = makeDocsIndexSweepDefaults(makeBoundary(), () => base);

    expect(readDoc('app_docs/feature-missing.md')).toBeNull();
  });

  it('returns null when there is no sweep base', () => {
    const { readDoc } = makeDocsIndexSweepDefaults(makeBoundary(), () => null);

    expect(readDoc('app_docs/feature-a.md')).toBeNull();
  });
});
