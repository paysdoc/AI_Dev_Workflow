import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseJsonlOutput, createJsonlParserState } from '../../../adws/core/claudeStreamParser.ts';
import { classifyProbeResult } from '../../../adws/triggers/rateLimitProbe.ts';
import { checkConformance } from '../../../adws/jsonl/conformanceCheck.ts';
import { resolveResponseMode, shouldRateLimit } from '../stubResponse.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_PATH = resolve(__dirname, '../claude-cli-stub.ts');
const SCHEMA_PATH = resolve(__dirname, '../../../adws/jsonl/schema.json');

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

function runStub(env: Record<string, string | undefined>, cwd?: string): { status: number | null; stdout: string } {
  const result = spawnSync('bun', [STUB_PATH, '--print', '--verbose', '--output-format', 'stream-json', 'ping'], {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, MOCK_STREAM_DELAY_MS: '0', ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

describe('claude-cli-stub — rate-limited response via MOCK_RESPONSE', () => {
  it('exits 1 with three JSON lines that end an agent run rate-limited and classify as limited', () => {
    const { status, stdout } = runStub({ MOCK_RESPONSE: 'rate-limited' });
    expect(status).toBe(1);

    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(3);

    const state = createJsonlParserState();
    parseJsonlOutput(stdout, state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.lastResult).not.toBeNull();
    expect((state.lastResult as unknown as Record<string, unknown>)['is_error']).toBe(true);
    expect((state.lastResult as unknown as Record<string, unknown>)['api_error_status']).toBe(429);

    expect(classifyProbeResult({ status, stdout, stderr: '' }).verdict).toBe('limited');
  });

  it('names a reset time that has not yet passed when no override is given', () => {
    const { stdout } = runStub({ MOCK_RESPONSE: 'rate-limited' });
    const event = JSON.parse(stdout.trim().split('\n')[0] ?? '') as { rate_limit_info: { resetsAt: number } };
    expect(event.rate_limit_info.resetsAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('echoes MOCK_RATE_LIMIT_RESETS_AT into rate_limit_info.resetsAt', () => {
    const { stdout } = runStub({ MOCK_RESPONSE: 'rate-limited', MOCK_RATE_LIMIT_RESETS_AT: '1790081400' });
    const event = JSON.parse(stdout.trim().split('\n')[0] ?? '') as { rate_limit_info: { resetsAt: number } };
    expect(event.rate_limit_info.resetsAt).toBe(1790081400);
  });

  it('passes the committed envelope conformance schema', () => {
    const { stdout } = runStub({ MOCK_RESPONSE: 'rate-limited' });
    const dir = makeTempDir('stub-rate-limited-fixture-');
    writeFileSync(join(dir, 'captured.jsonl'), stdout, 'utf-8');

    const results = checkConformance(SCHEMA_PATH, dir);
    expect(results.every(r => r.passed)).toBe(true);
  });
});

describe('claude-cli-stub — default response is unchanged', () => {
  it('exits 0 with no rate-limited signal when nothing asks for it', () => {
    const { status, stdout } = runStub({});
    expect(status).toBe(0);
    expect(stdout).not.toContain('rate_limit_event');

    const state = createJsonlParserState();
    parseJsonlOutput(stdout, state);
    expect(state.rateLimitDetected).toBe(false);
  });
});

describe('claude-cli-stub — manifest-driven limitedInvocations', () => {
  it('rejects the first invocation and answers normally on the second', () => {
    const cwd = makeTempDir('stub-manifest-cwd-');
    const manifest = {
      jsonlPath: 'payload.json',
      edits: [{ path: 'payload.json', contents: '[{"type":"text","text":"hello"}]\n' }],
      response: { kind: 'rate-limited', limitedInvocations: 1 },
    };
    writeFileSync(join(cwd, '.adw-stub-manifest.json'), JSON.stringify(manifest), 'utf-8');

    const first = runStub({}, cwd);
    expect(first.status).toBe(1);
    expect(first.stdout).toContain('rate_limit_event');

    const second = runStub({}, cwd);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('rate_limit_event');
  });
});

describe('resolveResponseMode — precedence and defaults', () => {
  it('prefers a manifest response over MOCK_RESPONSE', () => {
    const mode = resolveResponseMode(
      { kind: 'rate-limited', rateLimitType: 'from-manifest' },
      { MOCK_RESPONSE: 'rate-limited', MOCK_RATE_LIMIT_TYPE: 'from-env' },
    );
    expect(mode.kind).toBe('rate-limited');
    expect(mode.kind === 'rate-limited' && mode.rateLimitType).toBe('from-manifest');
  });

  it('falls back to MOCK_RESPONSE when there is no manifest response', () => {
    const mode = resolveResponseMode(undefined, { MOCK_RESPONSE: 'rate-limited' });
    expect(mode.kind).toBe('rate-limited');
  });

  it('defaults to the unchanged response when neither is set', () => {
    const mode = resolveResponseMode(undefined, {});
    expect(mode).toEqual({ kind: 'default' });
  });
});

describe('shouldRateLimit', () => {
  it('rejects every invocation when limitedInvocations is absent', () => {
    const mode = { kind: 'rate-limited' as const, resetsAt: 0, rateLimitType: 'five_hour' };
    expect(shouldRateLimit(mode, 0)).toBe(true);
    expect(shouldRateLimit(mode, 50)).toBe(true);
  });

  it('rejects only invocations below the limit', () => {
    const mode = { kind: 'rate-limited' as const, resetsAt: 0, rateLimitType: 'five_hour', limitedInvocations: 1 };
    expect(shouldRateLimit(mode, 0)).toBe(true);
    expect(shouldRateLimit(mode, 1)).toBe(false);
  });

  it('never rejects the default mode', () => {
    expect(shouldRateLimit({ kind: 'default' }, 0)).toBe(false);
  });
});
