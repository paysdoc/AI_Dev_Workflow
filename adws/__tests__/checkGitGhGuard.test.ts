/**
 * checkGitGhGuard.test.ts — #701 scanFiles behavioural assertions.
 *
 * Drives the exported scanFiles() over in-memory fixture paths + sources,
 * proving that a raw git/gh call in a non-package file is a violation,
 * and that there is no allowlist parameter or skip remaining.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs');

import { scanFiles } from '../checkGitGhGuard';

const mockReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scanFiles — ALLOWLIST removed (#701)', () => {
  it('reports a violation for a raw execSync(git …) call in a non-package file', () => {
    mockReadFileSync.mockReturnValue('const x = execSync("git status");\n');

    const { violations, scannedCount } = scanFiles(['adws/triggers/trigger_cron.ts'], '/repo');

    expect(scannedCount).toBe(1);
    expect(violations).toHaveLength(1);
    expect(violations[0].command).toBe('git status');
    expect(violations[0].file).toBe('adws/triggers/trigger_cron.ts');
  });

  it('reports a violation for a raw execSync(gh …) call', () => {
    mockReadFileSync.mockReturnValue('execSync(`gh pr create --title "foo"`);\n');

    const { violations } = scanFiles(['adws/agents/buildAgent.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].command).toMatch(/^gh/);
  });

  it('returns no violations when the source has no git/gh call', () => {
    mockReadFileSync.mockReturnValue('const x = execSync("ls -la");\n');

    const { violations, scannedCount } = scanFiles(['adws/core/utils.ts'], '/repo');

    expect(scannedCount).toBe(1);
    expect(violations).toHaveLength(0);
  });

  it('scans all provided paths — no allowlist skip reduces scannedCount', () => {
    mockReadFileSync.mockReturnValue('// clean file\n');

    const paths = [
      'adws/triggers/trigger_webhook.ts',
      'adws/adwUpgrade.tsx',
      'adws/adwMerge.tsx',
    ];
    const { scannedCount } = scanFiles(paths, '/repo');

    expect(scannedCount).toBe(paths.length);
    expect(mockReadFileSync).toHaveBeenCalledTimes(paths.length);
  });

  it('scanFiles signature accepts no allowlist parameter — only relPaths and repoRoot', () => {
    // The function should accept exactly (relPaths, repoRoot).
    // TypeScript enforces this at compile-time; this assertion documents the contract.
    expect(scanFiles.length).toBe(2);
  });
});

describe('scanFiles — cwd-derived-identity rule (#769)', () => {
  it('flags an inline gitContextForRepo(getRepoInfo()) composite', () => {
    mockReadFileSync.mockReturnValue(
      "const ctx = gitContextForRepo(getRepoInfo());\nctx.lsFiles(ctx.basePath);\n",
    );

    const { violations } = scanFiles(['adws/triggers/someProbe.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
    expect(violations[0].command).toBe('gitContextForRepo(getRepoInfo())');
  });

  it('flags a local-variable composite: const info = getRepoInfo(); … gitContextForRepo(info)', () => {
    mockReadFileSync.mockReturnValue(
      'const info = getRepoInfo();\nconst ctx = gitContextForRepo(info);\n',
    );

    const { violations } = scanFiles(['adws/triggers/someProbe.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
    expect(violations[0].command).toBe('gitContextForRepo(info)');
  });

  it('flags a readLocalRepoInfo() composite', () => {
    mockReadFileSync.mockReturnValue(
      'const ctx = gitContextForRepo(readLocalRepoInfo(), { selfHost: true });\n',
    );

    const { violations } = scanFiles(['adws/healthCheck.tsx'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
    expect(violations[0].command).toBe('gitContextForRepo(readLocalRepoInfo())');
  });

  it('permits gitContextForRepo(readLocalRepoInfo(REPO_ROOT)) — an explicit argument is not cwd-derived', () => {
    mockReadFileSync.mockReturnValue(
      'const ctx = gitContextForRepo(readLocalRepoInfo(REPO_ROOT), { selfHost: true });\n',
    );

    const { violations } = scanFiles(['adws/healthCheck.tsx'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('permits a guarded-fallback identity: const r = repoInfo ?? getRepoInfo(); gitContextForRepo(r)', () => {
    mockReadFileSync.mockReturnValue(
      'const r = repoInfo ?? getRepoInfo();\nconst ctx = gitContextForRepo(r);\n',
    );

    const { violations } = scanFiles(['adws/triggers/someHandler.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('permits gitContextForRepo(repoInfoParam) — an unrelated identifier is never collected', () => {
    mockReadFileSync.mockReturnValue(
      'function handle(repoInfoParam) {\n  return gitContextForRepo(repoInfoParam);\n}\n',
    );

    const { violations } = scanFiles(['adws/triggers/someHandler.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('permits a bare getRepoInfo() that is never fed to a context construction', () => {
    mockReadFileSync.mockReturnValue(
      'const info = getRepoInfo();\nconsole.log(info.owner);\n',
    );

    const { violations } = scanFiles(['adws/triggers/someHandler.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('existing git-gh-shellout detections are tagged with rule "git-gh-shellout"', () => {
    mockReadFileSync.mockReturnValue('const x = execSync("git status");\n');

    const { violations } = scanFiles(['adws/triggers/trigger_cron.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('git-gh-shellout');
  });
});
