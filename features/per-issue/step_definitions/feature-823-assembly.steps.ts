/**
 * feature-823.feature step definitions — §1 seam-assembly steps and the
 * §1/§2 assembled-set checks. Entry file: feature-823.steps.ts (state,
 * Before/After hooks, splitRepo).
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { splitRepo, w823 } from './feature-823.steps.ts';
import { getRecordingSeam } from './feature-819.steps.ts';
import { getCapturedProviders } from './feature-794.steps.ts';

import { forgeProviders } from '../../../adws/providers/forgeProviders.ts';

// ---------------------------------------------------------------------------
// §1 — assembling a provider set directly over the recording gh seam
// ---------------------------------------------------------------------------

When(
  'a provider set is assembled for the identity {string} over that git context and any failure is captured',
  function (repoStr: string) {
    const identity = splitRepo(repoStr);
    const seam = getRecordingSeam();
    w823.assembleSeamRepoId = seam.repoId;
    w823.assembleIdentity = identity;
    w823.assembleError = null;
    w823.assembledProviders = null;
    try {
      w823.assembledProviders = forgeProviders({
        forge: { codeHost: 'github', issueTracker: 'github' },
        identity,
        tokenProvider: seam.tokenProvider,
        gitContext: seam.ctx,
      });
    } catch (err) {
      w823.assembleError = err instanceof Error ? err : new Error(String(err));
    }
  },
);

Then('assembling the provider set failed naming both repositories', function () {
  assert.ok(w823.assembleError, 'Expected assembling the provider set to fail');
  assert.ok(w823.assembleSeamRepoId, 'Expected a recording gh seam to have been set up');
  assert.ok(w823.assembleIdentity, 'Expected the assembly to have been attempted');
  const seamRepo = `${w823.assembleSeamRepoId.owner}/${w823.assembleSeamRepoId.repo}`;
  const identityRepo = `${w823.assembleIdentity.owner}/${w823.assembleIdentity.repo}`;
  assert.ok(
    w823.assembleError.message.includes(seamRepo),
    `Expected the error to name "${seamRepo}", got: ${w823.assembleError.message}`,
  );
  assert.ok(
    w823.assembleError.message.includes(identityRepo),
    `Expected the error to name "${identityRepo}", got: ${w823.assembleError.message}`,
  );
});

Then('no provider was returned from the assembly', function () {
  assert.strictEqual(w823.assembledProviders, null, 'Expected no provider set to have been returned');
});

Then('the recording gh seam recorded no command', function () {
  const seam = getRecordingSeam();
  assert.strictEqual(
    seam.calls.length, 0,
    `Expected no recorded commands, got: ${seam.calls.map((c) => c.command).join(' | ')}`,
  );
});

// ---------------------------------------------------------------------------
// §1/§2 — the boundary's assembled set, over feature-794's captured providers
// ---------------------------------------------------------------------------

Then('the assembled set carries no board manager', function () {
  const providers = getCapturedProviders();
  assert.ok(providers, 'Expected a captured provider set');
  assert.strictEqual(providers.boardManager, undefined, 'Expected no board manager on the assembled set');
});

Then('the assembled set carries an issue tracker and a code host', function () {
  const providers = getCapturedProviders();
  assert.ok(providers, 'Expected a captured provider set');
  assert.ok(providers.issueTracker, 'Expected an issue tracker');
  assert.ok(providers.codeHost, 'Expected a code host');
});
