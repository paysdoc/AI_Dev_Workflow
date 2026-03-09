/**
 * Worktree setup helpers: gitignore management and slash-command copying.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { log } from '../core';

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
 * Copies the ADW repo's `.claude/commands/` directory to a target repo worktree.
 * Only copies `.md` files that don't already exist in the destination,
 * preserving the target repo's own commands.
 *
 * @param worktreePath - The absolute path to the target repo worktree
 */
export function copyClaudeCommandsToWorktree(worktreePath: string): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const adwRepoRoot = path.resolve(currentDir, '../../');
  const sourceDir = path.join(adwRepoRoot, '.claude', 'commands');
  const destDir = path.join(worktreePath, '.claude', 'commands');

  if (!fs.existsSync(sourceDir)) {
    log(`No .claude/commands/ found in ADW repo at ${sourceDir}, skipping copy`, 'info');
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });

  const sourceFiles = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.md'));
  const copiedFiles = sourceFiles.filter((file) => {
    const destPath = path.join(destDir, file);
    if (fs.existsSync(destPath)) return false;
    fs.copyFileSync(path.join(sourceDir, file), destPath);
    return true;
  });

  if (copiedFiles.length > 0) {
    log(`Copied ${copiedFiles.length} slash command(s) to worktree: ${copiedFiles.join(', ')}`, 'info');
  } else {
    log('No new slash commands to copy (all already exist in target)', 'info');
  }

  if (copiedFiles.length > 0) {
    const gitignoreEntries = copiedFiles.map((file) => `.claude/commands/${file}`);
    ensureGitignoreEntries(worktreePath, gitignoreEntries);
  }
}
