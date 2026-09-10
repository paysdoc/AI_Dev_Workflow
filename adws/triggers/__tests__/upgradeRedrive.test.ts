import { describe, it, expect, vi } from 'vitest';
import {
  parseClaimBranch,
  decideUpgradeRedrive,
  findRedrivableUpgrades,
  runUpgradeRedriveScan,
  type UpgradeRedriveDeps,
  type UpgradeRedriveSignals,
  type UpgradeRedriveIssue,
} from '../upgradeRedrive';
import { Platform, type RepoIdentifier } from '../../providers/types';

const REPO_INFO: RepoIdentifier = { owner: 'acme', repo: 'target', platform: Platform.GitHub };
const UPGRADE_LABEL = { name: 'adw:upgrade' };
const BLOCKED_LABEL = { name: 'adw:blocked' };

// ── parseClaimBranch ──────────────────────────────────────────────────────────

describe('parseClaimBranch', () => {
  it('extracts the claim branch from a realistic #UPG body (as built by runUpgradeGate)', () => {
    const body = [
      'Auto-generated upgrade tracking issue.',
      'Claim branch: `adw-upgrade-a1b2c3d4e5f6`',
      'Framework hash: `a1b2c3d4e5f6`',
    ].join('\n\n');

    expect(parseClaimBranch(body)).toBe('adw-upgrade-a1b2c3d4e5f6');
  });

  it('returns null for a body with no claim-branch line', () => {
    expect(parseClaimBranch('Just some unrelated issue text.')).toBeNull();
  });

  it('is tolerant of heading case', () => {
    expect(parseClaimBranch('claim BRANCH: `adw-upgrade-xyz`')).toBe('adw-upgrade-xyz');
  });

  it('returns null for empty backticks (malformed)', () => {
    expect(parseClaimBranch('Claim branch: ``')).toBeNull();
  });
});

// ── decideUpgradeRedrive truth table ──────────────────────────────────────────

function signals(overrides: Partial<UpgradeRedriveSignals> = {}): UpgradeRedriveSignals {
  return {
    isOpen: true,
    hasUpgradeLabel: true,
    isTerminalLabeled: false,
    hasClaimPr: false,
    spawnLockHeldByLiveProcess: false,
    ...overrides,
  };
}

describe('decideUpgradeRedrive', () => {
  it('stranded: open, upgrade label, not terminal, no PR, no live lock → redrive:true', () => {
    expect(decideUpgradeRedrive(signals())).toEqual({ redrive: true, reason: 'stranded' });
  });

  it('closed → redrive:false, reason:closed', () => {
    expect(decideUpgradeRedrive(signals({ isOpen: false }))).toEqual({ redrive: false, reason: 'closed' });
  });

  it('no adw:upgrade label → redrive:false, reason:not_upgrade', () => {
    expect(decideUpgradeRedrive(signals({ hasUpgradeLabel: false }))).toEqual({ redrive: false, reason: 'not_upgrade' });
  });

  it('terminal-labeled (adw:blocked) → redrive:false, reason:terminal', () => {
    expect(decideUpgradeRedrive(signals({ isTerminalLabeled: true }))).toEqual({ redrive: false, reason: 'terminal' });
  });

  it('claim PR present → redrive:false, reason:pr_present', () => {
    expect(decideUpgradeRedrive(signals({ hasClaimPr: true }))).toEqual({ redrive: false, reason: 'pr_present' });
  });

  it('spawn lock held by a live process → redrive:false, reason:live_lock', () => {
    expect(decideUpgradeRedrive(signals({ spawnLockHeldByLiveProcess: true }))).toEqual({ redrive: false, reason: 'live_lock' });
  });

  it('a dead-PID lock (spawnLockHeldByLiveProcess:false) is still redrivable', () => {
    expect(decideUpgradeRedrive(signals({ spawnLockHeldByLiveProcess: false }))).toEqual({ redrive: true, reason: 'stranded' });
  });
});

// ── findRedrivableUpgrades / runUpgradeRedriveScan (composing) ───────────────

