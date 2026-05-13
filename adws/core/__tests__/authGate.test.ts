import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readAuthGate,
  writeAuthGate,
  clearAuthGate,
  markGateSlackNotified,
  shouldSendDetectionSlack,
  SLACK_DETECTION_COOLDOWN_MS,
} from '../authGate';

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authgate-test-'));
  origCwd = process.cwd();
  process.chdir(tmpDir);
  fs.mkdirSync('agents', { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readAuthGate', () => {
  it('returns null when gate file is absent', () => {
    expect(readAuthGate()).toBeNull();
  });

  it('returns null when gate file contains invalid JSON', () => {
    fs.writeFileSync('agents/.auth_gate', 'not-json', 'utf-8');
    expect(readAuthGate()).toBeNull();
  });
});

describe('writeAuthGate', () => {
  it('creates the gate file with correct fields and lastSlackNotifiedAt === null', () => {
    const detection = { adwId: 'adw-abc', issueNumber: 42, agentName: 'orchestrator' };
    const record = writeAuthGate(detection);

    expect(record.lastSlackNotifiedAt).toBeNull();
    expect(record.lastDetectedBy).toEqual(detection);
    expect(typeof record.firstDetectedAt).toBe('string');
    expect(typeof record.lastDetectedAt).toBe('string');
    expect(typeof record.host).toBe('string');

    // File should be parseable on disk
    const onDisk = JSON.parse(fs.readFileSync('agents/.auth_gate', 'utf-8'));
    expect(onDisk.lastSlackNotifiedAt).toBeNull();
    expect(onDisk.lastDetectedBy.adwId).toBe('adw-abc');
  });

  it('preserves firstDetectedAt on second write but updates lastDetectedAt and lastDetectedBy', async () => {
    const first = writeAuthGate({ adwId: 'adw-1', issueNumber: 10, agentName: 'orchestrator' });
    // Small delay to ensure timestamps differ
    await new Promise(r => setTimeout(r, 5));
    const second = writeAuthGate({ adwId: 'adw-2', issueNumber: 20, agentName: 'build-agent' });

    expect(second.firstDetectedAt).toBe(first.firstDetectedAt);
    expect(second.lastDetectedBy.adwId).toBe('adw-2');
    expect(second.lastDetectedBy.issueNumber).toBe(20);
    // lastDetectedAt should be >= firstDetectedAt
    expect(new Date(second.lastDetectedAt).getTime()).toBeGreaterThanOrEqual(new Date(second.firstDetectedAt).getTime());
  });

  it('preserves lastSlackNotifiedAt across writes', () => {
    writeAuthGate({ adwId: 'adw-1', issueNumber: 10, agentName: 'orchestrator' });
    markGateSlackNotified(new Date('2026-01-01T12:00:00Z'));
    const updated = readAuthGate();
    expect(updated?.lastSlackNotifiedAt).toBe('2026-01-01T12:00:00.000Z');

    // Second writeAuthGate should preserve the existing lastSlackNotifiedAt
    const second = writeAuthGate({ adwId: 'adw-2', issueNumber: 20, agentName: 'build-agent' });
    expect(second.lastSlackNotifiedAt).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('markGateSlackNotified', () => {
  it('updates lastSlackNotifiedAt on existing gate file', () => {
    writeAuthGate({ adwId: 'adw-1', issueNumber: 1, agentName: 'orchestrator' });
    const now = new Date('2026-05-13T10:00:00Z');
    markGateSlackNotified(now);

    const record = readAuthGate();
    expect(record?.lastSlackNotifiedAt).toBe('2026-05-13T10:00:00.000Z');
  });

  it('is a no-op when gate file is absent', () => {
    // Should not throw
    expect(() => markGateSlackNotified(new Date())).not.toThrow();
    expect(readAuthGate()).toBeNull();
  });
});

describe('shouldSendDetectionSlack', () => {
  const baseRecord = {
    firstDetectedAt: '2026-05-13T00:00:00Z',
    lastDetectedAt: '2026-05-13T00:00:00Z',
    host: 'testhost',
    lastDetectedBy: { adwId: null, issueNumber: null, agentName: 'orchestrator' },
  };

  it('returns true when lastSlackNotifiedAt is null', () => {
    const record = { ...baseRecord, lastSlackNotifiedAt: null };
    expect(shouldSendDetectionSlack(record, new Date())).toBe(true);
  });

  it('returns false when within the cooldown window', () => {
    const notifiedAt = new Date('2026-05-13T10:00:00Z');
    const record = { ...baseRecord, lastSlackNotifiedAt: notifiedAt.toISOString() };
    // 1 minute after notification — well within the 2-hour cooldown
    const now = new Date(notifiedAt.getTime() + 60_000);
    expect(shouldSendDetectionSlack(record, now)).toBe(false);
  });

  it('returns true when past the cooldown window', () => {
    const notifiedAt = new Date('2026-05-13T10:00:00Z');
    const record = { ...baseRecord, lastSlackNotifiedAt: notifiedAt.toISOString() };
    // Exactly at cooldown boundary
    const now = new Date(notifiedAt.getTime() + SLACK_DETECTION_COOLDOWN_MS);
    expect(shouldSendDetectionSlack(record, now)).toBe(true);
  });

  it('returns true when 1 ms past the cooldown window', () => {
    const notifiedAt = new Date('2026-05-13T10:00:00Z');
    const record = { ...baseRecord, lastSlackNotifiedAt: notifiedAt.toISOString() };
    const now = new Date(notifiedAt.getTime() + SLACK_DETECTION_COOLDOWN_MS + 1);
    expect(shouldSendDetectionSlack(record, now)).toBe(true);
  });
});

describe('clearAuthGate', () => {
  it('returns true and removes the file when it exists', () => {
    writeAuthGate({ adwId: 'adw-x', issueNumber: 99, agentName: 'orchestrator' });
    expect(fs.existsSync('agents/.auth_gate')).toBe(true);

    const result = clearAuthGate();
    expect(result).toBe(true);
    expect(fs.existsSync('agents/.auth_gate')).toBe(false);
  });

  it('returns false when the file is absent', () => {
    expect(clearAuthGate()).toBe(false);
  });

  it('returns null from readAuthGate after clear', () => {
    writeAuthGate({ adwId: 'adw-x', issueNumber: 99, agentName: 'orchestrator' });
    clearAuthGate();
    expect(readAuthGate()).toBeNull();
  });
});

describe('concurrent writeAuthGate', () => {
  it('final gate file is parseable after two concurrent writes', async () => {
    const d1 = { adwId: 'adw-1', issueNumber: 1, agentName: 'orchestrator' as const };
    const d2 = { adwId: 'adw-2', issueNumber: 2, agentName: 'build-agent' as const };

    await Promise.all([
      Promise.resolve(writeAuthGate(d1)),
      Promise.resolve(writeAuthGate(d2)),
    ]);

    // File should be valid JSON regardless of which write won the race
    const contents = fs.readFileSync('agents/.auth_gate', 'utf-8');
    expect(() => JSON.parse(contents)).not.toThrow();
    const record = JSON.parse(contents);
    expect(typeof record.firstDetectedAt).toBe('string');
    expect(typeof record.lastDetectedBy).toBe('object');
  });
});
