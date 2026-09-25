import { describe, it, expect } from 'vitest';
import {
  decideRateLimitWait,
  sleepUntil,
  hasResetTime,
  RateLimitType,
  MIN_RATE_LIMIT_WAIT_MS,
  type WaitClock,
} from '../rateLimitWaitPolicy';
import { RateLimitError, type RateLimitFacts } from '../../types/agentTypes';
import { INCIDENT_RESETS_AT, INCIDENT_RATE_LIMIT_TYPE } from './fixtures/rateLimitIncident';

const NOW = new Date('2026-09-22T11:57:00Z');

describe('decideRateLimitWait', () => {
  it('waits in-process until the exact reset instant for a five_hour limit at the incident time', () => {
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt: INCIDENT_RESETS_AT }, NOW);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date('2026-09-22T12:50:00.000Z') });
  });

  it('waits until exactly one second ahead of the clock, adding no margin', () => {
    const resetsAt = Math.floor(new Date('2026-09-22T12:50:00Z').getTime() / 1000);
    const now = new Date('2026-09-22T12:49:59Z');
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, now);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date('2026-09-22T12:50:00.000Z') });
  });

  it('waits until exactly ten seconds ahead of the clock, adding no margin', () => {
    const resetsAt = Math.floor(new Date('2026-09-22T12:50:00Z').getTime() / 1000);
    const now = new Date('2026-09-22T12:49:50Z');
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, now);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date('2026-09-22T12:50:00.000Z') });
  });

  it('applies the floor when the reset time is exactly at the clock', () => {
    const resetsAt = Math.floor(NOW.getTime() / 1000);
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, NOW);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date(NOW.getTime() + MIN_RATE_LIMIT_WAIT_MS) });
  });

  it('applies the floor when the reset time is a second behind the clock', () => {
    const resetsAt = Math.floor(NOW.getTime() / 1000) - 1;
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, NOW);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date(NOW.getTime() + MIN_RATE_LIMIT_WAIT_MS) });
  });

  it('waits until exactly a full five-hour window ahead, with no ceiling', () => {
    const now = new Date('2026-09-22T12:50:00Z');
    const resetsAt = Math.floor(new Date('2026-09-22T17:50:00Z').getTime() / 1000);
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, now);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date('2026-09-22T17:50:00.000Z') });
  });

  it('waits until a reset time far beyond a five-hour window (7 hours ahead), with no ceiling', () => {
    const now = new Date('2026-09-22T11:57:00Z');
    const resetsAt = Math.floor(new Date('2026-09-22T18:57:00Z').getTime() / 1000);
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, now);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date('2026-09-22T18:57:00.000Z') });
  });

  it('waits until a reset time far beyond a five-hour window (3 days ahead), with no ceiling', () => {
    const now = new Date('2026-09-22T11:57:00Z');
    const resetsAt = Math.floor(new Date('2026-09-25T11:57:00Z').getTime() / 1000);
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, now);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date('2026-09-25T11:57:00.000Z') });
  });

  it('enqueues a five_hour limit with no resetsAt key at all', () => {
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour' }, NOW);
    expect(decision).toEqual({ kind: 'enqueue' });
    expect(decision).not.toHaveProperty('resetsAt');
  });

  it('enqueues a five_hour limit whose resetsAt is NaN', () => {
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt: NaN }, NOW);
    expect(decision).toEqual({ kind: 'enqueue' });
  });

  it('enqueues a five_hour limit whose resetsAt is Infinity', () => {
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt: Infinity }, NOW);
    expect(decision).toEqual({ kind: 'enqueue' });
  });

  it('enqueues a seven_day limit, carrying its reset time', () => {
    const decision = decideRateLimitWait({ rateLimitType: 'seven_day', resetsAt: INCIDENT_RESETS_AT }, NOW);
    expect(decision).toEqual({ kind: 'enqueue', resetsAt: INCIDENT_RESETS_AT });
  });

  it('enqueues an unknown limit type, carrying its reset time', () => {
    const decision = decideRateLimitWait({ rateLimitType: 'weekly', resetsAt: INCIDENT_RESETS_AT }, NOW);
    expect(decision).toEqual({ kind: 'enqueue', resetsAt: INCIDENT_RESETS_AT });
  });

  it('enqueues an unknown limit type with no reset time, bare', () => {
    const decision = decideRateLimitWait({ rateLimitType: 'weekly' }, NOW);
    expect(decision).toEqual({ kind: 'enqueue' });
  });

  it('enqueues no facts at all (an overload or server error), bare', () => {
    const decision = decideRateLimitWait({}, NOW);
    expect(decision).toEqual({ kind: 'enqueue' });
  });

  it('waits in-process for a RateLimitError passed directly as the facts (structural typing)', () => {
    const err = new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });
    const decision = decideRateLimitWait(err, NOW);
    expect(decision.kind).toBe('wait_in_process');
  });

  it('honours a custom minWaitMs for a stale reset time', () => {
    const resetsAt = Math.floor(NOW.getTime() / 1000) - 100;
    const decision = decideRateLimitWait({ rateLimitType: 'five_hour', resetsAt }, NOW, 5_000);
    expect(decision).toEqual({ kind: 'wait_in_process', until: new Date(NOW.getTime() + 5_000) });
  });

  it('is pure: identical inputs give equal decisions and never mutate the input facts', () => {
    const facts: RateLimitFacts = { rateLimitType: 'five_hour', resetsAt: INCIDENT_RESETS_AT };
    const snapshot = { ...facts };
    const first = decideRateLimitWait(facts, NOW);
    const second = decideRateLimitWait(facts, NOW);
    expect(first).toEqual(second);
    expect(facts).toEqual(snapshot);
  });
});

