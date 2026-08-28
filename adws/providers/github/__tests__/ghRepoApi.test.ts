import { describe, it, expect, afterEach } from 'vitest';
import { GitContext } from '../../../gitContext';
import type { GitContextOptions, ExecFn } from '../../../gitContext';
import { createGhRepoApi } from '../ghRepoApi';

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
  input?: string;
}

function makeSpyExec(stdout = 'main\n'): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: options.env, input: options.input });
    return stdout;
  };
  return { exec, calls };
}

// ── defaultBranch() ──────────────────────────────────────────────────────────

describe('defaultBranch() command, cwd and env', () => {
  it('spawns the expected gh repo view command with explicit owner/repo', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ owner: 'myorg', repo: 'myrepo' }), { exec });
    createGhRepoApi(ctx).defaultBranch();
    expect(calls[0].command).toBe(
      'gh repo view myorg/myrepo --json defaultBranchRef --jq .defaultBranchRef.name',
    );
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).defaultBranch();
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('passes GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'secret-token' }), { exec });
    createGhRepoApi(ctx).defaultBranch();
    expect(calls[0].env.GH_TOKEN).toBe('secret-token');
  });

  it('passes all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Author Name', authorEmail: 'author@test.com',
          committerName: 'Committer Name', committerEmail: 'committer@test.com',
        },
      }),
      { exec },
    );
    createGhRepoApi(ctx).defaultBranch();
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Author Name');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('author@test.com');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('Committer Name');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('committer@test.com');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    createGhRepoApi(ctx).defaultBranch();
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns the trimmed stdout', () => {
    const { exec } = makeSpyExec('  dev  \n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).defaultBranch()).toBe('dev');
  });
});

// ── listOpenIssues() ─────────────────────────────────────────────────────────

describe('listOpenIssues() command and env', () => {
  it('builds the exact command with required fields and limit', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).listOpenIssues({ fields: ['number', 'comments'], limit: 100 });
    expect(calls[0].command).toBe(
      'gh issue list --repo acme/webapp --state open --json number,comments --limit 100',
    );
  });

  it('appends --search when provided', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).listOpenIssues({ fields: ['number', 'title'], search: 'docs-bloat: app_docs/foo.md', limit: 5 });
    expect(calls[0].command).toBe(
      'gh issue list --repo acme/webapp --state open --json number,title --search "docs-bloat: app_docs/foo.md" --limit 5',
    );
  });

  it('honours an explicit state', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).listOpenIssues({ fields: ['number', 'state'], state: 'all', limit: 5 });
    expect(calls[0].command).toBe(
      'gh issue list --repo acme/webapp --state all --json number,state --limit 5',
    );
  });

  it('omits --search and --limit when not provided', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).listOpenIssues({ fields: ['number'] });
    expect(calls[0].command).toBe('gh issue list --repo acme/webapp --state open --json number');
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).listOpenIssues({ fields: ['number'] });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'list-token' }), { exec });
    createGhRepoApi(ctx).listOpenIssues({ fields: ['number'] });
    expect(calls[0].env.GH_TOKEN).toBe('list-token');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    createGhRepoApi(ctx).listOpenIssues({ fields: ['number'] });
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('[{"number":1}]\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).listOpenIssues({ fields: ['number'] })).toBe('[{"number":1}]');
  });
});

// ── issueComments() ──────────────────────────────────────────────────────────

describe('issueComments() command and env', () => {
  it("builds the exact command with --jq '.comments'", () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).issueComments(42);
    expect(calls[0].command).toBe(
      "gh issue view 42 --repo acme/webapp --json comments --jq '.comments'",
    );
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).issueComments(1);
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('injects GH_TOKEN from the context token', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'comments-token' }), { exec });
    createGhRepoApi(ctx).issueComments(1);
    expect(calls[0].env.GH_TOKEN).toBe('comments-token');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    createGhRepoApi(ctx).issueComments(1);
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('[{"body":"hello"}]\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).issueComments(1)).toBe('[{"body":"hello"}]');
  });
});

// ── issueLabels() (renamed from GitContext's issueHasLabel) ─────────────────

describe('issueLabels() command', () => {
  it('builds exactly gh issue view <n> --repo <owner>/<repo> --json labels', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).issueLabels(28);
    expect(calls[0].command).toBe('gh issue view 28 --repo acme/webapp --json labels');
  });
});

// ── fetchMergedPRs() ─────────────────────────────────────────────────────────

