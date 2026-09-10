/**
 * BDD step definitions for feature-823.feature
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

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, copyFileSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resetGuardFixtureTree } from './feature-816.steps.ts';
import { resetBoundaryWorld, getCapturedProviders } from './feature-794.steps.ts';
import { getRecordingSeam, resetRecordingSeam } from './feature-819.steps.ts';
import { getTypeProbeResult, resetTypeProbe } from './feature-817.steps.ts';
import { stopRecordingForgeEndpoint, resetRecorder } from './feature-818.steps.ts';

import { forgeProviders } from '../../../adws/providers/forgeProviders.ts';
import { bindWorkspaceContext } from '../../../adws/core/workspaceBinding.ts';
import { Platform, type RepoIdentifier, type BoundProviders, type RepoContext } from '../../../adws/providers/types.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GITCONTEXT_SRC = path.join(REPO_ROOT, 'adws', 'gitContext');
const PROVIDERS_SRC = path.join(REPO_ROOT, 'adws', 'providers');

function splitRepo(repoStr: string): RepoIdentifier {
  const [owner, repo] = repoStr.split('/');
  return { owner, repo, platform: Platform.GitHub };
}

// ---------------------------------------------------------------------------
// §1 — assembling a provider set directly over the recording gh seam
// ---------------------------------------------------------------------------

interface W823 {
  assembleError: Error | null;
  assembledProviders: BoundProviders | null;
  assembleSeamRepoId: RepoIdentifier | null;
  assembleIdentity: RepoIdentifier | null;
  boundWorkspace: RepoContext | null;
  tempDirs: string[];
}

const w823: W823 = {
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

// ---------------------------------------------------------------------------
// §2/§5 — type-probe verdicts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// §4 — workspace binding over the recording gh seam's own context
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// §7 — the extraction gate: both packages copied side by side, imported
// ---------------------------------------------------------------------------

interface Wcopy {
  tempDir: string | null;
  importError: Error | null;
  imported: boolean;
}
const wcopy: Wcopy = { tempDir: null, importError: null, imported: false };

/** Modelled on feature-797.steps.ts's copyDirExcluding — a local copy, since that one is not exported. */
function copyDirEntry(entry: Dirent, src: string, dest: string, excludeDirNames: ReadonlySet<string>): void {
  const srcPath = path.join(src, entry.name);
  const destPath = path.join(dest, entry.name);
  if (entry.isFile()) {
    copyFileSync(srcPath, destPath);
    return;
  }
  if (!entry.isDirectory() || excludeDirNames.has(entry.name)) return;
  copyDirExcluding(srcPath, destPath, excludeDirNames);
}

function copyDirExcluding(src: string, dest: string, excludeDirNames: ReadonlySet<string>): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    copyDirEntry(entry, src, dest, excludeDirNames);
  }
}

function resetWcopy(): void {
  if (wcopy.tempDir) {
    rmSync(wcopy.tempDir, { recursive: true, force: true });
  }
  wcopy.tempDir = null;
  wcopy.importError = null;
  wcopy.imported = false;
}

Given('the git context and provider packages are copied side by side into an empty directory', function () {
  const parent = mkdtempSync(path.join(tmpdir(), 'adw-823-isolated-'));
  wcopy.tempDir = parent;
  copyDirExcluding(GITCONTEXT_SRC, path.join(parent, 'gitContext'), new Set(['__tests__']));
  copyDirExcluding(PROVIDERS_SRC, path.join(parent, 'providers'), new Set(['__tests__']));
});

When('the copied provider package is imported as its own entry point', async function () {
  assert.ok(wcopy.tempDir, 'Expected the packages to have been copied first');
  const entryUrl = pathToFileURL(path.join(wcopy.tempDir, 'providers', 'index.ts')).href;
  try {
    await import(entryUrl);
    wcopy.imported = true;
    wcopy.importError = null;
  } catch (err) {
    wcopy.imported = false;
    wcopy.importError = err as Error;
  }
});

Then('the import of the copied packages succeeds', function () {
  assert.strictEqual(
    wcopy.importError, null,
    `Expected the copied packages to import cleanly, got: ${wcopy.importError?.stack ?? wcopy.importError}`,
  );
  assert.strictEqual(wcopy.imported, true);
});

Then('the copied packages resolved no module outside their own directories', function () {
  assert.strictEqual(wcopy.importError, null, 'Expected no import error (a reach outside the copy would fail to resolve)');
  assert.ok(wcopy.tempDir, 'Expected a temp directory to have been set up');
  const topLevel = readdirSync(wcopy.tempDir).sort();
  assert.deepStrictEqual(
    topLevel, ['gitContext', 'providers'],
    `Expected only the copied packages on disk, found: ${topLevel.join(', ')}`,
  );
});

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
