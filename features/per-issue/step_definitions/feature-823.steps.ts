/**
 * Reuses five existing harnesses verbatim, never redefining their phrases:
 * the guard fixture tree (feature-816.steps.ts), the type-probe harness
 * (feature-817.steps.ts), the launch-boundary world (feature-794.steps.ts),
 * the recording gh seam (feature-819.steps.ts), and the recording forge
 * endpoint plus the "ADW's provider wiring resolves …" drivers
 * (feature-818.steps.ts). These rows carry only `@adw-823`, so none of those
 * files' own (tag-scoped) Before/After hooks run for them — this file forces
 * isolation from its own hooks instead, calling the small reset/accessor
 * exports each of those files added for exactly this reuse.
 */

import { Before, After } from '@cucumber/cucumber';
import { rmSync } from 'node:fs';

import { resetGuardFixtureTree } from './feature-816.steps.ts';
import { resetBoundaryWorld } from './feature-794.steps.ts';
import { resetRecordingSeam } from './feature-819.steps.ts';
import { resetTypeProbe } from './feature-817.steps.ts';
import { stopRecordingForgeEndpoint, resetRecorder } from './feature-818.steps.ts';

import { Platform, type RepoIdentifier, type BoundProviders, type RepoContext } from '@paysdoc/devplatform';

export function splitRepo(repoStr: string): RepoIdentifier {
  const [owner, repo] = repoStr.split('/');
  return { owner, repo, platform: Platform.GitHub };
}

export interface W823 {
  assembleError: Error | null;
  assembledProviders: BoundProviders | null;
  assembleSeamRepoId: RepoIdentifier | null;
  assembleIdentity: RepoIdentifier | null;
  boundWorkspace: RepoContext | null;
  tempDirs: string[];
}

export const w823: W823 = {
  assembleError: null,
  assembledProviders: null,
  assembleSeamRepoId: null,
  assembleIdentity: null,
  boundWorkspace: null,
  tempDirs: [],
};

function resetW823(): void {
  w823.assembleError = null;
  w823.assembledProviders = null;
  w823.assembleSeamRepoId = null;
  w823.assembleIdentity = null;
  w823.boundWorkspace = null;
  for (const dir of w823.tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  w823.tempDirs = [];
}

export interface Wcopy {
  tempDir: string | null;
  importError: Error | null;
  imported: boolean;
}

export const wcopy: Wcopy = { tempDir: null, importError: null, imported: false };

function resetWcopy(): void {
  if (wcopy.tempDir) {
    rmSync(wcopy.tempDir, { recursive: true, force: true });
  }
  wcopy.tempDir = null;
  wcopy.importError = null;
  wcopy.imported = false;
}

Before({ tags: '@adw-823' }, async function () {
  resetGuardFixtureTree();
  resetBoundaryWorld();
  resetRecordingSeam();
  resetTypeProbe();
  await stopRecordingForgeEndpoint();
  await resetRecorder();
  resetW823();
  resetWcopy();
});

After({ tags: '@adw-823' }, async function () {
  resetGuardFixtureTree();
  resetBoundaryWorld();
  resetRecordingSeam();
  resetTypeProbe();
  await stopRecordingForgeEndpoint();
  await resetRecorder();
  resetW823();
  resetWcopy();
});
