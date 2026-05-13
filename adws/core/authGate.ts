/**
 * Host-wide auth gate primitive.
 * Atomic temp+rename writer mirrors adws/core/pauseQueue.ts:55-60.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const AUTH_GATE_PATH = 'agents/.auth_gate';
export const SLACK_DETECTION_COOLDOWN_MS = 2 * 60 * 60 * 1000;

const HOST = os.hostname();

export interface AuthGateRecord {
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastSlackNotifiedAt: string | null;
  host: string;
  lastDetectedBy: {
    adwId: string | null;
    issueNumber: number | null;
    agentName: string;
  };
}

export function readAuthGate(): AuthGateRecord | null {
  try {
    if (!fs.existsSync(AUTH_GATE_PATH)) return null;
    const content = fs.readFileSync(AUTH_GATE_PATH, 'utf-8');
    return JSON.parse(content) as AuthGateRecord;
  } catch {
    return null;
  }
}

function writeAtomic(record: AuthGateRecord): void {
  const tmp = `${AUTH_GATE_PATH}.tmp`;
  fs.mkdirSync(path.dirname(AUTH_GATE_PATH), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmp, AUTH_GATE_PATH);
}

export function writeAuthGate(detection: {
  adwId: string | null;
  issueNumber: number | null;
  agentName: string;
}): AuthGateRecord {
  const now = new Date().toISOString();
  const existing = readAuthGate();
  const record: AuthGateRecord = {
    firstDetectedAt: existing?.firstDetectedAt ?? now,
    lastDetectedAt: now,
    lastSlackNotifiedAt: existing?.lastSlackNotifiedAt ?? null,
    host: HOST,
    lastDetectedBy: detection,
  };
  writeAtomic(record);
  return record;
}

export function clearAuthGate(): boolean {
  try {
    fs.unlinkSync(AUTH_GATE_PATH);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export function markGateSlackNotified(now: Date): void {
  const existing = readAuthGate();
  if (!existing) return;
  writeAtomic({ ...existing, lastSlackNotifiedAt: now.toISOString() });
}

export function shouldSendDetectionSlack(record: AuthGateRecord, now: Date): boolean {
  if (record.lastSlackNotifiedAt === null) return true;
  return (now.getTime() - new Date(record.lastSlackNotifiedAt).getTime()) >= SLACK_DETECTION_COOLDOWN_MS;
}
