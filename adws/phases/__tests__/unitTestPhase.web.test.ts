import { describe, it, expect } from 'vitest';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { ADW_PLAYWRIGHT_INSTALL_COMMAND } from '../../core/adwPlaywrightProject';
import type { ProcessRunner } from '../../core/checkRunner';
import { executeUnitTestPhase } from '../unitTestPhase';
import {
  ALL_CHECKS_RAN,
  GREEN,
  executionLog,
  makeConfig,
  recordingProcessRunner,
  recordingTestRun,
  useUnitTestPhaseSandbox,
} from './unitTestPhase.helpers';

useUnitTestPhaseSandbox();

describe("executeUnitTestPhase — a web repository installs ADW's Playwright project before the static checks", () => {
  const INSTALL = `check:${ADW_PLAYWRIGHT_INSTALL_COMMAND}`;

  it('runs the install first, in the worktree, and then the four checks', async () => {
    const events: string[] = [];
    const config = makeConfig(false, undefined, APPLICATION_TYPE_PROFILES.web);
    const directories: string[] = [];
    const runProcess: ProcessRunner = async (command, cwd) => {
      events.push(`check:${command}`);
      directories.push(cwd);
      return GREEN;
    };

    await executeUnitTestPhase(config, { runProcess, runUnitTestsWithRetry: recordingTestRun(events) });

    expect(events).toEqual([INSTALL, ...ALL_CHECKS_RAN]);
    expect(directories).toEqual(Array(5).fill(config.worktreePath));
  });

  it('installs before the checks and the test run alike', async () => {
    const events: string[] = [];

    await executeUnitTestPhase(makeConfig(true, undefined, APPLICATION_TYPE_PROFILES.web), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual([INSTALL, ...ALL_CHECKS_RAN, 'tests']);
  });

  it('logs the install on the console and in the execution log', async () => {
    const config = makeConfig(false, undefined, APPLICATION_TYPE_PROFILES.web);

    await executeUnitTestPhase(config, { runProcess: recordingProcessRunner([]), runUnitTestsWithRetry: recordingTestRun([]) });

    expect(executionLog(config)).toContain(`Scenario project installed (${ADW_PLAYWRIGHT_INSTALL_COMMAND})`);
  });

  it('runs all four checks and logs the failure when the install fails', async () => {
    const events: string[] = [];
    const config = makeConfig(false, undefined, APPLICATION_TYPE_PROFILES.web);

    const result = await executeUnitTestPhase(config, {
      runProcess: recordingProcessRunner(events, { [ADW_PLAYWRIGHT_INSTALL_COMMAND]: { exitCode: 1, output: 'npm ERR! The npm ci command can only install with an existing package-lock.json' } }),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual([INSTALL, ...ALL_CHECKS_RAN]);
    expect(result.unitTestsPassed).toBe(true);
    expect(executionLog(config)).toContain('Scenario project install failed');
    expect(executionLog(config)).toContain('can only install with an existing package-lock.json');
  });

  it('runs all four checks when the install cannot be run at all', async () => {
    const events: string[] = [];
    const runProcess: ProcessRunner = async (command) => {
      events.push(`check:${command}`);
      if (command === ADW_PLAYWRIGHT_INSTALL_COMMAND) throw new Error('spawn /bin/sh ENOENT');
      return GREEN;
    };
    const config = makeConfig(false, undefined, APPLICATION_TYPE_PROFILES.web);

    const result = await executeUnitTestPhase(config, { runProcess, runUnitTestsWithRetry: recordingTestRun(events) });

    expect(events).toEqual([INSTALL, ...ALL_CHECKS_RAN]);
    expect(result.unitTestsPassed).toBe(true);
    expect(executionLog(config)).toContain('spawn /bin/sh ENOENT');
  });
});

describe('executeUnitTestPhase — a cli repository installs nothing of its own', () => {
  it('runs exactly the four checks, and logs no scenario project install', async () => {
    const events: string[] = [];
    const config = makeConfig(false, undefined, APPLICATION_TYPE_PROFILES.cli);

    await executeUnitTestPhase(config, { runProcess: recordingProcessRunner(events), runUnitTestsWithRetry: recordingTestRun(events) });

    expect(events).toEqual(ALL_CHECKS_RAN);
    expect(executionLog(config)).not.toContain('Scenario project install');
  });
});

describe('executeUnitTestPhase — a config without an application profile', () => {
  it('rejects before it runs anything, instead of assuming a type', async () => {
    const events: string[] = [];
    const config = makeConfig(false);
    delete config.applicationProfile;

    await expect(
      executeUnitTestPhase(config, { runProcess: recordingProcessRunner(events), runUnitTestsWithRetry: recordingTestRun(events) }),
    ).rejects.toThrow(/requireApplicationProfile/);

    expect(events).toEqual([]);
  });
});
