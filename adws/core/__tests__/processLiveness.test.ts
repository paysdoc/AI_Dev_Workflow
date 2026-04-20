import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProcessStartTime, isProcessLive } from '../processLiveness';
import type { ProcessLivenessDeps } from '../processLiveness';

// Build a fake stat line where field 22 (starttime) has the given value.
// Format: pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt
//         majflt cmajflt utime stime cutime cstime priority nice numthreads
//         itrealvalue starttime
function makeStatLine(pid: number, starttime: string): string {
  const fields = ['S', '1', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0',
    '0', '0', '0', '0', '0', '1', '0', starttime];
  return `${pid} (some-cmd) ${fields.join(' ')} 0`;
}

const linuxDeps = (statContent: string): ProcessLivenessDeps => ({
  readFile: () => statContent,
  execPs: () => { throw new Error('should not call execPs on linux'); },
});

const throwingLinuxDeps: ProcessLivenessDeps = {
  readFile: () => { const e = Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); throw e; },
  execPs: () => { throw new Error('should not call execPs on linux'); },
};

const macosDeps = (lstart: string): ProcessLivenessDeps => ({
  readFile: () => { throw new Error('should not call readFile on macos'); },
  execPs: () => lstart,
});

const throwingMacosDeps: ProcessLivenessDeps = {
  readFile: () => { throw new Error('should not call readFile on macos'); },
  execPs: () => { throw new Error('process not found'); },
};

let originalKill: typeof process.kill;
let originalPlatform: string;

beforeEach(() => {
  originalKill = process.kill;
  originalPlatform = process.platform;
});

afterEach(() => {
  process.kill = originalKill;
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.restoreAllMocks();
});

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function mockKillSuccess(): void {
  process.kill = vi.fn().mockReturnValue(true) as unknown as typeof process.kill;
}

function mockKillThrows(): void {
  process.kill = vi.fn().mockImplementation(() => {
    const e = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    throw e;
  }) as unknown as typeof process.kill;
}

// ─── Linux branch ────────────────────────────────────────────────────────────

describe('Linux branch', () => {
  beforeEach(() => setPlatform('linux'));

  it('isProcessLive returns true when kill-0 succeeds and start-times match', () => {
    mockKillSuccess();
    const deps = linuxDeps(makeStatLine(123, '12345678'));
    expect(isProcessLive(123, '12345678', deps)).toBe(true);
  });

  it('isProcessLive returns false when kill-0 succeeds but start-time differs (PID reuse)', () => {
    mockKillSuccess();
    const deps = linuxDeps(makeStatLine(123, '99999999'));
    expect(isProcessLive(123, '12345678', deps)).toBe(false);
  });

  it('isProcessLive returns false when readFile throws ENOENT (dead process)', () => {
    mockKillSuccess();
    expect(isProcessLive(123, '12345678', throwingLinuxDeps)).toBe(false);
  });

  it('isProcessLive returns false when kill-0 throws (non-existent PID)', () => {
    const readFileSpy = vi.fn();
    mockKillThrows();
    const deps: ProcessLivenessDeps = {
      readFile: readFileSpy,
      execPs: () => { throw new Error('should not be called'); },
    };
    expect(isProcessLive(123, '12345678', deps)).toBe(false);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('getProcessStartTime returns null when readFile throws', () => {
    expect(getProcessStartTime(123, throwingLinuxDeps)).toBeNull();
  });

  it('parses field 22 correctly when comm contains spaces and parentheses', () => {
    // comm = "(my (nested) comm)" — last ')' is the outer close-paren
    // Build the same field layout as makeStatLine so index 19 = starttime
    const starttime = '42000000';
    const line = `1234 (my (nested) comm) S 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 ${starttime} 0`;
    const deps = linuxDeps(line);
    mockKillSuccess();
    expect(isProcessLive(1234, starttime, deps)).toBe(true);
  });
});

// ─── macOS branch ────────────────────────────────────────────────────────────

describe('macOS branch', () => {
  beforeEach(() => setPlatform('darwin'));

  it('isProcessLive returns true when execPs returns the recorded lstart', () => {
    mockKillSuccess();
    const deps = macosDeps('Mon Apr 20 10:15:23 2026');
    expect(isProcessLive(123, 'Mon Apr 20 10:15:23 2026', deps)).toBe(true);
  });

  it('isProcessLive returns false when execPs returns a different lstart (PID reuse)', () => {
    mockKillSuccess();
    const deps = macosDeps('Mon Apr 20 11:30:00 2026');
    expect(isProcessLive(123, 'Mon Apr 20 10:15:23 2026', deps)).toBe(false);
  });

  it('isProcessLive returns false when execPs throws (process not found)', () => {
    mockKillSuccess();
    expect(isProcessLive(123, 'Mon Apr 20 10:15:23 2026', throwingMacosDeps)).toBe(false);
  });

  it('getProcessStartTime returns null when execPs throws', () => {
    expect(getProcessStartTime(123, throwingMacosDeps)).toBeNull();
  });

  it('getProcessStartTime returns null when execPs returns empty string', () => {
    const deps = macosDeps('   ');
    expect(getProcessStartTime(123, deps)).toBeNull();
  });

  it('getProcessStartTime returns trimmed stdout', () => {
    const deps = macosDeps('  Mon Apr 20 10:15:23 2026  ');
    mockKillSuccess();
    expect(getProcessStartTime(123, deps)).toBe('Mon Apr 20 10:15:23 2026');
  });
});

// ─── Windows — explicitly unsupported ────────────────────────────────────────

describe('Windows (win32) branch', () => {
  beforeEach(() => setPlatform('win32'));

  it('getProcessStartTime returns null without throwing', () => {
    // deps should not be called on windows
    const deps: ProcessLivenessDeps = {
      readFile: () => { throw new Error('should not call readFile on windows'); },
      execPs: () => { throw new Error('should not call execPs on windows'); },
    };
    expect(() => getProcessStartTime(123, deps)).not.toThrow();
    expect(getProcessStartTime(123, deps)).toBeNull();
  });

  it('isProcessLive returns false for any input without throwing', () => {
    mockKillSuccess();
    const deps: ProcessLivenessDeps = {
      readFile: () => { throw new Error('should not call readFile on windows'); },
      execPs: () => { throw new Error('should not call execPs on windows'); },
    };
    expect(() => isProcessLive(123, 'anything', deps)).not.toThrow();
    expect(isProcessLive(123, 'anything', deps)).toBe(false);
  });
});

// ─── Non-existent PID (platform-independent) ─────────────────────────────────

describe('non-existent PID', () => {
  it('isProcessLive returns false cleanly (does not throw)', () => {
    setPlatform('linux');
    mockKillThrows();
    expect(() => isProcessLive(99999, 'whatever', linuxDeps(makeStatLine(99999, '0')))).not.toThrow();
    expect(isProcessLive(99999, 'whatever', linuxDeps(makeStatLine(99999, '0')))).toBe(false);
  });

  it('getProcessStartTime returns null when readFile throws (linux, dead PID)', () => {
    setPlatform('linux');
    expect(getProcessStartTime(99999, throwingLinuxDeps)).toBeNull();
  });
});
