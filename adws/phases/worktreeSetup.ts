/**
 * Worktree setup helpers: gitignore management and slash-command/skill copying.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { log } from '../core';
import type { GitContext } from '../gitContext';

/** The six canonical .adw/ config files that /adw_init must produce. */
export const REQUIRED_ADW_FILES = [
  'commands.md',
  'project.md',
  'conditional_docs.md',
  'providers.md',
  'review_proof.md',
  'scenarios.md',
] as const;

/**
 * Ensures a given entry exists in the `.gitignore` file at the specified directory.
 * Creates the `.gitignore` file if it doesn't exist. Idempotent — safe to call
 * multiple times without duplicating the entry.
 *
 * @param worktreePath - The absolute path to the directory containing `.gitignore`
 * @param entry - The gitignore pattern to ensure is present (e.g., `.claude/commands/bug.md`)
 */
export function ensureGitignoreEntry(worktreePath: string, entry: string): void {
  const gitignorePath = path.join(worktreePath, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';

  const lines = existing.split('\n').map((line) => line.trim());
  if (lines.includes(entry.trim())) {
    log(`Gitignore already contains '${entry}', skipping`, 'info');
    return;
  }

  const comment = '# ADW: copied slash commands (do not commit)';
  const hasComment = lines.includes(comment);
  const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const appendContent = hasComment
    ? `${suffix}${entry}\n`
    : `${suffix}${comment}\n${entry}\n`;

  fs.writeFileSync(gitignorePath, existing + appendContent, 'utf-8');
  log(`Added '${entry}' to ${gitignorePath}`, 'info');
}

/**
 * Ensures multiple entries exist in the `.gitignore` file at the specified directory.
 * Writes all new entries in a single file operation with one comment header,
 * avoiding duplicate comments from calling `ensureGitignoreEntry` in a loop.
 *
 * @param worktreePath - The absolute path to the directory containing `.gitignore`
 * @param entries - The gitignore patterns to ensure are present
 */
export function ensureGitignoreEntries(worktreePath: string, entries: readonly string[]): void {
  if (entries.length === 0) return;

  const gitignorePath = path.join(worktreePath, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';

  const existingLines = existing.split('\n').map((line) => line.trim());
  const newEntries = entries.filter((entry) => !existingLines.includes(entry.trim()));

  if (newEntries.length === 0) {
    log('All gitignore entries already present, skipping', 'info');
    return;
  }

  const comment = '# ADW: copied slash commands (do not commit)';
  const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const appendContent = `${suffix}${comment}\n${newEntries.join('\n')}\n`;

  fs.writeFileSync(gitignorePath, existing + appendContent, 'utf-8');
  log(`Added ${newEntries.length} gitignore entr${newEntries.length === 1 ? 'y' : 'ies'} to ${gitignorePath}`, 'info');
}

/**
 * Parses the YAML frontmatter of a markdown file and returns whether `target: true` is set.
 * Returns `false` if the file doesn't exist, has no frontmatter, or the `target` field is absent/false.
 */
function parseFrontmatterTarget(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return false;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break;
    const match = lines[i].match(/^target:\s*(.+)$/);
    if (match) return match[1].trim() === 'true';
  }
  return false;
}

/**
 * Copies all files from a source directory to a destination directory, overwriting existing files.
 */
function copyDirContents(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.readdirSync(srcDir).forEach((file) => {
    const srcFile = path.join(srcDir, file);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, path.join(destDir, file));
    }
  });
}

/**
 * Returns the set of basenames tracked by git under a given path prefix in the worktree.
 */
function getTrackedBasenames(ctx: GitContext, worktreePath: string, prefix: string): Set<string> {
  try {
    return new Set(ctx.lsFiles(worktreePath, prefix).map((f) => path.basename(f)));
  } catch {
    return new Set();
  }
}

/**
 * Returns the set of top-level directory names tracked by git under a given path prefix.
 * E.g., for `.claude/skills/` returns `{'tdd', 'refactor', ...}`.
 */
