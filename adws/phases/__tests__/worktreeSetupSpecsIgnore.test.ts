import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { ignoreSpecsInWorktree } from '../worktreeSetup.ts';
import { initGitRepo } from './fixtures/worktreeSetupHarness.ts';

const SPECS_HEADER = '# ADW: per-run plans stay in the worktree that wrote them (do not commit)';
const SLASH_COMMANDS_HEADER = '# ADW: copied slash commands (do not commit)';
const PLAN_FILE = 'specs/issue-1-adw-x-sdlc_planner-y.md';

let repo: string;

function git(command: string): string {
  return execSync(`git ${command}`, { cwd: repo, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();
}

function write(relPath: string, contents: string): void {
  const absolute = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, 'utf-8');
}

function trackGitignore(contents: string): void {
  write('.gitignore', contents);
  git('add .gitignore');
  git('commit -q -m "track .gitignore"');
}

function readGitignore(): string {
  return fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8');
}

function occurrences(line: string): number {
  return readGitignore().split('\n').filter((l) => l === line).length;
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-specs-ignore-'));
  initGitRepo(repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('ignoreSpecsInWorktree', () => {
  it('ends a fresh worktree with "specs/" once, under its own header, in the tracked .gitignore, and git ignores a plan written there', () => {
    trackGitignore('node_modules/\n');

    ignoreSpecsInWorktree(repo);
    write(PLAN_FILE, '# Plan\n');

    const lines = readGitignore().split('\n');
    expect(occurrences('specs/')).toBe(1);
    expect(occurrences(SPECS_HEADER)).toBe(1);
    expect(lines.indexOf('specs/')).toBe(lines.indexOf(SPECS_HEADER) + 1);
    expect(git('status --porcelain --untracked-files=all')).toBe(' M .gitignore');
    expect(() => git(`check-ignore -q ${PLAN_FILE}`)).not.toThrow();
  });

  it('leaves the file byte for byte as the first setup left it when it runs a second time', () => {
    trackGitignore('node_modules/\n');
    ignoreSpecsInWorktree(repo);
    const afterFirst = readGitignore();

    ignoreSpecsInWorktree(repo);

    expect(readGitignore()).toBe(afterFirst);
    expect(occurrences('specs/')).toBe(1);
    expect(occurrences(SPECS_HEADER)).toBe(1);
  });

  it('leaves a .gitignore that already names "specs/" as it is, whatever its line endings', () => {
    trackGitignore('node_modules/\r\nspecs/\r\n');

    ignoreSpecsInWorktree(repo);

    expect(readGitignore()).toBe('node_modules/\r\nspecs/\r\n');
    expect(git('status --porcelain')).toBe('');
  });

  it('puts the entry on its own line when the .gitignore has no trailing newline', () => {
    trackGitignore('node_modules/');

    ignoreSpecsInWorktree(repo);

    expect(readGitignore()).toBe(`node_modules/\n${SPECS_HEADER}\nspecs/\n`);
  });

  it('creates a .gitignore holding the header and the entry when the repository has none', () => {
    ignoreSpecsInWorktree(repo);

    expect(readGitignore()).toBe(`${SPECS_HEADER}\nspecs/\n`);
    expect(git('status --porcelain')).toBe('?? .gitignore');
  });

  it('gives the entry its own header when the slash-commands header is already there', () => {
    trackGitignore(`${SLASH_COMMANDS_HEADER}\n.claude/commands/feature.md\n`);

    ignoreSpecsInWorktree(repo);

    expect(readGitignore()).toBe(
      `${SLASH_COMMANDS_HEADER}\n.claude/commands/feature.md\n${SPECS_HEADER}\nspecs/\n`,
    );
  });
});
