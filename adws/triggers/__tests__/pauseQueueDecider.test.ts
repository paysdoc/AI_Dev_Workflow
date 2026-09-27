import { describe, it, expect } from 'vitest';
import {
  decidePauseQueueAction,
  isBeforeReset,
  isOwnedByScanningCron,
  parseResetsAt,
  type PauseQueueDecisionInput,
  type ScanningCronIdentity,
} from '../pauseQueueDecider';
import type { PausedWorkflow } from '../../core/pauseQueue';
import type { ProbeClassification, ProbeOutcome } from '../rateLimitProbe';
import { INCIDENT_RESETS_AT, INCIDENT_RATE_LIMIT_TYPE } from '../../core/__tests__/fixtures/rateLimitIncident';

const NOW = new Date('2026-09-22T12:06:00Z');
const BEFORE = '2026-09-22T12:50:00.000Z'; // = resetsAtIsoFromEpochSeconds(INCIDENT_RESETS_AT)
const PAST = '2026-09-22T11:00:00.000Z';
const BUDGET = 3;

const ACME_CRON: ScanningCronIdentity = { repoId: { owner: 'acme', repo: 'widgets' }, selfHost: false };
const DEVPLATFORM_CRON: ScanningCronIdentity = { repoId: { owner: 'paysdoc', repo: 'devplatform' }, selfHost: false };
const SELF_HOST_CRON: ScanningCronIdentity = { repoId: { owner: 'paysdoc', repo: 'AI_Dev_Workflow' }, selfHost: true };

function makeEntry(overrides: Partial<PausedWorkflow> = {}): PausedWorkflow {
  return {
    adwId: 'test-adw-910',
    issueNumber: 840,
    orchestratorScript: 'adws/adwSdlc.tsx',
    pausedAtPhase: 'build',
    pauseReason: 'rate_limited',
    pausedAt: '2026-09-22T11:57:00Z',
    worktreePath: '/tmp/fake-worktree',
    branchName: 'fix/test-branch',
    extraArgs: ['--target-repo', 'acme/widgets'],
    probeFailures: 0,
    ...overrides,
  };
}

function probe(verdict: ProbeOutcome, facts: Partial<ProbeClassification> = {}): ProbeClassification {
  return { verdict, ...facts };
}

function decide(
  entry: PausedWorkflow,
  classification: ProbeClassification,
  now: Date,
  maxProbeFailures = BUDGET,
  scanningCron: ScanningCronIdentity = ACME_CRON,
): ReturnType<typeof decidePauseQueueAction> {
  const input: PauseQueueDecisionInput = { entry, probe: classification, now, maxProbeFailures, scanningCron };
  return decidePauseQueueAction(input);
}

describe('parseResetsAt / isBeforeReset', () => {
  it('a future ISO timestamp is before reset', () => {
    expect(isBeforeReset({ resetsAt: BEFORE }, NOW)).toBe(true);
  });

  it('a past ISO timestamp is not before reset', () => {
    expect(isBeforeReset({ resetsAt: PAST }, NOW)).toBe(false);
  });

  it('a resetsAt exactly equal to now is not before reset (due, not frozen)', () => {
    expect(isBeforeReset({ resetsAt: NOW.toISOString() }, NOW)).toBe(false);
  });

  it('an absent resetsAt is not before reset', () => {
    expect(isBeforeReset({ resetsAt: undefined }, NOW)).toBe(false);
    expect(parseResetsAt(undefined)).toBeNull();
  });

  it('an unparseable resetsAt is not before reset and parses to null', () => {
    expect(isBeforeReset({ resetsAt: 'not-a-date' }, NOW)).toBe(false);
    expect(parseResetsAt('not-a-date')).toBeNull();
  });
});

describe('decidePauseQueueAction — reset gate', () => {
  it.each<ProbeOutcome>(['clear', 'limited', 'failed', 'unknown'])(
    'before resetsAt, a %s verdict is skip_before_reset regardless',
    (verdict) => {
      const entry = makeEntry({ resetsAt: BEFORE });
      const action = decide(entry, probe(verdict), NOW);
      expect(action).toEqual({ kind: 'skip_before_reset', resetsAt: BEFORE });
    },
  );

  it('a strike that would have evicted is not counted while before resetsAt', () => {
    const entry = makeEntry({ resetsAt: BEFORE, probeFailures: 2 });
    const action = decide(entry, probe('unknown'), NOW);
    expect(action).toEqual({ kind: 'skip_before_reset', resetsAt: BEFORE });
  });

  it('a clear probe taken early does not resume', () => {
    const entry = makeEntry({ resetsAt: BEFORE });
    const action = decide(entry, probe('clear'), NOW);
    expect(action.kind).toBe('skip_before_reset');
  });
});

