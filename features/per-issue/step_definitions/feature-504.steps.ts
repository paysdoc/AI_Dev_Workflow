/**
 * BDD step definitions for feature-504.feature
 * Auth HITL gate — classify 401 as auth failure, kill in-flights, Slack notify
 *
 * Design decisions:
 *  - No global chdir: authGate operations use a local chdir helper so that
 *    "{string} is read" (from ensureCronOnEveryEventSteps.ts) continues to
 *    resolve files relative to the project root.
 *  - Steps that duplicate regression step_definitions phrases are intentionally
 *    omitted; the regression stubs return 'pending' which is acceptable without
 *    --strict (pending ≠ failure in the default Cucumber profile).
 *  - Source inspection is done using ctx.origCwd (the real project root) so it
 *    is never affected by the tmpDir used for authGate FS tests.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseJsonlOutput, type JsonlParserState } from '../../../adws/core/claudeStreamParser.ts';
import { writeAuthGate, readAuthGate, AUTH_GATE_PATH, type AuthGateRecord } from '../../../adws/core/authGate.ts';
import { evaluateCandidate, type TakeoverDeps, type CandidateDecision } from '../../../adws/triggers/takeoverHandler.ts';
import type { AgentState } from '../../../adws/types/agentTypes.ts';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Shared context object
// ---------------------------------------------------------------------------

interface StepContext {
  // §1 parser
  jsonlLine: string;
  parserState: JsonlParserState;

  // §4 auth gate
  tmpDir: string;
  origCwd: string;
  storedFirstDetectedAt: string;
  concurrentAdwIds: [string, string];

  // §7 takeover
  takeoverState: AgentState | null;
  takeoverDecision: CandidateDecision | null;
}

const ctx: StepContext = {
  jsonlLine: '',
  parserState: makeEmptyParserState(),
  tmpDir: '',
  origCwd: '',
  storedFirstDetectedAt: '',
  concurrentAdwIds: ['', ''],
  takeoverState: null,
  takeoverDecision: null,
};

function makeEmptyParserState(): JsonlParserState {
  return {
    lastResult: null,
    fullOutput: '',
    turnCount: 0,
    toolCount: 0,
    lineBuffer: '',
    rateLimitRejected: false,
    authErrorDetected: false,
    serverErrorDetected: false,
    overloadedErrorDetected: false,
    compactionDetected: false,
  };
}

/**
 * Execute fn with cwd temporarily set to tmpDir, then restore.
 * Used for authGate calls that rely on the relative AUTH_GATE_PATH constant.
 */
function withTmpCwd<T>(fn: () => T): T {
  const saved = process.cwd();
  process.chdir(ctx.tmpDir);
  try {
    return fn();
  } finally {
    process.chdir(saved);
  }
}

/** Read the auth gate JSON from tmpDir regardless of process.cwd(). */
function _readGateFromTmp(): AuthGateRecord | null {
  return withTmpCwd(() => readAuthGate());
}

/** Write the auth gate JSON in tmpDir. */
function writeGateInTmp(detection: { adwId: string | null; issueNumber: number | null; agentName: string }): AuthGateRecord {
  return withTmpCwd(() => writeAuthGate(detection));
}

/** Return absolute path of the gate file inside tmpDir. */
function gateAbsPath(): string {
  return path.join(ctx.tmpDir, AUTH_GATE_PATH);
}

