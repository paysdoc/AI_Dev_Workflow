import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { startMergeLog, MERGE_LOG_FILE } from '../adwMerge';
import { LOGS_DIR, log } from '../core';
import { resetLogFile } from '../core/logger';

describe('startMergeLog', () => {
  const adwId = `merge-log-test-${process.pid}`;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetLogFile();
    fs.rmSync(path.join(LOGS_DIR, adwId), { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it('points the log at logs/<adwId>/merge.log, so every later line of the run lands there', () => {
    const mergeLogPath = startMergeLog(adwId);

    log('Auto-merge attempt 1/3 for PR #7');

    expect(mergeLogPath).toBe(path.join(LOGS_DIR, adwId, MERGE_LOG_FILE));
    expect(fs.readFileSync(mergeLogPath, 'utf-8')).toContain('Auto-merge attempt 1/3 for PR #7');
  });

  it('appends to the log of an earlier run of the same workflow', () => {
    startMergeLog(adwId);
    log('first run');
    resetLogFile();

    const mergeLogPath = startMergeLog(adwId);
    log('second run');

    const lines = fs.readFileSync(mergeLogPath, 'utf-8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first run');
    expect(lines[1]).toContain('second run');
  });
});
