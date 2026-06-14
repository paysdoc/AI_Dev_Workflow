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
import { copyClaudeAssetsToWorktree } from '../worktreeSetup.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADW_REPO_ROOT = resolve(__dirname, '../../..');

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

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-ws-test-'));
  initGitRepo(tempDir);
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

    copyClaudeAssetsToWorktree(tempDir);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'install.md'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/commands/install.md')).toBe(false);
  });

  it('copies prime.md and does NOT add it to .gitignore', () => {
    const primeSrc = path.join(ADW_REPO_ROOT, '.claude', 'commands', 'prime.md');
    if (!fs.existsSync(primeSrc)) return;

    copyClaudeAssetsToWorktree(tempDir);

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

    copyClaudeAssetsToWorktree(tempDir);

    expect(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'feature.md'))).toBe(true);
    expect(gitignoreContains(tempDir, '.claude/commands/feature.md')).toBe(true);
  });

  it('copies implement.md and adds it to .gitignore', () => {
    const implementSrc = path.join(ADW_REPO_ROOT, '.claude', 'commands', 'implement.md');
    if (!fs.existsSync(implementSrc)) return;

    copyClaudeAssetsToWorktree(tempDir);

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

    copyClaudeAssetsToWorktree(tempDir);

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

    copyClaudeAssetsToWorktree(tempDir);

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

    copyClaudeAssetsToWorktree(tempDir);

    // feature.md is target:false but already tracked → must NOT be gitignored
    expect(gitignoreContains(tempDir, '.claude/commands/feature.md')).toBe(false);
  });
});
