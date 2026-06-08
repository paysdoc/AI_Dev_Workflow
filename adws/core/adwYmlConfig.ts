/**
 * Deep module for reading `.github/adw.yml` at a target repo's worktree root
 * to determine the framework-upgrade auto-merge policy.
 *
 * The file lives outside `.adw/` so `/adw_init` regeneration of `.adw/` cannot
 * clobber it — the same rationale that keeps `.adw-version` outside `.adw/`
 * (see `adwVersion.ts` and the parent PRD "Hash storage on target repos" section
 * of `specs/prd/adw-init-hash-and-label-classification.md`).
 *
 * Read rules:
 *   - File absent           → { hitl: false } (no warning; absence is the common case)
 *   - `hitl: true`          → { hitl: true }
 *   - `hitl: false`         → { hitl: false }
 *   - No `hitl:` key        → { hitl: false } (file is not malformed, key just omitted)
 *   - Malformed `hitl` value → { hitl: false } + warn log
 *   - File unreadable       → { hitl: false } + warn log
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from './utils';

export const ADW_YML_RELATIVE_PATH = path.join('.github', 'adw.yml');

/**
 * Configuration read from `.github/adw.yml`.
 *
 * `hitl: true` means the upgrade PR requires human review (no auto-merge).
 * Default is `false` (auto-merge).
 */
export interface AdwYmlConfig {
  readonly hitl: boolean;
}

const DEFAULT_CONFIG: AdwYmlConfig = { hitl: false };

/**
 * Pure parser: converts `.github/adw.yml` file content to an `AdwYmlConfig`.
 * Does not perform I/O — suitable for direct unit testing.
 */
export function parseAdwYml(content: string): AdwYmlConfig {
  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^\s*hitl\s*:\s*(.*)$/.exec(rawLine);
    if (!match) continue;

    let value = match[1] ?? '';
    // Strip inline comment
    const commentIdx = value.indexOf('#');
    if (commentIdx !== -1) value = value.slice(0, commentIdx);
    // Strip surrounding quotes and whitespace, then normalize case
    value = value.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();

    if (value === 'true') return { hitl: true };
    if (value === 'false') return { hitl: false };

    const rawValue = (match[1] ?? '').trim();
    log(`adw.yml: malformed 'hitl' value "${rawValue}", defaulting to auto-merge (hitl: false)`, 'warn');
    return DEFAULT_CONFIG;
  }
  return DEFAULT_CONFIG;
}

/**
 * Reads `.github/adw.yml` from the given worktree root and returns its config.
 *
 * @param worktreePath - Absolute path to the target repo's worktree root.
 * @returns `AdwYmlConfig` with the parsed `hitl` value, or the default `{ hitl: false }`.
 */
export function readAdwYmlConfig(worktreePath: string): AdwYmlConfig {
  const filePath = path.join(worktreePath, ADW_YML_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return DEFAULT_CONFIG;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseAdwYml(content);
  } catch (error) {
    log(`adw.yml: failed to read "${filePath}": ${String(error)}, defaulting to auto-merge (hitl: false)`, 'warn');
    return DEFAULT_CONFIG;
  }
}
