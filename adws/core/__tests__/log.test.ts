import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, setLogAdwId, getLogAdwId, resetLogAdwId } from '..';

describe('log', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetLogAdwId();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs without adwId bracket when no adwId is set', () => {
    log('test message');

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/📋 \[\d{4}-\d{2}-\d{2}T.+Z\] test message/);
    expect(output).not.toContain('[abc123]');
  });

  it('includes adwId bracket when adwId is set', () => {
    setLogAdwId('abc123');
    log('test message');

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/📋 \[\d{4}-\d{2}-\d{2}T.+Z\] \[abc123\] test message/);
  });

  it('wraps error level output in red ANSI codes with adwId', () => {
    setLogAdwId('abc123');
    log('error msg', 'error');

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('\x1b[31m');
    expect(output).toContain('\x1b[0m');
    expect(output).toContain('[abc123]');
  });

  it('includes adwId for success level', () => {
    setLogAdwId('abc123');
    log('done', 'success');

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[abc123]');
    expect(output).toContain('✅');
  });
});

describe('setLogAdwId / getLogAdwId', () => {
  beforeEach(() => {
    resetLogAdwId();
  });

  it('returns the current adwId after setting', () => {
    setLogAdwId('xyz');
    expect(getLogAdwId()).toBe('xyz');
  });

  it('returns undefined when no adwId has been set', () => {
    expect(getLogAdwId()).toBeUndefined();
  });
});