function makeDeps(overrides: Partial<UpgradeRedriveDeps> = {}): UpgradeRedriveDeps {
  return {
    findClaimPr: vi.fn().mockReturnValue(null),
    readSpawnLock: vi.fn().mockReturnValue(null),
    isProcessLive: vi.fn().mockReturnValue(false),
    spawn: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('findRedrivableUpgrades', () => {
  const strandedIssue: UpgradeRedriveIssue = { number: 101, body: 'Claim branch: `adw-upgrade-101`', labels: [UPGRADE_LABEL] };
  const terminalIssue: UpgradeRedriveIssue = { number: 102, body: 'Claim branch: `adw-upgrade-102`', labels: [UPGRADE_LABEL, BLOCKED_LABEL] };
  const prPresentIssue: UpgradeRedriveIssue = { number: 103, body: 'Claim branch: `adw-upgrade-103`', labels: [UPGRADE_LABEL] };
  const liveLockIssue: UpgradeRedriveIssue = { number: 104, body: 'Claim branch: `adw-upgrade-104`', labels: [UPGRADE_LABEL] };
  const normalIssue: UpgradeRedriveIssue = { number: 105, body: 'Just a regular bug report.', labels: [{ name: 'adw:bug' }] };

  function makeFixtureDeps(): UpgradeRedriveDeps {
    return makeDeps({
      findClaimPr: vi.fn().mockImplementation((body: string) =>
        body.includes('adw-upgrade-103') ? { number: 1, state: 'OPEN', headRefName: 'adw-upgrade-103', baseRefName: 'main' } : null),
      readSpawnLock: vi.fn().mockImplementation((issueNumber: number) =>
        issueNumber === 104 ? { pid: 555, pidStartedAt: 'live-era' } : null),
      isProcessLive: vi.fn().mockImplementation((pid: number) => pid === 555),
    });
  }

  it('returns exactly the stranded #UPG number among a mixed fixture (terminal/PR-present/live-lock/non-upgrade all skipped)', () => {
    const deps = makeFixtureDeps();
    const result = findRedrivableUpgrades(
      [strandedIssue, terminalIssue, prPresentIssue, liveLockIssue, normalIssue],
      REPO_INFO,
      deps,
    );

    expect(result).toEqual([101]);
  });

  it('treats an absent lock and a dead-PID lock both as redrivable', () => {
    const deadLockIssue: UpgradeRedriveIssue = { number: 106, body: 'Claim branch: `adw-upgrade-106`', labels: [UPGRADE_LABEL] };
    const absentLockIssue: UpgradeRedriveIssue = { number: 107, body: 'Claim branch: `adw-upgrade-107`', labels: [UPGRADE_LABEL] };
    const deps = makeDeps({
      readSpawnLock: vi.fn().mockImplementation((issueNumber: number) =>
        issueNumber === 106 ? { pid: 99999, pidStartedAt: 'dead-era' } : null),
      isProcessLive: vi.fn().mockReturnValue(false),
    });

    const result = findRedrivableUpgrades([deadLockIssue, absentLockIssue], REPO_INFO, deps);

    expect(result).toEqual([106, 107]);
  });

  it('a body with no claim-branch line is treated as no PR (redrive proceeds)', () => {
    const noClaimLineIssue: UpgradeRedriveIssue = { number: 108, body: 'No claim branch line here.', labels: [UPGRADE_LABEL] };
    const deps = makeFixtureDeps();

    const result = findRedrivableUpgrades([noClaimLineIssue], REPO_INFO, deps);

    expect(result).toEqual([108]);
  });
});

describe('runUpgradeRedriveScan', () => {
  it('spawns the upgrade orchestrator only for the stranded issue, with (upgNumber, targetRepoArgs)', () => {
    const strandedIssue: UpgradeRedriveIssue = { number: 201, body: '', labels: [UPGRADE_LABEL] };
    const terminalIssue: UpgradeRedriveIssue = { number: 202, body: '', labels: [UPGRADE_LABEL, BLOCKED_LABEL] };
    const spawn = vi.fn();
    const deps = makeDeps({ spawn });
    const targetRepoArgs = ['--target-repo', 'acme/target'];

    runUpgradeRedriveScan([strandedIssue, terminalIssue], REPO_INFO, targetRepoArgs, deps);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(201, targetRepoArgs);
  });

  it('spawns nothing when no issue is stranded', () => {
    const terminalIssue: UpgradeRedriveIssue = { number: 203, body: '', labels: [UPGRADE_LABEL, BLOCKED_LABEL] };
    const spawn = vi.fn();
    const deps = makeDeps({ spawn });

    runUpgradeRedriveScan([terminalIssue], REPO_INFO, [], deps);

    expect(spawn).not.toHaveBeenCalled();
  });
});
