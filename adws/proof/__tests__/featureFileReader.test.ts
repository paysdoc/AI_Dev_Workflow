import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readFeatureFiles } from '../featureFileReader';

let root: string;

function write(relPath: string, content = ''): void {
  const file = path.join(root, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-file-reader-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readFeatureFiles', () => {
  it('finds the feature files of every nested directory, with their content, sorted by path', () => {
    write('regression/cart.feature', 'Feature: Cart\n');
    write('per-issue/feature-1.feature', 'Feature: One\n');
    write('top.feature', 'Feature: Top\n');

    expect(readFeatureFiles(root)).toEqual([
      { path: 'per-issue/feature-1.feature', content: 'Feature: One\n' },
      { path: 'regression/cart.feature', content: 'Feature: Cart\n' },
      { path: 'top.feature', content: 'Feature: Top\n' },
    ]);
  });

  it('reads nothing but feature files: not step definitions, nor the specs the generator writes', () => {
    write('steps/cart.ts');
    write('per-issue/feature-1.feature.spec.js');
    write('per-issue/notes.md');
    write('per-issue/feature-1.feature', 'Feature: One\n');

    expect(readFeatureFiles(root).map(file => file.path)).toEqual(['per-issue/feature-1.feature']);
  });

  it('skips node_modules at any depth', () => {
    write('node_modules/pkg/example.feature');
    write('steps/node_modules/pkg/example.feature');
    write('kept.feature');

    expect(readFeatureFiles(root).map(file => file.path)).toEqual(['kept.feature']);
  });

  it('skips directories whose name starts with a dot, such as the generator output', () => {
    write('.features-gen/per-issue/generated.feature');
    write('.git/hooks/example.feature');
    write('kept.feature');

    expect(readFeatureFiles(root).map(file => file.path)).toEqual(['kept.feature']);
  });

  it('gives [] for a directory that does not exist', () => {
    expect(readFeatureFiles(path.join(root, 'missing'))).toEqual([]);
  });

  it('gives [] for a directory without feature files', () => {
    write('steps/cart.ts');

    expect(readFeatureFiles(root)).toEqual([]);
  });
});
