import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { harvestProofArtifacts } from '../proofArtifactHarvester';

const tmpDirs: string[] = [];

function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-harvest-'));
  tmpDirs.push(dir);
  return dir;
}

function touch(absPath: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, '');
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('harvestProofArtifacts', () => {
  it('returns [] for an empty directory', () => {
    const dir = mkTmp();
    expect(harvestProofArtifacts(dir)).toEqual([]);
  });

  it('returns [] for a missing directory', () => {
    expect(harvestProofArtifacts('/nonexistent/path/that/does/not/exist')).toEqual([]);
  });

  it('finds images nested in subdirectories', () => {
    const dir = mkTmp();
    touch(path.join(dir, 'scenarioA', 'step-1.png'));
    touch(path.join(dir, 'scenarioA', 'step-2.png'));
    touch(path.join(dir, 'scenarioB', 'sub', 'confirm.png'));

    const results = harvestProofArtifacts(dir);
    expect(results).toHaveLength(3);
    expect(results.map(r => r.relPath)).toContain('scenarioB/sub/confirm.png');
  });

  it('includes only image extensions and excludes non-images', () => {
    const dir = mkTmp();
    touch(path.join(dir, 'screen.png'));
    touch(path.join(dir, 'photo.jpg'));
    touch(path.join(dir, 'capture.jpeg'));
    touch(path.join(dir, 'animation.gif'));
    touch(path.join(dir, 'clip.webp'));
    touch(path.join(dir, 'report.xml'));
    touch(path.join(dir, 'trace.zip'));
    touch(path.join(dir, 'run.log'));
    touch(path.join(dir, 'noext'));

    const results = harvestProofArtifacts(dir);
    expect(results).toHaveLength(5);
    const names = results.map(r => r.relPath);
    expect(names).toContain('screen.png');
    expect(names).toContain('photo.jpg');
    expect(names).toContain('capture.jpeg');
    expect(names).toContain('animation.gif');
    expect(names).toContain('clip.webp');
    expect(names).not.toContain('report.xml');
    expect(names).not.toContain('trace.zip');
  });

  it('matches image extensions case-insensitively', () => {
    const dir = mkTmp();
    touch(path.join(dir, 'A.PNG'));
    touch(path.join(dir, 'B.JPG'));

    const results = harvestProofArtifacts(dir);
    expect(results).toHaveLength(2);
  });

  it('returns results sorted by relPath', () => {
    const dir = mkTmp();
    touch(path.join(dir, 'z', 'last.png'));
    touch(path.join(dir, 'a', 'first.png'));
    touch(path.join(dir, 'm', 'middle.png'));

    const results = harvestProofArtifacts(dir);
    const relPaths = results.map(r => r.relPath);
    expect(relPaths).toEqual([...relPaths].sort());
  });

  it('relPath uses forward slashes even on windows-style separators', () => {
    const dir = mkTmp();
    touch(path.join(dir, 'nested', 'deep', 'image.png'));

    const results = harvestProofArtifacts(dir);
    expect(results[0].relPath).toBe('nested/deep/image.png');
  });

  it('absPath is the full absolute path', () => {
    const dir = mkTmp();
    touch(path.join(dir, 'shot.jpg'));

    const results = harvestProofArtifacts(dir);
    expect(results[0].absPath).toBe(path.join(dir, 'shot.jpg'));
  });
});