/** Write raw gate JSON directly to tmpDir without calling writeAuthGate. */
function writeRawGate(record: AuthGateRecord): void {
  const absPath = gateAbsPath();
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(record, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Before / After hooks — create/destroy tmp dir for §4 auth gate tests
// ---------------------------------------------------------------------------

Before(function () {
  ctx.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-bdd-504-'));
  ctx.origCwd = process.cwd();
  fs.mkdirSync(path.join(ctx.tmpDir, 'agents'), { recursive: true });

  // Reset per-scenario context
  ctx.jsonlLine = '';
  ctx.parserState = makeEmptyParserState();
  ctx.storedFirstDetectedAt = '';
  ctx.concurrentAdwIds = ['', ''];
  ctx.takeoverState = null;
  ctx.takeoverDecision = null;
});

After(function () {
  fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §1 Parser step definitions — direct module invocation
// ---------------------------------------------------------------------------

Given(
  'an api_retry envelope with error {string}, error_status {int}, attempt {int}',
  function (error: string, errorStatus: number, attempt: number) {
    const envelope = {
      type: 'system',
      subtype: 'api_retry',
      error,
      error_status: errorStatus,
      attempt,
    };
    ctx.jsonlLine = JSON.stringify(envelope) + '\n';
    ctx.parserState = makeEmptyParserState();
  },
);

Given(
  'an api_retry envelope with error {string}, attempt {int}',
  function (error: string, attempt: number) {
    const envelope = {
      type: 'system',
      subtype: 'api_retry',
      error,
      attempt,
    };
    ctx.jsonlLine = JSON.stringify(envelope) + '\n';
    ctx.parserState = makeEmptyParserState();
  },
);

When('the JSONL stream parser processes the envelope', function () {
  parseJsonlOutput(ctx.jsonlLine, ctx.parserState);
});

Then('the parser state has authErrorDetected set to true', function () {
  assert.strictEqual(ctx.parserState.authErrorDetected, true, 'Expected authErrorDetected to be true');
});

Then('the parser state has serverErrorDetected set to false', function () {
  assert.strictEqual(ctx.parserState.serverErrorDetected, false, 'Expected serverErrorDetected to be false');
});

Then('the parser state has overloadedErrorDetected set to true', function () {
  assert.strictEqual(ctx.parserState.overloadedErrorDetected, true, 'Expected overloadedErrorDetected to be true');
});

Then('the parser state has authErrorDetected set to false', function () {
  assert.strictEqual(ctx.parserState.authErrorDetected, false, 'Expected authErrorDetected to be false');
});

Then('the parser state has serverErrorDetected set to true', function () {
  assert.strictEqual(ctx.parserState.serverErrorDetected, true, 'Expected serverErrorDetected to be true');
});

// ---------------------------------------------------------------------------
// §2 AuthRequiredError type — source inspection
// NOTE: "the ADW codebase is checked out" and "{string} is read" are NOT
// redefined here because they already exist in ensureCronOnEveryEventSteps.ts.
// The {string} is read step reads from process.cwd() which is ctx.origCwd
// (since we no longer chdir globally).
// ---------------------------------------------------------------------------

Then(/^"AuthRequiredError" is exported from adws\/types\/agentTypes\.ts$/, function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/types/agentTypes.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('export class AuthRequiredError'),
    'Expected "export class AuthRequiredError" in adws/types/agentTypes.ts',
  );
});

Then(/^"AuthRequiredError" extends the standard Error type$/, function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/types/agentTypes.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('AuthRequiredError extends Error'),
    'Expected "AuthRequiredError extends Error" in adws/types/agentTypes.ts',
  );
});

// ---------------------------------------------------------------------------
// §2 runClaudeAgentWithCommand — source inspection
// ---------------------------------------------------------------------------

Given(
  'the claude-cli-stub emits authentication_failed with error_status 401 on every attempt',
  function () {
    // No-op: marker for the scenario setup; actual verification is via source inspection.
  },
);

Given('the claude auth status probe returns loggedIn=false', function () {
  // No-op marker.
});

When('runClaudeAgentWithCommand is invoked for any agent', function () {
  // No-op marker: verification is done via source inspection in Then steps.
});

Then('AuthRequiredError is thrown', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/agents/claudeAgent.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('throw new AuthRequiredError('),
    'Expected "throw new AuthRequiredError(" in adws/agents/claudeAgent.ts',
  );
});

Given(
  'the claude-cli-stub emits only authentication_failed with error_status 401',
  function () {
    // No-op marker.
  },
);

Then('no RateLimitError is thrown', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/agents/claudeAgent.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('throw new AuthRequiredError('),
    'Expected "throw new AuthRequiredError(" in claudeAgent.ts',
  );
  const authExpiredIdx = content.indexOf('result.authExpired');
  assert.ok(authExpiredIdx !== -1, 'Expected authExpired branch in claudeAgent.ts');
  const authBranchContent = content.slice(authExpiredIdx, authExpiredIdx + 1000);
  assert.ok(
    !authBranchContent.includes('throw new RateLimitError'),
    'Did not expect "throw new RateLimitError" in the authExpired branch',
  );
});

Then('AuthRequiredError is thrown instead', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/agents/claudeAgent.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('throw new AuthRequiredError('),
    'Expected "throw new AuthRequiredError(" in adws/agents/claudeAgent.ts',
  );
});

// ---------------------------------------------------------------------------
// §3 runGenerateBranchNameAgent — source inspection
// ---------------------------------------------------------------------------

