import { When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Sequencing checks ─────────────────────────────────────────────────────────

Then('the file contains a call that invokes {string}', function (this: Record<string, string>, operation: string) {
  const content = this.fileContent;
  assert.ok(
    content.includes(operation) || content.includes('executeDepauditSetup'),
    `Expected file to contain a call that invokes "${operation}"`,
  );
});

Then('the invocation is sequenced after {string}', function (this: Record<string, string>, precedingCall: string) {
  const content = this.fileContent;
  // Use the function call pattern (with opening paren) to find actual invocations, not imports
  const precedingIdx = content.indexOf(`${precedingCall}(`);
  const invocationIdx = content.indexOf('executeDepauditSetup(');
  assert.ok(precedingIdx !== -1, `Expected a call to "${precedingCall}(" to appear in the file`);
  assert.ok(invocationIdx !== -1, `Expected a call to "executeDepauditSetup(" to appear in the file`);
  assert.ok(precedingIdx < invocationIdx, `Expected "executeDepauditSetup" to appear after "${precedingCall}"`);
});

Then('the invocation is sequenced before {string}', function (this: Record<string, string>, followingCall: string) {
  const content = this.fileContent;
  const invocationIdx = content.indexOf('executeDepauditSetup(');
  const followingIdx = content.indexOf(`${followingCall}(`);
  assert.ok(invocationIdx !== -1, `Expected a call to "executeDepauditSetup(" to appear in the file`);
  assert.ok(followingIdx !== -1, `Expected a call to "${followingCall}(" to appear in the file`);
  assert.ok(invocationIdx < followingIdx, `Expected "executeDepauditSetup" to appear before "${followingCall}"`);
});

// ── depaudit setup cwd check ──────────────────────────────────────────────────

When('the depaudit setup invocation is found', function (this: Record<string, string>) {
  const fullPath = join(ROOT, 'adws/phases/depauditSetup.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/depauditSetup.ts to exist');
  const content = readFileSync(fullPath, 'utf-8');
  this.fileContent = content;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/phases/depauditSetup.ts';
});

Then('it passes {string} as the working directory for the child process', function (this: Record<string, string>, arg: string) {
  const content = this.fileContent;
  assert.ok(content.includes('cwd'), `Expected code to use "cwd" option`);
  assert.ok(content.includes(arg), `Expected code to pass "${arg}" as the working directory`);
});

// ── gh secret set repo scoping ────────────────────────────────────────────────

When('the gh secret set invocation is found', function (this: Record<string, string>) {
  const fullPath = join(ROOT, 'adws/phases/depauditSetup.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/depauditSetup.ts to exist');
  const content = readFileSync(fullPath, 'utf-8');
  this.fileContent = content;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/phases/depauditSetup.ts';
});

Then('it uses the "--repo" flag', function (this: Record<string, string>) {
  assert.ok(this.fileContent.includes('--repo'), `Expected code to use "--repo" flag`);
});

Then('it targets the repository identifier for the target repo', function (this: Record<string, string>) {
  const content = this.fileContent;
  assert.ok(
    content.includes('ownerRepo') || content.includes('targetRepo'),
    'Expected code to use a repository identifier (ownerRepo or targetRepo)',
  );
});

// ── Secret propagation env checks ─────────────────────────────────────────────

When('the secret propagation code is found', function (this: Record<string, string>) {
  const fullPath = join(ROOT, 'adws/phases/depauditSetup.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/depauditSetup.ts to exist');
  const content = readFileSync(fullPath, 'utf-8');
  this.fileContent = content;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/phases/depauditSetup.ts';
});

Then('the values read come from {string} and {string}', function (this: Record<string, string>, val1: string, val2: string) {
  const content = this.fileContent;
  const name1 = val1.replace('process.env.', '');
  const name2 = val2.replace('process.env.', '');
  assert.ok(content.includes(name1), `Expected code to reference "${name1}"`);
  assert.ok(content.includes(name2), `Expected code to reference "${name2}"`);
  assert.ok(content.includes('process.env'), `Expected code to read from process.env`);
});

Then('a warning is logged when {string} is unset', function (this: Record<string, string>, envName: string) {
  const content = this.fileContent;
  assert.ok(content.includes(envName), `Expected code to reference "${envName}"`);
  assert.ok(content.includes('warn'), `Expected code to log at warn level`);
  assert.ok(content.includes('not set'), `Expected code to log a "not set" warning`);
});

Then('the workflow does not throw or exit on the missing value', function (this: Record<string, string>) {
  const content = this.fileContent;
  assert.ok(
    content.includes('success: true'),
    'Expected code to always return success: true (no throw on missing value)',
  );
});

// ── Init summary ──────────────────────────────────────────────────────────────

When('the init summary is produced', function (this: Record<string, string>) {
  const fullPath = join(ROOT, 'adws/adwInit.tsx');
  const content = readFileSync(fullPath, 'utf-8');
  this.fileContent = content;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/adwInit.tsx';
});

Then('any missing env values are listed in the summary as {string} or {string}', function (this: Record<string, string>, term1: string, term2: string) {
  const content = this.fileContent;
  assert.ok(
    content.includes(term1) || content.includes(term2),
    `Expected file to list missing env values as "${term1}" or "${term2}"`,
  );
});

// ── Integration test assertions ───────────────────────────────────────────────

Then('an integration test file exists that asserts {string} is invoked during adw_init', function (assertion: string) {
  const testDir = join(ROOT, 'adws/__tests__');
  assert.ok(existsSync(testDir), `Expected directory adws/__tests__ to exist`);
  const files = readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  const found = files.some(f => {
    const content = readFileSync(join(testDir, f), 'utf-8');
    return content.includes(assertion);
  });
  assert.ok(found, `Expected a test file in adws/__tests__ to assert "${assertion}" is invoked`);
});

Then('the test uses a fixture target repo', function () {
  const testDir = join(ROOT, 'adws/__tests__');
  const files = readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  const found = files.some(f => {
    const content = readFileSync(join(testDir, f), 'utf-8');
    return content.includes('fixture') || content.includes('worktreePath') || content.includes('/tmp/');
  });
  assert.ok(found, 'Expected a test file in adws/__tests__ to use a fixture target repo');
});

Then('an integration test asserts that {string} is called with {string} when the env var is present', function (command: string, envVar: string) {
  const testDir = join(ROOT, 'adws/__tests__');
  const files = readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  const found = files.some(f => {
    const content = readFileSync(join(testDir, f), 'utf-8');
    return content.includes(envVar) && content.includes(command);
  });
  assert.ok(found, `Expected a test to assert that "${command}" is called with "${envVar}" when env var is present`);
});

Then('an integration test asserts that when {string} or {string} is unset, adw_init logs a warning and completes successfully', function (var1: string, var2: string) {
  const testDir = join(ROOT, 'adws/__tests__');
  const files = readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  const found = files.some(f => {
    const content = readFileSync(join(testDir, f), 'utf-8');
    return content.includes(var1) &&
      (content.includes('warn') || content.includes('skipped') || content.includes('not set')) &&
      content.includes('success');
  });
  assert.ok(found, `Expected a test to cover the missing env var warning path for "${var1}" or "${var2}"`);
});

// ── README propagation note ───────────────────────────────────────────────────

Then('the file contains a note that adw_init propagates this value to target repo GitHub Actions secrets', function (this: Record<string, string>) {
  const content = this.fileContent;
  assert.ok(
    (content.includes('adw_init') || content.includes('adwInit')) &&
    (content.includes('propagat') || content.includes('secret') || content.includes('gh secret')),
    'Expected file to contain a note about adw_init propagating secrets to target repo',
  );
});

// ── TypeScript compiler check ─────────────────────────────────────────────────
// "Then the compiler exits with code 0" and "Then no type errors are reported" are
// already defined in devServerLifecycleSteps.ts and run both tsc checks.

When('the TypeScript compiler is run with --noEmit on {string}', function (_tsconfig: string) {
  // Context-only step; the Then steps in devServerLifecycleSteps.ts run the actual check.
});
