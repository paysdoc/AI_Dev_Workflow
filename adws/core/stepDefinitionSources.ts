/**
 * The step-definition source files of a worktree: every file under the given directories whose name ends with one of the
 * given extensions, read as text. A directory that does not exist, or an entry that cannot be read, is skipped.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StepDefinitionSource } from './unusedStepReport';

function entriesOf(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Symbolic links are not followed, so a link back up the tree cannot loop. */
function filesOf(directory: string, entry: fs.Dirent): string[] {
  const entryPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return filesUnder(entryPath);
  return entry.isFile() ? [entryPath] : [];
}

function filesUnder(directory: string): string[] {
  return entriesOf(directory).flatMap((entry) => filesOf(directory, entry));
}

function readSource(rootPath: string, file: string): StepDefinitionSource[] {
  try {
    return [{ file, text: fs.readFileSync(path.join(rootPath, file), 'utf-8') }];
  } catch {
    return [];
  }
}

export function readStepDefinitionSources(rootPath: string, directories: readonly string[], extensions: readonly string[]): readonly StepDefinitionSource[] {
  if (extensions.length === 0) return [];
  const toRepositoryPath = (file: string): string => path.relative(rootPath, file).split(path.sep).join('/');
  const files = directories.flatMap((directory) => filesUnder(path.join(rootPath, directory))).map(toRepositoryPath);
  const sources = [...new Set(files)].filter((file) => extensions.some((extension) => file.endsWith(extension))).sort();
  return sources.flatMap((file) => readSource(rootPath, file));
}
