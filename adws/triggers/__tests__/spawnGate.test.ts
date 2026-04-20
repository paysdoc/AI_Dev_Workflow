import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RepoInfo } from '../../github/githubApi';

let tmpDir = '';

vi.mock('../../core/config', () => ({
  get AGENTS_STATE_DIR() { return tmpDir; },
}));

vi.mock('../../core/processLiveness', () => ({
  getProcessStartTime: vi.fn().mockReturnValue('fake-start-time-123'),
  isProcessLive: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { acquireIssueSpawnLock, releaseIssueSpawnLock, getSpawnLockFilePath } from '../spawnGate';
import { getProcessStartTime, isProcessLive } from '../../core/processLiveness';

const mockGetProcessStartTime = vi.mocked(getProcessStartTime);
const mockIsProcessLive = vi.mocked(isProcessLive);

const repoWidgets: RepoInfo = { owner: 'acme', repo: 'widgets' };
const repoGadgets: RepoInfo = { owner: 'acme', repo: 'gadgets' };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawngate-test-'));
  vi.clearAllMocks();
  mockGetProcessStartTime.mockReturnValue('fake-start-time-123');
  mockIsProcessLive.mockReturnValue(false);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('acquireIssueSpawnLock', () => {
  it('first acquire succeeds and writes a record with pid, pidStartedAt, repoKey, issueNumber, startedAt', () => {
    const result = acquireIssueSpawnLock(repoWidgets, 42, 12345);

    expect(result).toBe(true);
    const lockPath = getSpawnLockFilePath(repoWidgets, 42);
    expect(fs.existsSync(lockPath)).toBe(true);
    const record = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(record.pid).toBe(12345);
    expect(record.pidStartedAt).toBe('fake-start-time-123');
    expect(record.repoKey).toBe('acme/widgets');
    expect(record.issueNumber).toBe(42);
    expect(typeof record.startedAt).toBe('string');
  });

  it('second acquire while first holder PID is alive returns false', () => {
    mockIsProcessLive.mockReturnValue(true);
    // Manually write a lock with pidStartedAt so isProcessLive is consulted
    const lockPath = getSpawnLockFilePath(repoWidgets, 42);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 9999, pidStartedAt: 'boot-era-A', repoKey: 'acme/widgets', issueNumber: 42, startedAt: new Date().toISOString() }), 'utf-8');

    const result = acquireIssueSpawnLock(repoWidgets, 42, 8888);

    expect(result).toBe(false);
  });

  it('second acquire when first holder PID is dead reclaims stale lock and succeeds', () => {
    const lockPath = getSpawnLockFilePath(repoWidgets, 42);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999, pidStartedAt: 'old-start-time', repoKey: 'acme/widgets', issueNumber: 42, startedAt: new Date().toISOString() }), 'utf-8');
    mockIsProcessLive.mockReturnValue(false);

    const result = acquireIssueSpawnLock(repoWidgets, 42, 11111);

    expect(result).toBe(true);
    const record = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(record.pid).toBe(11111);
  });

  it('two different issues in the same repo can both acquire concurrently', () => {
    mockIsProcessLive.mockReturnValue(true);
    const r1 = acquireIssueSpawnLock(repoWidgets, 10, 1001);
    const r2 = acquireIssueSpawnLock(repoWidgets, 11, 1002);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it('same issue number in different repos can both acquire concurrently', () => {
    mockIsProcessLive.mockReturnValue(true);
    const r1 = acquireIssueSpawnLock(repoWidgets, 42, 2001);
    const r2 = acquireIssueSpawnLock(repoGadgets, 42, 2002);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it('malformed JSON in lock file is treated as stale and overwritten', () => {
    const lockPath = getSpawnLockFilePath(repoWidgets, 42);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, 'not-valid-json', 'utf-8');

    const result = acquireIssueSpawnLock(repoWidgets, 42, 5555);

    expect(result).toBe(true);
    const record = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(record.pid).toBe(5555);
  });

  it('concurrent acquire: exactly one succeeds (wx atomicity)', async () => {
    mockIsProcessLive.mockReturnValue(true);

    const [r1, r2] = await Promise.all([
      Promise.resolve(acquireIssueSpawnLock(repoWidgets, 55, 1111)),
      Promise.resolve(acquireIssueSpawnLock(repoWidgets, 55, 2222)),
    ]);

    const trueCount = [r1, r2].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it('PID reuse: stored pidStartedAt differs from live process start-time reclaims stale lock', () => {
    const lockPath = getSpawnLockFilePath(repoWidgets, 42);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 12345, pidStartedAt: 'old-boot-era', repoKey: 'acme/widgets', issueNumber: 42, startedAt: new Date().toISOString() }), 'utf-8');
    // isProcessLive returns false because start-times differ (PID reuse)
    mockIsProcessLive.mockReturnValue(false);

    const result = acquireIssueSpawnLock(repoWidgets, 42, 99999);

    expect(result).toBe(true);
    const record = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(record.pid).toBe(99999);
  });

  it('lock record missing pidStartedAt is treated as stale and reclaimed', () => {
    const lockPath = getSpawnLockFilePath(repoWidgets, 42);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    // Old-format record without pidStartedAt
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 12345, repoKey: 'acme/widgets', issueNumber: 42, startedAt: new Date().toISOString() }), 'utf-8');

    const result = acquireIssueSpawnLock(repoWidgets, 42, 77777);

    expect(result).toBe(true);
    const record = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(record.pid).toBe(77777);
  });
});

describe('releaseIssueSpawnLock', () => {
  it('removes the lock file', () => {
    acquireIssueSpawnLock(repoWidgets, 42, 12345);
    const lockPath = getSpawnLockFilePath(repoWidgets, 42);
    expect(fs.existsSync(lockPath)).toBe(true);

    releaseIssueSpawnLock(repoWidgets, 42);

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('is a no-op when the lock file does not exist', () => {
    expect(() => releaseIssueSpawnLock(repoWidgets, 99)).not.toThrow();
  });
});
