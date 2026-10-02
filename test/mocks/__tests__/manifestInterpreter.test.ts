import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { applyManifest } from '../manifestInterpreter.ts';

const worktrees: string[] = [];

function makeTempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
  worktrees.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of worktrees.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function writeManifest(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('applyManifest — well-formed manifest', () => {
  it('applies two edits, returns resolved paths and jsonlPath', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = {
      jsonlPath: 'fixtures/stub-payload.json',
      edits: [
        { path: 'src/alpha.ts', contents: 'export const alpha = 1;' },
        { path: 'src/beta.ts', contents: 'export const beta = 2;' },
      ],
    };
    const manifestPath = writeManifest(manifestDir, 'manifest.json', JSON.stringify(manifest));

    const result = applyManifest(manifestPath, worktree);

    expect(result.editsApplied).toHaveLength(2);
    expect(result.editsApplied[0]).toBe(resolve(worktree, 'src/alpha.ts'));
    expect(result.editsApplied[1]).toBe(resolve(worktree, 'src/beta.ts'));

    expect(readFileSync(result.editsApplied[0] ?? '', 'utf-8')).toBe('export const alpha = 1;');
    expect(readFileSync(result.editsApplied[1] ?? '', 'utf-8')).toBe('export const beta = 2;');

    expect(result.jsonlPath).toBe(resolve(worktree, 'fixtures/stub-payload.json'));
  });
});

describe('applyManifest — malformed manifest', () => {
  it('throws with manifestInterpreter: prefix when manifest JSON is invalid', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();
    const manifestPath = writeManifest(manifestDir, 'bad.json', '{ this is not json }');

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/^manifestInterpreter:/);
  });

  it('throws with manifestInterpreter: prefix when manifest fails schema validation', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();
    // Missing required `jsonlPath` field
    const manifestPath = writeManifest(
      manifestDir,
      'schema-fail.json',
      JSON.stringify({ edits: [] }),
    );

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/^manifestInterpreter:/);
  });
});

describe('applyManifest — no-op manifest', () => {
  it('returns empty editsApplied and resolved jsonlPath without writing files', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = {
      jsonlPath: 'test/fixtures/jsonl/payloads/plan-agent.json',
      edits: [],
    };
    const manifestPath = writeManifest(manifestDir, 'noop.json', JSON.stringify(manifest));

    const result = applyManifest(manifestPath, worktree);

    expect(result.editsApplied).toHaveLength(0);
    expect(result.jsonlPath).toBe(
      resolve(worktree, 'test/fixtures/jsonl/payloads/plan-agent.json'),
    );
    const worktreeSrc = join(worktree, 'src');
    expect(existsSync(worktreeSrc)).toBe(false);
  });
});

describe('applyManifest — response block', () => {
  it('passes a well-formed rate-limited response block through unchanged', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = {
      jsonlPath: 'fixtures/payload.json',
      edits: [],
      response: { kind: 'rate-limited', resetsAt: 1790081400, rateLimitType: 'five_hour', limitedInvocations: 1 },
    };
    const manifestPath = writeManifest(manifestDir, 'response.json', JSON.stringify(manifest));

    const result = applyManifest(manifestPath, worktree);

    expect(result.response).toEqual({ kind: 'rate-limited', resetsAt: 1790081400, rateLimitType: 'five_hour', limitedInvocations: 1 });
  });

  it('leaves response undefined when the manifest carries none', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = { jsonlPath: 'fixtures/payload.json', edits: [] };
    const manifestPath = writeManifest(manifestDir, 'no-response.json', JSON.stringify(manifest));

    const result = applyManifest(manifestPath, worktree);

    expect(result.response).toBeUndefined();
  });

  it('throws with manifestInterpreter: prefix when the response block has an unknown kind', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = { jsonlPath: 'fixtures/payload.json', edits: [], response: { kind: 'bogus' } };
    const manifestPath = writeManifest(manifestDir, 'bad-response.json', JSON.stringify(manifest));

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/^manifestInterpreter:/);
  });

  it('throws with manifestInterpreter: prefix when resetsAt is not a number', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = { jsonlPath: 'fixtures/payload.json', edits: [], response: { kind: 'rate-limited', resetsAt: 'soon' } };
    const manifestPath = writeManifest(manifestDir, 'bad-resets-at.json', JSON.stringify(manifest));

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/^manifestInterpreter:/);
  });
});

describe('applyManifest — conflicting edits', () => {
  it('throws with conflicting edits message and leaves worktree unchanged', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = {
      jsonlPath: 'fixtures/payload.json',
      edits: [
        { path: 'shared/config.ts', contents: 'export const A = 1;' },
        { path: 'shared/config.ts', contents: 'export const B = 2;' },
      ],
    };
    const manifestPath = writeManifest(manifestDir, 'conflict.json', JSON.stringify(manifest));

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/conflicting edits/);

    // The conflict is detected before any writes — the target file must not exist.
    expect(existsSync(join(worktree, 'shared/config.ts'))).toBe(false);
  });
});

function makeTempRepo(): string {
  const dir = makeTempWorktree();
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "test@adw.local"', { cwd: dir });
  execSync('git config user.name "ADW Test"', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'readme\n');
  writeFileSync(join(dir, 'old.txt'), 'old\n');
  execSync('git add -A && git commit -q -m init', { cwd: dir });
  return dir;
}

function git(dir: string, command: string): string {
  return execSync(`git ${command}`, { cwd: dir, encoding: 'utf-8' }).trimEnd();
}

