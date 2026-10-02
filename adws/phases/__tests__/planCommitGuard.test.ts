import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import {
  PlanCommitGuardError,
  assertPlanPhaseLeftOffLimitsAlone,
  buildPlanCommitMessage,
  capturePlanPhaseBaseline,
  changedFilePaths,
  commitPlanFileOnly,
  committedPathsSince,
  findOffLimitsChanges,
  hashOffLimitsFiles,
  isOffLimitsToPlanner,
  parseNameOnlyDiff,
} from '../planCommitGuard.ts';

const PLAN_FILE = 'specs/issue-7-adw-abc123-sdlc_planner-plan.md';

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();
}

function write(root: string, relPath: string, contents: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf-8');
}

function commitAll(root: string, message: string): void {
  git(root, 'add -A');
  git(root, `commit -q -m "${message}"`);
}

function filesInHead(root: string): string[] {
  return git(root, 'show --name-only --format= HEAD').split('\n').filter(Boolean);
}

function statusLines(root: string): string[] {
  return git(root, 'status --porcelain --untracked-files=all').split('\n').filter(Boolean);
}

let repo: string;
let ctx: GitContext;

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

describe('buildPlanCommitMessage', () => {
  it('keeps the plan-orchestrator prefix and the conventional-commit keyword', () => {
    expect(buildPlanCommitMessage('/bug', 930)).toBe('plan-orchestrator: fix: add plan for issue #930');
    expect(buildPlanCommitMessage('/feature', 12)).toBe('plan-orchestrator: feat: add plan for issue #12');
    expect(buildPlanCommitMessage('/chore', 5)).toBe('plan-orchestrator: chore: add plan for issue #5');
  });
});

describe('commitPlanFileOnly', () => {
  beforeEach(() => {
    write(repo, 'README.md', 'readme, edited\n');
    write(repo, 'src/widget.ts', 'export const widget = 2;\n');
    git(repo, 'add src/widget.ts');
    write(repo, '.claude/commands/install.md', 'stale install\n');
    write(repo, PLAN_FILE, '# Plan\n');
  });

  it('commits the plan file and no other path', () => {
    const committed = commitPlanFileOnly(ctx, repo, PLAN_FILE, 'plan-orchestrator: fix: add plan for issue #7');

    expect(committed).toBe(true);
    expect(filesInHead(repo)).toEqual([PLAN_FILE]);
    expect(git(repo, 'log -1 --format=%s')).toBe('plan-orchestrator: fix: add plan for issue #7');
  });

  it("commits under the launch GitContext's git identity, not the host's git config", () => {
    commitPlanFileOnly(ctx, repo, PLAN_FILE, 'plan-orchestrator: fix: add plan for issue #7');

    expect(git(repo, 'log -1 --format=%an,%ae,%cn,%ce')).toBe('T,t@e.co,T,t@e.co');
  });

  it('leaves every other change in the worktree uncommitted, staged changes still staged', () => {
    commitPlanFileOnly(ctx, repo, PLAN_FILE, 'plan-orchestrator: fix: add plan for issue #7');

    expect(statusLines(repo)).toEqual([
      ' M .claude/commands/install.md',
      ' M README.md',
      'M  src/widget.ts',
    ]);
  });

  it('returns false when the plan file is already committed and unchanged', () => {
    commitPlanFileOnly(ctx, repo, PLAN_FILE, 'plan-orchestrator: fix: add plan for issue #7');
    const headBefore = git(repo, 'rev-parse HEAD');

    expect(commitPlanFileOnly(ctx, repo, PLAN_FILE, 'plan-orchestrator: fix: add plan for issue #7')).toBe(false);
    expect(git(repo, 'rev-parse HEAD')).toBe(headBefore);
  });

  it('throws, naming the expected plan path, when the plan file is missing', () => {
    expect(() => commitPlanFileOnly(ctx, repo, 'specs/issue-7-adw-none-sdlc_planner-missing.md', 'msg'))
      .toThrow('specs/issue-7-adw-none-sdlc_planner-missing.md');
  });
});

describe('isOffLimitsToPlanner', () => {
  it.each([
    '.claude',
    '.adw',
    '.claude/commands/scenario_writer.md',
    '.adw/commands.md',
    './.claude/settings.json',
    '.claude\\commands\\scenario_writer.md',
  ])('is off limits: %s', (relPath) => {
    expect(isOffLimitsToPlanner(relPath)).toBe(true);
  });

  it.each([
    '.adw-version',
    '.adw-stub-invocations',
    '.adw-stub-manifest.json',
    '.claude-x',
    '.claudeignore',
    'docs/.claude/notes.md',
    'specs/issue-7-adw-abc123-sdlc_planner-plan.md',
    'README.md',
  ])('is not off limits: %s', (relPath) => {
    expect(isOffLimitsToPlanner(relPath)).toBe(false);
  });
});

