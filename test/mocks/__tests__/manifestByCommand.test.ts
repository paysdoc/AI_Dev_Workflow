import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { applyManifest } from '../manifestInterpreter.ts';
import { gitOut, makeTempRepo, makeTempWorktree, useTempDirCleanup, writeManifest } from './fixtures/manifestHarness.ts';

useTempDirCleanup();

function routedManifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jsonlPath: 'top.json',
    edits: [{ path: 'notes/default.md', contents: 'default\n' }],
    byCommand: {
      '/feature': {
        jsonlPath: 'plan.json',
        edits: [{ path: 'specs/issue-7-plan.md', contents: 'plan\n' }],
        response: { kind: 'error' },
      },
      '/implement': {
        jsonlPath: 'build.json',
        edits: [{ path: 'src/featureStub.ts', contents: 'build\n' }],
      },
    },
    ...extra,
  };
}

function manifestFile(manifest: Record<string, unknown>): string {
  return writeManifest(makeTempWorktree(), 'manifest.json', JSON.stringify(manifest));
}

describe('applyManifest — per-command entries', () => {
  it('applies only the entry keyed on the command that opens the prompt, and returns its jsonlPath and response', () => {
    const worktree = makeTempWorktree();

    const result = applyManifest(manifestFile(routedManifest()), worktree, "/feature '7'");

    expect(result.editsApplied).toEqual([resolve(worktree, 'specs/issue-7-plan.md')]);
    expect(result.jsonlPath).toBe(resolve(worktree, 'plan.json'));
    expect(result.response).toEqual({ kind: 'error' });
    expect(existsSync(join(worktree, 'specs/issue-7-plan.md'))).toBe(true);
    expect(existsSync(join(worktree, 'notes/default.md'))).toBe(false);
    expect(existsSync(join(worktree, 'src/featureStub.ts'))).toBe(false);
  });

  it('matches the command exactly, so /implement-tdd is answered by the top-level entry when only /implement has one', () => {
    const worktree = makeTempWorktree();

    const result = applyManifest(manifestFile(routedManifest()), worktree, "/implement-tdd '7'");

    expect(result.editsApplied).toEqual([resolve(worktree, 'notes/default.md')]);
    expect(result.jsonlPath).toBe(resolve(worktree, 'top.json'));
    expect(result.response).toBeUndefined();
    expect(existsSync(join(worktree, 'src/featureStub.ts'))).toBe(false);
  });

  it.each([
    ['a command no entry is keyed on', "/review '7'"],
    ['a prompt that opens with no command', 'ping'],
    ['an empty prompt', ''],
  ])('keeps the top-level entry for %s', (_label, prompt) => {
    const worktree = makeTempWorktree();

    const result = applyManifest(manifestFile(routedManifest()), worktree, prompt);

    expect(result.editsApplied).toEqual([resolve(worktree, 'notes/default.md')]);
    expect(result.jsonlPath).toBe(resolve(worktree, 'top.json'));
  });

  it('keeps the top-level onCommitCommand behaviour for a command no entry is keyed on', () => {
    const repo = makeTempRepo();
    writeFileSync(join(repo, 'pending.txt'), 'pending\n');
    const manifest = routedManifest({ onCommitCommand: 'stage-all-and-commit' });

    const result = applyManifest(manifestFile(manifest), repo, "/commit 'plan-orchestrator: fix' '{}'");

    expect(result.commitSubject).toBe(gitOut(repo, 'log', '-1', '--format=%s'));
    expect(result.editsApplied).toEqual([]);
  });

  it('lets an entry keyed on /commit replace the top-level onCommitCommand for that prompt', () => {
    const repo = makeTempRepo();
    const manifest = routedManifest({
      onCommitCommand: 'stage-all-and-commit',
      byCommand: { '/commit': { jsonlPath: 'commit.json', edits: [{ path: 'notes/commit.md', contents: 'entry\n' }] } },
    });
    const headBefore = gitOut(repo, 'rev-parse', 'HEAD');

    const result = applyManifest(manifestFile(manifest), repo, "/commit 'plan-orchestrator: fix' '{}'");

    expect(result.commitSubject).toBeUndefined();
    expect(result.editsApplied).toEqual([resolve(repo, 'notes/commit.md')]);
    expect(gitOut(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
  });

  it('runs none of the top-level deletes, stage, commits or commitAll for a prompt an entry answers', () => {
    const repo = makeTempRepo();
    const manifest = routedManifest({
      deletes: ['README.md'],
      stage: ['README.md'],
      commits: [{ subject: 'top-level commit' }],
      commitAll: { subject: 'top-level commitAll' },
    });
    const headBefore = gitOut(repo, 'rev-parse', 'HEAD');

    const result = applyManifest(manifestFile(manifest), repo, "/feature '7'");

    expect(result.commitsCreated).toBe(0);
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
    expect(gitOut(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
  });

  it("creates the entry's commits as allow-empty commits, and counts them", () => {
    const repo = makeTempRepo();
    const manifest = routedManifest({
      commits: [{ subject: 'top-level commit' }],
      byCommand: {
        '/feature': { jsonlPath: 'plan.json', commits: [{ subject: 'entry commit one' }, { subject: 'entry commit two' }] },
      },
    });

    const result = applyManifest(manifestFile(manifest), repo, "/feature '7'");

    expect(result.commitsCreated).toBe(2);
    expect(gitOut(repo, 'log', '--format=%s', '-n', '3').split('\n')).toEqual(['entry commit two', 'entry commit one', 'init']);
  });

  it("resolves an entry's absolute jsonlPath as it is", () => {
    const worktree = makeTempWorktree();
    const payload = join(makeTempWorktree(), 'payload.json');
    const manifest = routedManifest({ byCommand: { '/feature': { jsonlPath: payload } } });

    const result = applyManifest(manifestFile(manifest), worktree, "/feature '7'");

    expect(result.jsonlPath).toBe(payload);
    expect(result.editsApplied).toEqual([]);
  });

  it("throws on conflicting edits inside the selected entry, before writing any of them", () => {
    const worktree = makeTempWorktree();
    const manifest = routedManifest({
      byCommand: {
        '/feature': {
          jsonlPath: 'plan.json',
          edits: [{ path: 'specs/a.md', contents: 'one' }, { path: 'specs/a.md', contents: 'two' }],
        },
      },
    });

    expect(() => applyManifest(manifestFile(manifest), worktree, "/feature '7'")).toThrow(/conflicting edits/);
    expect(existsSync(join(worktree, 'specs/a.md'))).toBe(false);
  });
});

describe('applyManifest — byCommand schema', () => {
  it.each([
    ['an entry without jsonlPath', { byCommand: { '/feature': { edits: [] } } }],
    ['an entry whose edits are malformed', { byCommand: { '/feature': { jsonlPath: 'plan.json', edits: [{ path: 1 }] } } }],
    ['an entry whose commits are malformed', { byCommand: { '/feature': { jsonlPath: 'plan.json', commits: [{ subject: 1 }] } } }],
    ['an entry whose response has an unknown kind', { byCommand: { '/feature': { jsonlPath: 'plan.json', response: { kind: 'bogus' } } } }],
    ['a key that is not a slash command', { byCommand: { feature: { jsonlPath: 'plan.json' } } }],
    ['a byCommand that is not an object', { byCommand: ['/feature'] }],
  ])('throws a manifestInterpreter: schema error for %s, naming byCommand', (_label, extra) => {
    const manifest = routedManifest(extra);

    expect(() => applyManifest(manifestFile(manifest), makeTempWorktree(), "/feature '7'")).toThrow(/^manifestInterpreter:.*schema validation failed.*byCommand/);
  });
});

describe('applyManifest — the error response', () => {
  it('validates at the top level and is passed through', () => {
    const manifest = { jsonlPath: 'top.json', edits: [], response: { kind: 'error' } };

    const result = applyManifest(manifestFile(manifest), makeTempWorktree(), "/feature '7'");

    expect(result.response).toEqual({ kind: 'error' });
  });

  it("validates per entry and is passed through only for that entry's prompt", () => {
    const manifest = routedManifest();
    const path = manifestFile(manifest);

    expect(applyManifest(path, makeTempWorktree(), "/feature '7'").response).toEqual({ kind: 'error' });
    expect(applyManifest(path, makeTempWorktree(), "/implement '7'").response).toBeUndefined();
  });
});