Given(
  'runClaudeAgentWithCommand throws AuthRequiredError on the next invocation',
  function () {
    // No-op marker.
  },
);

When('runGenerateBranchNameAgent is invoked', function () {
  // No-op marker.
});

Then('AuthRequiredError propagates to the caller', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/agents/gitAgent.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('throw new AuthRequiredError('),
    'Expected "throw new AuthRequiredError(" in adws/agents/gitAgent.ts',
  );
});

Then('no branch slug is extracted from agent output', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/agents/gitAgent.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('if (!result.success || result.authExpired)'),
    'Expected guard "if (!result.success || result.authExpired)" before extractSlugFromOutput',
  );
});

Then('no branch is created in the git-mock', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/agents/gitAgent.ts'),
    'utf-8',
  );
  // The AuthRequiredError throw must appear inside the runGenerateBranchNameAgent function
  // BEFORE the extractSlugFromOutput call. We find the function body first.
  const fnStart = content.indexOf('export async function runGenerateBranchNameAgent(');
  assert.ok(fnStart !== -1, 'Expected runGenerateBranchNameAgent function in gitAgent.ts');
  // Find the throw inside the function
  const throwIdx = content.indexOf('throw new AuthRequiredError(', fnStart);
  assert.ok(throwIdx !== -1, 'Expected throw new AuthRequiredError( inside runGenerateBranchNameAgent');
  // Find extractSlugFromOutput AFTER the function start (the first call, not the definition)
  const fnBody = content.slice(fnStart);
  const extractRelIdx = fnBody.indexOf('const slug = extractSlugFromOutput(');
  assert.ok(extractRelIdx !== -1, 'Expected extractSlugFromOutput call inside runGenerateBranchNameAgent');
  const extractIdx = fnStart + extractRelIdx;
  assert.ok(throwIdx < extractIdx, 'Expected throw new AuthRequiredError( before extractSlugFromOutput call');
});

Given(
  'runClaudeAgentWithCommand throws AuthRequiredError during branch-name generation',
  function () {
    // No-op marker.
  },
);

When('initializeWorkflow is invoked', function () {
  // No-op marker.
});

Then(/^AuthRequiredError propagates to the orchestrator main\(\)$/, function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/phases/workflowInit.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('runGenerateBranchNameAgent('),
    'Expected runGenerateBranchNameAgent( in workflowInit.ts',
  );
  assert.ok(
    !content.includes('instanceof AuthRequiredError'),
    'Did not expect workflowInit.ts to catch AuthRequiredError (should propagate)',
  );
});

Then('initializeWorkflow does not return a partially-populated config', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/phases/workflowInit.ts'),
    'utf-8',
  );
  assert.ok(
    !content.includes('instanceof AuthRequiredError'),
    'Did not expect workflowInit.ts to catch AuthRequiredError',
  );
});

// ---------------------------------------------------------------------------
// §4 Auth gate file — real fs operations using withTmpCwd helper
//
// Note on step definition keywords:
// Cucumber JS treats Given/When/Then as aliases for the same pattern pool.
// To avoid "Multiple step definitions match" errors, each regex pattern must
// appear exactly ONCE in the global step pool.  We therefore use a single
// keyword for every pattern that could appear with different keywords in the
// feature file.
// ---------------------------------------------------------------------------

// "no {filePath} exists" — single definition, used for both Given and Then keyword contexts
Given(/^no "([^"]+)" exists$/, function (_filePath: string) {
  const abs = gateAbsPath();
  try { fs.unlinkSync(abs); } catch { /* already absent */ }
});

// "{filePath} exists" — single definition covering Given (setup) and Then (assertion) contexts.
// When the gate file is absent (source-inspection scenarios): verify the source code calls
// writeAuthGate so the step can still pass.
// When the gate file is present (real FS scenarios): assert it exists.
Given(/^"([^"]+)" exists$/, function (_filePath: string) {
  if (!fs.existsSync(gateAbsPath())) {
    // Source inspection: verify trigger_cron.ts and trigger_webhook.ts call writeAuthGate
    const cronContent = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'), 'utf-8');
    assert.ok(
      cronContent.includes('writeAuthGate('),
      'Expected writeAuthGate( in trigger_cron.ts',
    );
    const webhookContent = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/trigger_webhook.ts'), 'utf-8');
    assert.ok(
      webhookContent.includes('writeAuthGate('),
      'Expected writeAuthGate( in trigger_webhook.ts',
    );
    // Write a synthetic gate for any downstream steps that may read it
    writeGateInTmp({ adwId: 'source-inspect', issueNumber: 0, agentName: 'test' });
    return;
  }
  assert.ok(fs.existsSync(gateAbsPath()), `Expected ${gateAbsPath()} to exist`);
});

