import { beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';

export const PLAN_FILE = 'specs/issue-7-adw-abc123-sdlc_planner-plan.md';

export function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();
}

export function write(root: string, relPath: string, contents: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf-8');
}

export function commitAll(root: string, message: string): void {
  git(root, 'add -A');
  git(root, `commit -q -m "${message}"`);
}

export function filesInHead(root: string): string[] {
  return git(root, 'show --name-only --format= HEAD').split('\n').filter(Boolean);
}

export function statusLines(root: string): string[] {
  return git(root, 'status --porcelain --untracked-files=all').split('\n').filter(Boolean);
}

/** Live bindings: reassigned before each test by the hooks `setupPlanGuardRepo` registers. */
export let repo: string;
export let ctx: GitContext;

/** Registers beforeEach/afterEach hooks that give each test a fresh seeded git repo and GitContext. */
export function setupPlanGuardRepo(): void {
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-guard-'));
    git(repo, 'init -q');
    git(repo, 'config user.email "test@adw.local"');
    git(repo, 'config user.name "ADW Test"');
    write(repo, 'README.md', 'readme\n');
    write(repo, 'src/widget.ts', 'export const widget = 1;\n');
    write(repo, '.claude/commands/scenario_writer.md', 'branch copy\n');
    write(repo, '.claude/commands/install.md', 'install\n');
    write(repo, '.claude/skills/tdd/SKILL.md', 'tdd\n');
    write(repo, '.adw/commands.md', 'commands\n');
    commitAll(repo, 'init');
    ctx = new GitContext({
      owner: 'acme', repo: 'widgets', selfHost: false, tokenProvider: createLiteralTokenProvider('t'),
      gitIdentity: { authorName: 'T', authorEmail: 't@e.co', committerName: 'T', committerEmail: 't@e.co' },
      frameworkRepoRoot: repo, targetReposDir: repo,
    });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });
}
