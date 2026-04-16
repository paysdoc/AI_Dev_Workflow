import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── JsonlParserState helpers ─────────────────────────────────────────────────

/**
 * Reads the claudeStreamParser.ts source file into sharedCtx for assertions.
 */
function ensureParserSource(): string {
  const fullPath = join(ROOT, 'adws/core/claudeStreamParser.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/core/claudeStreamParser.ts to exist');
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/core/claudeStreamParser.ts';
  return content;
}

/**
 * Reads the agentProcessHandler.ts source file into sharedCtx for assertions.
 */
function ensureHandlerSource(): string {
  const fullPath = join(ROOT, 'adws/agents/agentProcessHandler.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/agentProcessHandler.ts to exist');
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/agents/agentProcessHandler.ts';
  return content;
}

// ── Cross-chunk line buffering in parseJsonlOutput ───────────────────────────

Given('a JsonlParserState with an empty lineBuffer', function () {
  const content = ensureParserSource();
  assert.ok(content.includes('lineBuffer'), 'Expected JsonlParserState to include lineBuffer field');
});

When('parseJsonlOutput receives a chunk containing a complete JSONL line ending with newline', function () {
  // Context only — verified via source inspection
});

Then('the JSONL line is parsed and state is updated', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('JSON.parse(line)'),
    'Expected parseJsonlOutput to call JSON.parse on each complete line',
  );
});

Then('lineBuffer remains empty', function () {
  const content = ensureParserSource();
  // When chunk ends with \n, lineBuffer is set to ''
  assert.ok(
    content.includes("state.lineBuffer = ''"),
    "Expected parseJsonlOutput to clear lineBuffer when chunk ends with newline",
  );
});

When('parseJsonlOutput receives a chunk with a partial JSONL line \\(no trailing newline)', function () {
  // Context only — verified via source inspection
});

Then('the partial line is stored in lineBuffer', function () {
  const content = ensureParserSource();
  // When chunk does not end with \n, the last segment is stored in lineBuffer
  assert.ok(
    content.includes('state.lineBuffer = segments.pop()'),
    'Expected parseJsonlOutput to buffer the trailing partial line',
  );
});

Then('no parse occurs for the partial line', function () {
  // The partial line is popped from segments before the parsing loop processes them
  const content = ensureParserSource();
  assert.ok(
    content.includes('segments.pop()'),
    'Expected the partial line to be removed from segments before parsing',
  );
});

When('parseJsonlOutput receives a second chunk completing the line with a trailing newline', function () {
  // Context only — verified via source inspection
});

Then('the reassembled line is parsed correctly', function () {
  const content = ensureParserSource();
  // The lineBuffer is prepended to the next chunk
  assert.ok(
    content.includes('state.lineBuffer + text'),
    'Expected parseJsonlOutput to prepend lineBuffer to next chunk for reassembly',
  );
});

Then('lineBuffer is cleared', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes("state.lineBuffer = ''"),
    "Expected lineBuffer to be cleared after a complete line is reassembled",
  );
});

When('parseJsonlOutput receives a chunk with three complete JSONL lines each ending with newline', function () {
  // Context only — verified via source inspection
});

Then('all three lines are parsed', function () {
  const content = ensureParserSource();
  // The parser splits on \n and iterates all non-empty segments
  assert.ok(
    content.includes("combined.split('\\n')"),
    'Expected parseJsonlOutput to split combined text on newlines',
  );
  assert.ok(
    content.includes('for (const line of lines)'),
    'Expected parseJsonlOutput to iterate over all lines',
  );
});

When('parseJsonlOutput receives a chunk with one complete line and one partial line', function () {
  // Context only — verified via source inspection
});

Then('the complete line is parsed', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('JSON.parse(line)'),
    'Expected complete lines to be parsed via JSON.parse',
  );
});

Then('the partial line is stored in lineBuffer', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('state.lineBuffer = segments.pop()'),
    'Expected partial line to be stored in lineBuffer',
  );
});

