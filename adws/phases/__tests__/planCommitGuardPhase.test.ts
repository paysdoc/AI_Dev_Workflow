import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  PlanCommitGuardError,
  assertPlanPhaseLeftOffLimitsAlone,
  capturePlanPhaseBaseline,
  committedPathsSince,
  hashOffLimitsFiles,
} from '../planCommitGuard.ts';
import { PLAN_FILE, commitAll, ctx, git, repo, setupPlanGuardRepo, write } from './fixtures/planCommitGuardHarness.ts';

setupPlanGuardRepo();

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