describe('applyManifest — worktree actions of a planner', () => {
  it('deletes the named paths after the edits are written, tolerating a path that is already gone', () => {
    const repo = makeTempRepo();
    const manifestPath = writeManifest(makeTempWorktree(), 'deletes.json', JSON.stringify({
      jsonlPath: 'payload.json',
      edits: [{ path: 'new.txt', contents: 'new\n' }],
      deletes: ['old.txt', 'never-existed.txt'],
    }));

    applyManifest(manifestPath, repo);

    expect(existsSync(join(repo, 'old.txt'))).toBe(false);
    expect(existsSync(join(repo, 'new.txt'))).toBe(true);
  });

  it('stages the named paths, deletions included, and leaves every other change unstaged', () => {
    const repo = makeTempRepo();
    const manifestPath = writeManifest(makeTempWorktree(), 'stage.json', JSON.stringify({
      jsonlPath: 'payload.json',
      edits: [
        { path: 'README.md', contents: 'readme, edited\n' },
        { path: 'new.txt', contents: 'new\n' },
      ],
      deletes: ['old.txt'],
      stage: ['README.md', 'old.txt'],
    }));

    applyManifest(manifestPath, repo);

    expect(git(repo, 'status --porcelain --untracked-files=all').split('\n').sort()).toEqual([
      '?? new.txt',
      'D  old.txt',
      'M  README.md',
    ].sort());
  });

  it('commitAll stages every change and commits it under the given subject', () => {
    const repo = makeTempRepo();
    const manifestPath = writeManifest(makeTempWorktree(), 'commit-all.json', JSON.stringify({
      jsonlPath: 'payload.json',
      edits: [{ path: 'README.md', contents: 'readme, edited\n' }, { path: 'new.txt', contents: 'new\n' }],
      commitAll: { subject: 'planner: commit everything' },
    }));

    applyManifest(manifestPath, repo);

    expect(git(repo, 'log -1 --format=%s')).toBe('planner: commit everything');
    expect(git(repo, 'show --name-only --format= HEAD').split('\n').sort()).toEqual(['README.md', 'new.txt']);
    expect(git(repo, 'status --porcelain')).toBe('');
  });

  it.each([
    ['deletes', { deletes: 'old.txt' }],
    ['stage', { stage: [1] }],
    ['commitAll', { commitAll: 'subject' }],
  ])('throws with manifestInterpreter: prefix when %s is malformed', (_field, extra) => {
    const manifestPath = writeManifest(makeTempWorktree(), 'bad.json', JSON.stringify({
      jsonlPath: 'payload.json',
      edits: [],
      ...extra,
    }));

    expect(() => applyManifest(manifestPath, makeTempRepo())).toThrow(/^manifestInterpreter:/);
  });
});

describe('applyManifest — stand-in for the /commit command', () => {
  const standInManifest = {
    jsonlPath: 'payload.json',
    edits: [{ path: 'planner-edit.txt', contents: 'edit\n' }],
    onCommitCommand: 'stage-all-and-commit',
  };

  it('stages every change and commits it under the prefix the command was given, without applying the edits', () => {
    const repo = makeTempRepo();
    writeFileSync(join(repo, 'README.md'), 'readme, edited\n');
    writeFileSync(join(repo, 'untracked.txt'), 'untracked\n');
    const manifestPath = writeManifest(makeTempWorktree(), 'stand-in.json', JSON.stringify(standInManifest));

    const result = applyManifest(manifestPath, repo, "/commit 'plan-orchestrator: fix' '{\"number\":1}'");

    expect(result.commitSubject).toBe(git(repo, 'log -1 --format=%s'));
    expect(result.commitSubject).toMatch(/^plan-orchestrator: fix: /);
    expect(git(repo, 'show --name-only --format= HEAD').split('\n').sort()).toEqual(['README.md', 'untracked.txt']);
    expect(existsSync(join(repo, 'planner-edit.txt'))).toBe(false);
    expect(result.editsApplied).toEqual([]);
  });

  it('applies the edits and commits nothing when the invoked command is not /commit', () => {
    const repo = makeTempRepo();
    const headBefore = git(repo, 'rev-parse HEAD');
    const manifestPath = writeManifest(makeTempWorktree(), 'stand-in.json', JSON.stringify(standInManifest));

    const result = applyManifest(manifestPath, repo, "/feature '7' 'abc123' '{}'");

    expect(result.commitSubject).toBeUndefined();
    expect(existsSync(join(repo, 'planner-edit.txt'))).toBe(true);
    expect(git(repo, 'rev-parse HEAD')).toBe(headBefore);
  });

  it('does not stand in for /commit unless the manifest asks for it', () => {
    const repo = makeTempRepo();
    const headBefore = git(repo, 'rev-parse HEAD');
    const manifestPath = writeManifest(makeTempWorktree(), 'plain.json', JSON.stringify({
      jsonlPath: 'payload.json',
      edits: [{ path: 'planner-edit.txt', contents: 'edit\n' }],
    }));

    const result = applyManifest(manifestPath, repo, "/commit 'plan-orchestrator: fix' '{}'");

    expect(result.commitSubject).toBeUndefined();
    expect(existsSync(join(repo, 'planner-edit.txt'))).toBe(true);
    expect(git(repo, 'rev-parse HEAD')).toBe(headBefore);
  });

  it('throws with manifestInterpreter: prefix when onCommitCommand names an unknown behaviour', () => {
    const manifestPath = writeManifest(makeTempWorktree(), 'bad.json', JSON.stringify({
      jsonlPath: 'payload.json',
      edits: [],
      onCommitCommand: 'commit-only-the-plan',
    }));

    expect(() => applyManifest(manifestPath, makeTempRepo())).toThrow(/^manifestInterpreter:/);
  });
});