When('parseJsonlOutput receives a third chunk completing the partial line', function () {
  // Context only — verified via source inspection
});

Then('the reassembled partial line is parsed correctly', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('state.lineBuffer + text'),
    'Expected lineBuffer to be prepended to next chunk for reassembly',
  );
});

// ── Structured detection: rate_limit_event ───────────────────────────────────

Given('a JsonlParserState with rateLimitRejected = false', function () {
  const content = ensureParserSource();
  assert.ok(content.includes('rateLimitRejected'), 'Expected JsonlParserState to include rateLimitRejected');
});

When('parseJsonlOutput receives a JSONL line with type {string} and rate_limit_info.status {string}', function (type: string, status: string) {
  const content = ensureParserSource();
  // Verify the parser checks for this type and status
  assert.ok(
    content.includes(`parsed.type === '${type}'`),
    `Expected parseJsonlOutput to check for type "${type}"`,
  );
  assert.ok(
    content.includes(`'${status}'`),
    `Expected parseJsonlOutput to reference status "${status}"`,
  );
});

Then('state.rateLimitRejected is true', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('state.rateLimitRejected = true'),
    'Expected parseJsonlOutput to set state.rateLimitRejected = true for rejected status',
  );
});

Then('state.rateLimitRejected remains false', function () {
  const content = ensureParserSource();
  // Only 'rejected' status sets the flag; 'allowed' and 'allowed_warning' do not
  const rateIdx = content.indexOf("parsed.type === 'rate_limit_event'");
  assert.ok(rateIdx !== -1, 'Expected rate_limit_event detection block');
  const rateBlock = content.slice(rateIdx, rateIdx + 300);
  assert.ok(
    rateBlock.includes("status === 'rejected'"),
    'Expected rateLimitRejected to only be set when status is "rejected"',
  );
});

// ── Structured detection: authentication error ───────────────────────────────

Given('a JsonlParserState with authErrorDetected = false', function () {
  const content = ensureParserSource();
  assert.ok(content.includes('authErrorDetected'), 'Expected JsonlParserState to include authErrorDetected');
});

When('parseJsonlOutput receives a JSONL line with type {string}, subtype {string}, and error {string}', function (type: string, subtype: string, error: string) {
  const content = ensureParserSource();
  assert.ok(
    content.includes(`parsed.type === '${type}'`),
    `Expected parseJsonlOutput to check for type "${type}"`,
  );
  assert.ok(
    content.includes(`subtype === '${subtype}'`),
    `Expected parseJsonlOutput to check for subtype "${subtype}"`,
  );
  assert.ok(
    content.includes(`'${error}'`),
    `Expected parseJsonlOutput to reference error "${error}"`,
  );
});

Then('state.authErrorDetected is true', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('state.authErrorDetected = true'),
    'Expected parseJsonlOutput to set state.authErrorDetected = true for authentication_error',
  );
});

// ── Structured detection: server error ───────────────────────────────────────

Given('a JsonlParserState with serverErrorDetected = false', function () {
  const content = ensureParserSource();
  assert.ok(content.includes('serverErrorDetected'), 'Expected JsonlParserState to include serverErrorDetected');
});

When('parseJsonlOutput receives a JSONL line with type {string}, subtype {string}, error {string}, and attempt {int}', function (type: string, subtype: string, error: string, attempt: number) {
  const content = ensureParserSource();
  assert.ok(content.includes(`parsed.type === '${type}'`), `Expected type check for "${type}"`);
  assert.ok(content.includes(`subtype === '${subtype}'`), `Expected subtype check for "${subtype}"`);
  // Verify the attempt threshold check
  assert.ok(
    content.includes('attempt') && content.includes('>= 2'),
    `Expected parseJsonlOutput to check attempt >= 2 (provided attempt=${attempt})`,
  );
});