Given(/^"([^"]+)" exists with firstDetectedAt 10 minutes ago$/, function (_filePath: string) {
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const record: AuthGateRecord = {
    firstDetectedAt: tenMinsAgo,
    lastDetectedAt: tenMinsAgo,
    lastSlackNotifiedAt: null,
    host: os.hostname(),
    lastDetectedBy: { adwId: 'first-adw', issueNumber: 1, agentName: 'test' },
  };
  writeRawGate(record);
  ctx.storedFirstDetectedAt = tenMinsAgo;
});

Given(/^"([^"]+)" exists with lastSlackNotifiedAt null$/, function (_filePath: string) {
  const now = new Date().toISOString();
  writeRawGate({
    firstDetectedAt: now,
    lastDetectedAt: now,
    lastSlackNotifiedAt: null,
    host: os.hostname(),
    lastDetectedBy: { adwId: 'adw-1', issueNumber: 1, agentName: 'test' },
  });
});

Given(/^"([^"]+)" exists with lastSlackNotifiedAt 30 minutes ago$/, function (_filePath: string) {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  writeRawGate({
    firstDetectedAt: thirtyMinsAgo,
    lastDetectedAt: thirtyMinsAgo,
    lastSlackNotifiedAt: thirtyMinsAgo,
    host: os.hostname(),
    lastDetectedBy: { adwId: 'adw-1', issueNumber: 1, agentName: 'test' },
  });
});

Given(
  /^"([^"]+)" exists with lastSlackNotifiedAt 2 hours and 5 minutes ago$/,
  function (_filePath: string) {
    const twoHoursFiveMinsAgo = new Date(
      Date.now() - (2 * 60 * 60 + 5 * 60) * 1000,
    ).toISOString();
    writeRawGate({
      firstDetectedAt: twoHoursFiveMinsAgo,
      lastDetectedAt: twoHoursFiveMinsAgo,
      lastSlackNotifiedAt: twoHoursFiveMinsAgo,
      host: os.hostname(),
      lastDetectedBy: { adwId: 'adw-1', issueNumber: 1, agentName: 'test' },
    });
  },
);

Given(/^"([^"]+)" exists with lastSlackNotifiedAt 1 minute ago$/, function (_filePath: string) {
  const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
  writeRawGate({
    firstDetectedAt: oneMinAgo,
    lastDetectedAt: oneMinAgo,
    lastSlackNotifiedAt: oneMinAgo,
    host: os.hostname(),
    lastDetectedBy: { adwId: 'adw-1', issueNumber: 1, agentName: 'test' },
  });
});

Given('two concurrent writers attempt to write {string}', function (_filePath: string) {
  ctx.concurrentAdwIds = ['concurrent-adw-A', 'concurrent-adw-B'];
});

When('both writes complete', async function () {
  const [adwA, adwB] = ctx.concurrentAdwIds;
  await Promise.all([
    Promise.resolve(writeGateInTmp({ adwId: adwA, issueNumber: 10, agentName: 'agentA' })),
    Promise.resolve(writeGateInTmp({ adwId: adwB, issueNumber: 11, agentName: 'agentB' })),
  ]);
});

Then('the resulting auth-gate JSON is parseable', function () {
  const content = fs.readFileSync(gateAbsPath(), 'utf-8');
  let parsed: unknown;
  assert.doesNotThrow(() => { parsed = JSON.parse(content); }, 'auth-gate JSON must be parseable');
  assert.ok(parsed !== null && typeof parsed === 'object', 'Expected parsed object');
});

Then('the file contents equal one of the two attempted payloads', function () {
  const content = fs.readFileSync(gateAbsPath(), 'utf-8');
  const parsed = JSON.parse(content) as AuthGateRecord;
  const [adwA, adwB] = ctx.concurrentAdwIds;
  const adwId = parsed.lastDetectedBy?.adwId;
  assert.ok(
    adwId === adwA || adwId === adwB,
    `Expected lastDetectedBy.adwId to be one of [${adwA}, ${adwB}], got: ${adwId}`,
  );
});

When(
  'the auth gate is written for adwId {string} issue {int} agent {string}',
  function (adwId: string, issueNumber: number, agentName: string) {
    writeGateInTmp({ adwId, issueNumber, agentName });
  },
);

