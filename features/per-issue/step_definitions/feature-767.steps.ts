/**
 * BDD step definitions for feature-767.feature
 * BDD mock harness: writable git-mock scratch dir + crash-safe setup/teardown.
 *
 * Self-contained: its own @adw-767-scoped Before/After and module-private ctx.
 * Does NOT redefine "the ADW codebase is checked out" (ensureCronOnEveryEventSteps.ts,
 * registry G18) or "the ADW TypeScript type-check passes" (feature-504.steps.ts,
 * registry T22) — both already registered globally.
 *
 * Design:
 *  - §1/§2 drive the REAL setupMockInfrastructure/teardownMockInfrastructure
 *    in-process. §1 has no failure injection — it distinguishes "wrapper dir
 *    inside cwd" (pre-fix) from "wrapper dir under os.tmpdir()" (post-fix)
 *    directly from the PATH env var the harness mutates. §2 additionally
 *    chdir's the whole process into a chmod'd-read-only directory to model
 *    the Docker `:ro` mount, then asserts setup does not throw.
 *  - §3/§4 force createGitMockDir to fail AFTER the mock server has started by
 *    pointing TMPDIR at a directory made read-only (chmod 0o555) — this fails
 *    regardless of whether Bug 1 is fixed (mkdtemp under os.tmpdir() still
 *    lands inside the forced-read-only base), so these two scenarios pin Bug 2
 *    specifically. §3 asserts the mock server socket in-process; §4 spawns a
 *    REAL child process (bun) that sets up, fails, tears down, and lets main()
 *    return WITHOUT calling process.exit — a leaked server is what would keep
 *    such a process alive, which is exactly the 6-hour production hang.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { MockContext } from '../../../test/mocks/types.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

interface StepContext {
  mockContext: MockContext | null;
  setupError: Error | null;
  originalCwd: string | null;
  readOnlyCwdDir: string | null;
  forcedTmpdir: string | null;
  realTmpdirBase: string;
  tmpdirWasForced: boolean;
  originalTmpdirEnv: string | undefined;
  fixedPort: number;
  childScratchDir: string | null;
  childTerminatedOnOwn: boolean | null;
  childOutput: string;
}

const ctx: StepContext = {
  mockContext: null,
  setupError: null,
  originalCwd: null,
  readOnlyCwdDir: null,
  forcedTmpdir: null,
  realTmpdirBase: os.tmpdir(),
  tmpdirWasForced: false,
  originalTmpdirEnv: undefined,
  fixedPort: 0,
  childScratchDir: null,
  childTerminatedOnOwn: null,
  childOutput: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The first PATH entry — the directory the harness prepends on setup. */
function firstPathSegment(): string {
  return (process.env['PATH'] ?? '').split(path.delimiter)[0] ?? '';
}

