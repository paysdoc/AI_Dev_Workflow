import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { log, STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH } from '../core';
import type { GitContext } from '@paysdoc/devplatform/git';

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
 * Creates the `.gitignore` file if it doesn't exist. Idempotent — safe to call
 * multiple times without duplicating the entry.
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
 * Writes all new entries in a single file operation with one comment header,
 * avoiding duplicate comments from calling `ensureGitignoreEntry` in a loop.
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

/** Returns `false` if the file doesn't exist, has no frontmatter, or the `target` field is absent/false. */
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

function copyDirContents(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.readdirSync(srcDir).forEach((file) => {
    const srcFile = path.join(srcDir, file);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, path.join(destDir, file));
    }
  });
}

function getTrackedBasenames(ctx: GitContext, worktreePath: string, prefix: string): Set<string> {
  try {
    return new Set(ctx.lsFiles(worktreePath, prefix).map((f) => path.basename(f)));
  } catch {
    return new Set();
  }
}

/** E.g., for `.claude/skills/` returns `{'tdd', 'refactor', ...}`. */
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

/** Pure skip-if-exists decision for the starter guardrails settings copy. */
export type StarterSettingsDecision =
  | { readonly action: 'copy' }
  | { readonly action: 'skip'; readonly reason: 'already_exists' };

/**
 * An owner who already has a `.claude/settings.json` has opinions — the copy is
 * always skipped, never merged or overwritten.
 */
export function decideStarterSettingsCopy({ settingsExists }: { settingsExists: boolean }): StarterSettingsDecision {
  if (settingsExists) return { action: 'skip', reason: 'already_exists' };
  return { action: 'copy' };
}

export interface StarterSettingsResult {
  readonly action: 'copied' | 'skipped';
  readonly destPath: string;
}

/**
 * Copies the canonical deny-only `templates/claude-settings-starter.json` into a
 * target worktree's `.claude/settings.json`, byte-identical, ONLY when the worktree has
 * none — an existing owner-authored settings file is never read, merged, or overwritten.
 *
 * Unlike `copyClaudeAssetsToWorktree`, this file is deliberately left OFF the gitignore
 * list: it is the repo owner's to keep, edit, or delete, and must ride into the init/
 * upgrade commit.
 */
export function copyStarterSettingsToWorktree(worktreePath: string, frameworkRepoRoot: string): StarterSettingsResult {
  const destPath = path.join(worktreePath, '.claude', 'settings.json');
  const decision = decideStarterSettingsCopy({ settingsExists: fs.existsSync(destPath) });

  if (decision.action === 'skip') {
    log('Target repo already has .claude/settings.json; skipping starter guardrails copy', 'info');
    return { action: 'skipped', destPath };
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(path.join(frameworkRepoRoot, STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH), destPath);
  log(`Copied starter guardrails settings to ${destPath}`, 'info');
  return { action: 'copied', destPath };
}

/**
 * Verifies that `/adw_init` actually ran to completion before the version stamp is written.
 *
 * Gate logic (all conditions must hold):
 *   1. All six canonical `.adw/` config files exist and are non-empty.
 *   2. `features/regression/vocabulary.md` exists.
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
 * Post-copy gitignore policy:
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
