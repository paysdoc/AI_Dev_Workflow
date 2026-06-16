/**
 * Gherkin freeze — snapshot, detect changes, and restore `.feature` files.
 *
 * fs calls are isolated here at the edges; the permit/reject decision
 * lives in `adws/core/resolveFreezeGuard.ts`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.worktrees']);

function scanFeatureFiles(dir: string, base: string, map: Map<string, string>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        scanFeatureFiles(join(dir, entry.name), base, map);
      }
    } else if (entry.isFile() && entry.name.endsWith('.feature')) {
      const full = join(dir, entry.name);
      const rel = relative(base, full);
      try {
        map.set(rel, readFileSync(full, 'utf-8'));
      } catch {
        // skip unreadable files
      }
    }
  }
}

export function captureGherkinSnapshot(worktreePath: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  scanFeatureFiles(worktreePath, worktreePath, snapshot);
  return snapshot;
}

export function collectChangedFeaturePaths(
  snapshot: Map<string, string>,
  worktreePath: string,
): string[] {
  const current = new Map<string, string>();
  scanFeatureFiles(worktreePath, worktreePath, current);

  const changed: string[] = [];

  for (const [relPath, snapshotContent] of snapshot) {
    const currentContent = current.get(relPath);
    if (currentContent === undefined || currentContent !== snapshotContent) {
      changed.push(relPath);
    }
  }

  for (const relPath of current.keys()) {
    if (!snapshot.has(relPath)) {
      changed.push(relPath);
    }
  }

  return changed;
}

export function restoreGherkinSnapshot(
  snapshot: Map<string, string>,
  worktreePath: string,
): string[] {
  const current = new Map<string, string>();
  scanFeatureFiles(worktreePath, worktreePath, current);

  const restored: string[] = [];

  for (const [relPath, content] of snapshot) {
    const full = join(worktreePath, relPath);
    const currentContent = current.get(relPath);
    if (currentContent === undefined || currentContent !== content) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf-8');
      restored.push(relPath);
    }
  }

  for (const relPath of current.keys()) {
    if (!snapshot.has(relPath)) {
      rmSync(join(worktreePath, relPath));
      restored.push(relPath);
    }
  }

  return restored;
}
