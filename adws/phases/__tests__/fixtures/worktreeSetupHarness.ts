import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export function gitignoreContains(worktreePath: string, entry: string): boolean {
  const gitignorePath = path.join(worktreePath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split('\n').map((l) => l.trim());
  const bare = entry.replace(/\/$/, '');
  return lines.includes(bare) || lines.includes(bare + '/');
}

export function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: dir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'pipe' });
}