describe('decidePauseQueueAction — resume', () => {
  it('clear after a past reset resumes', () => {
    const entry = makeEntry({ resetsAt: PAST });
    expect(decide(entry, probe('clear'), NOW)).toEqual({ kind: 'resume' });
  });

  it('clear on a legacy entry (no resetsAt) resumes', () => {
    const entry = makeEntry({ resetsAt: undefined });
    expect(decide(entry, probe('clear'), NOW)).toEqual({ kind: 'resume' });
  });

  it('clear on an unparseable resetsAt resumes', () => {
    const entry = makeEntry({ resetsAt: 'not-a-date' });
    expect(decide(entry, probe('clear'), NOW)).toEqual({ kind: 'resume' });
  });
});

describe('decidePauseQueueAction — refresh_reset', () => {
  it('limited with a reported reset time and limit type refreshes both, exactly', () => {
    const entry = makeEntry({ resetsAt: PAST });
    const action = decide(entry, probe('limited', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT }), NOW);
    expect(action).toEqual({ kind: 'refresh_reset', resetsAt: BEFORE, rateLimitType: 'five_hour' });
  });

  it('limited with a limit type but no reset time is a bare refresh_reset — no change, not even the limit type', () => {
    const entry = makeEntry({ resetsAt: PAST });
    const action = decide(entry, probe('limited', { rateLimitType: 'seven_day' }), NOW);
    expect(action).toEqual({ kind: 'refresh_reset' });
  });

  it('limited with no facts at all is a bare refresh_reset', () => {
    const entry = makeEntry({ resetsAt: PAST });
    expect(decide(entry, probe('limited'), NOW)).toEqual({ kind: 'refresh_reset' });
  });

  it('limited with no facts, one strike short of eviction, is still refresh_reset — never evicted', () => {
    const entry = makeEntry({ resetsAt: PAST, probeFailures: 2 });
    expect(decide(entry, probe('limited'), NOW)).toEqual({ kind: 'refresh_reset' });
  });

  it('limited on a legacy entry (no resetsAt) with facts refreshes it — gains a reset time', () => {
    const entry = makeEntry({ resetsAt: undefined });
    const action = decide(entry, probe('limited', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT }), NOW);
    expect(action).toEqual({ kind: 'refresh_reset', resetsAt: BEFORE, rateLimitType: 'five_hour' });
  });
});

describe('decidePauseQueueAction — strikes and eviction', () => {
  it.each<StrikeVerdictCase>([
    ['failed', 0, 'count_strike', 1],
    ['failed', 1, 'count_strike', 2],
    ['failed', 2, 'evict', 3],
    ['unknown', 0, 'count_strike', 1],
    ['unknown', 1, 'count_strike', 2],
    ['unknown', 2, 'evict', 3],
  ])('%s verdict at %i prior failures -> %s (%i)', (verdict, priorFailures, expectedKind, expectedFailures) => {
    const entry = makeEntry({ probeFailures: priorFailures });
    const action = decide(entry, probe(verdict), NOW);
    expect(action).toEqual({ kind: expectedKind, probeFailures: expectedFailures, verdict });
  });

  it('a legacy entry with probeFailures absent strikes to 1', () => {
    const entry = makeEntry({ probeFailures: undefined });
    const action = decide(entry, probe('unknown'), NOW);
    expect(action).toEqual({ kind: 'count_strike', probeFailures: 1, verdict: 'unknown' });
  });

  it('maxProbeFailures of 1 evicts on the first strike', () => {
    const entry = makeEntry({ probeFailures: 0 });
    const action = decide(entry, probe('failed'), NOW, 1);
    expect(action).toEqual({ kind: 'evict', probeFailures: 1, verdict: 'failed' });
  });

  it('a past resetsAt with an unknown verdict still strikes — the gate only protects entries still waiting', () => {
    const entry = makeEntry({ resetsAt: PAST, probeFailures: 0 });
    const action = decide(entry, probe('unknown'), NOW);
    expect(action).toEqual({ kind: 'count_strike', probeFailures: 1, verdict: 'unknown' });
  });
});

