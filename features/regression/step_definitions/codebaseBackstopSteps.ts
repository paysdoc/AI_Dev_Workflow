import { When, Then } from '@cucumber/cucumber';
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import type { RegressionWorld } from './world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

interface ExecFailure {
  status?: number | null;
  stdout?: string;
  stderr?: string;
}

function runAtRepoRoot(command: string, args: readonly string[]): { exitCode: number; output: string } {
  try {
    const stdout = execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 180_000,
      // The cucumber process runs under `--import tsx`; the child tools need none of it.
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    const failure = err as ExecFailure;
    return { exitCode: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

Then('the ADW TypeScript type-check passes', function () {
  // tsconfig.json sets `incremental`, which would write tsconfig.tsbuildinfo into the checkout — read-only in the Docker leg.
  const { exitCode, output } = runAtRepoRoot('bunx', ['tsc', '--noEmit', '--incremental', 'false']);
  assert.strictEqual(exitCode, 0, `Expected the ADW TypeScript type-check to pass. Output:\n${output}`);
});

// `/` is the Cucumber Expression alternation operator; the escape keeps "git/gh" literal.
When('the git\\/gh guard is run across the repository', function (this: RegressionWorld) {
  this.gitGhGuardRun = runAtRepoRoot('bunx', ['tsx', 'adws/checkGitGhGuard.ts']);
});

Then('the git\\/gh guard reports no violations', function (this: RegressionWorld) {
  assert.ok(this.gitGhGuardRun, 'Expected the git/gh guard to have been run in this scenario');
  assert.strictEqual(
    this.gitGhGuardRun.exitCode,
    0,
    `Expected the git/gh guard to report no violations. Output:\n${this.gitGhGuardRun.output}`,
  );
});
