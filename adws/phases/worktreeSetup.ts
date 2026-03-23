/**
 * Worktree setup helpers: gitignore management and slash-command copying.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
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
 * Parses the YAML frontmatter of a markdown file and returns whether `target: true` is set.
 * Returns `false` if the file doesn't exist, has no frontmatter, or the `target` field is absent/false.
 *
 * @param filePath - The absolute path to the markdown file to parse
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
 * Copies `target: true` skills and commands from the ADW repo to a target repo worktree.
 * Skills (entire directories) and commands (individual `.md` files) marked with `target: true`
 * in their YAML frontmatter are copied and overwrite existing files. Intended to be called
 * during `adw_init` so these files are committed alongside `.adw/` config.
 *
 * @param worktreePath - The absolute path to the target repo worktree
 */
export function copyTargetSkillsAndCommands(worktreePath: string): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const adwRepoRoot = path.resolve(currentDir, '../../');

  const skillsSourceDir = path.join(adwRepoRoot, '.claude', 'skills');
  const commandsSourceDir = path.join(adwRepoRoot, '.claude', 'commands');

  let skillsCopied = 0;
  let commandsCopied = 0;

  if (fs.existsSync(skillsSourceDir)) {
    const skillNames = fs.readdirSync(skillsSourceDir).filter((name) =>
      fs.statSync(path.join(skillsSourceDir, name)).isDirectory()
    );

    skillNames
      .filter((name) => parseFrontmatterTarget(path.join(skillsSourceDir, name, 'SKILL.md')))
      .forEach((name) => {
        copyDirContents(
          path.join(skillsSourceDir, name),
          path.join(worktreePath, '.claude', 'skills', name)
        );
        skillsCopied++;
      });
  } else {
    log(`No .claude/skills/ found in ADW repo at ${skillsSourceDir}, skipping`, 'info');
  }

  if (fs.existsSync(commandsSourceDir)) {
    const commandsDestDir = path.join(worktreePath, '.claude', 'commands');
    fs.mkdirSync(commandsDestDir, { recursive: true });

    fs.readdirSync(commandsSourceDir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => parseFrontmatterTarget(path.join(commandsSourceDir, f)))
      .forEach((f) => {
        fs.copyFileSync(path.join(commandsSourceDir, f), path.join(commandsDestDir, f));
        commandsCopied++;
      });
  } else {
    log(`No .claude/commands/ found in ADW repo at ${commandsSourceDir}, skipping`, 'info');
  }

  log(`Copied ${skillsCopied} skill(s) and ${commandsCopied} command(s) to target repo`, 'info');
}

/**
 * Copies the ADW repo's `.claude/commands/` directory to a target repo worktree.
 * Only copies `.md` files that don't already exist in the destination,
 * preserving the target repo's own commands. Skips gitignoring any command files
 * that are already tracked by git in the target repo (i.e., committed during adw_init).
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
    const trackedFiles = execSync('git ls-files .claude/commands/', {
      encoding: 'utf-8',
      cwd: worktreePath,
    })
      .split('\n')
      .filter(Boolean)
      .map((f) => path.basename(f));

    const filesToGitignore = copiedFiles.filter((f) => !trackedFiles.includes(f));

    if (filesToGitignore.length > 0) {
      const gitignoreEntries = filesToGitignore.map((file) => `.claude/commands/${file}`);
      ensureGitignoreEntries(worktreePath, gitignoreEntries);
    } else {
      log('All copied commands are already tracked by git, skipping gitignore', 'info');
    }
  }
}
