/**
 * Deep module for reading `.github/adw.yml` at a target repo's worktree root
 * to determine the framework-upgrade auto-merge policy and the unit-test gate.
 *
 * The file lives outside `.adw/` so `/adw_init` regeneration of `.adw/` cannot
 * clobber it — the same rationale that keeps `.adw-version` outside `.adw/`
 * (see `adwVersion.ts` and the parent PRD "Hash storage on target repos" section
 * of `specs/prd/adw-init-hash-and-label-classification.md`).
 *
 * Read rules:
 *   - File absent           → { hitl: false, unitTests: true } (no warning; absence is the common case)
 *   - `hitl: true`          → hitl: true
 *   - `hitl: false`         → hitl: false
 *   - No `hitl:` key        → hitl: false (file is not malformed, key just omitted)
 *   - Malformed `hitl` value → hitl: false + warn log
 *   - `unitTests: false`    → unitTests: false (opt-out; gate disabled)
 *   - `unitTests: true`     → unitTests: true (gate enabled)
 *   - No `unitTests:` key   → unitTests: true (absent → enabled; opt-out default)
 *   - Malformed `unitTests` → unitTests: true + warn log (fails safe toward enabled)
 *   - File unreadable       → { hitl: false, unitTests: true } + warn log
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
 *
 * `unitTests: false` opts out of the unit-test phase gate; default `true` (enabled, opt-out).
 */
export interface AdwYmlConfig {
  readonly hitl: boolean;
  readonly unitTests: boolean;
}

const DEFAULT_CONFIG: AdwYmlConfig = { hitl: false, unitTests: true };

/**
 * Self-documenting, fully-commented `.github/adw.yml` template.
 * All keys are commented out so the file parses to the defaults.
 * Kept byte-identical to the heredoc in `.claude/commands/adw_init.md`.
 */
export const ADW_YML_TEMPLATE = `# ADW configuration for this repository.
# This file lives outside \`.adw/\`, so \`/adw_init\` regeneration never overwrites it.
# Uncomment a key and set its value to change policy; absent keys use the defaults below.

# Unit-test gate (opt-out). When enabled, the unit-test phase runs your test
# command and fails the workflow on unit-test failure. Default: enabled.
# unitTests: true

# Human-in-the-loop gate for framework-upgrade PRs (opt-in). When true, ADW opens
# the upgrade PR but leaves it for human review instead of auto-merging. Default: false.
# hitl: false
`;

/**
 * Normalises a raw YAML scalar value (the text after the colon) to a boolean.
 * Strips inline `#` comments, surrounding whitespace and quotes, then lowercases.
 * Returns `true`, `false`, or `null` for unrecognised values.
 */
function parseBooleanScalar(rawAfterColon: string): boolean | null {
  let value = rawAfterColon;
  const commentIdx = value.indexOf('#');
  if (commentIdx !== -1) value = value.slice(0, commentIdx);
  value = value.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * Pure parser: converts `.github/adw.yml` file content to an `AdwYmlConfig`.
 * Does not perform I/O — suitable for direct unit testing.
 *
 * First occurrence of each key wins; subsequent duplicates are ignored.
 * Malformed values default to the per-key default and emit a warn log.
 */
export function parseAdwYml(content: string): AdwYmlConfig {
  let hitl: boolean | undefined;
  let unitTests: boolean | undefined;

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (hitl === undefined) {
      const hitlMatch = /^\s*hitl\s*:\s*(.*)$/.exec(rawLine);
      if (hitlMatch) {
        const parsed = parseBooleanScalar(hitlMatch[1] ?? '');
        if (parsed !== null) {
          hitl = parsed;
        } else {
          const rawValue = (hitlMatch[1] ?? '').trim();
          log(`adw.yml: malformed 'hitl' value "${rawValue}", defaulting to auto-merge (hitl: false)`, 'warn');
          hitl = DEFAULT_CONFIG.hitl;
        }
      }
    }

    if (unitTests === undefined) {
      const unitTestsMatch = /^\s*unitTests\s*:\s*(.*)$/.exec(rawLine);
      if (unitTestsMatch) {
        const parsed = parseBooleanScalar(unitTestsMatch[1] ?? '');
        if (parsed !== null) {
          unitTests = parsed;
        } else {
          const rawValue = (unitTestsMatch[1] ?? '').trim();
          log(`adw.yml: malformed 'unitTests' value "${rawValue}", defaulting to enabled (unitTests: true)`, 'warn');
          unitTests = DEFAULT_CONFIG.unitTests;
        }
      }
    }

    if (hitl !== undefined && unitTests !== undefined) break;
  }

  return {
    hitl: hitl ?? DEFAULT_CONFIG.hitl,
    unitTests: unitTests ?? DEFAULT_CONFIG.unitTests,
  };
}

/**
 * Reads `.github/adw.yml` from the given worktree root and returns its config.
 *
 * @param worktreePath - Absolute path to the target repo's worktree root.
 * @returns `AdwYmlConfig` with parsed values, or defaults for absent/unreadable files.
 */
export function readAdwYmlConfig(worktreePath: string): AdwYmlConfig {
  const filePath = path.join(worktreePath, ADW_YML_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return DEFAULT_CONFIG;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseAdwYml(content);
  } catch (error) {
    log(`adw.yml: failed to read "${filePath}": ${String(error)}, defaulting to { hitl: false, unitTests: true }`, 'warn');
    return DEFAULT_CONFIG;
  }
}

/**
 * Creates `.github/adw.yml` from `ADW_YML_TEMPLATE` only when the file does not
 * already exist. Never overwrites an existing file (it carries durable operator policy).
 *
 * @param worktreePath - Absolute path to the target repo's worktree root.
 * @returns `{ created: true }` when the file was written; `{ created: false }` when it
 *   already existed (no write performed).
 */
export function writeAdwYmlTemplateIfAbsent(worktreePath: string): { created: boolean } {
  const filePath = path.join(worktreePath, ADW_YML_RELATIVE_PATH);
  if (fs.existsSync(filePath)) return { created: false };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, ADW_YML_TEMPLATE, 'utf-8');
  return { created: true };
}