/** Source for the §4 child process: sets up, fails, tears down, never exits explicitly. */
function buildChildMainSource(harnessPath: string, port: number): string {
  return [
    `import { setupMockInfrastructure, teardownMockInfrastructure } from ${JSON.stringify(harnessPath)};`,
    '',
    'async function main() {',
    '  try {',
    `    await setupMockInfrastructure({ port: ${port} });`,
    '  } catch {',
    '    // Expected: the injected failure. The point of this scenario is what',
    '    // happens next (does the process hang?), not whether setup succeeds.',
    '  }',
    '  await teardownMockInfrastructure();',
    "  console.log('ADW_767_CHILD_DONE');",
    '  // Deliberately no process.exit() — a leaked open handle must be what',
    '  // keeps this process alive, exactly like the real regression job.',
    '}',
    '',
    'main();',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Before / After — tag-scoped: cwd, TMPDIR, and PATH are process-wide state,
// so an unscoped hook would leak into every other scenario in the suite.
// ---------------------------------------------------------------------------

Before({ tags: '@adw-767' }, function () {
  ctx.mockContext = null;
  ctx.setupError = null;
  ctx.originalCwd = null;
  ctx.readOnlyCwdDir = null;
  ctx.forcedTmpdir = null;
  ctx.realTmpdirBase = os.tmpdir();
  ctx.tmpdirWasForced = false;
  ctx.originalTmpdirEnv = undefined;
  ctx.fixedPort = 40000 + Math.floor(Math.random() * 20000);
  ctx.childScratchDir = null;
  ctx.childTerminatedOnOwn = null;
  ctx.childOutput = '';
});

After({ tags: '@adw-767' }, async function () {
  try {
    await teardownMockInfrastructure();
  } catch {
    // best-effort — restoration below must still run regardless
  }

  if (ctx.readOnlyCwdDir) {
    if (ctx.originalCwd) process.chdir(ctx.originalCwd);
    fs.chmodSync(ctx.readOnlyCwdDir, 0o755);
    fs.rmSync(ctx.readOnlyCwdDir, { recursive: true, force: true });
  }

  if (ctx.tmpdirWasForced) {
    if (ctx.originalTmpdirEnv === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = ctx.originalTmpdirEnv;
  }
  if (ctx.forcedTmpdir) {
    fs.chmodSync(ctx.forcedTmpdir, 0o755);
    fs.rmSync(ctx.forcedTmpdir, { recursive: true, force: true });
  }

  if (ctx.childScratchDir) {
    fs.rmSync(ctx.childScratchDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('the working directory is a read-only mount', function () {
  ctx.originalCwd = process.cwd();
  ctx.readOnlyCwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-767-ro-cwd-'));
  fs.chmodSync(ctx.readOnlyCwdDir, 0o555);
  process.chdir(ctx.readOnlyCwdDir);
});

Given('creating the git wrapper directory will fail after the mock server has started', function () {
  // Captured before mutating TMPDIR below — os.tmpdir() reads TMPDIR live, so
  // anything this file itself needs to create later (e.g. §4's child scratch
  // dir) must anchor to this real base, not to os.tmpdir() at call time.
  ctx.forcedTmpdir = fs.mkdtempSync(path.join(ctx.realTmpdirBase, 'adw-767-forced-tmp-'));
  fs.chmodSync(ctx.forcedTmpdir, 0o555);
  ctx.originalTmpdirEnv = process.env['TMPDIR'];
  ctx.tmpdirWasForced = true;
  process.env['TMPDIR'] = ctx.forcedTmpdir;
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('the ADW mock infrastructure is set up', async function () {
  ctx.setupError = null;
  try {
    ctx.mockContext = await setupMockInfrastructure();
  } catch (err) {
    ctx.setupError = err as Error;
    ctx.mockContext = null;
  }
});

When('the ADW mock infrastructure setup is attempted and fails', async function () {
  ctx.setupError = null;
  try {
    ctx.mockContext = await setupMockInfrastructure({ port: ctx.fixedPort });
  } catch (err) {
    ctx.setupError = err as Error;
    ctx.mockContext = null;
  }
  assert.ok(
    ctx.setupError,
    'Expected the injected failure to make setup throw — the test fixture itself did not reproduce the failure',
  );
});

// Step-level timeout raised above the internal TIMEOUT_MS below (Cucumber's
// 5s default would otherwise abort this step first, orphaning the spawned
// child before our own SIGKILL cleanup ever ran).
When('a process sets up and then tears down the mock infrastructure across the failure', { timeout: 15_000 }, async function () {
  ctx.childScratchDir = fs.mkdtempSync(path.join(ctx.realTmpdirBase, 'adw-767-child-'));
  const childScriptPath = path.join(ctx.childScratchDir, 'main.ts');
  const harnessPath = path.join(REPO_ROOT, 'test', 'mocks', 'test-harness.ts');
  fs.writeFileSync(childScriptPath, buildChildMainSource(harnessPath, ctx.fixedPort), 'utf-8');

  const child = spawn('bun', [childScriptPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, TMPDIR: ctx.forcedTmpdir ?? process.env['TMPDIR'] },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

  const TIMEOUT_MS = 10_000;
  const exited = await Promise.race([
    new Promise<boolean>((resolvePromise) => {
      child.on('exit', () => resolvePromise(true));
    }),
    new Promise<boolean>((resolvePromise) => {
      setTimeout(() => resolvePromise(false), TIMEOUT_MS);
    }),
  ]);

  if (!exited) {
    child.kill('SIGKILL');
  }
  ctx.childTerminatedOnOwn = exited;
  ctx.childOutput = output;
});

// ---------------------------------------------------------------------------
// Then / And (teardown action registered as When — same registry as Then)
// ---------------------------------------------------------------------------

When('the ADW mock infrastructure is torn down', async function () {
  await teardownMockInfrastructure();
  ctx.mockContext = null;
});

Then('the mock git wrapper it installs on PATH resides outside the working tree', function () {
  assert.ok(ctx.mockContext, `Expected setup to succeed; it threw: ${ctx.setupError?.stack ?? ctx.setupError}`);
  const mockDir = firstPathSegment();
  assert.ok(mockDir, 'Expected PATH to carry a first segment for the mock git wrapper dir');
  const cwd = process.cwd();
  assert.ok(
    mockDir !== cwd && !mockDir.startsWith(cwd + path.sep),
    `Expected the mock git wrapper dir "${mockDir}" to be outside the working tree "${cwd}"`,
  );
});

Then('the mock git wrapper directory is writable', function () {
  const mockDir = firstPathSegment();
  assert.doesNotThrow(
    () => fs.accessSync(mockDir, fs.constants.W_OK),
    `Expected the mock git wrapper dir "${mockDir}" to be writable`,
  );
});

Then('the mock infrastructure setup completes without a read-only-filesystem error', function () {
  assert.strictEqual(
    ctx.setupError,
    null,
    `Expected setup to succeed on a read-only working directory; it threw: ${ctx.setupError?.stack ?? ctx.setupError}`,
  );
  assert.ok(ctx.mockContext, 'Expected a MockContext to be returned from a successful setup');
});

Then('no mock server is left listening on the port the setup opened', async function () {
  const stillListening = await fetch(`http://localhost:${ctx.fixedPort}/`).then(() => true).catch(() => false);
  assert.strictEqual(stillListening, false, `Expected no server listening on port ${ctx.fixedPort} after teardown`);
});

Then('the process terminates on its own instead of hanging', function () {
  assert.strictEqual(
    ctx.childTerminatedOnOwn,
    true,
    `Expected the child process to exit on its own within the timeout window; captured output:\n${ctx.childOutput}`,
  );
  assert.ok(
    ctx.childOutput.includes('ADW_767_CHILD_DONE'),
    `Expected the child process to run to completion; captured output:\n${ctx.childOutput}`,
  );
});