describe('decidePauseQueueAction — purity', () => {
  it('is deterministic across repeated calls with the same input', () => {
    const entry = makeEntry({ resetsAt: PAST, probeFailures: 1 });
    const input: PauseQueueDecisionInput = { entry, probe: probe('failed'), now: NOW, maxProbeFailures: BUDGET, scanningCron: ACME_CRON };
    expect(decidePauseQueueAction(input)).toEqual(decidePauseQueueAction(input));
  });

  it('does not mutate the input entry', () => {
    const entry = makeEntry({ resetsAt: PAST, probeFailures: 1 });
    const before = structuredClone(entry);
    decide(entry, probe('failed'), NOW);
    expect(entry).toEqual(before);
  });

  it('does not mutate an entry with extraArgs present (the ownership read must not splice)', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'acme/widgets', '--clone-url', 'https://example.invalid/acme/widgets.git'] });
    const before = structuredClone(entry);
    decide(entry, probe('clear'), NOW);
    expect(entry).toEqual(before);
    expect(entry.extraArgs).toEqual(before.extraArgs);
  });
});

describe('decidePauseQueueAction — ownership', () => {
  it('a matching target repo proceeds to the reset gate: before reset -> skip_before_reset', () => {
    const entry = makeEntry({ resetsAt: BEFORE });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'skip_before_reset', resetsAt: BEFORE });
  });

  it('a matching target repo proceeds to the verdict: clear after a past reset -> resume', () => {
    const entry = makeEntry({ resetsAt: PAST });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'resume' });
  });

  it('a matching target repo proceeds to the verdict: failed -> count_strike', () => {
    const entry = makeEntry({ probeFailures: 0 });
    expect(decide(entry, probe('failed'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'count_strike', probeFailures: 1, verdict: 'failed' });
  });

  it.each<ProbeOutcome>(['clear', 'limited', 'failed', 'unknown'])(
    'a mismatching target repo is skip_not_owner regardless of the %s verdict, before the reset time',
    (verdict) => {
      const entry = makeEntry({ resetsAt: BEFORE });
      expect(decide(entry, probe(verdict), NOW, BUDGET, DEVPLATFORM_CRON)).toEqual({ kind: 'skip_not_owner' });
    },
  );

  it.each<ProbeOutcome>(['clear', 'limited', 'failed', 'unknown'])(
    'a mismatching target repo is skip_not_owner regardless of the %s verdict, after the reset time',
    (verdict) => {
      const entry = makeEntry({ resetsAt: PAST });
      expect(decide(entry, probe(verdict), NOW, BUDGET, DEVPLATFORM_CRON)).toEqual({ kind: 'skip_not_owner' });
    },
  );

  it('a mismatching target repo is skip_not_owner one strike short of eviction — never evict', () => {
    const entry = makeEntry({ probeFailures: 2 });
    expect(decide(entry, probe('failed'), NOW, BUDGET, DEVPLATFORM_CRON)).toEqual({ kind: 'skip_not_owner' });
  });

  it('an entry with no extraArgs is owned by the self-host cron: clear -> resume', () => {
    const entry = makeEntry({ extraArgs: undefined });
    expect(decide(entry, probe('clear'), NOW, BUDGET, SELF_HOST_CRON)).toEqual({ kind: 'resume' });
  });

  it('an entry with no extraArgs is not owned by a --target-repo cron', () => {
    const entry = makeEntry({ extraArgs: undefined });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'skip_not_owner' });
  });

  it('an entry tagged with the self-host cron\'s own repo is owned by it (every cron-spawned orchestrator carries --target-repo)', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'paysdoc/AI_Dev_Workflow'] });
    expect(decide(entry, probe('clear'), NOW, BUDGET, SELF_HOST_CRON)).toEqual({ kind: 'resume' });
  });

  it('the self-host cron does not own an entry tagged with a different repo: clear', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'acme/widgets'] });
    expect(decide(entry, probe('clear'), NOW, BUDGET, SELF_HOST_CRON)).toEqual({ kind: 'skip_not_owner' });
  });

  it('the self-host cron does not own an entry tagged with a different repo: failed at the strike cap', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'acme/widgets'], probeFailures: 2 });
    expect(decide(entry, probe('failed'), NOW, BUDGET, SELF_HOST_CRON)).toEqual({ kind: 'skip_not_owner' });
  });

  it('the target-repo match is case-insensitive, exactly like sameRepoIdentity', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'Acme/Widgets'] });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'resume' });
  });

  it.each([
    ['--target-repo with no value', ['--target-repo']],
    ['--target-repo with a malformed value (no slash)', ['--target-repo', 'acme']],
    ['--target-repo with an empty owner', ['--target-repo', '/widgets']],
  ])('%s reads as no target repo: owned by the self-host cron, not by a --target-repo cron', (_label, extraArgs) => {
    const entry = makeEntry({ extraArgs });
    expect(decide(entry, probe('clear'), NOW, BUDGET, SELF_HOST_CRON)).toEqual({ kind: 'resume' });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'skip_not_owner' });
  });

  it('a non-array extraArgs (a hand-written queue file) never throws and reads as no target repo', () => {
    const entry = makeEntry({ extraArgs: {} as unknown as string[] });
    expect(decide(entry, probe('clear'), NOW, BUDGET, SELF_HOST_CRON)).toEqual({ kind: 'resume' });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'skip_not_owner' });
  });

  it('a non-string value after --target-repo never throws and reads as no target repo', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 42] as unknown as string[] });
    expect(decide(entry, probe('clear'), NOW, BUDGET, SELF_HOST_CRON)).toEqual({ kind: 'resume' });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'skip_not_owner' });
  });

  it('a legacy --clone-url alongside --target-repo does not affect ownership', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'acme/widgets', '--clone-url', 'https://example.invalid/acme/widgets.git'] });
    expect(decide(entry, probe('clear'), NOW, BUDGET, ACME_CRON)).toEqual({ kind: 'resume' });
  });
});