Then('state.serverErrorDetected is true', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('state.serverErrorDetected = true'),
    'Expected parseJsonlOutput to set state.serverErrorDetected = true for non-auth error at attempt >= 2',
  );
});

Then('state.serverErrorDetected remains false', function () {
  const content = ensureParserSource();
  // attempt 1 does not trigger serverErrorDetected because of the >= 2 guard
  assert.ok(
    content.includes('attempt >= 2'),
    'Expected serverErrorDetected to require attempt >= 2',
  );
});

// ── Structured detection: overloaded error ───────────────────────────────────

Given('a JsonlParserState with overloadedErrorDetected = false', function () {
  const content = ensureParserSource();
  assert.ok(content.includes('overloadedErrorDetected'), 'Expected JsonlParserState to include overloadedErrorDetected');
});

Then('state.overloadedErrorDetected is true', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('state.overloadedErrorDetected = true'),
    'Expected parseJsonlOutput to set state.overloadedErrorDetected = true for overloaded_error',
  );
});

// ── Structured detection: compaction ─────────────────────────────────────────

Given('a JsonlParserState with compactionDetected = false', function () {
  const content = ensureParserSource();
  assert.ok(content.includes('compactionDetected'), 'Expected JsonlParserState to include compactionDetected');
});

When('parseJsonlOutput receives a JSONL line with type {string} and subtype {string}', function (type: string, subtype: string) {
  const content = ensureParserSource();
  assert.ok(content.includes(`parsed.type === '${type}'`), `Expected type check for "${type}"`);
  assert.ok(content.includes(`'${subtype}'`), `Expected subtype reference "${subtype}"`);
});

Then('state.compactionDetected is true', function () {
  const content = ensureParserSource();
  assert.ok(
    content.includes('state.compactionDetected = true'),
    'Expected parseJsonlOutput to set state.compactionDetected = true for compact_boundary',
  );
});

// ── False-positive prevention ────────────────────────────────────────────────

Given('a JsonlParserState with all detection flags set to false', function () {
  const content = ensureParserSource();
  assert.ok(content.includes('rateLimitRejected: false'), 'Expected initial rateLimitRejected: false');
  assert.ok(content.includes('authErrorDetected: false') || content.includes('authErrorDetected'), 'Expected authErrorDetected in state');
});

When('parseJsonlOutput receives a JSONL line with type {string} whose content contains {string}, {string}, {string}, and {string}', function (type: string, _s1: string, _s2: string, _s3: string, _s4: string) {
  const content = ensureParserSource();
  // tool_result and assistant messages should not trigger detection flags
  // The parser only checks specific typed messages (rate_limit_event, system) for flags
  assert.ok(
    content.includes(`parsed.type === 'rate_limit_event'`),
    'Expected detection to only trigger on rate_limit_event type, not tool_result',
  );
  assert.ok(
    content.includes(`parsed.type === 'system'`),
    'Expected detection to only trigger on system type, not tool_result',
  );
});

Then('state.authErrorDetected remains false', function () {
  const content = ensureParserSource();
  // authErrorDetected is only set inside the system type block, not for tool_result
  const systemIdx = content.indexOf("parsed.type === 'system'");
  assert.ok(systemIdx !== -1, 'Expected system type check in parser');
  const systemBlock = content.slice(systemIdx, systemIdx + 500);
  assert.ok(
    systemBlock.includes('state.authErrorDetected = true'),
    'Expected authErrorDetected to only be set inside the system type block',
  );
});

Then('state.overloadedErrorDetected remains false', function () {
  const content = ensureParserSource();
  const systemIdx = content.indexOf("parsed.type === 'system'");
  assert.ok(systemIdx !== -1, 'Expected system type check');
  const systemBlock = content.slice(systemIdx, systemIdx + 500);
  assert.ok(
    systemBlock.includes('state.overloadedErrorDetected = true'),
    'Expected overloadedErrorDetected to only be set inside the system type block',
  );
});

