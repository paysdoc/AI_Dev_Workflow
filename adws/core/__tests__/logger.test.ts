import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log, setLogFile, resetLogFile, setLogAdwId, resetLogAdwId } from '../logger';

describe('log file sink', () => {
  let tmp: string;
  let file: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-logger-'));
    file = path.join(tmp, 'merge.log');
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetLogFile();
    resetLogAdwId();
    fs.rmSync(tmp, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it('appends each line of the log to the file, timestamped', () => {
    setLogFile(file);

    log('hello');

    expect(fs.readFileSync(file, 'utf-8')).toMatch(/^\S+ \[\d{4}-\d{2}-\d{2}T[^\]]+\] hello\n$/u);
  });

  it('appends to what the file already holds, one line to a line, in order', () => {
    fs.writeFileSync(file, 'an earlier run\n', 'utf-8');
    setLogFile(file);

    log('first');
    log('second');

    const lines = fs.readFileSync(file, 'utf-8').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('an earlier run');
    expect(lines[1]).toContain('first');
    expect(lines[2]).toContain('second');
  });

  it('writes an error without the red the console shows it in', () => {
    setLogFile(file);

    log('boom', 'error');

    expect(fs.readFileSync(file, 'utf-8')).toContain('boom');
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('\x1b[');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('\x1b[31m'));
  });

  it('keeps writing to the console as before', () => {
    setLogFile(file);

    log('hello');

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/ hello$/));
  });

  it('names the adwId in the file as it does on the console', () => {
    setLogFile(file);
    setLogAdwId('abc123');

    log('hello');

    expect(fs.readFileSync(file, 'utf-8')).toContain('[abc123]');
  });

  it('stops writing to the file once it is reset', () => {
    setLogFile(file);
    resetLogFile();

    log('x');

    expect(fs.existsSync(file)).toBe(false);
  });

  it('never throws when the file cannot be written', () => {
    setLogFile(path.join(tmp, 'missing-dir', 'merge.log'));

    expect(() => log('x')).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });
});
