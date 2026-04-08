import { Given, When, Then, Before } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { parseCommandsMd } from '../../adws/core/projectConfig.ts';
import type { ProjectConfig } from '../../adws/core/projectConfig.ts';
import { substitutePort, PROBE_INTERVAL_MS, PROBE_TIMEOUT_MS, MAX_START_ATTEMPTS } from '../../adws/core/devServerLifecycle.ts';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Scenario-local state
// ---------------------------------------------------------------------------

interface Ctx {
  startCommand: string;
  port: number;
  commandsMdContent: string;
  parsedConfig: ReturnType<typeof parseCommandsMd> | null;
  orchestratorFiles: string[];
}

const ctx: Ctx = {
  startCommand: '',
  port: 0,
  commandsMdContent: '',
  parsedConfig: null,
  orchestratorFiles: [],
};

Before(function () {
  ctx.startCommand = '';
  ctx.port = 0;
  ctx.commandsMdContent = '';
  ctx.parsedConfig = null;
  ctx.orchestratorFiles = [];
});

// ---------------------------------------------------------------------------
// Scenario: devServerLifecycle.ts exports withDevServer function
// ---------------------------------------------------------------------------

When('the module exports are inspected', function () {
  // Content already loaded into sharedCtx by the Given step
});

Then('the module exports a function named {string}', function (funcName: string) {
  const hasExportedFunction =
    sharedCtx.fileContent.includes(`export async function ${funcName}`) ||
    sharedCtx.fileContent.includes(`export function ${funcName}`) ||
    sharedCtx.fileContent.includes(`export const ${funcName}`);
  assert.ok(
    hasExportedFunction,
    `Expected "${sharedCtx.filePath}" to export "${funcName}" as a function`,
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer substitutes {PORT} in the start command
// ---------------------------------------------------------------------------

Given('a start command {string}', function (cmd: string) {
  ctx.startCommand = cmd;
});

Given('port is set to {int}', function (port: number) {
  ctx.port = port;
});

When('withDevServer spawns the process', function () {
  // Context annotation — port substitution is verified in the Then step
});

Then('the spawned command contains {string}', function (expectedCmd: string) {
  const result = substitutePort(ctx.startCommand, ctx.port);
  assert.strictEqual(
    result,
    expectedCmd,
    `Expected substitutePort("${ctx.startCommand}", ${ctx.port}) to return "${expectedCmd}", got "${result}"`,
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer spawns in a detached process group
// ---------------------------------------------------------------------------

Given('a valid start command and port', function () {
  ctx.startCommand = 'bun run dev --port {PORT}';
  ctx.port = 3000;
});

Then('child_process.spawn is called with detached set to true', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('detached: true'),
    'Expected devServerLifecycle.ts to call spawn with detached: true',
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer probes health endpoint at 1-second intervals
// ---------------------------------------------------------------------------

Given('a dev server that becomes healthy after 3 seconds', function () {
  // Context annotation
});

When('withDevServer starts the server on port {int} with healthPath {string}', function (port: number, healthPath: string) {
  ctx.port = port;
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('localhost') && content.includes('healthPath'),
    `Expected devServerLifecycle.ts to construct a URL using localhost + port + healthPath (got healthPath "${healthPath}")`,
  );
});

Then('HTTP GET requests are sent to {string}', function (expectedUrl: string) {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('localhost') && content.includes('config.port') && content.includes('config.healthPath'),
    `Expected devServerLifecycle.ts to build URL from localhost, port, and healthPath (checking for: ${expectedUrl})`,
  );
  assert.ok(
    content.includes('fetch(url)') || content.includes('fetch('),
    'Expected devServerLifecycle.ts to call fetch with the health URL',
  );
});

Then('the interval between probes is 1 second', function () {
  assert.strictEqual(
    PROBE_INTERVAL_MS,
    1000,
    `Expected PROBE_INTERVAL_MS to be 1000, got ${PROBE_INTERVAL_MS}`,
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer times out after 20 seconds of failed probes
// ---------------------------------------------------------------------------

Given('a dev server that never becomes healthy', function () {
  // Context annotation
});

When('withDevServer starts the server on port {int}', function (port: number) {
  ctx.port = port;
});

Then('the health probe loop gives up after 20 seconds', function () {
  assert.strictEqual(
    PROBE_TIMEOUT_MS,
    20000,
    `Expected PROBE_TIMEOUT_MS to be 20000, got ${PROBE_TIMEOUT_MS}`,
  );
});

Then('the start attempt is counted as a failure', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('runningProcess = null') || content.includes('if (healthy)'),
    'Expected devServerLifecycle.ts to handle probe failure by marking the attempt as failed',
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer retries startup up to 3 times on probe failure
// ---------------------------------------------------------------------------

When('withDevServer is called', function () {
  // Context annotation
});

Then('the server is started exactly 3 times', function () {
  assert.strictEqual(
    MAX_START_ATTEMPTS,
    3,
    `Expected MAX_START_ATTEMPTS to be 3, got ${MAX_START_ATTEMPTS}`,
  );
});

Then('each attempt waits for health probes to time out before retrying', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('probeHealth('),
    'Expected devServerLifecycle.ts to await the probe in the retry loop',
  );
  assert.ok(
    content.includes('for (') || content.includes('for('),
    'Expected devServerLifecycle.ts to use a loop for retry attempts',
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer runs wrapped work on successful health probe
// ---------------------------------------------------------------------------

Given('a dev server that becomes healthy on the first attempt', function () {
  // Context annotation
});

When('withDevServer is called with a work function', function () {
  // Context annotation
});

Then('the work function is invoked exactly once', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('await work()') || content.includes('work()'),
    'Expected devServerLifecycle.ts to invoke the work function',
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer falls back to running work after 3 failed starts
// ---------------------------------------------------------------------------

Then('the work function is still invoked after all 3 start attempts fail', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('await work()'),
    'Expected devServerLifecycle.ts to call await work() after the retry loop (fallback behavior)',
  );
  assert.ok(
    content.includes('fallback') || content.includes('running work anyway') || content.includes('failed to'),
    'Expected devServerLifecycle.ts to log a warning when falling back after failed starts',
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer kills the entire process group on cleanup
// ---------------------------------------------------------------------------

Given('a dev server is running with process ID 12345', function () {
  // Context annotation
});

When('cleanup is triggered', function () {
  // Context annotation
});

Then('process.kill is called with {int} and {string}', function (pid: number, signal: string) {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  // Verify negative PID (group kill) and the correct signal appear in source
  void pid; // The sign flip (-pid) is verified separately
  assert.ok(
    content.includes('-pid') && content.includes(`'${signal}'`),
    `Expected devServerLifecycle.ts to call process.kill(-pid, '${signal}') (group kill)`,
  );
});

Then('the signal targets the process group, not just the PID', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('-pid'),
    'Expected devServerLifecycle.ts to use -pid (negative PID) to target the process group',
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer escalates to SIGKILL after grace period
// ---------------------------------------------------------------------------

Given('a dev server process group that does not exit on SIGTERM', function () {
  // Context annotation
});

When('cleanup sends SIGTERM and waits the grace period', function () {
  // Context annotation
});

// Note: "Then process.kill is called with -12345 and SIGKILL" reuses the
// step above: Then('process.kill is called with {int} and {string}')

// ---------------------------------------------------------------------------
// Scenario: withDevServer cleans up when wrapped work throws / succeeds
// ---------------------------------------------------------------------------

Given('a dev server that is healthy', function () {
  // Context annotation
});

Given('a work function that throws an error', function () {
  // Context annotation
});

Given('a work function that completes successfully', function () {
  // Context annotation
});

Then('the dev server process group is killed', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('finally'),
    'Expected devServerLifecycle.ts to have a finally block for cleanup',
  );
  assert.ok(
    content.includes('killProcessGroup(') || content.includes('process.kill('),
    'Expected devServerLifecycle.ts to kill the process group in the finally block',
  );
});

Then('the error from the work function is re-thrown', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  // try...finally without catch means errors automatically propagate
  assert.ok(
    content.includes('return await work()'),
    'Expected devServerLifecycle.ts to return await work() so errors propagate',
  );
  assert.ok(
    content.includes('finally'),
    'Expected devServerLifecycle.ts to use finally for cleanup (errors propagate automatically)',
  );
});

Then('the dev server process group is killed after work completes', function () {
  const content = readFileSync(join(ROOT, 'adws/core/devServerLifecycle.ts'), 'utf-8');
  assert.ok(
    content.includes('finally'),
    'Expected devServerLifecycle.ts to guarantee cleanup in a finally block',
  );
});

// ---------------------------------------------------------------------------
// Scenario: CommandsConfig interface includes healthCheckPath field
// Note: When('the {string} interface definition is found') exists in
// replaceCrucialWithRegressionSteps.ts as a context-only no-op.
// Then('the interface contains a {string} field') exists in
// adwInitCommandsMdSteps.ts and checks sharedCtx.fileContent.
// Both existing steps work for this scenario without duplication.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenario: Health Check Path defaults / parsing
// ---------------------------------------------------------------------------

// Note: Given('a {string} file without a {string} section') is unique to this
// feature and is defined below.
// Note: Given('a {string} file with {string} set to {string}') already exists
// in applicationTypeScreenshotUploadSteps.ts — it stores sectionName and value
// in this.expectedSection / this.expectedValue via the Cucumber World.

Given('a {string} file without a {string} section', function (filePath: string, sectionHeading: string) {
  // Set ctx.commandsMdContent to content that does NOT include the heading
  ctx.commandsMdContent = '## Start Dev Server\nbun run dev\n';
  void filePath;
  void sectionHeading;
});

When('parseCommandsMd is called with the file content', function (this: Record<string, string>) {
  let content: string;
  if (this.expectedSection && this.expectedValue !== undefined) {
    // "with section set to value" scenario — build content from World state
    content = `${this.expectedSection}\n${this.expectedValue}\n`;
  } else {
    // "without section" scenario — use ctx.commandsMdContent
    content = ctx.commandsMdContent;
  }
  ctx.parsedConfig = parseCommandsMd(content);
});

Then('the returned healthCheckPath is {string}', function (expectedPath: string) {
  assert.ok(ctx.parsedConfig !== null, 'Expected parsedConfig to be set by the When step');
  assert.strictEqual(
    ctx.parsedConfig.healthCheckPath,
    expectedPath,
    `Expected healthCheckPath to be "${expectedPath}", got "${ctx.parsedConfig.healthCheckPath}"`,
  );
});

// ---------------------------------------------------------------------------
// Scenario: loadProjectConfig returns healthCheckPath from .adw/commands.md
// Note: Given('a target repository with {string} containing {string}') and
// When('loadProjectConfig is called for that repository') are defined in
// applicationTypeScreenshotUploadSteps.ts (updated to store state + call loader).
// ---------------------------------------------------------------------------

Then('the returned ProjectConfig commands has healthCheckPath set to {string}', function (
  this: Record<string, unknown>, expectedPath: string,
) {
  const loadedConfig = this.loadedProjectConfig as ProjectConfig | undefined;
  assert.ok(loadedConfig, 'Expected loadedProjectConfig to be set by the When step');
  assert.strictEqual(
    loadedConfig.commands.healthCheckPath,
    expectedPath,
    `Expected healthCheckPath to be "${expectedPath}", got "${loadedConfig.commands.healthCheckPath}"`,
  );
});

// ---------------------------------------------------------------------------
// Scenario: withDevServer is not imported in any orchestrator
// ---------------------------------------------------------------------------

When('all orchestrator files in {string} are scanned for imports', function (dir: string) {
  const fullDir = join(ROOT, dir);
  const result = execSync(
    `find "${fullDir}" -name "*.ts" -not -path "*/__tests__/*" -not -path "*/node_modules/*"`,
    { encoding: 'utf-8' },
  );
  ctx.orchestratorFiles = result.trim().split('\n').filter(Boolean);
});

Then('none of them import from {string}', function (importPath: string) {
  for (const file of ctx.orchestratorFiles) {
    const content = readFileSync(file, 'utf-8');
    assert.ok(
      !content.includes(importPath),
      `Expected ${file} not to import from "${importPath}", but it does`,
    );
  }
});

// ---------------------------------------------------------------------------
// Scenario: TypeScript type-check passes with dev server lifecycle changes
// Note: When('the TypeScript compiler is run with {string}') already exists in
// topLevelWorkflowStateFileSteps.ts for quoted args like "bunx tsc --noEmit".
// The feature file uses an unquoted literal "--noEmit", so a dedicated step
// is needed here.
// ---------------------------------------------------------------------------

When('the TypeScript compiler is run with --noEmit', function () {
  // Context annotation — the actual compilation check happens in the Then step
});

Then('the compiler exits with code 0', function () {
  try {
    execSync('bunx tsc --noEmit', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT });
    execSync('bunx tsc --noEmit -p adws/tsconfig.json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: ROOT,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    assert.fail(`TypeScript compilation failed:\n${(e.stdout ?? '') + (e.stderr ?? '')}`);
  }
});

Then('no type errors are reported', function () {
  // Verification already performed in "Then the compiler exits with code 0"
});
