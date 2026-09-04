import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { GitContext } from '../../../gitContext';
import type { GitContextOptions, ExecFn } from '../../../gitContext';
import { createGhRepoApi, type GhRepoApi } from '../ghRepoApi';
import { createLiteralTokenProvider } from '../githubTokenProvider';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
    gitIdentity: {
      authorName: 'ADW Bot',
      authorEmail: 'bot@adw.dev',
      committerName: 'ADW Bot',
      committerEmail: 'bot@adw.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

interface SpyCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function makeSpyExec(stdout = 'main\n'): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: options.env });
    return stdout;
  };
  return { exec, calls };
}

/** Every one of the 35 relocated operations. Return value is not asserted, only (command, cwd, env). */
interface MethodCase {
  name: string;
  invoke: (gh: GhRepoApi) => unknown;
}

/** The only repo-API operations whose command carries no literal `owner/repo` substring. */
const REPO_FREE_METHODS = new Set(['authenticatedUser', 'runGraphQL', 'runGraphQLInput', 'moveIssueToStatus']);

function repoApiMethods(): MethodCase[] {
  return [
    { name: 'defaultBranch', invoke: (gh) => gh.defaultBranch() },
    { name: 'fetchIssue', invoke: (gh) => gh.fetchIssue(28) },
    { name: 'commentOnIssue', invoke: (gh) => gh.commentOnIssue(28, 'body text') },
    { name: 'issueState', invoke: (gh) => gh.issueState(28) },
    { name: 'closeIssue', invoke: (gh) => gh.closeIssue(28) },
    { name: 'issueTitle', invoke: (gh) => gh.issueTitle(28) },
    { name: 'fetchIssueComments', invoke: (gh) => gh.fetchIssueComments(28) },
    { name: 'issueLabels', invoke: (gh) => gh.issueLabels(28) },
    { name: 'addIssueLabel', invoke: (gh) => gh.addIssueLabel(28, 'adw:bug') },
    { name: 'createIssue', invoke: (gh) => gh.createIssue('Title', 'Body') },
    { name: 'updateIssueBody', invoke: (gh) => gh.updateIssueBody(28, 'Body') },
    { name: 'findOpenUpgradeIssue', invoke: (gh) => gh.findOpenUpgradeIssue() },
    { name: 'deleteIssueComment', invoke: (gh) => gh.deleteIssueComment(123) },
    { name: 'listOpenIssues', invoke: (gh) => gh.listOpenIssues({ fields: ['number'] }) },
    { name: 'issueComments', invoke: (gh) => gh.issueComments(28) },
    { name: 'fetchMergedPRs', invoke: (gh) => gh.fetchMergedPRs() },
    { name: 'authenticatedUser', invoke: (gh) => gh.authenticatedUser() },
    { name: 'findPRByBranch', invoke: (gh) => gh.findPRByBranch('feature-x') },
    { name: 'fetchPRDetails', invoke: (gh) => gh.fetchPRDetails(7) },
    { name: 'fetchPRReviews', invoke: (gh) => gh.fetchPRReviews(7) },
    { name: 'fetchPRReviewComments', invoke: (gh) => gh.fetchPRReviewComments(7) },
    { name: 'commentOnPR', invoke: (gh) => gh.commentOnPR(7, 'body text') },
    { name: 'mergePR', invoke: (gh) => gh.mergePR(7) },
    { name: 'approvePR', invoke: (gh) => gh.approvePR(7) },
    { name: 'prApprovalState', invoke: (gh) => gh.prApprovalState(7) },
    { name: 'fetchPRList', invoke: (gh) => gh.fetchPRList() },
    { name: 'fetchAllPRs', invoke: (gh) => gh.fetchAllPRs() },
    { name: 'fetchPRChangedFiles', invoke: (gh) => gh.fetchPRChangedFiles(7) },
    { name: 'createPR', invoke: (gh) => gh.createPR('Title', 'Body', 'feature-issue-1-x') },
    { name: 'createLabel', invoke: (gh) => gh.createLabel('bug', 'ff0000', 'Bug label') },
    { name: 'applyLabel', invoke: (gh) => gh.applyLabel(28, 'adw:bug') },
    { name: 'setSecret', invoke: (gh) => gh.setSecret('MY_SECRET', 'value') },
    { name: 'runGraphQL', invoke: (gh) => gh.runGraphQL('query{}') },
    { name: 'runGraphQLInput', invoke: (gh) => gh.runGraphQLInput({ query: 'mutation{}' }) },
    { name: 'moveIssueToStatus', invoke: (gh) => gh.moveIssueToStatus(28, 'In Progress') },
  ];
}

// ── Reproduction: the RED→GREEN proof (#775) ────────────────────────────────