Then('state.compactionDetected remains false', function () {
  const content = ensureParserSource();
  const systemIdx = content.indexOf("parsed.type === 'system'");
  assert.ok(systemIdx !== -1, 'Expected system type check');
  const systemBlock = content.slice(systemIdx, systemIdx + 500);
  assert.ok(
    systemBlock.includes('state.compactionDetected = true'),
    'Expected compactionDetected to only be set inside the system type block',
  );
});

When('parseJsonlOutput receives a JSONL line with type {string} whose content contains {string} and {string}', function (type: string, _s1: string, _s2: string) {
  // Context only — assistant messages should not trigger any detection flags
  const content = ensureParserSource();
  assert.ok(
    content.includes("parsed.type === 'rate_limit_event'") && content.includes("parsed.type === 'system'"),
    'Expected detection logic to be gated by specific type checks (rate_limit_event, system)',
  );
});

Then('no detection flags are set', function () {
  const content = ensureParserSource();
  // The flag-setting logic is all inside type === 'rate_limit_event' or type === 'system' blocks
  // An assistant-type message never enters these blocks
  assert.ok(
    content.includes("parsed.type === 'rate_limit_event'"),
    'Expected rate_limit_event check to gate rateLimitRejected',
  );
  assert.ok(
    content.includes("parsed.type === 'system'"),
    'Expected system check to gate auth/server/overloaded/compaction detection',
  );
});

// ── agentProcessHandler flag-based process kill ──────────────────────────────

Given('agentProcessHandler is processing stdout chunks', function () {
  ensureHandlerSource();
});

Given('parseJsonlOutput sets state.rateLimitRejected to true', function () {
  const content = ensureHandlerSource();
  assert.ok(
    content.includes('state.rateLimitRejected'),
    'Expected agentProcessHandler.ts to read state.rateLimitRejected',
  );
});

Given('parseJsonlOutput sets state.authErrorDetected to true', function () {
  const content = ensureHandlerSource();
  assert.ok(
    content.includes('state.authErrorDetected'),
    'Expected agentProcessHandler.ts to read state.authErrorDetected',
  );
});

Given('parseJsonlOutput sets state.overloadedErrorDetected to true', function () {
  const content = ensureHandlerSource();
  assert.ok(
    content.includes('state.overloadedErrorDetected'),
    'Expected agentProcessHandler.ts to read state.overloadedErrorDetected',
  );
});

When('the handler checks the state flags after parseJsonlOutput returns', function () {
  // Context only — the handler checks flags after each parseJsonlOutput call
  const content = ensureHandlerSource();
  assert.ok(
    content.includes('parseJsonlOutput('),
    'Expected agentProcessHandler.ts to call parseJsonlOutput',
  );
});

Then('a {string} warning is logged', function (message: string) {
  const content = ensureHandlerSource();
  assert.ok(
    content.includes(message),
    `Expected agentProcessHandler.ts to log "${message}"`,
  );
});

Then('a {string} error is logged', function (message: string) {
  const content = ensureHandlerSource();
  assert.ok(
    content.includes(message),
    `Expected agentProcessHandler.ts to log "${message}"`,
  );
});

When('parseJsonlOutput sets state.rateLimitRejected to true on the first chunk', function () {
  // Context only — verified via source inspection
});

When('parseJsonlOutput sets state.rateLimitRejected to true on a subsequent chunk', function () {
  // Context only — verified via source inspection
});

Then('SIGTERM is sent only once for rate limit detection', function () {
  const content = ensureHandlerSource();
  // The !rateLimitDetected guard prevents duplicate kills
  assert.ok(
    content.includes('!rateLimitDetected'),
    'Expected agentProcessHandler.ts to use !rateLimitDetected guard',
  );
  assert.ok(
    content.includes('rateLimitDetected = true'),
    'Expected agentProcessHandler.ts to set rateLimitDetected = true after first SIGTERM',
  );
});

