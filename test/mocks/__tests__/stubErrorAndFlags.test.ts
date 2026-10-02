import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseJsonlOutput, createJsonlParserState } from '../../../adws/core/claudeStreamParser.ts';
import { checkConformance } from '../../../adws/jsonl/conformanceCheck.ts';
import { buildErrorResultLine, resolveResponseMode, shouldRateLimit } from '../stubResponse.ts';
import { extractPrompt, VALUE_FLAGS } from '../stubArgs.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_PATH = resolve(__dirname, '../claude-cli-stub.ts');
const SCHEMA_PATH = resolve(__dirname, '../../../adws/jsonl/schema.json');
const RESULT_TEMPLATE_PATH = resolve(__dirname, '../../fixtures/jsonl/envelopes/result-message.jsonl');

const GUARDRAILS_JSON = '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"guard"}]}]}}';

/** The vector `runClaudeAgentWithCommand` builds, with `--settings` unshifted when guardrails are injected. */
function agentArgv(prompt: string, opts: { settings?: string } = {}): string[] {
  const cliArgs = ['--print', '--verbose', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--model', 'sonnet', '--effort', 'high', prompt];
  if (opts.settings !== undefined) cliArgs.unshift('--settings', opts.settings);
  return cliArgs;
}

const dirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('extractPrompt — value flags', () => {
  it('knows every value-taking flag ADW passes to claude', () => {
    expect([...VALUE_FLAGS].sort()).toEqual(['--effort', '--max-turns', '--model', '--output-format', '--settings']);
  });

  it.each([
    ['--output-format', 'stream-json'],
    ['--model', 'sonnet'],
    ['--effort', 'high'],
    ['--max-turns', '1'],
    ['--settings', GUARDRAILS_JSON],
  ])('skips the value of %s', (flag, value) => {
    expect(extractPrompt(['bun', 'stub', flag, value, "/feature '7'"])).toBe("/feature '7'");
  });

  it('returns the prompt of the exact vector runClaudeAgentWithCommand builds, without guardrails', () => {
    expect(extractPrompt(['bun', 'stub', ...agentArgv("/feature '7'")])).toBe("/feature '7'");
  });

  it('returns the prompt of the exact vector runClaudeAgentWithCommand builds, with --settings unshifted first', () => {
    expect(extractPrompt(['bun', 'stub', ...agentArgv("/feature '7'", { settings: GUARDRAILS_JSON })])).toBe("/feature '7'");
  });

  it('returns the prompt of the probe vector, which passes --max-turns 1', () => {
    const probe = ['--print', '--verbose', '--output-format', 'stream-json', '--model', 'haiku', '--max-turns', '1', '--dangerously-skip-permissions', 'say hello'];
    expect(extractPrompt(['bun', 'stub', ...probe])).toBe('say hello');
  });

  it('returns an empty string when no argument is a prompt', () => {
    expect(extractPrompt(['bun', 'stub', '--print', '--model', 'sonnet'])).toBe('');
  });
});

function writePayload(dir: string, name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify([{ type: 'text', text }]), 'utf-8');
  return path;
}

interface StubRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The stub as an agent spawns it: the worktree as cwd, so only the marker file can program it. */
function runStubInWorktree(worktree: string, argv: string[]): StubRun {
  const result = spawnSync('bun', [STUB_PATH, ...argv], {
    cwd: worktree,
    encoding: 'utf-8',
    env: { ...process.env, MOCK_STREAM_DELAY_MS: '0', MOCK_MANIFEST_PATH: undefined },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function writeMarker(worktree: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(worktree, '.adw-stub-manifest.json'), JSON.stringify(manifest), 'utf-8');
}

function lastLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1] ?? '') as Record<string, unknown>;
}

describe('claude-cli-stub — a prompt that follows the value-taking flags is answered by its command\'s entry', () => {
  it.each([
    ['without guardrails', undefined],
    ['with --settings <json> unshifted first', GUARDRAILS_JSON],
  ])('answers /feature from its entry, %s', (_label, settings) => {
    const worktree = makeTempDir('stub-flags-worktree-');
    const payloads = makeTempDir('stub-flags-payloads-');
    writeMarker(worktree, {
      jsonlPath: writePayload(payloads, 'default.json', 'the default answer'),
      edits: [],
      byCommand: { '/feature': { jsonlPath: writePayload(payloads, 'plan.json', 'the plan answer') } },
    });

    const { status, stdout } = runStubInWorktree(worktree, agentArgv("/feature '7'", { settings }));

    expect(status).toBe(0);
    expect(lastLine(stdout)['result']).toBe('the plan answer');
  });
});

