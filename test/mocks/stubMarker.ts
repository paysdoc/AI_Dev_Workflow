/**
 * Where the Claude CLI stub finds the marker manifest that programs it. Pure apart from the
 * existence probe, which is injectable: no I/O of its own beyond `existsSync`.
 */

import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

export const STUB_MANIFEST_MARKER = '.adw-stub-manifest.json';

/** The nearest marker at or above `startDir`, or undefined when none lies between it and the filesystem root. */
export function findStubManifestMarker(startDir: string, exists: (path: string) => boolean = existsSync): string | undefined {
  const directory = resolve(startDir);
  const candidate = join(directory, STUB_MANIFEST_MARKER);
  if (exists(candidate)) return candidate;

  const parent = dirname(directory);
  return parent === directory ? undefined : findStubManifestMarker(parent, exists);
}