describe('fetchMergedPRs() command and env', () => {
  it('defaults to --limit 200', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).fetchMergedPRs();
    expect(calls[0].command).toBe(
      'gh pr list --repo acme/webapp --state merged --json body,mergedAt --limit 200',
    );
  });

  it('honors an explicit limit', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).fetchMergedPRs(50);
    expect(calls[0].command).toBe(
      'gh pr list --repo acme/webapp --state merged --json body,mergedAt --limit 50',
    );
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).fetchMergedPRs();
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('injects GH_TOKEN from the context token', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'prs-token' }), { exec });
    createGhRepoApi(ctx).fetchMergedPRs();
    expect(calls[0].env.GH_TOKEN).toBe('prs-token');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    createGhRepoApi(ctx).fetchMergedPRs();
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('[{"body":"Closes #1","mergedAt":"2024-01-01"}]\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).fetchMergedPRs()).toBe('[{"body":"Closes #1","mergedAt":"2024-01-01"}]');
  });
});

// ── createPR() head-branch contract ──────────────────────────────────────────
// Regression guard: gh pr create must carry an explicit --head, or gh infers
// the head from the cwd's current branch, producing an empty-diff PR.

describe('createPR() head-branch contract', () => {
  it('includes an explicit --head set to the source branch', () => {
    const { exec, calls } = makeSpyExec('https://github.com/acme/webapp/pull/12\n');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).createPR('My title', 'body text', 'feature-issue-7-do-thing', 'dev');
    expect(calls[0].command).toContain('--head "feature-issue-7-do-thing"');
  });

  it('passes the PR body via --body-file - on stdin', () => {
    const { exec, calls } = makeSpyExec('https://github.com/acme/webapp/pull/1\n');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).createPR('T', 'the body', 'feature-issue-1-y');
    expect(calls[0].command).toContain('--body-file -');
    expect(calls[0].input).toBe('the body');
  });
});

describe('createPR() with optional labels', () => {
  it('appends --label for each label in the command string', () => {
    const { exec, calls } = makeSpyExec('https://github.com/acme/webapp/pull/12\n');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).createPR('My title', 'body text', 'feature-issue-7-do-thing', 'dev', ['regression-promotion']);
    expect(calls[0].command).toContain("--label 'regression-promotion'");
  });

  it('emits no --label when labels array is empty', () => {
    const { exec, calls } = makeSpyExec('https://github.com/acme/webapp/pull/12\n');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).createPR('T', 'b', 'feature-issue-1-x', 'dev', []);
    expect(calls[0].command).not.toContain('--label');
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec('https://github.com/acme/webapp/pull/12\n');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).createPR('T', 'b', 'feature-issue-1-y', undefined, ['regression-promotion']);
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });
});

// ── setSecret() ──────────────────────────────────────────────────────────────

describe('setSecret() command and env', () => {
  it('builds exactly gh secret set <NAME> --repo <owner>/<repo> --body -', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).setSecret('MY_SECRET', 'the-value');
    expect(calls[0].command).toBe('gh secret set MY_SECRET --repo acme/webapp --body -');
  });

  it('uses the context primary token (not the PAT) even when a PAT is configured', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    createGhRepoApi(ctx).setSecret('MY_SECRET', 'the-value');
    expect(calls[0].env.GH_TOKEN).toBe('primary-token');
  });

  it('pipes the secret value via stdin input (not in the command string)', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).setSecret('MY_SECRET', 'super-secret-value');
    expect(calls[0].input).toBe('super-secret-value');
    expect(calls[0].command).not.toContain('super-secret-value');
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).setSecret('MY_SECRET', 'val');
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('does not mutate process.env.GH_TOKEN after the call', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    createGhRepoApi(ctx).setSecret('MY_SECRET', 'val');
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── runGraphQLInput() ────────────────────────────────────────────────────────

describe('runGraphQLInput() command and env', () => {
  it('builds exactly gh api graphql --input -', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).runGraphQLInput({ query: 'mutation{}', variables: { ids: ['a', 'b'] } });
    expect(calls[0].command).toBe('gh api graphql --input -');
  });

  it('pipes JSON.stringify(body) via stdin input', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions(), { exec });
    const body = { query: 'mutation{}', variables: { ids: ['a', 'b'] } };
    createGhRepoApi(ctx).runGraphQLInput(body);
    expect(calls[0].input).toBe(JSON.stringify(body));
  });

  it('uses the PAT as GH_TOKEN when a pat is configured (alternateIdentity purpose)', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    createGhRepoApi(ctx).runGraphQLInput({ q: 'mutation{}' });
    expect(calls[0].env.GH_TOKEN).toBe('pat-token');
  });

  it('falls back to the context primary token when no PAT is configured', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions({ token: 'primary-token' }), { exec });
    createGhRepoApi(ctx).runGraphQLInput({ q: 'mutation{}' });
    expect(calls[0].env.GH_TOKEN).toBe('primary-token');
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).runGraphQLInput({ q: 'mutation{}' });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions({ token: 'injected', pat: 'pat' }), { exec });
    createGhRepoApi(ctx).runGraphQLInput({ q: 'mutation{}' });
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── runGraphQL() ─────────────────────────────────────────────────────────────

