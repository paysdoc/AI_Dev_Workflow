import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { copyClaudeAssetsToWorktree, isFrameworkOwnRepository } from '../worktreeSetup.ts';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import { gitignoreContains, initGitRepo } from './fixtures/worktreeSetupHarness.ts';

function frontmatter(target: boolean, body: string): string {
  return `---\ntarget: ${target}\n---\n${body}\n`;
}

function writeFile(root: string, relPath: string, contents: string): void {
  const absolute = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, 'utf-8');
}

function ctxFor(owner: string, repo: string, root: string): GitContext {
  return new GitContext({
    owner, repo, selfHost: false, tokenProvider: createLiteralTokenProvider('t'),
    gitIdentity: { authorName: 'T', authorEmail: 't@e.co', committerName: 'T', committerEmail: 't@e.co' },
    frameworkRepoRoot: root, targetReposDir: root,
  });
}

describe('isFrameworkOwnRepository', () => {
  it('is true when the target repository is the framework origin, whatever the case', () => {
    expect(isFrameworkOwnRepository({ owner: 'acme', repo: 'framework' }, { owner: 'Acme', repo: 'Framework' })).toBe(true);
  });

  it('is false for any other repository', () => {
    expect(isFrameworkOwnRepository({ owner: 'acme', repo: 'widgets' }, { owner: 'acme', repo: 'framework' })).toBe(false);
  });

  it('is false when the framework identity could not be read', () => {
    expect(isFrameworkOwnRepository({ owner: 'acme', repo: 'framework' }, null)).toBe(false);
  });
});

describe('copyClaudeAssetsToWorktree — assets the worktree branch tracks (framework checkout behind the branch)', () => {
  const COMMAND = '.claude/commands/scenario_writer.md';
  const SKILL = '.claude/skills/tdd/SKILL.md';
  const BRANCH_COMMAND = frontmatter(false, 'newer copy on the branch');
  const BRANCH_SKILL = frontmatter(true, 'newer skill on the branch');

  let frameworkRoot: string;
  let worktree: string;

  function makeFrameworkCheckout(origin: string | null): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-ws-framework-'));
    initGitRepo(dir);
    if (origin) execSync(`git remote add origin ${origin}`, { cwd: dir, stdio: 'pipe' });
    writeFile(dir, COMMAND, frontmatter(false, 'older copy in the framework checkout'));
    writeFile(dir, SKILL, frontmatter(true, 'older skill in the framework checkout'));
    writeFile(dir, '.claude/commands/framework_only.md', frontmatter(false, 'only the framework checkout has this'));
    return dir;
  }

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-ws-worktree-'));
    initGitRepo(worktree);
    writeFile(worktree, COMMAND, BRANCH_COMMAND);
    writeFile(worktree, SKILL, BRANCH_SKILL);
    execSync('git add -A && git commit -q -m "newer prompts on the branch"', { cwd: worktree, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(frameworkRoot, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  it("leaves the framework's own tracked command and skill files as the branch has them", () => {
    frameworkRoot = makeFrameworkCheckout('https://github.com/acme/framework.git');

    copyClaudeAssetsToWorktree(worktree, ctxFor('acme', 'framework', worktree), frameworkRoot);

    expect(fs.readFileSync(path.join(worktree, COMMAND), 'utf-8')).toBe(BRANCH_COMMAND);
    expect(fs.readFileSync(path.join(worktree, SKILL), 'utf-8')).toBe(BRANCH_SKILL);
    const status = execSync(`git status --porcelain -- ${COMMAND} ${SKILL}`, { cwd: worktree, encoding: 'utf-8' });
    expect(status.trim()).toBe('');
  });

  it("still copies a command that only the framework checkout has, and gitignores it as before", () => {
    frameworkRoot = makeFrameworkCheckout('https://github.com/acme/framework.git');

    copyClaudeAssetsToWorktree(worktree, ctxFor('acme', 'framework', worktree), frameworkRoot);

    expect(fs.existsSync(path.join(worktree, '.claude/commands/framework_only.md'))).toBe(true);
    expect(gitignoreContains(worktree, '.claude/commands/framework_only.md')).toBe(true);
    expect(gitignoreContains(worktree, COMMAND)).toBe(false);
  });

  it('matches the framework identity case-insensitively', () => {
    frameworkRoot = makeFrameworkCheckout('https://github.com/Acme/Framework.git');

    copyClaudeAssetsToWorktree(worktree, ctxFor('acme', 'framework', worktree), frameworkRoot);

    expect(fs.readFileSync(path.join(worktree, COMMAND), 'utf-8')).toBe(BRANCH_COMMAND);
  });

  it('keeps refreshing a tracked asset in an external target repository', () => {
    frameworkRoot = makeFrameworkCheckout('https://github.com/acme/framework.git');

    copyClaudeAssetsToWorktree(worktree, ctxFor('acme', 'widgets', worktree), frameworkRoot);

    expect(fs.readFileSync(path.join(worktree, COMMAND), 'utf-8')).toBe(frontmatter(false, 'older copy in the framework checkout'));
    expect(fs.readFileSync(path.join(worktree, SKILL), 'utf-8')).toBe(frontmatter(true, 'older skill in the framework checkout'));
  });

  it('behaves as it does for an external target when the framework checkout has no origin to read', () => {
    frameworkRoot = makeFrameworkCheckout(null);

    copyClaudeAssetsToWorktree(worktree, ctxFor('acme', 'framework', worktree), frameworkRoot);

    expect(fs.readFileSync(path.join(worktree, COMMAND), 'utf-8')).toBe(frontmatter(false, 'older copy in the framework checkout'));
  });
});
