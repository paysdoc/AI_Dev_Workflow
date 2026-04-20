import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core';
import { AGENTS_STATE_DIR } from '../core/config';
import { getProcessStartTime, isProcessLive } from '../core/processLiveness';
import type { RepoInfo } from '../github/githubApi';

interface IssueSpawnLockRecord {
  readonly pid: number;
  readonly pidStartedAt: string;
  readonly repoKey: string;
  readonly issueNumber: number;
  readonly startedAt: string;
}

export function getSpawnLockFilePath(repoInfo: RepoInfo, issueNumber: number): string {
  const fragment = `${repoInfo.owner}_${repoInfo.repo}_issue-${issueNumber}.json`;
  return path.join(AGENTS_STATE_DIR, 'spawn_locks', fragment);
}

function ensureSpawnLockDir(): void {
  fs.mkdirSync(path.join(AGENTS_STATE_DIR, 'spawn_locks'), { recursive: true });
}

function readSpawnLock(filePath: string): IssueSpawnLockRecord | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as IssueSpawnLockRecord;
  } catch {
    return null;
  }
}

function removeSpawnLock(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function tryExclusiveCreate(filePath: string, record: IssueSpawnLockRecord): boolean {
  try {
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export function acquireIssueSpawnLock(repoInfo: RepoInfo, issueNumber: number, ownPid: number): boolean {
  ensureSpawnLockDir();
  const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;
  const filePath = getSpawnLockFilePath(repoInfo, issueNumber);
  const pidStartedAt = getProcessStartTime(ownPid) ?? '';
  const record: IssueSpawnLockRecord = {
    pid: ownPid,
    pidStartedAt,
    repoKey,
    issueNumber,
    startedAt: new Date().toISOString(),
  };

  if (tryExclusiveCreate(filePath, record)) return true;

  const existing = readSpawnLock(filePath);

  if (existing === null) {
    removeSpawnLock(filePath);
    return tryExclusiveCreate(filePath, record);
  }

  if (existing.pidStartedAt && isProcessLive(existing.pid, existing.pidStartedAt)) {
    log(`spawn lock held for ${repoKey}#${issueNumber} by pid=${existing.pid}`);
    return false;
  }

  log(`Removing stale spawn lock for ${repoKey}#${issueNumber} (PID ${existing.pid} is dead)`);
  removeSpawnLock(filePath);
  return tryExclusiveCreate(filePath, record);
}

export function releaseIssueSpawnLock(repoInfo: RepoInfo, issueNumber: number): void {
  removeSpawnLock(getSpawnLockFilePath(repoInfo, issueNumber));
}
