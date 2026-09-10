/**
 * feature-823.feature step definitions — §4 workspace-binding steps over the
 * recording gh seam's own context. Entry file: feature-823.steps.ts (state,
 * Before/After hooks, splitRepo).
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { splitRepo, w823 } from './feature-823.steps.ts';
import { getRecordingSeam } from './feature-819.steps.ts';

import { bindWorkspaceContext } from '../../../adws/core/workspaceBinding.ts';
import type { BoundProviders } from '../../../adws/providers/types.ts';

When('a workspace is bound to that git context for the identity {string}', function (repoStr: string) {
  const identity = splitRepo(repoStr);
  const seam = getRecordingSeam();
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-823-workspace-'));
  mkdirSync(path.join(dir, '.git'));
  w823.tempDirs.push(dir);
  const stubProviders: BoundProviders = {
    issueTracker: {} as BoundProviders['issueTracker'],
    codeHost: {} as BoundProviders['codeHost'],
  };
  w823.boundWorkspace = bindWorkspaceContext(
    { gitContext: seam.ctx, repoId: identity, providers: stubProviders },
    dir,
  );
});

Then('the remote read reached the recording gh seam', function () {
  const seam = getRecordingSeam();
  assert.ok(
    seam.calls.some((c) => c.command.includes('remote get-url')),
    `Expected a "remote get-url" command among: ${seam.calls.map((c) => c.command).join(' | ')}`,
  );
});

Then('the bound workspace carries the identity {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(w823.boundWorkspace, 'Expected a workspace to have been bound');
  assert.strictEqual(w823.boundWorkspace.repoId.owner, owner);
  assert.strictEqual(w823.boundWorkspace.repoId.repo, repo);
});
