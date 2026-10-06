import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { ParkReason, buildParkComment } from '../../forge/parkComment';
import { buildApplicationTypeGateDeps, runApplicationTypeGate, type ApplicationTypeGateConfig } from '../applicationTypeGate';
import {
  DEFAULT_BRANCH,
  ExitSignal,
  ISSUE_NUMBER,
  adwId,
  configDeclaring,
  makeConfig,
  makeTempDir,
  useApplicationTypeGateSandbox,
} from './applicationTypeGate.helpers';

useApplicationTypeGateSandbox();

describe('buildApplicationTypeGateDeps — the real park, end to end', () => {
  function worktreeWithProjectMd(projectMd: string | null): string {
    const worktree = makeTempDir('adw-apptype-gate-real-');
    fs.mkdirSync(path.join(worktree, '.adw'));
    if (projectMd !== null) fs.writeFileSync(path.join(worktree, '.adw', 'project.md'), projectMd, 'utf-8');
    return worktree;
  }

  function runWithRealDeps(config: ApplicationTypeGateConfig, merge = vi.fn()): void {
    runApplicationTypeGate(config, configDeclaring(null), buildApplicationTypeGateDeps({ mergeLatestFromDefaultBranch: merge }));
  }

  it('parks as human_gated and posts the missing_application_type comment when the section is missing', () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(worktreeWithProjectMd('## Project Overview\nA tool\n'), commentOnIssue);

    expect(() => runWithRealDeps(config)).toThrow(ExitSignal);

    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).toBe('human_gated');
    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    const expected = buildParkComment(adwId, { reason: ParkReason.MissingApplicationType, found: null });
    expect(commentOnIssue).toHaveBeenCalledWith(ISSUE_NUMBER, expected);
    expect(expected).toContain('`## Application Type`');
    expect(expected).toContain('Re-run `adw_init`');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('quotes the value in the comment when the section names a type ADW does not know', () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(worktreeWithProjectMd('## Application Type\ndesktop\n'), commentOnIssue);

    expect(() => runWithRealDeps(config)).toThrow(ExitSignal);

    expect(commentOnIssue).toHaveBeenCalledWith(ISSUE_NUMBER, buildParkComment(adwId, { reason: ParkReason.MissingApplicationType, found: 'desktop' }));
  });

  it('parks a repository that has no .adw/ directory', () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(makeTempDir('adw-apptype-gate-bare-'), commentOnIssue);

    expect(() => runWithRealDeps(config)).toThrow(ExitSignal);

    expect(commentOnIssue).toHaveBeenCalledWith(ISSUE_NUMBER, buildParkComment(adwId, { reason: ParkReason.MissingApplicationType, found: null }));
  });

  it('merges the latest default branch through the git context it was given before it parks', () => {
    const merge = vi.fn();
    const config = makeConfig(worktreeWithProjectMd('## Project Overview\nA tool\n'));

    expect(() => runWithRealDeps(config, merge)).toThrow(ExitSignal);

    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith(DEFAULT_BRANCH, config.worktreePath);
  });

  it('proceeds, and posts nothing, when the merge brings the section into the worktree', () => {
    const commentOnIssue = vi.fn();
    const worktree = worktreeWithProjectMd('## Project Overview\nA tool\n');
    const merge = vi.fn(() => {
      fs.writeFileSync(path.join(worktree, '.adw', 'project.md'), '## Application Type\ncli\n', 'utf-8');
    });
    const config = makeConfig(worktree, commentOnIssue);

    const result = runApplicationTypeGate(config, configDeclaring(null), buildApplicationTypeGateDeps({ mergeLatestFromDefaultBranch: merge }));

    expect(result.applicationProfile).toBe(APPLICATION_TYPE_PROFILES.cli);
    expect(result.projectConfig.applicationType).toBe('cli');
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).not.toBe('human_gated');
  });
});