describe('isOwnedByScanningCron', () => {
  it('owns an entry whose target repo matches the scanning cron', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'acme/widgets'] });
    expect(isOwnedByScanningCron(entry, ACME_CRON)).toBe(true);
  });

  it('does not own an entry whose target repo mismatches', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'acme/widgets'] });
    expect(isOwnedByScanningCron(entry, DEVPLATFORM_CRON)).toBe(false);
  });

  it('a target-less entry is owned only by the self-host cron', () => {
    const entry = makeEntry({ extraArgs: undefined });
    expect(isOwnedByScanningCron(entry, SELF_HOST_CRON)).toBe(true);
    expect(isOwnedByScanningCron(entry, ACME_CRON)).toBe(false);
  });

  it('the self-host cron owns an entry tagged with its own repo, and no other', () => {
    const selfEntry = makeEntry({ extraArgs: ['--target-repo', 'paysdoc/AI_Dev_Workflow'] });
    const otherEntry = makeEntry({ extraArgs: ['--target-repo', 'acme/widgets'] });
    expect(isOwnedByScanningCron(selfEntry, SELF_HOST_CRON)).toBe(true);
    expect(isOwnedByScanningCron(otherEntry, SELF_HOST_CRON)).toBe(false);
  });

  it('matches case-insensitively', () => {
    const entry = makeEntry({ extraArgs: ['--target-repo', 'Acme/Widgets'] });
    expect(isOwnedByScanningCron(entry, ACME_CRON)).toBe(true);
  });

  it('a malformed or non-array extraArgs never throws and reads as no target repo', () => {
    expect(isOwnedByScanningCron(makeEntry({ extraArgs: ['--target-repo'] }), SELF_HOST_CRON)).toBe(true);
    expect(isOwnedByScanningCron(makeEntry({ extraArgs: {} as unknown as string[] }), SELF_HOST_CRON)).toBe(true);
    expect(isOwnedByScanningCron(makeEntry({ extraArgs: {} as unknown as string[] }), ACME_CRON)).toBe(false);
  });
});

type StrikeVerdict = Extract<ProbeOutcome, 'failed' | 'unknown'>;
type StrikeVerdictCase = [StrikeVerdict, number, 'count_strike' | 'evict', number];
