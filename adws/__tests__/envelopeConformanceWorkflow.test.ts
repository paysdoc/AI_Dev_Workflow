import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Contract guard: the live leg of the envelope conformance gate decides the run. It has no
 * condition that could skip it, the secret reaches that one step only, and a missing secret fails
 * the step with an error naming it, where a warning would leave the run green.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github/workflows/envelope-conformance.yml');
const LIVE_STEP_NAME = 'Live envelope check against the pinned CLI';

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '';

/** The lines of a block scalar: those up to the first non-blank line indented less than the block, with its indentation removed. */
function blockScalar(lines: readonly string[]): string {
  const first = lines.find(line => !isBlank(line));
  if (first === undefined) return '';
  const indent = indentOf(first);
  const end = lines.findIndex(line => !isBlank(line) && indentOf(line) < indent);
  return (end === -1 ? lines : lines.slice(0, end)).map(line => line.slice(indent)).join('\n');
}

/** The `run:` value of a step, written inline (`run: cmd`) or as a block (`run: |`). */
function readRunScript(step: string): string {
  const lines = step.split('\n');
  const runIndex = lines.findIndex(line => /^\s+run:/.test(line));
  if (runIndex === -1) throw new Error(`The step "${LIVE_STEP_NAME}" has no run script`);

  const inline = lines[runIndex].replace(/^\s+run:\s*/, '');
  return inline.startsWith('|') ? blockScalar(lines.slice(runIndex + 1)) : inline;
}

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
const liveStep = workflow.split(/^ {6}- name: /m).find(chunk => chunk.startsWith(LIVE_STEP_NAME)) ?? '';
const liveScript = readRunScript(liveStep);

let fakeBinDir = '';

function createFakeBun(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-envelope-gate-'));
  fs.writeFileSync(path.join(dir, 'bun'), '#!/bin/sh\necho "bun $*"\n', { mode: 0o755 });
  return dir;
}

beforeAll(() => {
  fakeBinDir = createFakeBun();
});

afterAll(() => {
  fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

/** Actions runs a `run` step that names no `shell` as `bash -e`. */
function runLiveStep(apiKey: string | undefined): SpawnSyncReturns<string> {
  const env: NodeJS.ProcessEnv = {
    PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    CLAUDE_CLI_VERSION: '2.1.282',
    ...(apiKey === undefined ? {} : { ANTHROPIC_API_KEY: apiKey }),
  };
  return spawnSync('bash', ['-e', '-c', liveScript], { env, encoding: 'utf-8' });
}

function expectMissingKeyToFail(apiKey: string | undefined): void {
  const result = runLiveStep(apiKey);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('::error');
  expect(result.stdout).toContain('ANTHROPIC_API_KEY');
  expect(result.stdout).not.toContain('bun run');
}

describe('envelope-conformance.yml live leg', () => {
  it('cannot be skipped or softened', () => {
    expect(workflow).not.toContain('HAS_ANTHROPIC_KEY');
    expect(workflow).not.toContain('::warning');
    expect(workflow).not.toContain('Live envelope check skipped');
    expect(liveStep).not.toMatch(/^\s+if:/m);
    expect(liveStep).not.toContain('continue-on-error');
  });

  it('hands the secret to the live step only', () => {
    expect(workflow.match(/secrets\.ANTHROPIC_API_KEY/g)).toHaveLength(1);
    expect(liveStep).toContain('ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}');
  });

  it.each<[string, string | undefined]>([
    ['empty, as Actions passes a secret that does not exist', ''],
    ['unset', undefined],
  ])('fails with an error naming the secret when the key is %s', (_description, apiKey) => {
    expectMissingKeyToFail(apiKey);
  });

  it('runs the live probe when the key is present', () => {
    const result = runLiveStep('test-key');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bun run jsonl:probe:check');
    expect(result.stdout).not.toContain('::error');
  });
});
