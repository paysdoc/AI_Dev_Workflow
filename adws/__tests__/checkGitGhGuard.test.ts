/**
 * checkGitGhGuard.test.ts — #701 scanFiles behavioural assertions.
 *
 * Drives the exported scanFiles() over in-memory fixture paths + sources,
 * proving that a raw git/gh call in a non-package file is a violation,
 * and that there is no allowlist parameter or skip remaining.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');

import { scanFiles, scanExtractionScope, EXEMPT_PACKAGES, isExemptPackage } from '../checkGitGhGuard';
import { isSanctionedConstructionSite, findStaleSanctionedEntries, SANCTIONED_CONSTRUCTION_SITES } from '../guard/constructionRule';

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

    // A sanctioned path is used deliberately so the new #795 unsanctioned-construction
    // rule (which flags every bare gitContextForRepo(...) call outside the allowlist)
    // does not also fire here — this test isolates cwd-derived-identity in particular.
    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
    expect(violations[0].command).toBe('gitContextForRepo(getRepoInfo())');
  });

  it('flags a local-variable composite: const info = getRepoInfo(); … gitContextForRepo(info)', () => {
    mockReadFileSync.mockReturnValue(
      'const info = getRepoInfo();\nconst ctx = gitContextForRepo(info);\n',
    );

    // Sanctioned path — see comment in the test above.
    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
    expect(violations[0].command).toBe('gitContextForRepo(info)');
  });

  it('flags a readLocalRepoInfo() composite', () => {
    mockReadFileSync.mockReturnValue(
      'const ctx = gitContextForRepo(readLocalRepoInfo(), { selfHost: true });\n',
    );

    // Sanctioned path — see comment on the first cwd-derived-identity test above.
    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
    expect(violations[0].command).toBe('gitContextForRepo(readLocalRepoInfo())');
  });

  it('permits gitContextForRepo(readLocalRepoInfo(REPO_ROOT)) — an explicit argument is not cwd-derived', () => {
    mockReadFileSync.mockReturnValue(
      'const ctx = gitContextForRepo(readLocalRepoInfo(REPO_ROOT), { selfHost: true });\n',
    );

    // Sanctioned path — see comment on the first cwd-derived-identity test above.
    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('permits a guarded-fallback identity: const r = repoInfo ?? getRepoInfo(); gitContextForRepo(r)', () => {
    mockReadFileSync.mockReturnValue(
      'const r = repoInfo ?? getRepoInfo();\nconst ctx = gitContextForRepo(r);\n',
    );

    // Sanctioned path — see comment on the first cwd-derived-identity test above. The bare
    // gitContextForRepo(r) call here would otherwise also trip #795's unsanctioned-construction
    // rule, which (unlike this rule) does not care whether the argument is cwd-derived.
    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('permits gitContextForRepo(repoInfoParam) — an unrelated identifier is never collected', () => {
    mockReadFileSync.mockReturnValue(
      'function handle(repoInfoParam) {\n  return gitContextForRepo(repoInfoParam);\n}\n',
    );

    // Sanctioned path — see comment above. Note the identical source IS one violation
    // under unsanctioned-construction at a non-allowlisted path (see that describe block).
    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

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

describe('scanFiles — cwd-derived-identity rule follows forgeProviders (#823)', () => {
  it('flags an inline forgeProviders({ identity: readLocalRepoInfo() }) composite', () => {
    mockReadFileSync.mockReturnValue(
      "const p = forgeProviders({ identity: readLocalRepoInfo(), tokenProvider, gitContext, forge });\n",
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
  });

  it('flags a local-variable composite: const info = getRepoInfo(); … forgeProviders({ identity: info })', () => {
    mockReadFileSync.mockReturnValue(
      'const info = getRepoInfo();\nconst p = forgeProviders({ identity: info, tokenProvider, gitContext, forge });\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
  });

  it('flags the shorthand form: const identity = getRepoInfo(); … forgeProviders({ identity })', () => {
    mockReadFileSync.mockReturnValue(
      'const identity = getRepoInfo();\nconst p = forgeProviders({ identity, tokenProvider, gitContext, forge });\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
  });

  it('flags deps.forgeProviders({ identity: getRepoInfo() }) — an injected seam still carries a cwd-derived identity', () => {
    mockReadFileSync.mockReturnValue(
      'function a(deps) { return deps.forgeProviders({ identity: getRepoInfo(), tokenProvider, gitContext, forge }); }\n',
    );

    const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
  });

  it('permits forgeProviders({ identity: repoIdParam }) — an unrelated identifier is never collected', () => {
    mockReadFileSync.mockReturnValue(
      'function handle(repoIdParam) {\n  return forgeProviders({ identity: repoIdParam, tokenProvider, gitContext, forge });\n}\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations.filter((v) => v.rule === 'cwd-derived-identity')).toHaveLength(0);
  });

  it('permits forgeProviders({ identity: readLocalRepoInfo(REPO_ROOT) }) — an explicit argument is not cwd-derived', () => {
    mockReadFileSync.mockReturnValue(
      'const p = forgeProviders({ identity: readLocalRepoInfo(REPO_ROOT), tokenProvider, gitContext, forge });\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations.filter((v) => v.rule === 'cwd-derived-identity')).toHaveLength(0);
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

describe('scanFiles — unsanctioned-construction rule (#795)', () => {
  describe('flags deliberate violations', () => {
    it('flags a bare createGitHubIssueTracker(...) call in a non-allowlisted file', () => {
      mockReadFileSync.mockReturnValue(
        "const t = createGitHubIssueTracker({ owner: 'acme', repo: 'typo', platform: Platform.GitHub });\n",
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
    });

    it('flags a bare createRepoContext(...) call in a non-allowlisted file', () => {
      mockReadFileSync.mockReturnValue('const rc = createRepoContext({ repoId, cwd });\n');

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
    });

    it('flags a bare mintBoundProviders(...) call in a non-allowlisted file', () => {
      mockReadFileSync.mockReturnValue(
        'const providers = mintBoundProviders({ repoId, codeHostPlatform, issueTrackerPlatform });\n',
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
    });

    it('flags new GitContext(...) in a non-allowlisted file, naming it in `command`', () => {
      mockReadFileSync.mockReturnValue('const ctx = new GitContext({ owner, repo, selfHost: false });\n');

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
      expect(violations[0].command).toContain('new GitContext');
    });

    it('flags gitContextForRepo(repoInfoParam) — the identical source is ZERO violations under cwd-derived-identity (see that describe block above), proving the two rules are independent', () => {
      mockReadFileSync.mockReturnValue(
        'function handle(repoInfoParam) {\n  return gitContextForRepo(repoInfoParam);\n}\n',
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
    });

    it('flags two constructions in one file as two violations, one per line', () => {
      mockReadFileSync.mockReturnValue(
        'const t = createGitHubIssueTracker(repoId);\nconst h = createGitHubCodeHost(repoId);\n',
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(2);
      expect(violations[0].line).toBe(1);
      expect(violations[1].line).toBe(2);
      expect(violations.every((v) => v.rule === 'unsanctioned-construction')).toBe(true);
    });

    it('flags a bare forgeProviders(...) call in a non-allowlisted file', () => {
      mockReadFileSync.mockReturnValue(
        "const p = forgeProviders({ forge, identity, tokenProvider, gitContext });\n",
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
    });

    it('flags createGitHubIssueTracker(...) at the now-retired mint file and factory-definition file — neither is sanctioned any longer', () => {
      mockReadFileSync.mockReturnValue(
        "const t = createGitHubIssueTracker({ owner: 'acme', repo: 'typo', platform: Platform.GitHub });\n",
      );

      const atRepoContext = scanFiles(['adws/providers/repoContext.ts'], '/repo');
      const atGitContextFactory = scanFiles(['adws/github/gitContextFactory.ts'], '/repo');

      expect(atRepoContext.violations).toHaveLength(1);
      expect(atRepoContext.violations[0].rule).toBe('unsanctioned-construction');
      expect(atGitContextFactory.violations).toHaveLength(1);
      expect(atGitContextFactory.violations[0].rule).toBe('unsanctioned-construction');
    });
  });

  describe('does not flag sanctioned sites or legal shapes', () => {
    it('permits createGitHubIssueTracker(...) at the permanent launch-boundary file', () => {
      mockReadFileSync.mockReturnValue(
        "const t = createGitHubIssueTracker({ owner: 'acme', repo: 'typo', platform: Platform.GitHub });\n",
      );

      const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

      expect(violations).toHaveLength(0);
    });

    it('permits createGitHubIssueTracker(...) at the permanent assembly-module file', () => {
      mockReadFileSync.mockReturnValue(
        "const t = createGitHubIssueTracker({ owner: 'acme', repo: 'typo', platform: Platform.GitHub });\n",
      );

      const { violations } = scanFiles(['adws/providers/forgeProviders.ts'], '/repo');

      expect(violations).toHaveLength(0);
    });

    it('permits deps.forgeProviders(...) — an injected seam, not a bypass', () => {
      mockReadFileSync.mockReturnValue(
        'function a(deps) { return deps.forgeProviders({ forge, identity, tokenProvider, gitContext }); }\n',
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(0);
    });

    it('permits createGhCommandRunner/createGitHubTokenProvider/createIssueCmd/createGhRepoApi — the flagged set is explicit names, never a create* pattern', () => {
      mockReadFileSync.mockReturnValue(
        'const runner = createGhCommandRunner(ctx);\nconst tp = createGitHubTokenProvider({ pat });\nconst cmd = createIssueCmd(o, r, t);\nconst gh = createGhRepoApi(ctx);\n',
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(0);
    });

    it('permits deps.gitContextForRepo(...) and d.gitContextForRepo(...) — injected seams, not bypasses', () => {
      mockReadFileSync.mockReturnValue(
        'function a(deps) { return deps.gitContextForRepo(repoInfo); }\nfunction b(d) { return d.gitContextForRepo(repoInfo); }\n',
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(0);
    });

    it('permits a createGitHubCodeHost function declaration — declarations are never flagged, only calls', () => {
      mockReadFileSync.mockReturnValue(
        'export function createGitHubCodeHost(repoId) {\n  return new GitHubCodeHostImpl(repoId);\n}\n',
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(0);
    });

    it('a git shell-out in a construction-sanctioned file is still exactly one git-gh-shellout violation — the construction allowlist does not leak into the other rules', () => {
      mockReadFileSync.mockReturnValue('const x = execSync("git status");\n');

      const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('git-gh-shellout');
    });
  });
});

describe('isSanctionedConstructionSite — the two-entry permanent allowlist (#795, #823)', () => {
  it('is true for both permanent paths', () => {
    expect(isSanctionedConstructionSite('adws/core/launchGitContext.ts')).toBe(true);
    expect(isSanctionedConstructionSite('adws/providers/forgeProviders.ts')).toBe(true);
  });

  it('is false for the retired mint file and factory-definition file — #823 took the sunset half to zero', () => {
    expect(isSanctionedConstructionSite('adws/providers/repoContext.ts')).toBe(false);
    expect(isSanctionedConstructionSite('adws/github/gitContextFactory.ts')).toBe(false);
  });

  it('is false for an unlisted file', () => {
    expect(isSanctionedConstructionSite('adws/phases/reviewPhaseNew.ts')).toBe(false);
  });

  it('is false for a directory prefix — a whole directory is never sanctioned, only exact files', () => {
    expect(isSanctionedConstructionSite('adws/core/somethingElse.ts')).toBe(false);
  });

  it('the allowlist is exactly two permanent entries and no transitional entry', () => {
    const permanent = SANCTIONED_CONSTRUCTION_SITES.filter((site) => !('owner' in site));
    const transitional = SANCTIONED_CONSTRUCTION_SITES.filter((site) => 'owner' in site);

    expect(permanent).toHaveLength(2);
    expect(transitional).toHaveLength(0);
  });
});

describe('findStaleSanctionedEntries (#795, #823)', () => {
  it('with an empty seen-set, returns [] — nothing transitional is left to go stale', () => {
    const stale = findStaleSanctionedEntries(new Set());

    expect(stale).toEqual([]);
  });

  it('with both permanent paths seen, returns []', () => {
    const stale = findStaleSanctionedEntries(new Set(['adws/core/launchGitContext.ts', 'adws/providers/forgeProviders.ts']));

    expect(stale).toEqual([]);
  });
});

describe('scanExtractionScope — extraction-readiness rule (#816)', () => {
  it('fails: an in-scope gitContext file importing ../../core', () => {
    mockReadFileSync.mockReturnValue("import { log } from '../../core';\n");

    const { violations, scannedCount } = scanExtractionScope(['adws/gitContext/newOp.ts'], '/repo');

    expect(scannedCount).toBe(1);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
    expect(violations[0].file).toBe('adws/gitContext/newOp.ts');
    expect(violations[0].line).toBe(1);
    expect(violations[0].command).toContain('../../core');
  });

  it('fails: adws/providers/types.ts importing ../core/projectConfig', () => {
    mockReadFileSync.mockReturnValue("import { CONFIG_PATH } from '../core/projectConfig';\n");

    const { violations } = scanExtractionScope(['adws/providers/types.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('fails: a type-only import still counts', () => {
    mockReadFileSync.mockReturnValue("import type { GitHubIssue } from '../github/githubApi';\n");

    const { violations } = scanExtractionScope(['adws/gitContext/newOp.ts'], '/repo');

    expect(violations).toHaveLength(1);
  });

  it('passes: a clean in-scope file', () => {
    mockReadFileSync.mockReturnValue(
      "import { execSync } from 'child_process';\nimport * as path from 'node:path';\nimport * as ts from 'typescript';\nimport type { Logger } from './types';\n",
    );

    const { violations } = scanExtractionScope(['adws/gitContext/newOp.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('passes: an intra-set import', () => {
    mockReadFileSync.mockReturnValue("import type { RepoIdentifier } from '../providers/types';\n");

    const { violations } = scanExtractionScope(['adws/gitContext/a.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('fails: adws/providers/github/githubCodeHost.ts importing ../../github/prApi (in scope since #819)', () => {
    mockReadFileSync.mockReturnValue("import { getRepoInfo } from '../../github/prApi';\n");

    const { violations } = scanExtractionScope(['adws/providers/github/githubCodeHost.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('fails: adws/providers/forgeProviders.ts importing ../core/logger (the whole provider package is in scope since #823)', () => {
    mockReadFileSync.mockReturnValue("import { log } from '../core/logger';\n");

    const { violations } = scanExtractionScope(['adws/providers/forgeProviders.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('fails: adws/providers/repoContext.ts importing ../github/githubApi (in scope since #823)', () => {
    mockReadFileSync.mockReturnValue("import { getRepoInfo } from '../github/githubApi';\n");

    const { violations } = scanExtractionScope(['adws/providers/repoContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('fails: adws/providers/github/mappers.ts importing ../../types/issueTypes (in scope since #817)', () => {
    mockReadFileSync.mockReturnValue("import type { GitHubIssue } from '../../types/issueTypes';\n");

    const { violations } = scanExtractionScope(['adws/providers/github/mappers.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('fails: a domain module importing ../../../github/prApi', () => {
    mockReadFileSync.mockReturnValue("import type { RawPR } from '../../../github/prApi';\n");

    const { violations } = scanExtractionScope(['adws/providers/github/domain/pullRequest.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('passes: domain/pullRequest.ts importing ./issue', () => {
    mockReadFileSync.mockReturnValue("import type { GitHubUser } from './issue';\n");

    const { violations } = scanExtractionScope(['adws/providers/github/domain/pullRequest.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('passes: mappers.ts importing ./domain/issue and ../types', () => {
    mockReadFileSync.mockReturnValue(
      "import type { GitHubIssue } from './domain/issue';\nimport type { RepoIdentifier } from '../types';\n",
    );

    const { violations } = scanExtractionScope(['adws/providers/github/mappers.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('two escaping imports in one file are two violations, one per line', () => {
    mockReadFileSync.mockReturnValue(
      "import { log } from '../core';\nimport { getRepoInfo } from '../github/githubApi';\n",
    );

    const { violations } = scanExtractionScope(['adws/gitContext/newOp.ts'], '/repo');

    expect(violations).toHaveLength(2);
    expect(violations[0].line).toBe(1);
    expect(violations[1].line).toBe(2);
    expect(violations.every((v) => v.rule === 'extraction-readiness')).toBe(true);
  });

  it('fails: adws/providers/gitlab/gitlabApiClient.ts importing ../../core (in scope since #818)', () => {
    mockReadFileSync.mockReturnValue("import { log } from '../../core';\n");

    const { violations } = scanExtractionScope(['adws/providers/gitlab/gitlabApiClient.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('fails: adws/providers/jira/jiraIssueTracker.ts importing ../../core (in scope since #818)', () => {
    mockReadFileSync.mockReturnValue("import { log, JIRA_EMAIL } from '../../core';\n");

    const { violations } = scanExtractionScope(['adws/providers/jira/jiraIssueTracker.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
  });

  it('passes: adws/providers/gitlab/gitlabCodeHost.ts importing the Logger port, its own client, and provider types', () => {
    mockReadFileSync.mockReturnValue(
      "import { consoleLogger } from '../../gitContext/consoleLogger';\nimport { GitLabApiClient } from './gitlabApiClient';\nimport type { RepoIdentifier } from '../types';\n",
    );

    const { violations } = scanExtractionScope(['adws/providers/gitlab/gitlabCodeHost.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('passes: adws/providers/jira/jiraApiClient.ts importing the Logger port type', () => {
    mockReadFileSync.mockReturnValue("import type { Logger } from '../../gitContext/types';\n");

    const { violations } = scanExtractionScope(['adws/providers/jira/jiraApiClient.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('the scope scan never runs the other three rules', () => {
    mockReadFileSync.mockReturnValue('const x = execSync("git status");\n');

    const { violations } = scanExtractionScope(['adws/gitContext/a.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('scanFiles is unchanged: length is still 2, and a non-scope framework import is zero violations under it', () => {
    expect(scanFiles.length).toBe(2);

    mockReadFileSync.mockReturnValue("import { log } from '../core';\n");
    const { violations } = scanFiles(['adws/phases/x.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });
});

describe('guarded factory names still exist (#795 / AC3)', () => {
  const cases: { name: string; file: string; declPattern: RegExp }[] = [
    { name: 'forgeProviders', file: 'adws/providers/forgeProviders.ts', declPattern: /export function forgeProviders\(/ },
    { name: 'readLocalRepoInfo', file: 'adws/providers/github/githubIdentity.ts', declPattern: /export function readLocalRepoInfo\(/ },
    { name: 'createGitHubIssueTracker', file: 'adws/providers/github/githubIssueTracker.ts', declPattern: /export function createGitHubIssueTracker\(/ },
    { name: 'createGitHubCodeHost', file: 'adws/providers/github/githubCodeHost.ts', declPattern: /export function createGitHubCodeHost\(/ },
    { name: 'createGitHubBoardManager', file: 'adws/providers/github/githubBoardManager.ts', declPattern: /export function createGitHubBoardManager\(/ },
    { name: 'createGitLabCodeHost', file: 'adws/providers/gitlab/gitlabCodeHost.ts', declPattern: /export function createGitLabCodeHost\(/ },
    { name: 'createGitLabBoardManager', file: 'adws/providers/gitlab/gitlabBoardManager.ts', declPattern: /export function createGitLabBoardManager\(/ },
    { name: 'createJiraIssueTracker', file: 'adws/providers/jira/jiraIssueTracker.ts', declPattern: /export function createJiraIssueTracker\(/ },
    { name: 'createJiraBoardManager', file: 'adws/providers/jira/jiraBoardManager.ts', declPattern: /export function createJiraBoardManager\(/ },
    { name: 'GitContext', file: 'adws/gitContext/gitContext.ts', declPattern: /export class GitContext\b/ },
    { name: 'GitContext barrel', file: 'adws/gitContext/index.ts', declPattern: /export \{ GitContext \} from '\.\/gitContext'/ },
  ];

  // fs is mocked at module scope (see `vi.mock('fs')` above) — the factory modules
  // themselves are never imported directly, since they pull in core/environment and
  // would run env/dotenv side effects under a mocked fs. Instead, obtain the real fs
  // module and read each owning source file as plain text, matching its declaration.
  it.each(cases)('$name is still declared in $file', async ({ name, file, declPattern }) => {
    const realFs = await vi.importActual<typeof import('fs')>('fs');
    const source = realFs.readFileSync(path.join(process.cwd(), file), 'utf-8');

    expect(
      declPattern.test(source),
      `Expected to find "${name}"'s declaration in ${file} — was it renamed? Update ` +
      'CWD_DERIVED_IDENTITY_FNS/CONTEXT_CONSTRUCTOR_NAMES (adws/guard/identityRule.ts), ' +
      'PROVIDER_CONSTRUCTORS/CONTEXT_CONSTRUCTORS/GIT_CONTEXT_CLASS_NAME (adws/guard/constructionRule.ts), or ' +
      'EXTRACTION_SCOPE (adws/guard/extractionRule.ts) accordingly.',
    ).toBe(true);
  });
});
