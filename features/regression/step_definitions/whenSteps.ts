import { When } from '@cucumber/cucumber';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCronProbe, runOrchestrator, runWorkflowInit } from '../support/subprocessDrivers.ts';
import type { RegressionWorld } from './world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// Fails without the subprocess harness, so a scenario outside `@regression and (@subprocess or @webhook)` never passes by doing nothing.
When(
  'the {string} orchestrator is invoked with adwId {string} and issue {int}',
  { timeout: 150_000 },
  async function (this: RegressionWorld, orchestratorName: string, adwId: string, issueNumber: number) {
    await runOrchestrator(this, orchestratorName, adwId, issueNumber);
  },
);

// Fails without the subprocess harness, for the reason W1 does.
When(
  'the workflow is initialised with config {string}',
  { timeout: 60_000 },
  async function (this: RegressionWorld, configLabel: string) {
    await runWorkflowInit(this, configLabel);
  },
);

// Fails without the subprocess harness, for the reason W1 does. Records no exit code: the harness kills the cron.
When(
  'the cron probe runs once',
  { timeout: 90_000 },
  async function (this: RegressionWorld) {
    await runCronProbe(this);
  },
);

// A bare `/` is alternation in a cucumber expression, so it is escaped.
When(
  'the git\\/gh guard is run across the repository',
  function (this: RegressionWorld) {
    try {
      const stdout = execFileSync('bunx', ['tsx', 'adws/checkGitGhGuard.ts'], { cwd: ROOT, encoding: 'utf-8' });
      this.gitGhGuardResult = { exitCode: 0, output: stdout };
    } catch (err) {
      const e = err as { status?: number | null; stdout?: string; stderr?: string };
      this.gitGhGuardResult = { exitCode: e.status ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
    }
  },
);
