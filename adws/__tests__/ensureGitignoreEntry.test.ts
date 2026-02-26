import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

import { ensureGitignoreEntry, ensureGitignoreEntries } from '../phases/workflowLifecycle';

const WORKTREE = '/tmp/fake-worktree';
const GITIGNORE = path.join(WORKTREE, '.gitignore');

describe('ensureGitignoreEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates .gitignore with entry when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    ensureGitignoreEntry(WORKTREE, '.claude/commands/bug.md');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      GITIGNORE,
      expect.stringContaining('.claude/commands/bug.md'),
      'utf-8',
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      GITIGNORE,
      expect.stringContaining('# ADW: copied slash commands (do not commit)'),
      'utf-8',
    );
  });

  it('appends entry to existing .gitignore that lacks it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules/\ndist/\n');

    ensureGitignoreEntry(WORKTREE, '.claude/commands/bug.md');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('node_modules/');
    expect(written).toContain('dist/');
    expect(written).toContain('.claude/commands/bug.md');
  });

  it('does not duplicate entry when it already exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'node_modules/\n.claude/commands/bug.md\n',
    );

    ensureGitignoreEntry(WORKTREE, '.claude/commands/bug.md');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('preserves existing content when appending', () => {
    const existing = '# project ignores\nbuild/\ncoverage/\n';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(existing);

    ensureGitignoreEntry(WORKTREE, '.claude/commands/bug.md');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written.startsWith(existing)).toBe(true);
    expect(written).toContain('.claude/commands/bug.md');
  });

  it('adds newline before comment when existing content lacks trailing newline', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules/');

    ensureGitignoreEntry(WORKTREE, '.claude/commands/bug.md');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toBe(
      'node_modules/\n# ADW: copied slash commands (do not commit)\n.claude/commands/bug.md\n',
    );
  });

  it('adds multiple file entries with comment header only once', () => {
    const comment = '# ADW: copied slash commands (do not commit)';

    // First call: file does not exist
    vi.mocked(fs.existsSync).mockReturnValue(false);
    ensureGitignoreEntry(WORKTREE, '.claude/commands/bug.md');

    const afterFirst = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(afterFirst).toBe(`${comment}\n.claude/commands/bug.md\n`);

    // Second call: simulate reading the file that was just written
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(afterFirst);
    ensureGitignoreEntry(WORKTREE, '.claude/commands/feature.md');

    const afterSecond = vi.mocked(fs.writeFileSync).mock.calls[1][1] as string;
    expect(afterSecond).toBe(
      `${comment}\n.claude/commands/bug.md\n.claude/commands/feature.md\n`,
    );

    // Verify comment appears exactly once
    const commentOccurrences = afterSecond.split('\n').filter((line) => line === comment);
    expect(commentOccurrences).toHaveLength(1);

    // Verify both entries are present
    expect(afterSecond).toContain('.claude/commands/bug.md');
    expect(afterSecond).toContain('.claude/commands/feature.md');
  });
});

describe('ensureGitignoreEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds multiple file entries with a single comment header', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const entries = [
      '.claude/commands/bug.md',
      '.claude/commands/feature.md',
      '.claude/commands/chore.md',
    ];
    ensureGitignoreEntries(WORKTREE, entries);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const commentOccurrences = written.split('\n').filter(
      (line) => line === '# ADW: copied slash commands (do not commit)',
    );
    expect(commentOccurrences).toHaveLength(1);
    expect(written).toContain('.claude/commands/bug.md');
    expect(written).toContain('.claude/commands/feature.md');
    expect(written).toContain('.claude/commands/chore.md');
  });

  it('skips entries that already exist in .gitignore', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'node_modules/\n.claude/commands/bug.md\n',
    );

    ensureGitignoreEntries(WORKTREE, [
      '.claude/commands/bug.md',
      '.claude/commands/chore.md',
    ]);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('.claude/commands/chore.md');
    // bug.md should not appear in the appended section
    const appendedSection = written.split('# ADW: copied slash commands (do not commit)\n').pop()!;
    expect(appendedSection).not.toContain('.claude/commands/bug.md');
  });

  it('does not write when all entries already exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '.claude/commands/bug.md\n.claude/commands/feature.md\n',
    );

    ensureGitignoreEntries(WORKTREE, [
      '.claude/commands/bug.md',
      '.claude/commands/feature.md',
    ]);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('does nothing for empty entries array', () => {
    ensureGitignoreEntries(WORKTREE, []);

    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates .gitignore when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    ensureGitignoreEntries(WORKTREE, [
      '.claude/commands/bug.md',
      '.claude/commands/feature.md',
    ]);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      GITIGNORE,
      '# ADW: copied slash commands (do not commit)\n.claude/commands/bug.md\n.claude/commands/feature.md\n',
      'utf-8',
    );
  });
});
