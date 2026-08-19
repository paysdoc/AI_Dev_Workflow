import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions, ExecFn } from '../types';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    token: 'gh-token-abc',
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

/**
 * Every method routed through #runRepoApi (plan step 3). Each invoke() is a
 * minimal, argument-valid call — the return value is not asserted here, only
 * the recorded (command, cwd, env) triple.
 */
interface MethodCase {
  name: string;
  invoke: (ctx: GitContext) => unknown;
}

/** The only repo-API methods whose command carries no literal `owner/repo` substring. */
const REPO_FREE_METHODS = new Set(['authenticatedUser', 'runGraphQL', 'runGraphQLInput', 'moveIssueToStatus']);

function repoApiMethods(): MethodCase[] {
  return [
    { name: 'defaultBranch', invoke: (ctx) => ctx.defaultBranch() },
    { name: 'fetchIssue', invoke: (ctx) => ctx.fetchIssue(28) },
    { name: 'commentOnIssue', invoke: (ctx) => ctx.commentOnIssue(28, 'body text') },
    { name: 'issueState', invoke: (ctx) => ctx.issueState(28) },
    { name: 'closeIssue', invoke: (ctx) => ctx.closeIssue(28) },
    { name: 'issueTitle', invoke: (ctx) => ctx.issueTitle(28) },
    { name: 'fetchIssueComments', invoke: (ctx) => ctx.fetchIssueComments(28) },
    { name: 'issueHasLabel', invoke: (ctx) => ctx.issueHasLabel(28, 'adw:bug') },
    { name: 'addIssueLabel', invoke: (ctx) => ctx.addIssueLabel(28, 'adw:bug') },
    { name: 'createIssue', invoke: (ctx) => ctx.createIssue('Title', 'Body') },
    { name: 'updateIssueBody', invoke: (ctx) => ctx.updateIssueBody(28, 'Body') },
    { name: 'findOpenUpgradeIssue', invoke: (ctx) => ctx.findOpenUpgradeIssue() },
    { name: 'deleteIssueComment', invoke: (ctx) => ctx.deleteIssueComment(123) },
    { name: 'listOpenIssues', invoke: (ctx) => ctx.listOpenIssues({ fields: ['number'] }) },
    { name: 'issueComments', invoke: (ctx) => ctx.issueComments(28) },
    { name: 'fetchMergedPRs', invoke: (ctx) => ctx.fetchMergedPRs() },
    { name: 'authenticatedUser', invoke: (ctx) => ctx.authenticatedUser() },
    { name: 'findPRByBranch', invoke: (ctx) => ctx.findPRByBranch('feature-x') },
    { name: 'fetchPRDetails', invoke: (ctx) => ctx.fetchPRDetails(7) },
    { name: 'fetchPRReviews', invoke: (ctx) => ctx.fetchPRReviews(7) },
    { name: 'fetchPRReviewComments', invoke: (ctx) => ctx.fetchPRReviewComments(7) },
    { name: 'commentOnPR', invoke: (ctx) => ctx.commentOnPR(7, 'body text') },
    { name: 'mergePR', invoke: (ctx) => ctx.mergePR(7) },
    { name: 'approvePR', invoke: (ctx) => ctx.approvePR(7) },
    { name: 'prApprovalState', invoke: (ctx) => ctx.prApprovalState(7) },
    { name: 'fetchPRList', invoke: (ctx) => ctx.fetchPRList() },
    { name: 'fetchAllPRs', invoke: (ctx) => ctx.fetchAllPRs() },
    { name: 'fetchPRChangedFiles', invoke: (ctx) => ctx.fetchPRChangedFiles(7) },
    { name: 'createPR', invoke: (ctx) => ctx.createPR('Title', 'Body', 'feature-issue-1-x') },
    { name: 'createLabel', invoke: (ctx) => ctx.createLabel('bug', 'ff0000', 'Bug label') },
    { name: 'applyLabel', invoke: (ctx) => ctx.applyLabel(28, 'adw:bug') },
    { name: 'setSecret', invoke: (ctx) => ctx.setSecret('MY_SECRET', 'value') },
    { name: 'runGraphQL', invoke: (ctx) => ctx.runGraphQL('query{}') },
    { name: 'runGraphQLInput', invoke: (ctx) => ctx.runGraphQLInput({ query: 'mutation{}' }) },
    { name: 'moveIssueToStatus', invoke: (ctx) => ctx.moveIssueToStatus(28, 'In Progress') },
  ];
}

// ── Reproduction: the RED→GREEN proof ───────────────────────────────────────

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
    expect(ctx.fetchIssueComments(28)).toBe(payload);
  });
});

