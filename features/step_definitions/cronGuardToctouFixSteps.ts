import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

Then(
  'the registerAndGuard function returns false when a live process blocks the exclusive create',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('EEXIST'),
      "Expected cronProcessGuard.ts to handle the 'EEXIST' error code from the wx write",
    );
    assert.ok(
      content.includes('isProcessAlive'),
      'Expected cronProcessGuard.ts to call isProcessAlive when handling EEXIST',
    );
    assert.ok(
      content.includes('return false'),
      'Expected registerAndGuard to return false when a live process already holds the PID file',
    );
  },
);

Then(
  'the registerAndGuard function removes the stale file before retrying the wx write',
  function () {
    const content = sharedCtx.fileContent;
    const hasRemoval =
      content.includes('unlinkSync') || content.includes('removeCronPid');
    assert.ok(
      hasRemoval,
      "Expected cronProcessGuard.ts to remove the stale PID file (unlinkSync or removeCronPid) before retrying the 'wx' write",
    );
    assert.ok(
      content.includes("'wx'"),
      "Expected the 'wx' flag to be present for the retry write after stale file removal",
    );
  },
);

Then('the ADW TypeScript type-check passes', function () {
  try {
    execSync('bunx tsc --noEmit --project adws/tsconfig.json', {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    const output = (error.stdout ?? '') + (error.stderr ?? '');
    assert.fail(`TypeScript type-check failed for adws/tsconfig.json:\n${output}`);
  }
});
