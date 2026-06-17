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
  parseRegenReceiptHash,
  REQUIRED_ADW_FILES,
  REGEN_RECEIPT_RELATIVE_PATH,
} from '../worktreeSetup.ts';

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

// ---------------------------------------------------------------------------
// parseRegenReceiptHash unit tests
// ---------------------------------------------------------------------------

describe('parseRegenReceiptHash', () => {
  it('returns the hash from a well-formed receipt line', () => {
    const hash = 'c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b';
    expect(parseRegenReceiptHash(`frameworkHash: ${hash}\n`)).toBe(hash);
  });

  it('tolerates leading/trailing whitespace around the hash value', () => {
    const hash = 'abc123def456';
    expect(parseRegenReceiptHash(`frameworkHash:   ${hash}  \n`)).toBe(hash);
  });

  it('returns null when the frameworkHash: key is absent', () => {
    expect(parseRegenReceiptHash('# some other content\nkey: value\n')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseRegenReceiptHash('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyAdwRegen integration tests (real temp git repo)
// ---------------------------------------------------------------------------

describe('verifyAdwRegen', () => {
  const EXPECTED_HASH = 'c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b';
  const STALE_HASH   = '34e7e1290a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70819';

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

  function writeReceipt(hash: string): void {
    const receiptPath = path.join(verifyDir, REGEN_RECEIPT_RELATIVE_PATH);
    fs.writeFileSync(receiptPath, `frameworkHash: ${hash}\n`);
    execSync('git add ' + REGEN_RECEIPT_RELATIVE_PATH, { cwd: verifyDir, stdio: 'pipe' });
    execSync('git commit -m "add receipt"', { cwd: verifyDir, stdio: 'pipe' });
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

  it('Test 1 (regression): fresh receipt + zero .adw/ content diff → ok:true', () => {
    // Proves the diff requirement is gone: all files committed (zero diff),
    // receipt committed with the expected hash → must pass.
    seedAndCommit();
    writeReceipt(EXPECTED_HASH);

    const result = verifyAdwRegen(verifyDir, EXPECTED_HASH);

    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('Test 2 (stale receipt / silent skip): receipt hash !== expectedHash → ok:false', () => {
    seedAndCommit();
    writeReceipt(STALE_HASH);

    const result = verifyAdwRegen(verifyDir, EXPECTED_HASH);

    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes('stale'))).toBe(true);
  });

  it('Test 4 (receipt absent): no .adw/.regen-receipt → ok:false', () => {
    seedAndCommit();
    // No receipt written.

    const result = verifyAdwRegen(verifyDir, EXPECTED_HASH);

    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes('missing'))).toBe(true);
  });

  it('Test 3 (#572 preserved): missing required .adw/ file → ok:false even with fresh receipt', () => {
    seedAndCommit();
    writeReceipt(EXPECTED_HASH);
    // Delete a required file after commit.
    fs.unlinkSync(path.join(verifyDir, '.adw', 'project.md'));

    const result = verifyAdwRegen(verifyDir, EXPECTED_HASH);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('project.md');
  });

  it('Vocabulary missing: absent features/regression/vocabulary.md → ok:false even with fresh receipt', () => {
    seedAndCommit();
    writeReceipt(EXPECTED_HASH);
    fs.unlinkSync(path.join(verifyDir, 'features', 'regression', 'vocabulary.md'));

    const result = verifyAdwRegen(verifyDir, EXPECTED_HASH);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('features/regression/vocabulary.md');
  });
});
