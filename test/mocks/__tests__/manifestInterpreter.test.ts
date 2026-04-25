import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { applyManifest } from '../manifestInterpreter.ts';

const worktrees: string[] = [];

function makeTempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
  worktrees.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of worktrees.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeManifest(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ---------------------------------------------------------------------------
// Case 1: Well-formed manifest with two distinct edits
// ---------------------------------------------------------------------------

describe('applyManifest — well-formed manifest', () => {
  it('applies two edits, returns resolved paths and jsonlPath', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = {
      jsonlPath: 'fixtures/stub-payload.json',
      edits: [
        { path: 'src/alpha.ts', contents: 'export const alpha = 1;' },
        { path: 'src/beta.ts', contents: 'export const beta = 2;' },
      ],
    };
    const manifestPath = writeManifest(manifestDir, 'manifest.json', JSON.stringify(manifest));

    const result = applyManifest(manifestPath, worktree);

    expect(result.editsApplied).toHaveLength(2);
    expect(result.editsApplied[0]).toBe(resolve(worktree, 'src/alpha.ts'));
    expect(result.editsApplied[1]).toBe(resolve(worktree, 'src/beta.ts'));

    expect(readFileSync(result.editsApplied[0]!, 'utf-8')).toBe('export const alpha = 1;');
    expect(readFileSync(result.editsApplied[1]!, 'utf-8')).toBe('export const beta = 2;');

    expect(result.jsonlPath).toBe(resolve(worktree, 'fixtures/stub-payload.json'));
  });
});

// ---------------------------------------------------------------------------
// Case 2: Malformed manifest (invalid JSON)
// ---------------------------------------------------------------------------

describe('applyManifest — malformed manifest', () => {
  it('throws with manifestInterpreter: prefix when manifest JSON is invalid', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();
    const manifestPath = writeManifest(manifestDir, 'bad.json', '{ this is not json }');

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/^manifestInterpreter:/);
  });

  it('throws with manifestInterpreter: prefix when manifest fails schema validation', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();
    // Missing required `jsonlPath` field
    const manifestPath = writeManifest(
      manifestDir,
      'schema-fail.json',
      JSON.stringify({ edits: [] }),
    );

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/^manifestInterpreter:/);
  });
});

// ---------------------------------------------------------------------------
// Case 3: No-op manifest (empty edits array)
// ---------------------------------------------------------------------------

describe('applyManifest — no-op manifest', () => {
  it('returns empty editsApplied and resolved jsonlPath without writing files', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = {
      jsonlPath: 'test/fixtures/jsonl/payloads/plan-agent.json',
      edits: [],
    };
    const manifestPath = writeManifest(manifestDir, 'noop.json', JSON.stringify(manifest));

    const result = applyManifest(manifestPath, worktree);

    expect(result.editsApplied).toHaveLength(0);
    expect(result.jsonlPath).toBe(
      resolve(worktree, 'test/fixtures/jsonl/payloads/plan-agent.json'),
    );
    // Confirm no stray files were written into the worktree
    const worktreeSrc = join(worktree, 'src');
    expect(existsSync(worktreeSrc)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 4: Conflicting edits (duplicate path)
// ---------------------------------------------------------------------------

describe('applyManifest — conflicting edits', () => {
  it('throws with conflicting edits message and leaves worktree unchanged', () => {
    const worktree = makeTempWorktree();
    const manifestDir = makeTempWorktree();

    const manifest = {
      jsonlPath: 'fixtures/payload.json',
      edits: [
        { path: 'shared/config.ts', contents: 'export const A = 1;' },
        { path: 'shared/config.ts', contents: 'export const B = 2;' },
      ],
    };
    const manifestPath = writeManifest(manifestDir, 'conflict.json', JSON.stringify(manifest));

    expect(() => applyManifest(manifestPath, worktree)).toThrow(/conflicting edits/);

    // The conflict is detected before any writes — the target file must not exist.
    expect(existsSync(join(worktree, 'shared/config.ts'))).toBe(false);
  });
});
