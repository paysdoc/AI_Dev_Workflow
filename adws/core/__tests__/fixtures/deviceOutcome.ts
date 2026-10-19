/**
 * Reads the outcome of `withDevices` for a test that expects one kind of it. No vitest import: any test may use it.
 */

import type { DeviceFailure, DeviceOutcome } from '../../deviceLifecycle';

/** The result of a `ready` outcome; any other outcome fails the test. */
export function resultOf<T>(outcome: DeviceOutcome<T>): T {
  if (outcome.kind !== 'ready') throw new Error(`withDevices came back ${outcome.kind}, not ready: ${outcome.output}`);
  return outcome.result;
}

/** The failure of an outcome that is not `ready`; a `ready` outcome fails the test. */
export function failureOf<T>(outcome: DeviceOutcome<T>): DeviceFailure {
  if (outcome.kind === 'ready') throw new Error('withDevices came back ready: it should have come back with a failure');
  return outcome;
}