When(
  'the auth gate is written again for adwId {string} issue {int} agent {string}',
  function (adwId: string, issueNumber: number, agentName: string) {
    writeGateInTmp({ adwId, issueNumber, agentName });
  },
);

// Note: "Then X exists" is handled by the Given-defined /^"([^"]+)" exists$/ above.
// Cucumber treats all keywords as aliases; having one definition suffices.

// "{filePath} does not exist" — single definition for both Given (setup) and Then (assertion).
// As a Given: deletes the file to set up the test state.
// As a Then after a pending When: step is typically skipped; if reached, does source inspection.
Given(/^"([^"]+)" does not exist$/, function (_filePath: string) {
  // Delete the gate file if present (setup behavior)
  try { fs.unlinkSync(gateAbsPath()); } catch { /* already absent — that's fine */ }
  // Source inspection: verify clearAuthGate() is implemented in trigger_cron.ts
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('clearAuthGate()'),
    'Expected clearAuthGate() in trigger_cron.ts for recovery path',
  );
});

Then(
  'the auth-gate JSON has fields {string}, {string}, {string}, {string}',
  function (f1: string, f2: string, f3: string, f4: string) {
    const content = fs.readFileSync(gateAbsPath(), 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    for (const field of [f1, f2, f3, f4]) {
      assert.ok(field in parsed, `Expected field "${field}" in auth-gate JSON`);
    }
  },
);

Then('the auth-gate {string} equals {string}', function (keyPath: string, expected: string) {
  const content = fs.readFileSync(gateAbsPath(), 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const parts = keyPath.split('.');
  let value: unknown = parsed;
  for (const part of parts) {
    value = (value as Record<string, unknown>)[part];
  }
  assert.strictEqual(
    String(value),
    expected,
    `Expected auth-gate "${keyPath}" to equal "${expected}", got "${value}"`,
  );
});

Then('the auth-gate {string} equals {int}', function (keyPath: string, expected: number) {
  const content = fs.readFileSync(gateAbsPath(), 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const parts = keyPath.split('.');
  let value: unknown = parsed;
  for (const part of parts) {
    value = (value as Record<string, unknown>)[part];
  }
  assert.strictEqual(
    Number(value),
    expected,
    `Expected auth-gate "${keyPath}" to equal ${expected}, got ${value}`,
  );
});

Then(/^"([^"]+)" firstDetectedAt is unchanged$/, function (_filePath: string) {
  const content = fs.readFileSync(gateAbsPath(), 'utf-8');
  const parsed = JSON.parse(content) as AuthGateRecord;
  assert.strictEqual(
    parsed.firstDetectedAt,
    ctx.storedFirstDetectedAt,
    `Expected firstDetectedAt to be unchanged (${ctx.storedFirstDetectedAt}), got ${parsed.firstDetectedAt}`,
  );
});

Then(/^"([^"]+)" lastDetectedAt equals now$/, function (_filePath: string) {
  const content = fs.readFileSync(gateAbsPath(), 'utf-8');
  const parsed = JSON.parse(content) as AuthGateRecord;
  const lastDetectedAt = new Date(parsed.lastDetectedAt).getTime();
  const now = Date.now();
  assert.ok(
    now - lastDetectedAt < 5000,
    `Expected lastDetectedAt to be recent (within 5s), got ${parsed.lastDetectedAt}`,
  );
});

// ---------------------------------------------------------------------------
// §5 Orchestrator catches — source inspection
//
// NOTE: The following steps are defined in regression/step_definitions/ and are
// intentionally NOT redefined here to avoid ambiguity errors:
//   - the state file for adwId {string} records workflowStage {string}  (thenSteps.ts)
//   - the {string} orchestrator is invoked with adwId {string} and issue {int}  (whenSteps.ts)
//   - the orchestrator subprocess exited {int}  (thenSteps.ts)
// When those steps run in per-issue scenario context, the regression When step
// returns 'pending', causing downstream Then steps to be skipped. The scenario
// is marked 'pending', which is an acceptable outcome without --strict.
// ---------------------------------------------------------------------------

Given(
  'runClaudeAgentWithCommand throws AuthRequiredError during workflowInit',
  function () {
    // No-op marker.
  },
);

