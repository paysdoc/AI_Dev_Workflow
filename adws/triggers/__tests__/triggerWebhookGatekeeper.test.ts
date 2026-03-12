import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
  generateAdwId: vi.fn(() => 'adw-test-12345678'),
}));

vi.mock('../../core/issueClassifier', () => ({
  classifyIssueForTrigger: vi.fn(),
  getWorkflowScript: vi.fn(),
}));

vi.mock('../issueEligibility', () => ({
  checkIssueEligibility: vi.fn(),
}));

vi.mock('../issueDependencies', () => ({
  parseDependencies: vi.fn(),
}));

import { spawn, execSync } from 'child_process';
import { classifyIssueForTrigger, getWorkflowScript } from '../../core/issueClassifier';

import { checkIssueEligibility } from '../issueEligibility';
import { parseDependencies } from '../issueDependencies';
import { classifyAndSpawnWorkflow, handleIssueClosedDependencyUnblock, ensureCronProcess, resetCronSpawnedForRepo, logDeferral } from '../webhookGatekeeper';

const repoInfo = { owner: 'test', repo: 'repo' };

describe('classifyAndSpawnWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies issue and spawns workflow', async () => {
    vi.mocked(classifyIssueForTrigger).mockResolvedValue({ issueType: '/feature', success: true });
    vi.mocked(getWorkflowScript).mockReturnValue('adws/adwSdlc.tsx');

    await classifyAndSpawnWorkflow(42, repoInfo, ['--target-repo', 'test/repo']);

    expect(spawn).toHaveBeenCalledWith('bunx', expect.arrayContaining(['tsx', 'adws/adwSdlc.tsx', '42']), expect.any(Object));
  });

  it('uses classification adwId when available', async () => {
    vi.mocked(classifyIssueForTrigger).mockResolvedValue({ issueType: '/bug', success: true, adwId: 'adw-custom-id' });
    vi.mocked(getWorkflowScript).mockReturnValue('adws/adwPlanBuildTest.tsx');

    await classifyAndSpawnWorkflow(10, repoInfo, []);

    expect(spawn).toHaveBeenCalledWith('bunx', expect.arrayContaining(['tsx', expect.any(String), '10', 'adw-custom-id']), expect.any(Object));
  });
});

describe('handleIssueClosedDependencyUnblock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds and re-evaluates dependent issues', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      { number: 10, body: '## Dependencies\n- #5' },
      { number: 20, body: 'No deps' },
    ]));
    vi.mocked(parseDependencies).mockImplementation((body: string) => {
      if (body.includes('#5')) return [5];
      return [];
    });
    vi.mocked(checkIssueEligibility).mockResolvedValue({ eligible: true });
    vi.mocked(classifyIssueForTrigger).mockResolvedValue({ issueType: '/feature', success: true });
    vi.mocked(getWorkflowScript).mockReturnValue('adws/adwSdlc.tsx');

    await handleIssueClosedDependencyUnblock(5, repoInfo, []);

    expect(checkIssueEligibility).toHaveBeenCalledWith(10, '## Dependencies\n- #5', repoInfo);
    expect(checkIssueEligibility).not.toHaveBeenCalledWith(20, expect.anything(), expect.anything());
    expect(classifyIssueForTrigger).toHaveBeenCalledWith(10, repoInfo);
  });

  it('does not process still-ineligible issues', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([{ number: 10, body: '## Dependencies\n- #5\n- #6' }]));
    vi.mocked(parseDependencies).mockReturnValue([5, 6]);
    vi.mocked(checkIssueEligibility).mockResolvedValue({ eligible: false, reason: 'open_dependencies', blockingIssues: [6] });

    await handleIssueClosedDependencyUnblock(5, repoInfo, []);

    expect(classifyIssueForTrigger).not.toHaveBeenCalled();
  });

  it('handles no dependents gracefully', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([]));

    await handleIssueClosedDependencyUnblock(5, repoInfo, []);

    expect(checkIssueEligibility).not.toHaveBeenCalled();
  });
});

describe('ensureCronProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCronSpawnedForRepo();
  });

  it('spawns cron process on first call', () => {
    ensureCronProcess(repoInfo, []);
    expect(spawn).toHaveBeenCalledWith('bunx', expect.arrayContaining(['tsx', 'adws/triggers/trigger_cron.ts']), expect.any(Object));
  });

  it('does not spawn cron process on second call for same repo', () => {
    ensureCronProcess(repoInfo, []);
    ensureCronProcess(repoInfo, []);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe('logDeferral', () => {
  it('logs open dependencies reason', async () => {
    const { log } = vi.mocked(await import('../../core/utils'));
    logDeferral(42, { reason: 'open_dependencies', blockingIssues: [10, 20] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('open dependencies'));
  });

  it('logs concurrency limit reason', async () => {
    const { log } = vi.mocked(await import('../../core/utils'));
    logDeferral(42, { reason: 'concurrency_limit' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('concurrency_limit'));
  });
});
