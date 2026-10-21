/**
 * Novel step definitions for feature-1068.feature. They drive feature-912's in-process wait with an injected
 * event-loop stall or a stopped heartbeat, and read what the hung-orchestrator detector saw at the end of every
 * wait. The hooks that set up and clean up the scenarios are feature-912's, which the feature's
 * `@rate-limit-in-process-wait` tag selects.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';

import {
  TEST_HUNG_THRESHOLD_MS,
  recordedWaits,
  stallBeforeEachProbe,
  stallFromLastHeartbeatTick,
  stopHeartbeatAsFirstWaitBegins,
  type WaitEvent,
} from '../../regression/step_definitions/feature-912.steps.ts';

function requireWaits(): readonly WaitEvent[] {
  const waits = recordedWaits();
  assert.ok(waits.length > 0, 'Expected at least one wait');
  return waits;
}

function lastSeenAtReadByDetector(wait: WaitEvent, adwId: string): number {
  const state = wait.probeState;
  assert.ok(state && state.adwId === adwId, `Expected the detector to have read the state file for adwId ${adwId} in wait ${wait.attempt}`);
  const lastSeenAt = Date.parse(state.lastSeenAt ?? '');
  assert.ok(!Number.isNaN(lastSeenAt), `Expected the state file the detector read in wait ${wait.attempt} to carry a lastSeenAt`);
  return lastSeenAt;
}

Given(
  'the orchestrator\'s event loop stalls, from just after the last heartbeat tick before every wait ends, for longer than the hung-orchestrator detector\'s threshold',
  function () {
    stallFromLastHeartbeatTick(2 * TEST_HUNG_THRESHOLD_MS);
  },
);

Given(
  'the orchestrator\'s event loop stalls for {int} ms just before the hung-orchestrator detector looks at the end of every wait',
  function (ms: number) {
    stallBeforeEachProbe(ms);
  },
);

Given('the orchestrator\'s heartbeat stops as the first wait begins', function () {
  stopHeartbeatAsFirstWaitBegins();
});

Then(
  'at the end of every wait, the hung-orchestrator detector found a lastSeenAt in the state file for adwId {string} that the heartbeat wrote after the stall',
  function (adwId: string) {
    for (const wait of requireWaits()) {
      assert.ok(wait.tickStallEndedAt !== null, `Expected a stall to have ended in wait ${wait.attempt}`);
      const lastSeenAt = lastSeenAtReadByDetector(wait, adwId);
      assert.ok(
        lastSeenAt >= wait.tickStallEndedAt,
        `Expected the lastSeenAt the detector read in wait ${wait.attempt} (${lastSeenAt}) to be no earlier than the end of the stall (${wait.tickStallEndedAt})`,
      );
    }
  },
);

Then(
  'at the end of every wait, the hung-orchestrator detector found lastSeenAt in the state file for adwId {string} at least {int} ms old',
  function (adwId: string, minimumAgeMs: number) {
    for (const wait of requireWaits()) {
      const ageMs = wait.probeNow - lastSeenAtReadByDetector(wait, adwId);
      assert.ok(ageMs >= minimumAgeMs, `Expected the lastSeenAt the detector read in wait ${wait.attempt} to be at least ${minimumAgeMs} ms old, but it was ${ageMs} ms old`);
    }
  },
);

Then('the hung-orchestrator detector reported adwId {string} at the end of every wait', function (adwId: string) {
  for (const wait of requireWaits()) {
    assert.ok(wait.hungAtEnd.some(hung => hung.adwId === adwId), `Expected adwId ${adwId} reported hung at the end of wait ${wait.attempt}`);
  }
});
