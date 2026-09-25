import { describe, it, expect } from 'vitest';
import {
  decidePauseQueueAction,
  isBeforeReset,
  parseResetsAt,
  type PauseQueueDecisionInput,
} from '../pauseQueueDecider';
import type { PausedWorkflow } from '../../core/pauseQueue';
import type { ProbeClassification, ProbeOutcome } from '../rateLimitProbe';
import { INCIDENT_RESETS_AT, INCIDENT_RATE_LIMIT_TYPE } from '../../core/__tests__/fixtures/rateLimitIncident';

const NOW = new Date('2026-09-22T12:06:00Z');
const BEFORE = '2026-09-22T12:50:00.000Z'; // = resetsAtIsoFromEpochSeconds(INCIDENT_RESETS_AT)
const PAST = '2026-09-22T11:00:00.000Z';
const BUDGET = 3;

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
    probeFailures: 0,
    ...overrides,
  };
}

function probe(verdict: ProbeOutcome, facts: Partial<ProbeClassification> = {}): ProbeClassification {
  return { verdict, ...facts };
}

function decide(entry: PausedWorkflow, classification: ProbeClassification, now: Date, maxProbeFailures = BUDGET): ReturnType<typeof decidePauseQueueAction> {
  const input: PauseQueueDecisionInput = { entry, probe: classification, now, maxProbeFailures };
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
    const input: PauseQueueDecisionInput = { entry, probe: probe('failed'), now: NOW, maxProbeFailures: BUDGET };
    expect(decidePauseQueueAction(input)).toEqual(decidePauseQueueAction(input));
  });

  it('does not mutate the input entry', () => {
    const entry = makeEntry({ resetsAt: PAST, probeFailures: 1 });
    const before = structuredClone(entry);
    decide(entry, probe('failed'), NOW);
    expect(entry).toEqual(before);
  });
});

type StrikeVerdict = Extract<ProbeOutcome, 'failed' | 'unknown'>;
type StrikeVerdictCase = [StrikeVerdict, number, 'count_strike' | 'evict', number];