describe('runGraphQL() command and purpose', () => {
  it('builds gh api graphql -f query=<query> with variable flags', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).runGraphQL('query{viewer{login}}', { limit: 5, name: 'x' });
    expect(calls[0].command).toBe("gh api graphql -f query='query{viewer{login}}' -F limit=5 -f name='x'");
  });

  it('uses the PAT (alternateIdentity purpose) when configured', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    createGhRepoApi(ctx).runGraphQL('query{}');
    expect(calls[0].env.GH_TOKEN).toBe('pat-token');
  });
});

// ── fetchPRChangedFiles() ─────────────────────────────────────────────────────

describe('fetchPRChangedFiles() command and env', () => {
  it('issues gh pr view <n> --repo <owner>/<repo> --json files', () => {
    const { exec, calls } = makeSpyExec('{"files":[]}');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    createGhRepoApi(ctx).fetchPRChangedFiles(7);
    expect(calls[0].command).toBe('gh pr view 7 --repo acme/webapp --json files');
  });

  it('passes cwd equal to the framework repo root', () => {
    const { exec, calls } = makeSpyExec('{"files":[]}');
    const ctx = new GitContext(validOptions(), { exec });
    createGhRepoApi(ctx).fetchPRChangedFiles(7);
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('{"files":[]}');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    createGhRepoApi(ctx).fetchPRChangedFiles(7);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── approvePR() uses the alternate identity ──────────────────────────────────

describe('approvePR() purpose routing', () => {
  it('uses the PAT as GH_TOKEN when configured', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    createGhRepoApi(ctx).approvePR(7);
    expect(calls[0].env.GH_TOKEN).toBe('pat-token');
    expect(calls[0].command).toBe('gh pr review 7 --approve --repo acme/webapp');
  });
});

// ── moveIssueToStatus() ───────────────────────────────────────────────────────

describe('moveIssueToStatus()', () => {
  const projectResponse = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
  const itemResponse = (status: string | null) => JSON.stringify({
    data: { repository: { issue: { projectItems: { nodes: [
      { id: 'ITEM_1', project: { id: 'PVT_1' }, fieldValueByName: status ? { name: status } : null },
    ] } } } },
  });
  const fieldResponse = JSON.stringify({
    data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_TODO', name: 'Todo' }, { id: 'OPT_PROG', name: 'In Progress' }] } } },
  });
  const moveResponse = JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });

  function makeSequencedExec(responses: string[]): { exec: ExecFn; calls: SpyCall[] } {
    const calls: SpyCall[] = [];
    let i = 0;
    const exec: ExecFn = (command, options) => {
      calls.push({ command, cwd: options.cwd, env: options.env, input: options.input });
      return responses[i++] ?? '{}';
    };
    return { exec, calls };
  }

  it('returns false when no project is found', () => {
    const { exec } = makeSequencedExec([JSON.stringify({ data: { repository: { projectsV2: { nodes: [] } } } })]);
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress')).toBe(false);
  });

  it('returns false when no matching item is found', () => {
    const { exec } = makeSequencedExec([
      projectResponse,
      JSON.stringify({ data: { repository: { issue: { projectItems: { nodes: [] } } } } }),
    ]);
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress')).toBe(false);
  });

  it('returns false when the status field has no matching option', () => {
    const { exec } = makeSequencedExec([
      projectResponse,
      itemResponse('Todo'),
      JSON.stringify({ data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_X', name: 'Unrelated' }] } } } }),
    ]);
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress')).toBe(false);
  });

  it('returns false when a graphql call throws', () => {
    const exec: ExecFn = () => { throw new Error('gh: rate limited'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress')).toBe(false);
  });

  it('short-circuits to true when already at the target status', () => {
    const { exec, calls } = makeSequencedExec([projectResponse, itemResponse('In Progress')]);
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress')).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('short-circuits to true when the field lookup resolves to already_at_status', () => {
    // currentStatus "In Progress" does not literally equal targetStatus "progress",
    // so the early current-status check does not fire; parseStatusField fuzzy-matches
    // "progress" to the "In Progress" option, whose name equals currentStatus.
    const { exec, calls } = makeSequencedExec([projectResponse, itemResponse('In Progress'), fieldResponse]);
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'progress')).toBe(true);
    expect(calls.length).toBe(3);
  });

  it('issues the move mutation and returns true on success', () => {
    const { exec, calls } = makeSequencedExec([projectResponse, itemResponse('Todo'), fieldResponse, moveResponse]);
    const ctx = new GitContext(validOptions(), { exec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress')).toBe(true);
    expect(calls.length).toBe(4);
    expect(calls[3].command).toContain('updateProjectV2ItemFieldValue');
    expect(calls.every((c) => c.env.GH_TOKEN !== undefined)).toBe(true);
  });

  it('returns false when the final move mutation throws', () => {
    const throwingExec: ExecFn = (() => {
      let i = 0;
      const responses = [projectResponse, itemResponse('Todo'), fieldResponse];
      return () => {
        if (i < responses.length) return responses[i++];
        throw new Error('gh: mutation failed');
      };
    })();
    const ctx = new GitContext(validOptions(), { exec: throwingExec });
    expect(createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress')).toBe(false);
  });

  it('every graphql call uses the alternate-identity (PAT) credential', () => {
    const { exec, calls } = makeSequencedExec([projectResponse, itemResponse('Todo'), fieldResponse, moveResponse]);
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    createGhRepoApi(ctx).moveIssueToStatus(28, 'In Progress');
    expect(calls.every((c) => c.env.GH_TOKEN === 'pat-token')).toBe(true);
  });
});

// ── Two-context isolation ────────────────────────────────────────────────────

describe('two-context isolation', () => {
  it('two contexts in one process each spawn their repo-API command with their own token, at the shared framework-rooted cwd', () => {
    const { exec: spyA, calls: callsA } = makeSpyExec('main\n');
    const { exec: spyB, calls: callsB } = makeSpyExec('main\n');

    const ctxA = new GitContext(validOptions({ owner: 'acme', repo: 'alpha', token: 'token-alpha' }), { exec: spyA });
    const ctxB = new GitContext(validOptions({ owner: 'octo', repo: 'beta', token: 'token-beta' }), { exec: spyB });

    createGhRepoApi(ctxA).defaultBranch();
    createGhRepoApi(ctxB).defaultBranch();

    expect(callsA[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(callsA[0].env.GH_TOKEN).toBe('token-alpha');
    expect(callsB[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(callsB[0].env.GH_TOKEN).toBe('token-beta');
  });

  it('neither context carries the other context token (shared spy)', () => {
    const { exec: shared, calls } = makeSpyExec();

    const ctxA = new GitContext(validOptions({ owner: 'acme', repo: 'alpha', token: 'token-alpha' }), { exec: shared });
    const ctxB = new GitContext(validOptions({ owner: 'octo', repo: 'beta', token: 'token-beta' }), { exec: shared });

    createGhRepoApi(ctxA).defaultBranch();
    createGhRepoApi(ctxB).defaultBranch();

    const [callA, callB] = calls;
    expect(callA.env.GH_TOKEN).toBe('token-alpha');
    expect(callB.env.GH_TOKEN).toBe('token-beta');
    expect(Object.values(callA.env)).not.toContain('token-beta');
    expect(Object.values(callB.env)).not.toContain('token-alpha');
  });
});

// ── Error propagation ────────────────────────────────────────────────────────

describe('error propagation', () => {
  const savedToken = process.env['GH_TOKEN'];
  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env['GH_TOKEN'];
    } else {
      process.env['GH_TOKEN'] = savedToken;
    }
  });

  it('surfaces exec errors at the system boundary', () => {
    const exec: ExecFn = () => { throw new Error('gh: unauthenticated'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => createGhRepoApi(ctx).defaultBranch()).toThrow('gh: unauthenticated');
  });

  it('does not mutate process.env when exec throws', () => {
    process.env['GH_TOKEN'] = 'before-throw';
    const exec: ExecFn = () => { throw new Error('spawn failed'); };
    const ctx = new GitContext(validOptions({ token: 'ctx-token' }), { exec });
    try { createGhRepoApi(ctx).defaultBranch(); } catch { /* expected */ }
    expect(process.env['GH_TOKEN']).toBe('before-throw');
  });
});
