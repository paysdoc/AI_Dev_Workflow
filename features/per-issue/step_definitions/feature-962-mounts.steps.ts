/**
 * Scenarios of feature-962.feature, the Then steps about the container the docker job starts. They
 * read every `docker run` the stand-in recorded for the docker job, of which there must be at least
 * one, and check the mounts it was given. Nothing here reads `test/docker-run.sh`.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { describeRun } from './feature-939-report.ts';
import { readDockerCalls, type DockerCall, type DockerMount } from './feature-962-docker.ts';
import { jobOf } from './feature-962-jobs.ts';
import {
  describeMount, isAnonymousVolumeOver, isOtherWritableMountUnder, isWritableBindOfCheckout, mountsCheckoutReadOnlyAt,
} from './feature-962-mounts.ts';
import { finishedRun } from './feature-962-world.ts';

interface ContainerRuns {
  readonly calls: readonly DockerCall[];
  readonly checkoutDir: string;
}

const mountsOf = (call: DockerCall): readonly DockerMount[] => call.mounts ?? [];

function describeCall(call: DockerCall): string {
  return [`docker ${call.args.join(' ')}`, ...mountsOf(call).map(mount => `  ${describeMount(mount)}`)].join('\n');
}

function dockerRuns(): ContainerRuns {
  const run = finishedRun();
  const job = jobOf('docker');
  const sandbox = run.sandboxes.get('docker');
  if (sandbox === undefined) assert.fail(`Expected the docker job to start a container, but it concluded with ${job.conclusion}.\n${describeRun(run.result)}`);

  const calls = readDockerCalls(sandbox.callsPath).filter(call => call.args[0] === 'run');
  assert.ok(calls.length > 0, `Expected the docker job to make a docker run, but it made none.\n${describeRun(run.result)}`);
  return { calls, checkoutDir: sandbox.checkoutDir };
}

/** Every `docker run` the docker job made has no mount that the check rejects. */
function assertNoRunHas(expectation: string, isViolation: (mount: DockerMount, checkoutDir: string) => boolean): void {
  const { calls, checkoutDir } = dockerRuns();
  const violating = calls.filter(call => mountsOf(call).some(mount => isViolation(mount, checkoutDir)));
  assert.deepStrictEqual(violating.map(describeCall), [], `Expected ${expectation}. The docker run calls that fail it:`);
}

Then('the docker job starts its container with the checkout mounted read-only at {string}', function (target: string) {
  const { calls, checkoutDir } = dockerRuns();
  const without = calls.filter(call => !mountsOf(call).some(mount => mountsCheckoutReadOnlyAt(mount, checkoutDir, target)));
  assert.deepStrictEqual(
    without.map(describeCall),
    [],
    `Expected every docker run of the docker job to mount the checkout (${checkoutDir}) read-only at ${target}. The calls that do not:`,
  );
});

Then('the docker job starts its container with an anonymous volume over {string}', function (target: string) {
  const { calls } = dockerRuns();
  const without = calls.filter(call => !mountsOf(call).some(mount => isAnonymousVolumeOver(mount, target)));
  assert.deepStrictEqual(without.map(describeCall), [], `Expected every docker run of the docker job to give its container an anonymous volume over ${target}. The calls that do not:`);
});

Then('no other mount the docker job gives its container under {string} is writable', function (root: string) {
  assertNoRunHas(
    `no mount under ${root} to be writable, apart from the anonymous volume over ${root}/node_modules`,
    mount => isOtherWritableMountUnder(mount, root, `${root}/node_modules`),
  );
});

Then('the docker job gives its container no writable mount of the checkout or of anything inside it', function () {
  assertNoRunHas('no writable bind mount of the checkout or of anything inside it', isWritableBindOfCheckout);
});
