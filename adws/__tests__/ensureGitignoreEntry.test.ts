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

import { ensureGitignoreEntry } from '../phases/workflowLifecycle';

const WORKTREE = '/tmp/fake-worktree';
const GITIGNORE = path.join(WORKTREE, '.gitignore');

describe('ensureGitignoreEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates .gitignore with entry when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    ensureGitignoreEntry(WORKTREE, '.claude/commands/');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      GITIGNORE,
      expect.stringContaining('.claude/commands/'),
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

    ensureGitignoreEntry(WORKTREE, '.claude/commands/');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('node_modules/');
    expect(written).toContain('dist/');
    expect(written).toContain('.claude/commands/');
  });

  it('does not duplicate entry when it already exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'node_modules/\n.claude/commands/\n',
    );

    ensureGitignoreEntry(WORKTREE, '.claude/commands/');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('preserves existing content when appending', () => {
    const existing = '# project ignores\nbuild/\ncoverage/\n';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(existing);

    ensureGitignoreEntry(WORKTREE, '.claude/commands/');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written.startsWith(existing)).toBe(true);
    expect(written).toContain('.claude/commands/');
  });

  it('adds newline before comment when existing content lacks trailing newline', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules/');

    ensureGitignoreEntry(WORKTREE, '.claude/commands/');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toBe(
      'node_modules/\n# ADW: copied slash commands (do not commit)\n.claude/commands/\n',
    );
  });
});