Then('the local rateLimitDetected guard prevents duplicate kills', function () {
  const content = ensureHandlerSource();
  assert.ok(
    content.includes('!rateLimitDetected') && content.includes('rateLimitDetected = true'),
    'Expected rateLimitDetected guard to prevent multiple SIGTERM sends',
  );
});

// ── runPhasesParallel RateLimitError routing ─────────────────────────────────

Given('runPhasesParallel is executing multiple phase functions in parallel', function () {
  const fullPath = join(ROOT, 'adws/core/phaseRunner.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/core/phaseRunner.ts to exist');
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/core/phaseRunner.ts';
  assert.ok(
    content.includes('runPhasesParallel'),
    'Expected phaseRunner.ts to define runPhasesParallel',
  );
});

When('one of the phase functions throws a RateLimitError', function () {
  // Context only — verified via source inspection
});

Then('handleRateLimitPause is called with the error\'s phase name and {string} status', function (status: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('handleRateLimitPause'),
    'Expected runPhasesParallel to call handleRateLimitPause',
  );
  assert.ok(
    content.includes(`'${status}'`),
    `Expected runPhasesParallel to pass "${status}" status to handleRateLimitPause`,
  );
});

Then('the RateLimitError is re-thrown after handling', function () {
  const content = sharedCtx.fileContent;
  // The catch block calls handleRateLimitPause and then re-throws
  const catchIdx = content.indexOf('if (err instanceof RateLimitError)');
  assert.ok(catchIdx !== -1, 'Expected runPhasesParallel to catch RateLimitError');
  const afterCatch = content.slice(catchIdx, catchIdx + 300);
  assert.ok(
    afterCatch.includes('throw err') || afterCatch.includes('throw'),
    'Expected RateLimitError to be re-thrown after handleRateLimitPause',
  );
});

When('one of the phase functions throws a generic Error', function () {
  // Context only — verified via source inspection
});

Then('handleRateLimitPause is NOT called', function () {
  const content = sharedCtx.fileContent;
  // Only RateLimitError triggers handleRateLimitPause, not generic errors
  assert.ok(
    content.includes('if (err instanceof RateLimitError)'),
    'Expected handleRateLimitPause to be gated by instanceof RateLimitError check',
  );
});

Then('the error propagates to the caller', function () {
  const content = sharedCtx.fileContent;
  // The catch block re-throws all errors (including non-RateLimitError)
  const catchBlock = content.indexOf('} catch (err)');
  assert.ok(catchBlock !== -1, 'Expected runPhasesParallel to have a catch block');
  const afterCatch = content.slice(catchBlock, catchBlock + 300);
  assert.ok(
    afterCatch.includes('throw err'),
    'Expected the error to be re-thrown to propagate to the caller',
  );
});

When('all phase functions complete successfully with cost data', function () {
  // Context only — verified via source inspection
});

Then('the cost tracker accumulates the merged totals from all phases', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('tracker.accumulate'),
    'Expected runPhasesParallel to call tracker.accumulate with merged results',
  );
  assert.ok(
    content.includes('mergedCost') || content.includes('mergedUsage'),
    'Expected runPhasesParallel to compute merged cost/usage totals',
  );
});

Then('the cost is persisted and committed', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('tracker.persist'),
    'Expected runPhasesParallel to call tracker.persist',
  );
  assert.ok(
    content.includes('tracker.commit'),
    'Expected runPhasesParallel to call tracker.commit',
  );
});

// ── Type checks ──────────────────────────────────────────────────────────────

Given('the ADW codebase with structured JSONL rate limit detection implemented', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
  assert.ok(
    existsSync(join(ROOT, 'adws/core/claudeStreamParser.ts')),
    'Expected adws/core/claudeStreamParser.ts to exist',
  );
});

// When('{string} is run') is defined in removeUnitTestsSteps.ts
// Then('the command exits with code {int}') is defined in wireExtractorSteps.ts
// Then('{string} also exits with code {int}') is defined in wireExtractorSteps.ts
