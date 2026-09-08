/**
 * E4: fixture tests for copyClaudeAssetsToWorktree.
 * Drives the function against a real temp git repo and checks git-committable vs
 * gitignored status for target:true and target:false assets, plus the #267 invariant
 * (already-tracked target:false files are never added to .gitignore).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  copyClaudeAssetsToWorktree,
  verifyAdwRegen,
  REQUIRED_ADW_FILES,
  decideStarterSettingsCopy,
  copyStarterSettingsToWorktree,
} from '../worktreeSetup.ts';
import { GitContext } from '../../gitContext/index.ts';
import { createLiteralTokenProvider } from '../../providers/github/githubTokenProvider';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADW_REPO_ROOT = resolve(__dirname, '../../..');
const FRAMEWORK_REPO_ROOT = ADW_REPO_ROOT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitignoreContains(worktreePath: string, entry: string): boolean {
  const gitignorePath = path.join(worktreePath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split('\n').map((l) => l.trim());
  const bare = entry.replace(/\/$/, '');
  return lines.includes(bare) || lines.includes(bare + '/');
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: dir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tempDir: string;
let ctx: GitContext;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-ws-test-'));
  initGitRepo(tempDir);
  ctx = new GitContext({
    owner: 'o', repo: 'r', selfHost: true, tokenProvider: createLiteralTokenProvider('t'),
    gitIdentity: { authorName: 'T', authorEmail: 't@e.co', committerName: 'T', committerEmail: 't@e.co' },
    frameworkRepoRoot: tempDir, targetReposDir: tempDir,
  });
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// E4a: target:true commands land as git-committable
// ---------------------------------------------------------------------------

describe('copyClaudeAssetsToWorktree — target:true commands (E4a)', () => {
  it('copies install.md and does NOT add it to .gitignore', () => {
    // install.md is a known target:true command
    const installSrc = path.join(ADW_REPO_ROOT, '.claude', 'commands', 'install.md');
    if (!fs.existsSync(installSrc)) return; // guard: skip if file absent in this checkout

    copyClaudeAssetsToWorktree(tempDir, ctx);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'install.md'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/commands/install.md')).toBe(false);
  });

  it('copies prime.md and does NOT add it to .gitignore', () => {
    const primeSrc = path.join(ADW_REPO_ROOT, '.claude', 'commands', 'prime.md');
    if (!fs.existsSync(primeSrc)) return;

    copyClaudeAssetsToWorktree(tempDir, ctx);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'prime.md'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/commands/prime.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E4b: target:false commands land as gitignored
// ---------------------------------------------------------------------------

describe('copyClaudeAssetsToWorktree — target:false commands (E4b)', () => {
  it('copies feature.md and adds it to .gitignore', () => {
    const featureSrc = path.join(ADW_REPO_ROOT, '.claude', 'commands', 'feature.md');
    if (!fs.existsSync(featureSrc)) return;

    copyClaudeAssetsToWorktree(tempDir, ctx);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'feature.md'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/commands/feature.md')).toBe(true);
  });

  it('copies implement.md and adds it to .gitignore', () => {
    const implementSrc = path.join(ADW_REPO_ROOT, '.claude', 'commands', 'implement.md');
    if (!fs.existsSync(implementSrc)) return;

    copyClaudeAssetsToWorktree(tempDir, ctx);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'implement.md'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/commands/implement.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E4c: target:true skill dirs land as git-committable
// ---------------------------------------------------------------------------

describe('copyClaudeAssetsToWorktree — target:true skills (E4c)', () => {
  it('copies tdd skill and does NOT add it to .gitignore', () => {
    const tddSrc = path.join(ADW_REPO_ROOT, '.claude', 'skills', 'tdd');
    if (!fs.existsSync(tddSrc)) return;

    copyClaudeAssetsToWorktree(tempDir, ctx);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'skills', 'tdd'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/skills/tdd/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E4d: target:false skill dirs land as gitignored
// ---------------------------------------------------------------------------

describe('copyClaudeAssetsToWorktree — target:false skills (E4d)', () => {
  it('copies refactor skill and adds it to .gitignore', () => {
    const refactorSrc = path.join(ADW_REPO_ROOT, '.claude', 'skills', 'refactor');
    if (!fs.existsSync(refactorSrc)) return;

    copyClaudeAssetsToWorktree(tempDir, ctx);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'skills', 'refactor'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/skills/refactor/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E4e: #267 invariant — already-tracked target:false file is NOT re-gitignored
// ---------------------------------------------------------------------------

describe('copyClaudeAssetsToWorktree — #267 gitignore-skip-if-tracked invariant (E4e)', () => {
  it('does not add feature.md to .gitignore when it is already tracked', () => {
    const featureSrc = path.join(ADW_REPO_ROOT, '.claude', 'commands', 'feature.md');
    if (!fs.existsSync(featureSrc)) return;

    // Pre-track feature.md in the target repo (simulates a committed same-named file)
    const destDir = path.join(tempDir, '.claude', 'commands');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(featureSrc, path.join(destDir, 'feature.md'));
    execSync('git add .claude/commands/feature.md', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "track feature.md"', { cwd: tempDir, stdio: 'pipe' });

    copyClaudeAssetsToWorktree(tempDir, ctx);

    // feature.md is target:false but already tracked → must NOT be gitignored
    expect(gitignoreContains(tempDir, '.claude/commands/feature.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyAdwRegen integration tests (real temp git repo)
// ---------------------------------------------------------------------------

describe('verifyAdwRegen', () => {
  let verifyDir: string;

  function seedAndCommit(): void {
    const adwDir = path.join(verifyDir, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    for (const file of REQUIRED_ADW_FILES) {
      fs.writeFileSync(path.join(adwDir, file), `# ${file}\nfixture\n`);
    }
    const vocabDir = path.join(verifyDir, 'features', 'regression');
    fs.mkdirSync(vocabDir, { recursive: true });
    fs.writeFileSync(path.join(vocabDir, 'vocabulary.md'), '# Vocabulary\nfixture\n');
    execSync('git add -A', { cwd: verifyDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: verifyDir, stdio: 'pipe' });
  }

  beforeEach(() => {
    verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-verify-'));
    execSync('git init', { cwd: verifyDir, stdio: 'pipe' });
    execSync('git config user.email "test@adw.local"', { cwd: verifyDir, stdio: 'pipe' });
    execSync('git config user.name "ADW Test"', { cwd: verifyDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(verifyDir, { recursive: true, force: true });
  });

  it('all required files present and non-empty → ok:true', () => {
    seedAndCommit();
    const result = verifyAdwRegen(verifyDir);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('missing required .adw/ file → ok:false and reports the file', () => {
    seedAndCommit();
    fs.unlinkSync(path.join(verifyDir, '.adw', 'project.md'));
    const result = verifyAdwRegen(verifyDir);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('project.md');
  });

  it('empty required .adw/ file → ok:false and reports the file', () => {
    seedAndCommit();
    fs.writeFileSync(path.join(verifyDir, '.adw', 'commands.md'), '');
    const result = verifyAdwRegen(verifyDir);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('commands.md');
  });

  it('Vocabulary missing → ok:false even when all .adw/ files present', () => {
    seedAndCommit();
    fs.unlinkSync(path.join(verifyDir, 'features', 'regression', 'vocabulary.md'));
    const result = verifyAdwRegen(verifyDir);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('features/regression/vocabulary.md');
  });
});

// ---------------------------------------------------------------------------
// decideStarterSettingsCopy — pure skip-if-exists decision (#763)
// ---------------------------------------------------------------------------

describe('decideStarterSettingsCopy', () => {
  it('returns action:copy when no settings.json exists', () => {
    expect(decideStarterSettingsCopy({ settingsExists: false })).toEqual({ action: 'copy' });
  });

  it('returns action:skip, reason:already_exists when settings.json already exists', () => {
    expect(decideStarterSettingsCopy({ settingsExists: true })).toEqual({
      action: 'skip',
      reason: 'already_exists',
    });
  });
});

// ---------------------------------------------------------------------------
// copyStarterSettingsToWorktree — fixture tests against a real temp git repo (#763)
// ---------------------------------------------------------------------------

describe('copyStarterSettingsToWorktree', () => {
  let starterDir: string;

  beforeEach(() => {
    starterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-starter-'));
    initGitRepo(starterDir);
  });

  afterEach(() => {
    fs.rmSync(starterDir, { recursive: true, force: true });
  });

  it('fresh worktree: copies the template byte-for-byte to .claude/settings.json', () => {
    const result = copyStarterSettingsToWorktree(starterDir, FRAMEWORK_REPO_ROOT);

    const destPath = path.join(starterDir, '.claude', 'settings.json');
    expect(result).toEqual({ action: 'copied', destPath });
    expect(fs.existsSync(destPath)).toBe(true);

    const templatePath = path.join(FRAMEWORK_REPO_ROOT, 'templates', 'claude-settings-starter.json');
    expect(fs.readFileSync(destPath).equals(fs.readFileSync(templatePath))).toBe(true);
  });

  it('fresh worktree: does NOT add .claude/settings.json to .gitignore', () => {
    copyStarterSettingsToWorktree(starterDir, FRAMEWORK_REPO_ROOT);
    expect(gitignoreContains(starterDir, '.claude/settings.json')).toBe(false);
  });

  it('fresh worktree: the copied file is git-committable (git add -A stages it)', () => {
    copyStarterSettingsToWorktree(starterDir, FRAMEWORK_REPO_ROOT);
    execSync('git add -A', { cwd: starterDir, stdio: 'pipe' });
    const status = execSync('git status --porcelain -- .claude/settings.json', {
      cwd: starterDir,
      encoding: 'utf-8',
    });
    expect(status.trim()).not.toBe('');
  });

  it('existing settings.json: is left byte-for-byte unchanged and result is skipped', () => {
    const destDir = path.join(starterDir, '.claude');
    fs.mkdirSync(destDir, { recursive: true });
    const ownerContent = '{"permissions":{"allow":["Bash(ls:*)"]}}\n';
    const destPath = path.join(destDir, 'settings.json');
    fs.writeFileSync(destPath, ownerContent);

    const result = copyStarterSettingsToWorktree(starterDir, FRAMEWORK_REPO_ROOT);

    expect(result).toEqual({ action: 'skipped', destPath });
    expect(fs.readFileSync(destPath, 'utf-8')).toBe(ownerContent);
  });
});
