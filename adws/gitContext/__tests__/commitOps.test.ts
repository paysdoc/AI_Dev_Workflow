import { describe, it, expect } from 'vitest';
import { commitOps } from '../commitOps';

interface RunnerCall {
  command: string;
  cwd: string;
}

const CWD = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

/**
 * Fake runner keyed by command prefix. `checkIgnoreOutput` undefined simulates
 * `git check-ignore` exiting non-zero (nothing ignored) by throwing, matching
 * the real runner's throw-on-nonzero-exit contract.
 */
function makeRunner(config: { statusOutput?: string; checkIgnoreOutput?: string } = {}): {
  run: (cmd: string, cwd: string) => string;
  calls: RunnerCall[];
} {
  const calls: RunnerCall[] = [];
  const run = (command: string, cwd: string): string => {
    calls.push({ command, cwd });
    if (command.startsWith('git status --porcelain')) {
      return config.statusOutput ?? ' M .adw/project.md\n';
    }
    if (command.startsWith('git check-ignore')) {
      if (config.checkIgnoreOutput === undefined) {
        throw Object.assign(new Error('exit status 1'), { status: 1 });
      }
      return config.checkIgnoreOutput;
    }
    return '';
  };
  return { run, calls };
}

function addCommand(calls: RunnerCall[]): string {
  const call = calls.find(c => c.command.startsWith('git add'));
  if (!call) throw new Error('no git add command was issued');
  return call.command;
}

function statusCommand(calls: RunnerCall[]): string {
  const call = calls.find(c => c.command.startsWith('git status --porcelain'));
  if (!call) throw new Error('no git status command was issued');
  return call.command;
}

describe('commitChanges — ignore-safe exclude filter', () => {
  it('omits the :(exclude) token from both add and status when the excluded path is gitignored', () => {
    const { run, calls } = makeRunner({ checkIgnoreOutput: '.claude/commands/adw_init.md\n' });
    commitOps.commitChanges(run, 'chore: regen', CWD, { excludePaths: ['.claude/commands/adw_init.md'] });
    expect(addCommand(calls)).toBe('git add -A');
    expect(statusCommand(calls)).toBe('git status --porcelain');
  });

  it('retains the :(exclude) token when check-ignore reports nothing ignored (non-zero exit)', () => {
    const { run, calls } = makeRunner();
    commitOps.commitChanges(run, 'chore: regen', CWD, { excludePaths: ['.claude/commands/adw_init.md'] });
    expect(addCommand(calls)).toBe("git add -A -- '.' ':(exclude).claude/commands/adw_init.md'");
  });

  it('drops only the ignored path in a mixed exclude list, keeping the non-ignored one', () => {
    const { run, calls } = makeRunner({ checkIgnoreOutput: 'a\n' });
    commitOps.commitChanges(run, 'chore: regen', CWD, { excludePaths: ['a', 'b'] });
    expect(addCommand(calls)).toBe("git add -A -- '.' ':(exclude)b'");
  });

  it('never invokes git check-ignore and emits a bare git add -A when no excludePaths given', () => {
    const { run, calls } = makeRunner();
    commitOps.commitChanges(run, 'chore: regen', CWD);
    expect(calls.some(c => c.command.startsWith('git check-ignore'))).toBe(false);
    expect(addCommand(calls)).toBe('git add -A');
  });

  it('probes check-ignore with single-quoted, space-joined path tokens', () => {
    const { run, calls } = makeRunner({ checkIgnoreOutput: '' });
    commitOps.commitChanges(run, 'chore: regen', CWD, { excludePaths: ['a', 'b'] });
    const checkIgnoreCall = calls.find(c => c.command.startsWith('git check-ignore'));
    expect(checkIgnoreCall?.command).toBe("git check-ignore 'a' 'b'");
    expect(checkIgnoreCall?.cwd).toBe(CWD);
  });

  it('returns false and issues no add/commit when status is empty (nothing to commit)', () => {
    const { run, calls } = makeRunner({ statusOutput: '' });
    const result = commitOps.commitChanges(run, 'chore: regen', CWD);
    expect(result).toBe(false);
    expect(calls.some(c => c.command.startsWith('git add'))).toBe(false);
    expect(calls.some(c => c.command.startsWith('git commit'))).toBe(false);
  });

  it('returns true and issues a commit when there are pending changes', () => {
    const { run, calls } = makeRunner();
    const result = commitOps.commitChanges(run, 'chore: regen', CWD);
    expect(result).toBe(true);
    expect(calls.some(c => c.command.startsWith('git commit'))).toBe(true);
  });
});
