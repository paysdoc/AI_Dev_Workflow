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

describe('collectChangedFeaturePaths — boundary tags are no part of the frozen contract', () => {
  const SCENARIO = ['Feature: Orders', '', '  @adw-1139', '  Scenario: Orders are listed', '    Given an order', '    Then it is listed', ''].join('\n');

  function snapshotOf(content: string): { dir: string; snap: Map<string, string> } {
    const dir = makeTmp();
    writeFile(dir, 'features/orders.feature', content);
    return { dir, snap: captureGherkinSnapshot(dir) };
  }

  it('collectChangedFeaturePaths does not report a file whose only change is a boundary tag added to an existing tag line', () => {
    const { dir, snap } = snapshotOf(SCENARIO);
    writeFile(dir, 'features/orders.feature', SCENARIO.replace('  @adw-1139', '  @adw-1139 @boundary-cli'));
    expect(collectChangedFeaturePaths(snap, dir)).toEqual([]);
  });

  it('collectChangedFeaturePaths does not report a file whose only change is a new tag line holding a boundary tag', () => {
    const { dir, snap } = snapshotOf(SCENARIO);
    writeFile(dir, 'features/orders.feature', SCENARIO.replace('  @adw-1139', '  @boundary-cli\n  @adw-1139'));
    expect(collectChangedFeaturePaths(snap, dir)).toEqual([]);
  });

  it('collectChangedFeaturePaths reports a file whose boundary tag changed together with a step', () => {
    const { dir, snap } = snapshotOf(SCENARIO.replace('  @adw-1139', '  @adw-1139 @boundary-browser'));
    writeFile(dir, 'features/orders.feature', SCENARIO.replace('  @adw-1139', '  @adw-1139 @boundary-cli').replace('Then it is listed', 'Then it is shown'));
    expect(collectChangedFeaturePaths(snap, dir)).toEqual(['features/orders.feature']);
  });

  it.each([
    ['@adw-N added', '  @adw-1139', '  @adw-1139 @adw-1140'],
    ['@adw-N removed', '  @adw-1139', '  @smoke'],
    ['another tag added beside a boundary tag', '  @adw-1139', '  @adw-1139 @boundary-cli @regression'],
  ])('collectChangedFeaturePaths still reports a file whose @adw-N or any other non-boundary tag was added or removed: %s', (_case, from, to) => {
    const { dir, snap } = snapshotOf(SCENARIO);
    writeFile(dir, 'features/orders.feature', SCENARIO.replace(from, to));
    expect(collectChangedFeaturePaths(snap, dir)).toEqual(['features/orders.feature']);
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
