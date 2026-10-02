import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { applyManifest } from '../manifestInterpreter.ts';
import { makeTempWorktree, useTempDirCleanup, writeManifest } from './fixtures/manifestHarness.ts';

useTempDirCleanup();

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