describe('changedFilePaths', () => {
  it('reports created, deleted and modified paths, sorted, and ignores unchanged ones', () => {
    const before = new Map([['.adw/a.md', '1'], ['.adw/b.md', '2'], ['.adw/c.md', '3']]);
    const after = new Map([['.adw/a.md', '1'], ['.adw/b.md', 'changed'], ['.adw/d.md', '4']]);

    expect(changedFilePaths(before, after)).toEqual(['.adw/b.md', '.adw/c.md', '.adw/d.md']);
  });

  it('reports nothing when the two states are identical', () => {
    const state = new Map([['.claude/x.md', 'h']]);
    expect(changedFilePaths(state, new Map(state))).toEqual([]);
  });
});

describe('parseNameOnlyDiff', () => {
  it('splits lines, trims them, drops empty ones and strips the quotes git puts around unusual paths', () => {
    const output = '.claude/a.md\n  .adw/b.md  \n\n".claude/with space.md"\n';
    expect(parseNameOnlyDiff(output)).toEqual(['.claude/a.md', '.adw/b.md', '.claude/with space.md']);
  });

  it('returns an empty list for empty output', () => {
    expect(parseNameOnlyDiff('')).toEqual([]);
  });
});

describe('findOffLimitsChanges', () => {
  const baseline = { head: 'abc1234', offLimitsFiles: new Map([['.claude/x.md', 'h1']]) };

  it('unions the changed files with the off-limits paths of added commits, sorted and de-duplicated', () => {
    const current = {
      offLimitsFiles: new Map([['.claude/x.md', 'h2'], ['.adw/new.md', 'h3']]),
      committedPaths: ['.claude/x.md', 'README.md', '.adw/other.md'],
    };

    expect(findOffLimitsChanges(baseline, current)).toEqual(['.adw/new.md', '.adw/other.md', '.claude/x.md']);
  });

  it('ignores committed paths outside .claude/ and .adw/', () => {
    const current = { offLimitsFiles: new Map(baseline.offLimitsFiles), committedPaths: ['README.md', 'specs/p.md'] };
    expect(findOffLimitsChanges(baseline, current)).toEqual([]);
  });
});

