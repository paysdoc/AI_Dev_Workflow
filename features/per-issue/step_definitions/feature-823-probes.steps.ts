/**
 * feature-823.feature step definitions — §2/§5 type-probe verdicts. Entry
 * file: feature-823.steps.ts (state, Before/After hooks, splitRepo).
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { getTypeProbeResult } from './feature-817.steps.ts';

Then('the type probe fails to compile rejecting the forge name {string}', function (forgeName: string) {
  const { exitCode, stdout } = getTypeProbeResult();
  assert.notStrictEqual(exitCode, 0, `Expected the type probe to fail to compile. Output:\n${stdout}`);
  assert.ok(
    stdout.includes('probe.ts('),
    `Expected a diagnostic naming the probe file. Output:\n${stdout}`,
  );
  assert.ok(
    stdout.includes(`"${forgeName}"`),
    `Expected a diagnostic naming the forge "${forgeName}". Output:\n${stdout}`,
  );
});

Then('the type probe fails to compile reporting the unresolvable module {string}', function (specifier: string) {
  const { exitCode, stdout } = getTypeProbeResult();
  assert.notStrictEqual(exitCode, 0, `Expected the type probe to fail to compile. Output:\n${stdout}`);
  assert.ok(
    stdout.includes(`Cannot find module '${specifier}'`),
    `Expected a diagnostic naming the unresolvable module "${specifier}". Output:\n${stdout}`,
  );
});
