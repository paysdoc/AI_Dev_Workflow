import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import { detectRecoveryState } from '../../core';
import { executePlanPhase } from '../planPhase';
import { ignoreSpecsInWorktree } from '../worktreeSetup';
import type { WorkflowConfig } from '../workflowInit';

const mockRunPlanAgent = vi.hoisted(() => vi.fn());

vi.mock('../../agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents')>()),
  runPlanAgent: mockRunPlanAgent,
}));

describe('executePlanPhase — the plan stays in the worktree', () => {
  const PLAN_FILE = 'specs/issue-7-adw-abc123-sdlc_planner-plan.md';
  const PROMPT = '.claude/commands/scenario_writer.md';
  const planAgentResult = { success: true, output: 'plan written', totalCostUsd: 0.01, modelUsage: {} };

  let repo: string;
  let stateDir: string;
  let gitContext: GitContext;

  function git(command: string): string {
    return execSync(`git ${command}`, { cwd: repo, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();
  }

  function write(relPath: string, contents: string): void {
    const absolute = path.join(repo, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents, 'utf-8');
  }

  function planConfig(): WorkflowConfig {
    return {
      issueNumber: 7,
      adwId: 'abc123',
      issue: { number: 7, title: 'Test issue', body: '', state: 'open', author: 'tester', labels: [], comments: [], createdAt: '2026-01-01T00:00:00Z' },
      issueType: '/feature',
      worktreePath: repo,
      logsDir: path.join(stateDir, 'logs'),
      orchestratorStatePath: stateDir,
      orchestratorName: 'orchestrator',
      recoveryState: detectRecoveryState([]),
      ctx: { issueNumber: 7, adwId: 'abc123', issueType: '/feature' },
      branchName: 'feature-issue-7-plan-commit',
      repoContext: undefined,
      gitContext,
    } as unknown as WorkflowConfig;
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-phase-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-phase-state-'));
    git('init -q');
    git('config user.email "test@adw.local"');
    git('config user.name "ADW Test"');
    write('README.md', 'readme\n');
    write('.gitignore', 'node_modules/\n');
    write(PROMPT, 'branch copy\n');
    git('add -A');
    git('commit -q -m init');
    gitContext = new GitContext({
      owner: 'acme', repo: 'widgets', selfHost: false, tokenProvider: createLiteralTokenProvider('t'),
      gitIdentity: { authorName: 'T', authorEmail: 't@e.co', committerName: 'T', committerEmail: 't@e.co' },
      frameworkRepoRoot: repo, targetReposDir: repo,
    });
    mockRunPlanAgent.mockReset();
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('leaves the plan in the worktree and adds no commit to the branch', async () => {
    mockRunPlanAgent.mockImplementation(async () => {
      write(PLAN_FILE, '# Plan\n');
      return planAgentResult;
    });
    const headBefore = git('rev-parse HEAD');

    await executePlanPhase(planConfig());

    expect(git('rev-parse HEAD')).toBe(headBefore);
    expect(git('log --format=%H -- specs/')).toBe('');
    expect(fs.readFileSync(path.join(repo, PLAN_FILE), 'utf-8')).toBe('# Plan\n');
  });

  it('leaves the planner\'s other changes uncommitted, whatever they touch', async () => {
    mockRunPlanAgent.mockImplementation(async () => {
      write(PLAN_FILE, '# Plan\n');
      write('docs/notes.md', 'notes\n');
      write('README.md', 'readme, edited\n');
      write(PROMPT, 'planner rewrote this prompt\n');
      return planAgentResult;
    });
    const headBefore = git('rev-parse HEAD');

    await executePlanPhase(planConfig());

    expect(git('rev-parse HEAD')).toBe(headBefore);
    expect(git('status --porcelain --untracked-files=all').split('\n').sort()).toEqual(
      [` M ${PROMPT}`, ' M README.md', '?? docs/notes.md', `?? ${PLAN_FILE}`].sort(),
    );
  });

  it('leaves the plan ignored by git in a worktree that worktree setup prepared', async () => {
    ignoreSpecsInWorktree(repo);
    mockRunPlanAgent.mockImplementation(async () => {
      write(PLAN_FILE, '# Plan\n');
      return planAgentResult;
    });

    await executePlanPhase(planConfig());

    expect(git('status --porcelain --untracked-files=all')).toBe(' M .gitignore');
    expect(fs.existsSync(path.join(repo, PLAN_FILE))).toBe(true);
  });
});