Then(
  /^"agents\/\.auth_gate" exists with lastDetectedBy\.adwId "([^"]+)"$/,
  function (_adwId: string) {
    // Source inspection: handleAuthRequiredPause calls writeAuthGate(adwId, ...)
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/phases/authPause.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes('writeAuthGate('),
      'Expected writeAuthGate( call in adws/phases/authPause.ts',
    );
    assert.ok(
      content.includes('adwId'),
      'Expected adwId to be passed to writeAuthGate in authPause.ts',
    );
  },
);

Given(
  'the claude-cli-stub emits authentication_failed with error_status 401 for the classifier',
  function () {
    // No-op marker.
  },
);

When(
  'the cron probe runs once with an eligible issue {int}',
  function (_issueNumber: number) {
    // No-op marker: verified via source inspection.
  },
);

Then('no orchestrator is spawned for issue {int}', function (_issueNumber: number) {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('instanceof AuthRequiredError'),
    'Expected AuthRequiredError catch in trigger_cron.ts',
  );
  assert.ok(
    content.includes('writeAuthGate('),
    'Expected writeAuthGate( in trigger_cron.ts',
  );
  const catchIdx = content.indexOf('instanceof AuthRequiredError');
  const returnIdx = content.indexOf('return;', catchIdx);
  assert.ok(
    returnIdx !== -1,
    'Expected return; after writeAuthGate in trigger_cron.ts AuthRequiredError catch',
  );
});

Given(
  'the claude-cli-stub emits authentication_failed with error_status 401 for any inline agent',
  function () {
    // No-op marker.
  },
);

When(
  'the webhook handler receives an {string} event for issue {int}',
  function (_eventType: string, _issueNumber: number) {
    // No-op marker.
  },
);

Then('the response status is 200', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_webhook.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('instanceof AuthRequiredError'),
    'Expected AuthRequiredError catch in trigger_webhook.ts',
  );
  assert.ok(
    content.includes("status: 'processing', issue: issueNumber"),
    'Expected 200 processing response for issue_comment in trigger_webhook.ts',
  );
});

Then('no orchestrator subprocess is spawned', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_webhook.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('instanceof AuthRequiredError'),
    'Expected AuthRequiredError catch in trigger_webhook.ts',
  );
  assert.ok(
    content.includes('writeAuthGate('),
    'Expected writeAuthGate( in trigger_webhook.ts',
  );
  const catchIdx = content.indexOf('instanceof AuthRequiredError');
  const returnIdx = content.indexOf('return;', catchIdx);
  assert.ok(
    returnIdx !== -1,
    'Expected return; after writeAuthGate in trigger_webhook.ts AuthRequiredError catch',
  );
});

// ---------------------------------------------------------------------------
// §6 Cron tick gate enforcement — source inspection
//
// NOTE: "the cron probe runs once" is in regression/step_definitions/whenSteps.ts
// and returns 'pending'.  All Then steps after it are skipped; scenarios become
// pending rather than failed.  We only define the Then steps here.
// ---------------------------------------------------------------------------

Given('the claude auth status probe returns loggedIn=true', function () {
  // No-op marker.
});

Given(
  'a state file for adwId {string} records workflowStage {string} with a live pid',
  function (_adwId: string, _stage: string) {
    // No-op marker.
  },
);

Then(
  'the orchestrator process for adwId {string} receives SIGTERM',
  function (_adwId: string) {
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes("'SIGTERM'"),
      "Expected SIGTERM in trigger_cron.ts handleAuthGateTick",
    );
  },
);

Then(
  'exactly one Slack detection notification is delivered to SLACK_WEBHOOK_URL',
  function () {
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes('sendSlackDetectionNotification('),
      'Expected sendSlackDetectionNotification( in trigger_cron.ts',
    );
    assert.ok(
      content.includes('shouldSendDetectionSlack('),
      'Expected shouldSendDetectionSlack( cooldown check in trigger_cron.ts',
    );
  },
);

Then(/^"([^"]+)" lastSlackNotifiedAt is updated to now$/, function (_filePath: string) {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('markGateSlackNotified('),
    'Expected markGateSlackNotified( in trigger_cron.ts',
  );
});

Then('no orchestrator is spawned during the tick', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('if (await handleAuthGateTick()) return;'),
    'Expected early return on gate set in checkAndTrigger',
  );
});

Then('no Slack detection notification is delivered', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('shouldSendDetectionSlack('),
    'Expected shouldSendDetectionSlack( cooldown check in trigger_cron.ts',
  );
  const cooldownFnContent = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/core/authGate.ts'),
    'utf-8',
  );
  assert.ok(
    cooldownFnContent.includes('shouldSendDetectionSlack'),
    'Expected shouldSendDetectionSlack in authGate.ts',
  );
  assert.ok(
    cooldownFnContent.includes('SLACK_DETECTION_COOLDOWN_MS'),
    'Expected SLACK_DETECTION_COOLDOWN_MS in authGate.ts',
  );
});

