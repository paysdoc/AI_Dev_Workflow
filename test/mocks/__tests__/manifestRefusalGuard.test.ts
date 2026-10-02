import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applyManifest, findRefusedPaths, ManifestRefusalError } from '../manifestInterpreter.ts';
import { makeTempWorktree, useTempDirCleanup, writeManifest } from './fixtures/manifestHarness.ts';

useTempDirCleanup();

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMITTED_MANIFESTS = resolve(__dirname, '../../fixtures/jsonl/manifests');

const DEFAULT_EDIT = { path: 'notes/default.md', contents: 'default\n' };

/** Paths a Then step reads as the system's output, or that lie beyond the worktree. */
const REFUSED_PATHS = [
  '.adw/state.json',
  'agents/surface-02/state.json',
  'agents/spawn_locks/acme_widgets_issue-1002.json',
  'agents/paused_queue.json',
  'agents',
  './agents/x',
  'src/../agents/x',
  './.adw/state.json',
  '../outside.txt',
];

const ALLOWED_PATHS = [
  '.adw/commands.md',
  '.adw/project.md',
  '.claude/commands/feature.md',
  'specs/issue-7-plan.md',
  'src/featureStub.ts',
  'adws/agents/planAgent.ts',
  'src/../specs/issue-7-plan.md',
];

function refusalOf(run: () => unknown): ManifestRefusalError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ManifestRefusalError);
    return err as ManifestRefusalError;
  }
  throw new Error('Expected the manifest to be refused, but it was applied');
}

/** One level down, so a path that climbs out of the worktree lands in a directory this test removes. */
function makeNestedWorktree(): string {
  const worktree = join(makeTempWorktree(), 'worktree');
  mkdirSync(worktree);
  return worktree;
}

function manifestFile(manifest: Record<string, unknown>): string {
  return writeManifest(makeTempWorktree(), 'manifest.json', JSON.stringify(manifest));
}

describe('applyManifest — refusal guard on a top-level edit', () => {
  it.each(REFUSED_PATHS)('refuses an edit of %s, naming it, and writes none of the manifest\'s edits', (refused) => {
    const worktree = makeNestedWorktree();
    const manifest = { jsonlPath: 'top.json', edits: [DEFAULT_EDIT, { path: refused, contents: '{}' }] };

    const error = refusalOf(() => applyManifest(manifestFile(manifest), worktree, "/feature '7'"));

    expect(error.refusedPaths).toEqual([refused]);
    expect(error.message).toContain(refused);
    expect(existsSync(join(worktree, DEFAULT_EDIT.path))).toBe(false);
    expect(existsSync(resolve(worktree, refused))).toBe(false);
  });

  it('refuses an absolute path outside the worktree', () => {
    const worktree = makeNestedWorktree();
    const outside = join(makeTempWorktree(), 'outside.txt');
    const manifest = { jsonlPath: 'top.json', edits: [DEFAULT_EDIT, { path: outside, contents: 'x' }] };

    const error = refusalOf(() => applyManifest(manifestFile(manifest), worktree, "/feature '7'"));

    expect(error.refusedPaths).toEqual([outside]);
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(join(worktree, DEFAULT_EDIT.path))).toBe(false);
  });

  it('refuses an absolute path that lands on the worktree\'s own state file', () => {
    const worktree = makeNestedWorktree();
    const state = join(worktree, '.adw/state.json');
    const manifest = { jsonlPath: 'top.json', edits: [{ path: state, contents: '{}' }] };

    expect(refusalOf(() => applyManifest(manifestFile(manifest), worktree, '')).refusedPaths).toEqual([state]);
    expect(existsSync(state)).toBe(false);
  });

  it('names every refused path in the error, in declaration order, with the manifest it came from', () => {
    const worktree = makeNestedWorktree();
    const manifest = {
      jsonlPath: 'top.json',
      edits: [{ path: '.adw/state.json', contents: '{}' }, DEFAULT_EDIT, { path: 'agents/paused_queue.json', contents: '[]' }],
    };
    const manifestPath = manifestFile(manifest);

    const error = refusalOf(() => applyManifest(manifestPath, worktree, "/feature '7'"));

    expect(error.refusedPaths).toEqual(['.adw/state.json', 'agents/paused_queue.json']);
    expect(error.message).toBe(
      `manifestInterpreter: refused manifest at ${manifestPath}: it would write .adw/state.json, agents/paused_queue.json, which a Then step reads as the system's output`,
    );
  });
});

