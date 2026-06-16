import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  captureGherkinSnapshot,
  collectChangedFeaturePaths,
  restoreGherkinSnapshot,
} from '../gherkinFreeze';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gherkin-freeze-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeFile(base: string, relPath: string, content: string): void {
  const full = path.join(base, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

describe('captureGherkinSnapshot', () => {
  it('captures .feature files', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    writeFile(dir, 'features/sub/b.feature', 'Feature: B');
    const snap = captureGherkinSnapshot(dir);
    expect(snap.size).toBe(2);
    expect(snap.get('features/a.feature')).toBe('Feature: A');
    expect(snap.get('features/sub/b.feature')).toBe('Feature: B');
  });

  it('ignores non-.feature files', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    writeFile(dir, 'features/steps.ts', 'const x = 1;');
    const snap = captureGherkinSnapshot(dir);
    expect(snap.size).toBe(1);
  });

  it('excludes node_modules and .git', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    writeFile(dir, 'node_modules/pkg/a.feature', 'Feature: Pkg');
    writeFile(dir, '.git/COMMIT_EDITMSG', '');
    const snap = captureGherkinSnapshot(dir);
    expect(snap.size).toBe(1);
    expect([...snap.keys()]).toContain('features/a.feature');
  });
});

describe('collectChangedFeaturePaths', () => {
  it('no changes → empty list', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    expect(collectChangedFeaturePaths(snap, dir)).toEqual([]);
  });

  it('modified .feature → collected', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    writeFile(dir, 'features/a.feature', 'Feature: A modified');
    expect(collectChangedFeaturePaths(snap, dir)).toContain('features/a.feature');
  });

  it('deleted .feature → collected', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    fs.rmSync(path.join(dir, 'features/a.feature'));
    expect(collectChangedFeaturePaths(snap, dir)).toContain('features/a.feature');
  });

  it('added .feature → collected', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    writeFile(dir, 'features/b.feature', 'Feature: B');
    expect(collectChangedFeaturePaths(snap, dir)).toContain('features/b.feature');
  });

  it('non-.feature edits are ignored', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    writeFile(dir, 'src/app.ts', 'const x = 1;');
    writeFile(dir, 'src/app.ts', 'const x = 2;');
    expect(collectChangedFeaturePaths(snap, dir)).toEqual([]);
  });
});

describe('restoreGherkinSnapshot', () => {
  it('restores modified file to snapshot content', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    writeFile(dir, 'features/a.feature', 'Feature: A modified');
    const restored = restoreGherkinSnapshot(snap, dir);
    expect(restored).toContain('features/a.feature');
    expect(fs.readFileSync(path.join(dir, 'features/a.feature'), 'utf-8')).toBe('Feature: A');
  });

  it('recreates deleted file with original content', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    fs.rmSync(path.join(dir, 'features/a.feature'));
    const restored = restoreGherkinSnapshot(snap, dir);
    expect(restored).toContain('features/a.feature');
    expect(fs.readFileSync(path.join(dir, 'features/a.feature'), 'utf-8')).toBe('Feature: A');
  });

  it('deletes added file', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    writeFile(dir, 'features/b.feature', 'Feature: B');
    const restored = restoreGherkinSnapshot(snap, dir);
    expect(restored).toContain('features/b.feature');
    expect(fs.existsSync(path.join(dir, 'features/b.feature'))).toBe(false);
  });

  it('no changes → returns empty list', () => {
    const dir = makeTmp();
    writeFile(dir, 'features/a.feature', 'Feature: A');
    const snap = captureGherkinSnapshot(dir);
    const restored = restoreGherkinSnapshot(snap, dir);
    expect(restored).toEqual([]);
  });
});