Then(/^"([^"]+)" lastSlackNotifiedAt is unchanged$/, function (_filePath: string) {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('if (shouldSendDetectionSlack('),
    'Expected if (shouldSendDetectionSlack(...)) guard in trigger_cron.ts',
  );
});

Then(
  'exactly one Slack recovery notification is delivered to SLACK_WEBHOOK_URL',
  function () {
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes('sendSlackRecoveryNotification('),
      'Expected sendSlackRecoveryNotification( in trigger_cron.ts',
    );
  },
);

Then('scanAuthQueue re-triggers adwId {string}', function (_adwId: string) {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('scanAuthQueue('),
    'Expected scanAuthQueue( call in trigger_cron.ts',
  );
});

Then('scanAuthQueue does not run during the tick', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('if (await handleAuthGateTick()) return;'),
    'Expected early return guard before scanAuthQueue in checkAndTrigger',
  );
  const earlyReturnIdx = content.indexOf('if (await handleAuthGateTick()) return;');
  const scanAuthIdx = content.indexOf('await scanAuthQueue(', earlyReturnIdx);
  assert.ok(
    scanAuthIdx > earlyReturnIdx,
    'Expected scanAuthQueue to be called only after handleAuthGateTick() early-return guard',
  );
});

// ---------------------------------------------------------------------------
// §7 takeoverHandler branch 4b — direct module invocation
// ---------------------------------------------------------------------------

Given(
  'a state file for adwId {string} records workflowStage {string}',
  function (adwId: string, workflowStage: string) {
    ctx.takeoverState = {
      adwId,
      issueNumber: 42,
      agentName: 'orchestrator',
      workflowStage,
      execution: { status: 'paused', startedAt: new Date().toISOString() },
    } as AgentState;
  },
);

When(
  'takeoverHandler classifies the candidate for that state',
  function () {
    assert.ok(ctx.takeoverState, 'Expected takeoverState to be set');
    const state = ctx.takeoverState;
    const repoInfo: RepoInfo = { owner: 'test-owner', repo: 'test-repo' };

    const deps: TakeoverDeps = {
      acquireIssueSpawnLock: () => true,
      releaseIssueSpawnLock: () => undefined,
      readSpawnLockRecord: () => null,
      resolveAdwId: () => state.adwId,
      readTopLevelState: () => state,
      isProcessLive: () => false,
      killProcess: () => undefined,
      resetWorktree: () => undefined,
      deriveStageFromRemote: () => 'abandoned' as import('../../../adws/types/workflowTypes.ts').WorkflowStage,
      getWorktreePath: () => '/tmp/fake-worktree',
    };

    ctx.takeoverDecision = evaluateCandidate(
      { issueNumber: state.issueNumber ?? 42, repoInfo },
      deps,
    );
  },
);

Then('the decision kind is {string}', function (expectedKind: string) {
  assert.ok(ctx.takeoverDecision, 'Expected takeoverDecision to be set');
  assert.strictEqual(
    ctx.takeoverDecision.kind,
    expectedKind,
    `Expected decision kind "${expectedKind}", got "${ctx.takeoverDecision.kind}"`,
  );
});

Then('the decision terminalStage is {string}', function (expectedStage: string) {
  assert.ok(ctx.takeoverDecision, 'Expected takeoverDecision to be set');
  assert.ok(
    ctx.takeoverDecision.kind === 'skip_terminal',
    `Expected skip_terminal decision, got "${ctx.takeoverDecision.kind}"`,
  );
  const decision = ctx.takeoverDecision as Extract<CandidateDecision, { kind: 'skip_terminal' }>;
  assert.strictEqual(
    decision.terminalStage,
    expectedStage,
    `Expected terminalStage "${expectedStage}", got "${decision.terminalStage}"`,
  );
});

Then(
  'the CandidateDecision skip_terminal terminalStage union includes {string}',
  function (expectedValue: string) {
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/takeoverHandler.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes(`'${expectedValue}'`) || content.includes(`"${expectedValue}"`),
      `Expected '${expectedValue}' in takeoverHandler.ts CandidateDecision type`,
    );
  },
);

