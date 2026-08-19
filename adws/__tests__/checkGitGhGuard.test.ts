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

import { scanFiles, EXEMPT_PACKAGES, isExemptPackage } from '../checkGitGhGuard';

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

describe('EXEMPT_PACKAGES — the closed, named, two-entry exempt set (#792)', () => {
  it('names exactly two packages: the git core and the GitHub forge adapter', () => {
    expect(EXEMPT_PACKAGES).toHaveLength(2);
    const dirs = EXEMPT_PACKAGES.map((p) => p.dir);
    expect(dirs).toContain('adws/gitContext');
    expect(dirs).toContain('adws/providers/github');
  });

  it('each entry names a role', () => {
    for (const pkg of EXEMPT_PACKAGES) {
      expect(typeof pkg.role).toBe('string');
      expect(pkg.role.length).toBeGreaterThan(0);
    }
  });
});

describe('isExemptPackage — matches the directory itself or any path beneath it (#792)', () => {
  it('is true for the git core package directory itself', () => {
    expect(isExemptPackage('adws/gitContext')).toBe(true);
  });

  it('is true for a file beneath the git core package', () => {
    expect(isExemptPackage('adws/gitContext/appAuth.ts')).toBe(true);
  });

  it('is true for the GitHub forge adapter directory itself', () => {
    expect(isExemptPackage('adws/providers/github')).toBe(true);
  });

  it('is true for a file beneath the GitHub forge adapter', () => {
    expect(isExemptPackage('adws/providers/github/ghCommandRunner.ts')).toBe(true);
  });

  it('is false for adws/github/ — the name contains "github" but it is not the adapter package', () => {
    expect(isExemptPackage('adws/github/issueApi.ts')).toBe(false);
  });

  it('is false for the adapter\'s GitLab sibling package', () => {
    expect(isExemptPackage('adws/providers/gitlab/gitlabCodeHost.ts')).toBe(false);
  });

  it('is false for an ordinary consumer package', () => {
    expect(isExemptPackage('adws/phases/reviewPhase.ts')).toBe(false);
  });

  it('is false for the adapter\'s parent directory file — one directory above the adapter is not exempt', () => {
    expect(isExemptPackage('adws/providers/repoContext.ts')).toBe(false);
  });
});

describe('a third-package gh call site fails the guard (AC4)', () => {
  it('a synthetic gh call site in adws/github/ (an ordinary, non-exempt package) yields exactly one violation', () => {
    mockReadFileSync.mockReturnValue("execSync('gh issue view 1');\n");

    const { violations } = scanFiles(['adws/github/someNewApi.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('git-gh-shellout');
  });

  it('the counterpart: the same source at adws/providers/github/ is exempt by isExemptPackage, so a whole-repo walk never hands it to scanFiles', () => {
    expect(isExemptPackage('adws/providers/github/someAdapterOp.ts')).toBe(true);
  });
});