describe('reproduction: a repo-API call succeeds on a host that has never cloned the target workspace', () => {
  let targetReposDir: string;
  let frameworkRepoRoot: string;

  afterEach(() => {
    fs.rmSync(targetReposDir, { recursive: true, force: true });
    fs.rmSync(frameworkRepoRoot, { recursive: true, force: true });
  });

  function makeConditionalExec(payload: string): ExecFn {
    return (_command, options) => {
      if (!fs.existsSync(options.cwd)) {
        throw new Error('spawnSync /bin/sh ENOENT');
      }
      return payload;
    };
  }

  it('fetchIssueComments returns the payload even though targetReposDir/owner/repo was never created', () => {
    targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-775-target-'));
    frameworkRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-775-framework-'));
    const payload = '[{"body":"hello"}]';
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir }),
      { exec: makeConditionalExec(payload) },
    );
    // basePath (targetReposDir/acme/webapp) deliberately does not exist on disk.
    expect(fs.existsSync(ctx.basePath)).toBe(false);
    expect(createGhRepoApi(ctx).fetchIssueComments(28)).toBe(payload);
  });
});

// ── Table-driven cwd assertion ───────────────────────────────────────────────

describe('every repo-API operation spawns at the injected framework repository root', () => {
  for (const { name, invoke } of repoApiMethods()) {
    it(`${name}() records cwd = frameworkRepoRoot, not basePath`, () => {
      const { exec, calls } = makeSpyExec();
      const ctx = new GitContext(validOptions(), { exec });
      invoke(createGhRepoApi(ctx));
      expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
      expect(calls[0].cwd).not.toBe(ctx.basePath);
    });
  }
});

// ── Self-host invariance ─────────────────────────────────────────────────────

describe('self-host invariance: repo-API operations spawn at the framework root exactly as before', () => {
  for (const { name, invoke } of repoApiMethods()) {
    it(`${name}() records cwd = frameworkRepoRoot for a self-host context`, () => {
      const { exec, calls } = makeSpyExec();
      const ctx = new GitContext(validOptions({ selfHost: true }), { exec });
      invoke(createGhRepoApi(ctx));
      expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
      expect(calls[0].cwd).toBe(ctx.basePath);
    });
  }
});

// ── No ambient cwd ────────────────────────────────────────────────────────────

describe('repo-API commands never inherit the ambient process cwd', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it('records the injected frameworkRepoRoot even after process.chdir()', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    process.chdir('/tmp');
    createGhRepoApi(ctx).defaultBranch();
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].cwd).not.toBe(process.cwd());
  });
});

// ── Anti-drift guard ──────────────────────────────────────────────────────────

describe('anti-drift guard: every repo-API command still names the target repository explicitly', () => {
  for (const { name, invoke } of repoApiMethods().filter((m) => !REPO_FREE_METHODS.has(m.name))) {
    it(`${name}() command string contains "acme/webapp"`, () => {
      const { exec, calls } = makeSpyExec();
      const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
      invoke(createGhRepoApi(ctx));
      expect(calls[0].command).toContain('acme/webapp');
    });
  }

  it('lists exactly the four repo-free methods as excluded from the substring check', () => {
    expect([...REPO_FREE_METHODS].sort()).toEqual(
      ['authenticatedUser', 'moveIssueToStatus', 'runGraphQL', 'runGraphQLInput'].sort(),
    );
  });
});

// ── Auth/env unchanged ────────────────────────────────────────────────────────

describe('repo-API commands preserve the existing auth/env contract', () => {
  it('carries GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('repo-api-token') }), { exec });
    createGhRepoApi(ctx).defaultBranch();
    expect(calls[0].env.GH_TOKEN).toBe('repo-api-token');
  });

  it('carries all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Repo Api Bot', authorEmail: 'repoapi@bot.dev',
          committerName: 'Repo Api Bot', committerEmail: 'repoapi@bot.dev',
        },
      }),
      { exec },
    );
    createGhRepoApi(ctx).defaultBranch();
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Repo Api Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('repoapi@bot.dev');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('Repo Api Bot');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('repoapi@bot.dev');
  });

  it('still honours the PAT for approvePR', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('primary-token', 'pat-token') }), { exec });
    createGhRepoApi(ctx).approvePR(7);
    expect(calls[0].env.GH_TOKEN).toBe('pat-token');
  });

  it('does not mutate process.env when a repo-API op runs', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected') }), { exec });
    createGhRepoApi(ctx).defaultBranch();
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── The promoted executor is the only spawn path ─────────────────────────────

describe('every repo-API operation reaches the spawn seam exactly once, through the promoted executor', () => {
  it('a repo-API method call produces exactly one recorded call, at the framework root', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).defaultBranch();
    expect(calls.length).toBe(1);
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });
});