describe('applyManifest — refusal guard on a delete', () => {
  it.each(['.adw/state.json', 'agents/surface-04', '../outside.txt'])('refuses to delete %s and leaves what is there', (refused) => {
    const worktree = makeNestedWorktree();
    const target = resolve(worktree, refused);
    if (!refused.startsWith('..')) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'system output', 'utf-8');
    }
    const manifest = { jsonlPath: 'top.json', edits: [DEFAULT_EDIT], deletes: [refused] };

    const error = refusalOf(() => applyManifest(manifestFile(manifest), worktree, "/feature '7'"));

    expect(error.refusedPaths).toEqual([refused]);
    expect(existsSync(join(worktree, DEFAULT_EDIT.path))).toBe(false);
    if (!refused.startsWith('..')) expect(readFileSync(target, 'utf-8')).toBe('system output');
  });
});

describe('applyManifest — refusal guard on a per-command entry the prompt does not select', () => {
  it.each(['agents/surface-04/state.json', '.adw/state.json'])('refuses a /commit entry that writes %s, asked with a /feature prompt', (refused) => {
    const worktree = makeNestedWorktree();
    const manifest = {
      jsonlPath: 'top.json',
      edits: [DEFAULT_EDIT],
      byCommand: {
        '/feature': { jsonlPath: 'plan.json', edits: [{ path: 'specs/issue-7-plan.md', contents: 'plan\n' }] },
        '/commit': { jsonlPath: 'commit.json', edits: [{ path: refused, contents: '{}' }] },
      },
    };

    const error = refusalOf(() => applyManifest(manifestFile(manifest), worktree, "/feature '7'"));

    expect(error.refusedPaths).toEqual([refused]);
    expect(existsSync(join(worktree, 'specs/issue-7-plan.md'))).toBe(false);
    expect(existsSync(join(worktree, DEFAULT_EDIT.path))).toBe(false);
    expect(existsSync(join(worktree, refused))).toBe(false);
  });

  it('refuses before the onCommitCommand stand-in would commit anything', () => {
    const worktree = makeNestedWorktree();
    const manifest = {
      jsonlPath: 'top.json',
      edits: [],
      onCommitCommand: 'stage-all-and-commit',
      byCommand: { '/feature': { jsonlPath: 'plan.json', edits: [{ path: '.adw/state.json', contents: '{}' }] } },
    };

    expect(refusalOf(() => applyManifest(manifestFile(manifest), worktree, "/commit 'x' '{}'")).refusedPaths).toEqual(['.adw/state.json']);
  });
});

describe('applyManifest — refusal guard lets through what no Then step reads as output', () => {
  it.each(ALLOWED_PATHS)('applies an edit of %s', (allowed) => {
    const worktree = makeNestedWorktree();
    const manifest = { jsonlPath: 'top.json', edits: [{ path: allowed, contents: 'allowed\n' }] };

    const result = applyManifest(manifestFile(manifest), worktree, "/feature '7'");

    expect(result.editsApplied).toEqual([resolve(worktree, allowed)]);
    expect(readFileSync(resolve(worktree, allowed), 'utf-8')).toBe('allowed\n');
  });

  it('applies a path inside the worktree given in absolute form', () => {
    const worktree = makeNestedWorktree();
    const inside = join(worktree, 'specs/issue-7-plan.md');
    const manifest = { jsonlPath: 'top.json', edits: [{ path: inside, contents: 'plan\n' }] };

    expect(applyManifest(manifestFile(manifest), worktree, "/feature '7'").editsApplied).toEqual([inside]);
  });
});

describe('findRefusedPaths', () => {
  const worktree = '/tmp/worktree';

  it('returns the declared spelling of every refused path, once, across edits, deletes and entries', () => {
    const refused = findRefusedPaths(
      {
        edits: [{ path: './agents/x', contents: '' }, { path: 'src/a.ts', contents: '' }],
        deletes: ['.adw/state.json', './agents/x'],
        byCommand: { '/commit': { jsonlPath: 'p.json', edits: [{ path: '../out.txt', contents: '' }] }, '/feature': { jsonlPath: 'p.json' } },
      },
      worktree,
    );

    expect(refused).toEqual(['./agents/x', '.adw/state.json', '../out.txt']);
  });

  it('returns nothing for a manifest that declares no edits', () => {
    expect(findRefusedPaths({ edits: [] }, worktree)).toEqual([]);
  });

  it('returns nothing for a path that merely starts with the letters of a refused one', () => {
    expect(findRefusedPaths({ edits: [{ path: 'agents-notes/x.md', contents: '' }, { path: '.adw/state.json.bak', contents: '' }] }, worktree)).toEqual([]);
  });

  it('refuses none of the manifests committed under test/fixtures/jsonl/manifests', () => {
    const files = readdirSync(COMMITTED_MANIFESTS).filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);

    const refusedByFile = files
      .map((name) => ({ name, refused: findRefusedPaths(JSON.parse(readFileSync(join(COMMITTED_MANIFESTS, name), 'utf-8')), worktree) }))
      .filter(({ refused }) => refused.length > 0);

    expect(refusedByFile).toEqual([]);
  });
});
