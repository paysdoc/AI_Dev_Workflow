import { describe, it, expect } from 'vitest';
import { touchedPaths, type DiffFile } from '../unifiedDiff';

describe('touchedPaths', () => {
  const file = (oldPath: string | null, newPath: string | null): DiffFile => ({ oldPath, newPath, addedLines: [], removedLines: [] });

  it('is the one path of a modified file', () => {
    expect(touchedPaths(file('a.ts', 'a.ts'))).toEqual(['a.ts']);
  });

  it('is the new path of a created file', () => {
    expect(touchedPaths(file(null, 'a.ts'))).toEqual(['a.ts']);
  });

  it('is the old path of a deleted file', () => {
    expect(touchedPaths(file('a.ts', null))).toEqual(['a.ts']);
  });

  it('is both paths of a renamed file', () => {
    expect(touchedPaths(file('a.ts', 'b.ts'))).toEqual(['a.ts', 'b.ts']);
  });

  it('is empty for a file with no path', () => {
    expect(touchedPaths(file(null, null))).toEqual([]);
  });
});
