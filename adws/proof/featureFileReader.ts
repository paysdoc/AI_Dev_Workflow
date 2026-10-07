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

function sourcesOfEntry(rootDir: string, directory: string, entry: fs.Dirent): FeatureFileSource[] {
  const absPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return isSkippedDirectory(entry.name) ? [] : sourcesBelow(rootDir, absPath);
  if (!entry.isFile() || !entry.name.endsWith(FEATURE_EXTENSION)) return [];
  const source = readSource(rootDir, absPath);
  return source ? [source] : [];
}

function sourcesBelow(rootDir: string, directory: string): FeatureFileSource[] {
  return readEntries(directory).flatMap(entry => sourcesOfEntry(rootDir, directory, entry));
}

/**
 * @param rootDir - Absolute path to the directory the scenario runner reads its feature files from.
 * @returns Every `.feature` file below it, with its path relative to `rootDir`, sorted; [] when the directory is absent.
 */
export function readFeatureFiles(rootDir: string): FeatureFileSource[] {
  if (!fs.existsSync(rootDir)) return [];
  return sourcesBelow(rootDir, rootDir).sort(byPath);
}