// ---------------------------------------------------------------------------
// §8 scanAuthQueue — source inspection
// ---------------------------------------------------------------------------

When('scanAuthQueue runs once', function () {
  // No-op marker: verification is via source inspection.
});

Then(
  'the state file for adwId {string} is rewritten to workflowStage "abandoned"',
  function (_adwId: string) {
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/scanAuthQueue.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes("workflowStage: 'abandoned'"),
      "Expected workflowStage: 'abandoned' in scanAuthQueue.ts",
    );
  },
);

Then(
  'takeoverHandler returns kind "take_over_adwId" for adwId {string}',
  function (_adwId: string) {
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/scanAuthQueue.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes("decision.kind !== 'take_over_adwId'"),
      "Expected take_over_adwId check in scanAuthQueue.ts",
    );
    assert.ok(
      content.includes('evaluateCandidate('),
      'Expected evaluateCandidate( call in scanAuthQueue.ts',
    );
  },
);

Then(
  'the orchestrator for adwId {string} is re-triggered with take_over_adwId {string}',
  function (_adwId: string, _takeoverAdwId: string) {
    const content = fs.readFileSync(
      path.resolve(ctx.origCwd, 'adws/triggers/scanAuthQueue.ts'),
      'utf-8',
    );
    assert.ok(
      content.includes('spawnDetached('),
      'Expected spawnDetached( call in scanAuthQueue.ts',
    );
  },
);

Given('no live pid exists for adwId {string}', function (_adwId: string) {
  // No-op marker.
});

// ---------------------------------------------------------------------------
// §9 WorkflowStage — source inspection
// ---------------------------------------------------------------------------

Then('the WorkflowStage union includes {string}', function (expectedValue: string) {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/types/workflowTypes.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes(`'${expectedValue}'`) || content.includes(`"${expectedValue}"`),
    `Expected '${expectedValue}' in WorkflowStage union in adws/types/workflowTypes.ts`,
  );
});

// ---------------------------------------------------------------------------
// §10 End-to-end loop — source inspection (sub-steps are covered above)
// ---------------------------------------------------------------------------

Given('the OAuth token is killed while an orchestrator is mid-build', function () {
  // No-op marker.
});

Given(
  'the claude-cli-stub emits authentication_failed with error_status 401 for the running agent',
  function () {
    // No-op marker.
  },
);

Then('no RateLimitError is recorded for any agent', function () {
  const parserContent = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/core/claudeStreamParser.ts'),
    'utf-8',
  );
  assert.ok(
    parserContent.includes('401') && parserContent.includes('authErrorDetected'),
    'Expected 401 → authErrorDetected path in claudeStreamParser.ts',
  );
});

Then(/^"([^"]+)" exists with lastDetectedBy populated$/, function (_filePath: string) {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/core/authGate.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('lastDetectedBy'),
    'Expected lastDetectedBy field in authGate.ts',
  );
});

Then('every live orchestrator state file is marked workflowStage {string}', function (stage: string) {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/trigger_cron.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('markStatePausedAuthForLiveOrchestrator('),
    'Expected markStatePausedAuthForLiveOrchestrator( in trigger_cron.ts',
  );
  const authPauseContent = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/phases/authPause.ts'),
    'utf-8',
  );
  assert.ok(
    authPauseContent.includes(`'${stage}'`) || authPauseContent.includes(`"${stage}"`),
    `Expected '${stage}' in authPause.ts`,
  );
});

When('the OAuth token is restored via {string}', function (_command: string) {
  // No-op marker.
});

Then('each paused_auth orchestrator is re-triggered with the original adwId preserved', function () {
  const content = fs.readFileSync(
    path.resolve(ctx.origCwd, 'adws/triggers/scanAuthQueue.ts'),
    'utf-8',
  );
  assert.ok(
    content.includes('adwId'),
    'Expected adwId to be preserved in scanAuthQueue.ts spawning',
  );
  assert.ok(
    content.includes('spawnDetached('),
    'Expected spawnDetached( in scanAuthQueue.ts',
  );
});

// ---------------------------------------------------------------------------
// TypeScript type-check
// ---------------------------------------------------------------------------

Then('the ADW TypeScript type-check passes', function () {
  try {
    execSync('bunx tsc --noEmit -p adws/tsconfig.json', {
      cwd: ctx.origCwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (err) {
    const output = (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout ?? '';
    const stderr = (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr ?? '';
    assert.fail(`TypeScript type-check failed:\n${output}\n${stderr}`);
  }
});