describe('hasResetTime', () => {
  it('is true for a finite resetsAt', () => {
    expect(hasResetTime({ resetsAt: INCIDENT_RESETS_AT })).toBe(true);
  });

  it('is false for an absent, NaN or Infinite resetsAt', () => {
    expect(hasResetTime({})).toBe(false);
    expect(hasResetTime({ resetsAt: NaN })).toBe(false);
    expect(hasResetTime({ resetsAt: Infinity })).toBe(false);
  });
});

describe('RateLimitType', () => {
  it('names the CLI values the policy compares against', () => {
    expect(RateLimitType.FiveHour).toBe('five_hour');
    expect(RateLimitType.SevenDay).toBe('seven_day');
  });
});

function makeVirtualClock(startMs: number): { clock: WaitClock; calls: number[] } {
  let t = startMs;
  const calls: number[] = [];
  const clock: WaitClock = {
    now: () => new Date(t),
    sleep: async (ms: number) => {
      calls.push(ms);
      t += ms;
    },
  };
  return { clock, calls };
}

describe('sleepUntil', () => {
  it('slices a long wait into 60s chunks and ends exactly at the target instant', async () => {
    const start = NOW.getTime();
    const until = new Date(start + 3 * 60 * 60 * 1000 + 20 * 60 * 1000); // 3h20m ahead
    const { clock, calls } = makeVirtualClock(start);

    await sleepUntil(clock, until, 60_000);

    expect(calls).toHaveLength(200);
    expect(calls.every(ms => ms === 60_000)).toBe(true);
    expect(clock.now().getTime()).toBe(until.getTime());
  });

  it('sleeps exactly once for the remainder when it is smaller than the slice', async () => {
    const start = NOW.getTime();
    const until = new Date(start + 15_000);
    const { clock, calls } = makeVirtualClock(start);

    await sleepUntil(clock, until, 60_000);

    expect(calls).toEqual([15_000]);
    expect(clock.now().getTime()).toBe(until.getTime());
  });

  it('sleeps zero times when the target instant is already past', async () => {
    const start = NOW.getTime();
    const until = new Date(start - 1_000);
    const { clock, calls } = makeVirtualClock(start);

    await sleepUntil(clock, until, 60_000);

    expect(calls).toEqual([]);
  });

  it('stops after exactly one sleep when the clock jumps past the target mid-sleep', async () => {
    const start = NOW.getTime();
    const until = new Date(start + 30_000);
    let t = start;
    const calls: number[] = [];
    const jumpingClock: WaitClock = {
      now: () => new Date(t),
      sleep: async (ms: number) => {
        calls.push(ms);
        t += ms + 60 * 60 * 1000; // the fake adds an extra hour on top of the requested sleep
      },
    };

    await sleepUntil(jumpingClock, until, 60_000);

    expect(calls).toHaveLength(1);
  });

  it('clamps a zero or negative maxSliceMs to 1ms rather than looping forever', async () => {
    const start = NOW.getTime();
    const until = new Date(start + 3);
    const { clock, calls } = makeVirtualClock(start);

    await sleepUntil(clock, until, 0);

    expect(calls).toEqual([1, 1, 1]);
  });
});
