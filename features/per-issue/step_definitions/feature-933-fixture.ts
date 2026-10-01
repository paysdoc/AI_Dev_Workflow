/**
 * Shared fixtures for feature-933's step files: throwaway directories and workflow state that every
 * scenario removes afterwards. Nothing here reaches GitHub or starts the real Claude CLI.
 */

import { After } from '@cucumber/cucumber';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';

const tempDirs: string[] = [];
const adwIds: string[] = [];

export function trackTempDir(dir: string): void {
  tempDirs.push(dir);
}

/** `agents/<adwId>` and `logs/<adwId>` are removed after the scenario. */
export function trackAdwId(adwId: string): void {
  adwIds.push(adwId);
}

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  trackTempDir(dir);
  return dir;
}

export function writeFixtureFile(root: string, relPath: string, body: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

After({ tags: '@adw-933' }, function () {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const adwId of adwIds.splice(0)) {
    rmSync(join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
    rmSync(join(LOGS_DIR, adwId), { recursive: true, force: true });
  }
});
