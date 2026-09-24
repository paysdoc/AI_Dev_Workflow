import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');

import { scanFiles, EXEMPT_PACKAGES, isExemptPackage } from '../checkGitGhGuard';
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
    expect(scanFiles.length).toBe(2);
  });
});

describe('scanFiles — cwd-derived-identity rule (#769)', () => {
  it('flags an inline gitContextForRepo(getRepoInfo()) composite', () => {
    mockReadFileSync.mockReturnValue(
      "const ctx = gitContextForRepo(getRepoInfo());\nctx.lsFiles(ctx.basePath);\n",
    );

    // A sanctioned path is used deliberately so the unsanctioned-construction
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
    // gitContextForRepo(r) call here would otherwise also trip the unsanctioned-construction
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

describe('scanFiles — cwd-derived-identity rule follows readLocalRepoIdentity (#844)', () => {
  it('flags an inline gitContextForRepo(readLocalRepoIdentity()) composite', () => {
    mockReadFileSync.mockReturnValue(
      'const ctx = gitContextForRepo(readLocalRepoIdentity());\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
    expect(violations[0].command).toBe('gitContextForRepo(readLocalRepoIdentity())');
  });

  it('flags an inline forgeProviders({ identity: readLocalRepoIdentity() }) composite', () => {
    mockReadFileSync.mockReturnValue(
      'const p = forgeProviders({ identity: readLocalRepoIdentity(), tokenProvider, gitContext, forge });\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
  });

  it('flags a local-variable composite: const info = readLocalRepoIdentity(); … gitContextForRepo(info)', () => {
    mockReadFileSync.mockReturnValue(
      'const info = readLocalRepoIdentity();\nconst ctx = gitContextForRepo(info);\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
  });

  it('permits gitContextForRepo(readLocalRepoIdentity(REPO_ROOT)) — an explicit argument is not cwd-derived', () => {
    mockReadFileSync.mockReturnValue(
      'const ctx = gitContextForRepo(readLocalRepoIdentity(REPO_ROOT));\n',
    );

    const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

    expect(violations).toHaveLength(0);
  });

  it('still flags forgeProviders({ identity: readLocalRepoIdentity() }) when forgeProviders is an imported name, not a local declaration (#840)', () => {
    mockReadFileSync.mockReturnValue(
      "import { forgeProviders } from '@paysdoc/devplatform/providers';\nconst p = forgeProviders({ identity: readLocalRepoIdentity() });\n",
    );

    const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('cwd-derived-identity');
  });
});

describe('EXEMPT_PACKAGES — the closed, empty exempt set (#840)', () => {
  it('is empty — the git core and the GitHub forge adapter now live in @paysdoc/devplatform', () => {
    expect(EXEMPT_PACKAGES).toHaveLength(0);
  });
});

describe('isExemptPackage — the empty set exempts nothing (#840)', () => {
  it('is false for the former git core package directory', () => {
    expect(isExemptPackage('adws/gitContext')).toBe(false);
  });

  it('is false for a file beneath the former git core package', () => {
    expect(isExemptPackage('adws/gitContext/appAuth.ts')).toBe(false);
  });

  it('is false for the former GitHub forge adapter directory', () => {
    expect(isExemptPackage('adws/providers/github')).toBe(false);
  });

  it('is false for a file beneath the former GitHub forge adapter', () => {
    expect(isExemptPackage('adws/providers/github/ghCommandRunner.ts')).toBe(false);
  });

  it('is false for adws/github/ — the name contains "github" but it is not the adapter package', () => {
    expect(isExemptPackage('adws/github/issueApi.ts')).toBe(false);
  });

  it('is false for the adapter\'s former GitLab sibling package', () => {
    expect(isExemptPackage('adws/providers/gitlab/gitlabCodeHost.ts')).toBe(false);
  });

  it('is false for an ordinary consumer package', () => {
    expect(isExemptPackage('adws/phases/reviewPhase.ts')).toBe(false);
  });

  it('is false for the adapter\'s former parent directory file', () => {
    expect(isExemptPackage('adws/providers/repoContext.ts')).toBe(false);
  });
});

describe('a gh or git call site fails the guard — the exempt set is empty (AC4, #840)', () => {
  it('a synthetic gh call site at the former GitHub forge adapter path yields exactly one violation', () => {
    mockReadFileSync.mockReturnValue("execSync('gh issue view 1');\n");

    const { violations } = scanFiles(['adws/providers/github/bar.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('git-gh-shellout');
  });

  it('a synthetic git call site at the former git core path yields exactly one violation', () => {
    mockReadFileSync.mockReturnValue("execSync('git status');\n");

    const { violations } = scanFiles(['adws/gitContext/foo.ts'], '/repo');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('git-gh-shellout');
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

    it('still flags new GitContext(...) when GitContext is an imported name, not a local declaration (#840)', () => {
      mockReadFileSync.mockReturnValue(
        "import { GitContext } from '@paysdoc/devplatform/git';\nconst ctx = new GitContext(opts);\n",
      );

      const { violations } = scanFiles(['adws/phases/someNewPhase.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
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

    it('permits new GitContext(...) with GitContext as an imported name at the permanent launch-boundary file (#840)', () => {
      mockReadFileSync.mockReturnValue(
        "import { GitContext } from '@paysdoc/devplatform/git';\nconst ctx = new GitContext(opts);\n",
      );

      const { violations } = scanFiles(['adws/core/launchGitContext.ts'], '/repo');

      expect(violations).toHaveLength(0);
    });

    it('flags createGitHubIssueTracker(...) at the former assembly-module path — it is no longer a sanctioned site (#840)', () => {
      mockReadFileSync.mockReturnValue(
        "const t = createGitHubIssueTracker({ owner: 'acme', repo: 'typo', platform: Platform.GitHub });\n",
      );

      const { violations } = scanFiles(['adws/providers/forgeProviders.ts'], '/repo');

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('unsanctioned-construction');
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

describe('isSanctionedConstructionSite — the one-entry permanent allowlist (#795, #840)', () => {
  it('is true for the one permanent path', () => {
    expect(isSanctionedConstructionSite('adws/core/launchGitContext.ts')).toBe(true);
  });

  it('is false for the former assembly-module path — its construction role now lives in @paysdoc/devplatform', () => {
    expect(isSanctionedConstructionSite('adws/providers/forgeProviders.ts')).toBe(false);
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

  it('the allowlist is exactly one permanent entry and no transitional entry', () => {
    const permanent = SANCTIONED_CONSTRUCTION_SITES.filter((site) => !('owner' in site));
    const transitional = SANCTIONED_CONSTRUCTION_SITES.filter((site) => 'owner' in site);

    expect(permanent).toHaveLength(1);
    expect(transitional).toHaveLength(0);
  });
});

describe('findStaleSanctionedEntries (#795, #823)', () => {
  it('with an empty seen-set, returns [] — nothing transitional is left to go stale', () => {
    const stale = findStaleSanctionedEntries(new Set());

    expect(stale).toEqual([]);
  });

  it('with the permanent path seen, returns []', () => {
    const stale = findStaleSanctionedEntries(new Set(['adws/core/launchGitContext.ts']));

    expect(stale).toEqual([]);
  });
});

describe('guarded factory names still exist (#795 / AC3, #840)', () => {
  const DIST = 'node_modules/@paysdoc/devplatform/dist';
  const cases: { name: string; file: string; declPattern: RegExp }[] = [
    { name: 'forgeProviders', file: `${DIST}/providers/forgeProviders.d.ts`, declPattern: /export declare function forgeProviders\(/ },
    { name: 'readLocalRepoInfo', file: `${DIST}/providers/github/githubIdentity.d.ts`, declPattern: /export declare function readLocalRepoInfo\(/ },
    { name: 'readLocalRepoIdentity', file: 'adws/core/localRepoIdentity.ts', declPattern: /export function readLocalRepoIdentity\(/ },
    { name: 'createGitHubIssueTracker', file: `${DIST}/providers/github/index.d.ts`, declPattern: /\bcreateGitHubIssueTracker\b/ },
    { name: 'createGitHubCodeHost', file: `${DIST}/providers/github/index.d.ts`, declPattern: /\bcreateGitHubCodeHost\b/ },
    { name: 'createGitHubBoardManager', file: `${DIST}/providers/github/index.d.ts`, declPattern: /\bcreateGitHubBoardManager\b/ },
    { name: 'createGitLabCodeHost', file: `${DIST}/providers/gitlab/index.d.ts`, declPattern: /\bcreateGitLabCodeHost\b/ },
    { name: 'createGitLabBoardManager', file: `${DIST}/providers/gitlab/index.d.ts`, declPattern: /\bcreateGitLabBoardManager\b/ },
    { name: 'createJiraIssueTracker', file: `${DIST}/providers/jira/index.d.ts`, declPattern: /\bcreateJiraIssueTracker\b/ },
    { name: 'createJiraBoardManager', file: `${DIST}/providers/jira/index.d.ts`, declPattern: /\bcreateJiraBoardManager\b/ },
    { name: 'GitContext', file: `${DIST}/git/index.d.ts`, declPattern: /export \{ GitContext \} from/ },
  ];

  // fs is mocked at module scope (see `vi.mock('fs')` above) — the factory modules
  // themselves are never imported directly, since they pull in core/environment and
  // would run env/dotenv side effects under a mocked fs. Instead, obtain the real fs
  // module and read each owning declaration file as plain text, matching its export.
  // Every guarded name but `readLocalRepoIdentity` is declared in the
  // published library, not in this repo — the table reads its `.d.ts` files.
  it.each(cases)('$name is still declared in $file', async ({ name, file, declPattern }) => {
    const realFs = await vi.importActual<typeof import('fs')>('fs');
    const source = realFs.readFileSync(path.join(process.cwd(), file), 'utf-8');

    expect(
      declPattern.test(source),
      `Expected to find "${name}"'s declaration in ${file} — was it renamed? Update ` +
      'CWD_DERIVED_IDENTITY_FNS/CONTEXT_CONSTRUCTOR_NAMES (adws/guard/identityRule.ts) or ' +
      'PROVIDER_CONSTRUCTORS/CONTEXT_CONSTRUCTORS/GIT_CONTEXT_CLASS_NAME (adws/guard/constructionRule.ts) accordingly.',
    ).toBe(true);
  });
});
