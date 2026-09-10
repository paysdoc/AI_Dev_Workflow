/**
 * BDD step definitions for feature-823.feature — entry file.
 * Shared state (w823/wcopy), Before/After hooks, and the splitRepo helper.
 * Given/When/Then registrations live in sibling files auto-discovered by the
 * cucumber glob:
 *  - feature-823-assembly.steps.ts   (§1 seam-assembly + §1/§2 assembled-set steps)
 *  - feature-823-probes.steps.ts     (§2/§5 type-probe verdicts)
 *  - feature-823-workspace.steps.ts  (§4 workspace-binding steps)
 *  - feature-823-copyout.steps.ts    (§7 copy-out / extraction-gate steps)
 *
 * forgeProviders() is the library's one way to build a bound provider set —
 * one identity in, every member bound to it, an unknown forge name refused
 * by name, and the launch boundary its only caller.
 *
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

import { Platform, type RepoIdentifier, type BoundProviders, type RepoContext } from '../../../adws/providers/types.ts';

export function splitRepo(repoStr: string): RepoIdentifier {
  const [owner, repo] = repoStr.split('/');
  return { owner, repo, platform: Platform.GitHub };
}

// ---------------------------------------------------------------------------
// Shared state — §1/§4 assembly & workspace-binding scratch
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared state — §7 copy-out scratch
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Before / After — scoped to @adw-823, forcing isolation from every reused
// file's own (differently-tag-scoped) hooks.
// ---------------------------------------------------------------------------

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