// ── Table-driven cwd assertion ───────────────────────────────────────────────

describe('every repo-API method spawns at the injected framework repository root', () => {
  for (const { name, invoke } of repoApiMethods()) {
    it(`${name}() records cwd = frameworkRepoRoot, not basePath`, () => {
      const { exec, calls } = makeSpyExec();
      const ctx = new GitContext(validOptions(), { exec });
      invoke(ctx);
      expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
      expect(calls[0].cwd).not.toBe(ctx.basePath);
    });
  }
});

// ── Self-host invariance ─────────────────────────────────────────────────────

describe('self-host invariance: repo-API methods spawn at the framework root exactly as before', () => {
  for (const { name, invoke } of repoApiMethods()) {
    it(`${name}() records cwd = frameworkRepoRoot for a self-host context`, () => {
      const { exec, calls } = makeSpyExec();
      const ctx = new GitContext(validOptions({ selfHost: true }), { exec });
      invoke(ctx);
      expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
      expect(calls[0].cwd).toBe(ctx.basePath);
    });
  }
});

// ── Workspace ops unmoved (counter-assertion) ────────────────────────────────

describe('workspace-scoped git/worktree ops remain pinned to basePath', () => {
  it('getCurrentBranch() spawns at ctx.basePath', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.getCurrentBranch();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('listWorktrees() spawns at ctx.basePath', () => {
    const { exec, calls } = makeSpyExec('worktree /srv/adw/repos/acme/webapp\nHEAD abc\nbranch refs/heads/main\n\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.listWorktrees();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('headShort() spawns at ctx.basePath when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.headShort();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('remoteUrl() spawns at ctx.basePath when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.remoteUrl();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('an op given an explicit worktree path still spawns there, not at the framework root', () => {
    const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-775-x';
    const { exec, calls } = makeSpyExec('feature-issue-775-x\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.getCurrentBranch(worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
    expect(calls[0].cwd).not.toBe(FRAMEWORK_ROOT);
  });
});

// ── No ambient cwd ────────────────────────────────────────────────────────────

describe('repo-API commands never inherit the ambient process cwd', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it('records the injected frameworkRepoRoot even after process.chdir()', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    process.chdir(os.tmpdir());
    ctx.defaultBranch();
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
      invoke(ctx);
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
    const ctx = new GitContext(validOptions({ token: 'repo-api-token' }), { exec });
    ctx.defaultBranch();
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
    ctx.defaultBranch();
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Repo Api Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('repoapi@bot.dev');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('Repo Api Bot');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('repoapi@bot.dev');
  });

  it('still honours usePat for a PAT-requiring repo-API op (approvePR)', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    ctx.approvePR(7);
    expect(calls[0].env.GH_TOKEN).toBe('pat-token');
  });

  it('does not mutate process.env when a repo-API op runs', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.defaultBranch();
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── exec() with the frameworkRoot class preserves the #775 contract ─────────

describe("exec()'s frameworkRoot working-directory class is the #775 contract", () => {
  it('records the injected framework root for a target context', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].cwd).not.toBe(ctx.basePath);
  });

  it('records the injected framework root for a self-host context', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ selfHost: true }), { exec });
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('succeeds on a host that has never cloned the target workspace', () => {
    const targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-790-target-'));
    const frameworkRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-790-framework-'));
    try {
      const payload = '{"login":"adw-bot"}';
      const conditionalExec: ExecFn = (_command, options) => {
        if (!fs.existsSync(options.cwd)) {
          throw new Error('spawnSync /bin/sh ENOENT');
        }
        return payload;
      };
      const ctx = new GitContext(
        validOptions({ frameworkRepoRoot, targetReposDir }),
        { exec: conditionalExec },
      );
      expect(fs.existsSync(ctx.basePath)).toBe(false);
      expect(ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() })).toBe(payload);
    } finally {
      fs.rmSync(targetReposDir, { recursive: true, force: true });
      fs.rmSync(frameworkRepoRoot, { recursive: true, force: true });
    }
  });
});

// ── The promoted executor is the only spawn path ─────────────────────────────

describe('every operation reaches the spawn seam exactly once, through the promoted executor', () => {
  it('a repo-API method call produces exactly one recorded call, at the framework root', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.defaultBranch();
    expect(calls.length).toBe(1);
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('a workspace method call produces exactly one recorded call, at the base path', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.getCurrentBranch();
    expect(calls.length).toBe(1);
    expect(calls[0].cwd).toBe(ctx.basePath);
  });
});