describe('hashOffLimitsFiles', () => {
  it('hashes every file under .claude/ and .adw/ by POSIX relative path, and nothing else', () => {
    const hashes = hashOffLimitsFiles(repo);

    expect([...hashes.keys()].sort()).toEqual([
      '.adw/commands.md',
      '.claude/commands/install.md',
      '.claude/commands/scenario_writer.md',
      '.claude/skills/tdd/SKILL.md',
    ]);
  });

  it('gives a file a different hash when its contents change, and the same hash when they do not', () => {
    const before = hashOffLimitsFiles(repo);
    write(repo, '.claude/commands/install.md', 'changed\n');
    const after = hashOffLimitsFiles(repo);

    expect(after.get('.claude/commands/install.md')).not.toBe(before.get('.claude/commands/install.md'));
    expect(after.get('.adw/commands.md')).toBe(before.get('.adw/commands.md'));
  });

  it('hashes a symlink by its target without following it', () => {
    fs.symlinkSync('/nonexistent/target', path.join(repo, '.claude', 'dangling-link'));

    expect(hashOffLimitsFiles(repo).has('.claude/dangling-link')).toBe(true);
  });

  it('returns an empty map when neither directory exists', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-guard-bare-'));
    try {
      expect(hashOffLimitsFiles(bare).size).toBe(0);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('capturePlanPhaseBaseline', () => {
  it('records the HEAD commit and the hashes of the off-limits files', () => {
    const baseline = capturePlanPhaseBaseline(ctx, repo);

    expect(baseline.head).toBe(git(repo, 'rev-parse --short HEAD'));
    expect(baseline.offLimitsFiles).toEqual(hashOffLimitsFiles(repo));
  });
});

describe('committedPathsSince', () => {
  it('lists every path in commits added since the baseline head, both sides of a rename', () => {
    const head = git(repo, 'rev-parse --short HEAD');
    git(repo, 'mv .claude/commands/install.md docs-install.md');
    write(repo, 'README.md', 'edited\n');
    commitAll(repo, 'move and edit');

    expect(committedPathsSince(ctx, repo, head).sort()).toEqual(['.claude/commands/install.md', 'README.md', 'docs-install.md']);
  });

  it('is empty when nothing was committed since the baseline head', () => {
    expect(committedPathsSince(ctx, repo, git(repo, 'rev-parse --short HEAD'))).toEqual([]);
  });
});

describe('assertPlanPhaseLeftOffLimitsAlone', () => {
  it('fails with a PlanCommitGuardError naming the path when a .claude/ file is modified during the plan phase', () => {
    const baseline = capturePlanPhaseBaseline(ctx, repo);
    write(repo, '.claude/commands/scenario_writer.md', 'planner rewrote this\n');

    const run = (): void => assertPlanPhaseLeftOffLimitsAlone(ctx, repo, baseline);

    expect(run).toThrow(PlanCommitGuardError);
    expect(run).toThrow('.claude/commands/scenario_writer.md');
    try {
      run();
    } catch (err) {
      expect((err as PlanCommitGuardError).paths).toEqual(['.claude/commands/scenario_writer.md']);
      expect((err as PlanCommitGuardError).name).toBe('PlanCommitGuardError');
    }
  });

  it('names every offending path in the message', () => {
    const baseline = capturePlanPhaseBaseline(ctx, repo);
    write(repo, '.adw/commands.md', 'changed\n');
    write(repo, '.claude/commands/plan_checklist.md', 'new\n');

    expect(() => assertPlanPhaseLeftOffLimitsAlone(ctx, repo, baseline))
      .toThrow(/2 path\(s\).*\.adw\/commands\.md, \.claude\/commands\/plan_checklist\.md/);
  });

  describe.each([
    ['creating a file under .claude/', '.claude/commands/plan_checklist.md', () => write(repo, '.claude/commands/plan_checklist.md', 'new\n')],
    ['deleting a file under .claude/', '.claude/skills/tdd/SKILL.md', () => fs.rmSync(path.join(repo, '.claude/skills/tdd/SKILL.md'))],
    ['modifying and staging a file under .adw/', '.adw/commands.md', () => {
      write(repo, '.adw/commands.md', 'changed\n');
      git(repo, 'add .adw/commands.md');
    }],
    ['creating a file under .adw/', '.adw/plan_notes.md', () => write(repo, '.adw/plan_notes.md', 'notes\n')],
    ['modifying a .claude/ file and committing it', '.claude/commands/scenario_writer.md', () => {
      write(repo, '.claude/commands/scenario_writer.md', 'planner rewrote this\n');
      commitAll(repo, 'planner commit');
    }],
  ])('%s', (_label, offLimitsPath, act) => {
    it(`fails naming ${offLimitsPath}`, () => {
      const baseline = capturePlanPhaseBaseline(ctx, repo);
      act();

      expect(() => assertPlanPhaseLeftOffLimitsAlone(ctx, repo, baseline)).toThrow(offLimitsPath);
    });
  });

  it('fails when a .claude/ change that already existed before the baseline is committed during the phase', () => {
    write(repo, '.claude/commands/install.md', 'stale copy left by worktree setup\n');
    const baseline = capturePlanPhaseBaseline(ctx, repo);
    commitAll(repo, 'sweeps up the stale copy');

    expect(() => assertPlanPhaseLeftOffLimitsAlone(ctx, repo, baseline)).toThrow('.claude/commands/install.md');
  });

  it('passes when .claude/ and .adw/ changes existed before the baseline and stay as they were', () => {
    write(repo, '.claude/commands/install.md', 'stale copy left by worktree setup\n');
    write(repo, '.claude/skills/new-skill/SKILL.md', 'copied by worktree setup\n');
    write(repo, '.adw/commands.md', 'left by worktree setup\n');
    const baseline = capturePlanPhaseBaseline(ctx, repo);

    expect(() => assertPlanPhaseLeftOffLimitsAlone(ctx, repo, baseline)).not.toThrow();
  });

  it('passes when the planner only changes files outside .claude/ and .adw/, .adw-* files included', () => {
    const baseline = capturePlanPhaseBaseline(ctx, repo);
    write(repo, 'README.md', 'edited\n');
    write(repo, 'docs/x.md', 'new\n');
    write(repo, '.adw-version', '1.2.3\n');
    write(repo, '.adw-stub-invocations', '2');
    write(repo, PLAN_FILE, '# Plan\n');

    expect(() => assertPlanPhaseLeftOffLimitsAlone(ctx, repo, baseline)).not.toThrow();
  });

  it('passes when the planner commits a change outside .claude/ and .adw/', () => {
    const baseline = capturePlanPhaseBaseline(ctx, repo);
    write(repo, 'src/widget.ts', 'export const widget = 2;\n');
    commitAll(repo, 'planner commit outside the off-limits directories');

    expect(() => assertPlanPhaseLeftOffLimitsAlone(ctx, repo, baseline)).not.toThrow();
  });
});