describe('resolveResponseMode and buildErrorResultLine — the error response', () => {
  it('maps a manifest error response to the error mode', () => {
    expect(resolveResponseMode({ kind: 'error' }, {})).toEqual({ kind: 'error' });
  });

  it('prefers a manifest error response over MOCK_RESPONSE', () => {
    expect(resolveResponseMode({ kind: 'error' }, { MOCK_RESPONSE: 'rate-limited' })).toEqual({ kind: 'error' });
  });

  it('never rate-limits the error mode', () => {
    expect(shouldRateLimit({ kind: 'error' }, 0)).toBe(false);
  });

  it('turns the result template into an is_error result that keeps api_error_status null and subtype success', () => {
    const template = JSON.parse(readFileSync(RESULT_TEMPLATE_PATH, 'utf-8')) as Record<string, unknown>;

    const line = JSON.parse(buildErrorResultLine(template, 'the stub was asked to fail')) as Record<string, unknown>;

    expect(line['is_error']).toBe(true);
    expect(line['result']).toBe('the stub was asked to fail');
    expect(line['api_error_status']).toBeNull();
    expect(line['subtype']).toBe('success');
    expect(line['type']).toBe('result');
    expect(line['session_id']).toBe(template['session_id']);
    expect(template['is_error']).toBe(false);
  });
});

describe('claude-cli-stub — the error response', () => {
  it.each([
    ['top-level entry', { jsonlPath: 'unused.json', edits: [], response: { kind: 'error' } }],
    ['/feature entry', { jsonlPath: 'unused.json', edits: [], byCommand: { '/feature': { jsonlPath: 'unused.json', response: { kind: 'error' } } } }],
  ])('streams a result marked is_error and exits 1 when the %s answers with the error response', (_label, manifest) => {
    const worktree = makeTempDir('stub-error-worktree-');
    writeMarker(worktree, manifest);

    const { status, stdout } = runStubInWorktree(worktree, agentArgv("/feature '7'"));

    expect(status).toBe(1);
    const result = lastLine(stdout);
    expect(result['type']).toBe('result');
    expect(result['is_error']).toBe(true);
    expect(result['api_error_status']).toBeNull();
  });

  it('ends an agent run in a plain failure: no rate limit, no expired login, no server error, no overload', () => {
    const worktree = makeTempDir('stub-error-signals-');
    writeMarker(worktree, { jsonlPath: 'unused.json', edits: [], response: { kind: 'error' } });

    const { stdout } = runStubInWorktree(worktree, agentArgv("/feature '7'"));

    const state = createJsonlParserState();
    parseJsonlOutput(stdout, state);
    expect(state.lastResult).not.toBeNull();
    expect(state.rateLimitDetected).toBe(false);
    expect(state.authErrorDetected).toBe(false);
    expect(state.serverErrorDetected).toBe(false);
    expect(state.overloadedErrorDetected).toBe(false);
  });

  it('passes the committed envelope conformance schema', () => {
    const worktree = makeTempDir('stub-error-conformance-');
    writeMarker(worktree, { jsonlPath: 'unused.json', edits: [], response: { kind: 'error' } });
    const { stdout } = runStubInWorktree(worktree, agentArgv("/feature '7'"));
    const captured = makeTempDir('stub-error-fixture-');
    writeFileSync(join(captured, 'captured.jsonl'), stdout, 'utf-8');

    const results = checkConformance(SCHEMA_PATH, captured);

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('applies the selected entry\'s edits before it answers with the error', () => {
    const worktree = makeTempDir('stub-error-edits-');
    writeMarker(worktree, {
      jsonlPath: 'unused.json',
      edits: [],
      byCommand: { '/feature': { jsonlPath: 'unused.json', edits: [{ path: 'notes/partial.md', contents: 'partial\n' }], response: { kind: 'error' } } },
    });

    expect(runStubInWorktree(worktree, agentArgv("/feature '7'")).status).toBe(1);
    expect(existsSync(join(worktree, 'notes/partial.md'))).toBe(true);
  });
});

describe('claude-cli-stub — the refusal guard', () => {
  it('exits 1 naming .adw/state.json, and writes none of the manifest\'s edits', () => {
    const worktree = makeTempDir('stub-refusal-worktree-');
    writeMarker(worktree, {
      jsonlPath: 'unused.json',
      edits: [{ path: 'notes/default.md', contents: 'default\n' }, { path: '.adw/state.json', contents: '{"workflowStage":"awaiting_merge"}' }],
    });

    const { status, stdout, stderr } = runStubInWorktree(worktree, agentArgv("/feature '7'"));

    expect(status).toBe(1);
    expect(stderr).toContain('.adw/state.json');
    expect(stdout).not.toContain('"type":"result"');
    expect(existsSync(join(worktree, '.adw/state.json'))).toBe(false);
    expect(existsSync(join(worktree, 'notes/default.md'))).toBe(false);
  });
});