function getTrackedTopDirs(ctx: GitContext, worktreePath: string, prefix: string): Set<string> {
  try {
    return new Set(
      ctx.lsFiles(worktreePath, prefix)
        .map((f) => {
          const relative = f.startsWith(prefix) ? f.slice(prefix.length) : f;
          return relative.split('/')[0];
        })
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/**
 * Copies the framework's `adw_init.md` command into a worktree so `/adw_init` resolves,
 * then gitignores it so the upgrade commit does not carry it into the PR.
 *
 * Bespoke helper used only by `adwUpgrade.tsx` — intentionally separate from
 * `copyClaudeAssetsToWorktree` to keep the upgrade PR scope tight.
 */
export function copyAdwInitCommandToWorktree(worktreePath: string, frameworkRepoRoot: string): void {
  const srcFile = path.join(frameworkRepoRoot, '.claude', 'commands', 'adw_init.md');
  const destDir = path.join(worktreePath, '.claude', 'commands');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcFile, path.join(destDir, 'adw_init.md'));
  ensureGitignoreEntry(worktreePath, '.claude/commands/adw_init.md');
  ensureGitignoreEntry(worktreePath, '.adw/.regen-receipt');
}

/**
 * Verifies that `/adw_init` actually ran to completion before the version stamp is written.
 *
 * Gate logic (all conditions must hold):
 *   1. All six canonical `.adw/` config files exist and are non-empty.
 *   2. `features/regression/vocabulary.md` exists.
 *
 * Returns `{ ok: true, missing: [] }` on pass; `{ ok: false, missing }` on fail,
 * where `missing` lists the tokens that caused the failure.
 */
export function verifyAdwRegen(worktreePath: string): { ok: boolean; missing: readonly string[] } {
  const adwDir = path.join(worktreePath, '.adw');
  const missing: string[] = [];

  for (const file of REQUIRED_ADW_FILES) {
    const filePath = path.join(adwDir, file);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      missing.push(file);
    }
  }

  const vocabPath = path.join(worktreePath, 'features', 'regression', 'vocabulary.md');
  if (!fs.existsSync(vocabPath)) {
    missing.push('features/regression/vocabulary.md');
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Copies ALL commands and ALL skills from the ADW framework repo into a target worktree,
 * always overwriting (merged replacement for the two previous helper functions).
 *
 * Post-copy gitignore policy — preserving the #267 invariant:
 *   - `target: true` assets: left committable (refresh + propagation into the product repo).
 *   - `target: false` assets: gitignored for run-availability only, UNLESS already tracked
 *     by git (never gitignore an already-committed path — gitignore can't untrack).
 */
export function copyClaudeAssetsToWorktree(worktreePath: string, gitContext: GitContext): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const adwRepoRoot = path.resolve(currentDir, '../../');

  const commandsSourceDir = path.join(adwRepoRoot, '.claude', 'commands');
  const skillsSourceDir = path.join(adwRepoRoot, '.claude', 'skills');

  const gitignoreEntries: string[] = [];

  const trackedCommandFiles = getTrackedBasenames(gitContext, worktreePath, '.claude/commands/');
  const trackedSkillDirs = getTrackedTopDirs(gitContext, worktreePath, '.claude/skills/');

  if (fs.existsSync(commandsSourceDir)) {
    const commandsDestDir = path.join(worktreePath, '.claude', 'commands');
    fs.mkdirSync(commandsDestDir, { recursive: true });
    const mdFiles = fs.readdirSync(commandsSourceDir).filter((f) => f.endsWith('.md'));
    mdFiles.forEach((file) =>
      fs.copyFileSync(path.join(commandsSourceDir, file), path.join(commandsDestDir, file)),
    );
    gitignoreEntries.push(
      ...mdFiles
        .filter((f) => !parseFrontmatterTarget(path.join(commandsSourceDir, f)) && !trackedCommandFiles.has(f))
        .map((f) => `.claude/commands/${f}`),
    );
  } else {
    log(`No .claude/commands/ found in ADW repo at ${commandsSourceDir}, skipping`, 'info');
  }

  if (fs.existsSync(skillsSourceDir)) {
    const skillDirs = fs.readdirSync(skillsSourceDir).filter((n) =>
      fs.statSync(path.join(skillsSourceDir, n)).isDirectory(),
    );
    skillDirs.forEach((skillName) =>
      copyDirContents(
        path.join(skillsSourceDir, skillName),
        path.join(worktreePath, '.claude', 'skills', skillName),
      ),
    );
    gitignoreEntries.push(
      ...skillDirs
        .filter((n) => !parseFrontmatterTarget(path.join(skillsSourceDir, n, 'SKILL.md')) && !trackedSkillDirs.has(n))
        .map((n) => `.claude/skills/${n}/`),
    );
  } else {
    log(`No .claude/skills/ found in ADW repo at ${skillsSourceDir}, skipping`, 'info');
  }

  ensureGitignoreEntries(worktreePath, gitignoreEntries);
}
