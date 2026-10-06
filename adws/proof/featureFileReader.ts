/**
 * The I/O half of the feature index: no parsing, no logging. The directory the generator writes
 * (`.features-gen`) and installed packages hold copies of feature files that are not the repository's own.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FeatureFileSource } from './featureScenarioIndex';

const FEATURE_EXTENSION = '.feature';

function isSkippedDirectory(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.');
}

function readEntries(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readSource(rootDir: string, absPath: string): FeatureFileSource | null {
  try {
    return {
      path: path.relative(rootDir, absPath).split(path.sep).join('/'),
      content: fs.readFileSync(absPath, 'utf-8'),
    };
  } catch {
    return null;
  }
}

function byPath(a: FeatureFileSource, b: FeatureFileSource): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/**
 * @param rootDir - Absolute path to the directory the scenario runner reads its feature files from.
 * @returns Every `.feature` file below it, with its path relative to `rootDir`, sorted; [] when the directory is absent.
 */
export function readFeatureFiles(rootDir: string): FeatureFileSource[] {
  if (!fs.existsSync(rootDir)) return [];

  const sources: FeatureFileSource[] = [];
  const pending: string[] = [rootDir];

  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of readEntries(directory)) {
      const absPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !isSkippedDirectory(entry.name)) {
        pending.push(absPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(FEATURE_EXTENSION)) continue;
      const source = readSource(rootDir, absPath);
      if (source) sources.push(source);
    }
  }

  return sources.sort(byPath);
}
