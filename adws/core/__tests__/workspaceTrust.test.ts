import { describe, it, expect, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { ensureWorkspaceTrusted, claudeConfigPath, type WorkspaceTrustFs } from '../workspaceTrust';

const HOME = '/home/tester';
const CONFIG_FILE = path.join(HOME, '.claude.json');
const homedir = () => HOME;
const WORKSPACE = '/repos/acme/webapp';

interface FsFixture {
  fsDeps: WorkspaceTrustFs;
  files: Map<string, string>;
  writes: Array<{ path: string; data: string }>;
  renames: Array<{ from: string; to: string }>;
}

function makeFsFixture(initialFiles: Record<string, string> = {}): FsFixture {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const writes: Array<{ path: string; data: string }> = [];
  const renames: Array<{ from: string; to: string }> = [];

  function readFileSync(filePath: string): string {
    const content = files.get(filePath);
    if (content === undefined) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  }

  function writeFileSync(filePath: string, data: string): void {
    writes.push({ path: filePath, data });
    files.set(filePath, data);
  }

  function renameSync(from: string, to: string): void {
    renames.push({ from, to });
    const content = files.get(from);
    if (content !== undefined) {
      files.set(to, content);
      files.delete(from);
    }
  }

  const fsDeps = { readFileSync, writeFileSync, renameSync } as unknown as WorkspaceTrustFs;

  return { fsDeps, files, writes, renames };
}

function writtenConfig(fixture: FsFixture): Record<string, unknown> {
  const raw = fixture.files.get(CONFIG_FILE);
  expect(raw).toBeDefined();
  return JSON.parse(raw as string) as Record<string, unknown>;
}

describe('ensureWorkspaceTrusted', () => {
  it('creates a projects entry in a fresh file with no projects key', () => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify({ numStartups: 3 }) });
    const log = vi.fn();

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result).toEqual({ action: 'trusted' });
    const written = writtenConfig(fixture);
    const projects = written.projects as Record<string, Record<string, unknown>>;
    expect(projects[WORKSPACE].hasTrustDialogAccepted).toBe(true);
    expect(written.numStartups).toBe(3);
  });

  it('flips an existing false entry to true, preserving sibling keys and other projects', () => {
    const initial = {
      projects: {
        [WORKSPACE]: { hasTrustDialogAccepted: false, allowedTools: ['Bash'], lastCost: 1.23 },
        '/repos/other': { hasTrustDialogAccepted: true, allowedTools: ['Read'] },
      },
      someOtherTopLevelKey: 'preserved',
    };
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify(initial) });
    const log = vi.fn();

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result).toEqual({ action: 'trusted' });
    const written = writtenConfig(fixture);
    const projects = written.projects as Record<string, Record<string, unknown>>;
    expect(projects[WORKSPACE]).toEqual({ hasTrustDialogAccepted: true, allowedTools: ['Bash'], lastCost: 1.23 });
    expect(projects['/repos/other']).toEqual(initial.projects['/repos/other']);
    expect(written.someOtherTopLevelKey).toBe('preserved');
  });

  it('performs no write when already trusted', () => {
    const initial = { projects: { [WORKSPACE]: { hasTrustDialogAccepted: true } } };
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify(initial) });
    const log = vi.fn();

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result).toEqual({ action: 'already_trusted' });
    expect(fixture.writes.length).toBe(0);
    expect(fixture.renames.length).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('skips without throwing when the file is missing', () => {
    const fixture = makeFsFixture({});
    const log = vi.fn();

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result.action).toBe('skipped');
    expect((result as { reason: string }).reason).toMatch(/cannot read/);
    expect(fixture.writes.length).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.any(String), 'warn');
  });

  it('skips without throwing on corrupt JSON', () => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: '{ nope' });
    const log = vi.fn();

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result.action).toBe('skipped');
    expect((result as { reason: string }).reason).toMatch(/cannot parse/);
    expect(fixture.writes.length).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.any(String), 'warn');
  });

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
  ])('skips without throwing when the top-level JSON is %s', (_label, json) => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: json });
    const log = vi.fn();

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result.action).toBe('skipped');
    expect(fixture.writes.length).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.any(String), 'warn');
  });

  it('skips without throwing when projects is present but not an object', () => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify({ projects: 'nope' }) });
    const log = vi.fn();

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result.action).toBe('skipped');
    expect((result as { reason: string }).reason).toMatch(/projects is not an object/);
    expect(fixture.writes.length).toBe(0);
  });

  it('skips without throwing when writeFileSync throws (unwritable file)', () => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify({}) });
    const log = vi.fn();
    fixture.fsDeps.writeFileSync = (() => {
      const err: NodeJS.ErrnoException = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    }) as WorkspaceTrustFs['writeFileSync'];

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result.action).toBe('skipped');
    expect((result as { reason: string }).reason).toMatch(/cannot write/);
    expect(log).toHaveBeenCalledWith(expect.any(String), 'warn');
    expect(fixture.renames.length).toBe(0);
  });

  it('skips without throwing when renameSync throws', () => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify({}) });
    const log = vi.fn();
    fixture.fsDeps.renameSync = (() => {
      throw new Error('rename failed');
    }) as WorkspaceTrustFs['renameSync'];

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps, log });

    expect(result.action).toBe('skipped');
    expect((result as { reason: string }).reason).toMatch(/cannot write/);
    expect(log).toHaveBeenCalledWith(expect.any(String), 'warn');
  });

  it('writes atomically: tmp then rename, never a direct write of the target', () => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify({}) });

    const result = ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps });

    expect(result).toEqual({ action: 'trusted' });
    expect(fixture.writes.length).toBe(1);
    expect(fixture.writes[0].path).toBe(`${CONFIG_FILE}.tmp`);
    expect(fixture.renames.length).toBe(1);
    expect(fixture.renames[0]).toEqual({ from: `${CONFIG_FILE}.tmp`, to: CONFIG_FILE });
    expect(path.dirname(fixture.renames[0].from)).toBe(path.dirname(fixture.renames[0].to));
    expect(fixture.writes.every((w) => w.path !== CONFIG_FILE)).toBe(true);
  });

  it('stores the workspace path verbatim as the key, without mutating the parsed input', () => {
    const weirdPath = '/private/var/folders/x/workspace/';
    const initial = { projects: {} };
    const before = JSON.parse(JSON.stringify(initial));
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify(initial) });

    const result = ensureWorkspaceTrusted(weirdPath, { homedir, fsDeps: fixture.fsDeps });

    expect(result).toEqual({ action: 'trusted' });
    const written = writtenConfig(fixture);
    const projects = written.projects as Record<string, unknown>;
    expect(Object.keys(projects)).toEqual([weirdPath]);
    expect(initial).toEqual(before);
  });

  it('claudeConfigPath defaults to os.homedir()', () => {
    const p = claudeConfigPath();
    expect(p.startsWith(os.homedir())).toBe(true);
    expect(p.endsWith('.claude.json')).toBe(true);
  });

  it('writes 2-space-indented JSON', () => {
    const fixture = makeFsFixture({ [CONFIG_FILE]: JSON.stringify({}) });

    ensureWorkspaceTrusted(WORKSPACE, { homedir, fsDeps: fixture.fsDeps });

    const raw = fixture.files.get(CONFIG_FILE) as string;
    expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2));
    expect(raw).toContain('\n  ');
  });
});
