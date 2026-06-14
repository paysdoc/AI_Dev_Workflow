/**
 * BDD step definitions for feature-570.feature
 * adwUpgrade PR body carries both `Closes #N` and `Implements #N`
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'                                  → ensureCronOnEveryEventSteps.ts
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'              → givenSteps.ts (G3)
 *  - Given 'an issue {int} exists in the mock issue tracker'                   → givenSteps.ts (G4)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *  - Given 'the upgrade branch {string} already carries the empty upgrade-claim commit' → feature-541.steps.ts
 *  - Given 'the mock GitHub API is configured to accept issue comments'        → givenSteps.ts (G1)
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1)
 *  - Then  'the orchestrator subprocess exited {int}'                          → thenSteps.ts (T5)
 *  - Then  'the mock GitHub API recorded a PR creation for issue {int}'        → thenSteps.ts (T8)
 *  - Then  'the ADW TypeScript type-check passes'                              → feature-504.steps.ts
 *
 * Novel vocabulary introduced here:
 *  - Then  'the mock GitHub API recorded a PR creation for issue {int} with a body containing {string}'
 *    (extends T8 with a body-content qualifier, exactly as T3 extends T2 for comment bodies)
 */

import { Before, After, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ADW_UPGRADE_SRC = resolve(ROOT, 'adws/adwUpgrade.tsx');

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-570
// ---------------------------------------------------------------------------

Before({ tags: '@adw-570' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-570' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Then — PR creation body-content assertion (novel vocabulary)
// ---------------------------------------------------------------------------

Then(
  'the mock GitHub API recorded a PR creation for issue {int} with a body containing {string}',
  function (this: RegressionWorld, issueNumber: number, expectedText: string) {
    if (this.mockContext !== null) {
      const requests = this.getRecordedRequests();
      const prPost = requests.find((r: RecordedRequest) => {
        if (r.method !== 'POST' || !r.url.includes('/pulls')) return false;
        try {
          const body = JSON.parse(r.body) as Record<string, unknown>;
          const bodyStr = JSON.stringify(body);
          return bodyStr.includes(String(issueNumber));
        } catch {
          return false;
        }
      });
      assert.ok(
        prPost,
        `Expected a POST to /pulls referencing issue ${issueNumber} but none was recorded`,
      );
      const prBody = (JSON.parse(prPost.body) as Record<string, string>)['body'] ?? '';
      assert.ok(
        prBody.includes(expectedText),
        `Expected PR body for issue ${issueNumber} to contain "${expectedText}" but got:\n${prBody}`,
      );
      return;
    }

    // Source inspection fallback: verify the PR body builder includes the expected text pattern.
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    if (expectedText.startsWith('Closes #')) {
      assert.ok(
        src.includes('`Closes #${issueNumber}`'),
        `Expected adwUpgrade.tsx buildUpgradePrBody to include a \`Closes #\${issueNumber}\` line`,
      );
    } else if (expectedText.startsWith('Implements #')) {
      assert.ok(
        src.includes('`Implements #${issueNumber}`'),
        `Expected adwUpgrade.tsx buildUpgradePrBody to include a \`Implements #\${issueNumber}\` line`,
      );
    } else {
      assert.ok(
        src.includes(expectedText),
        `Expected adwUpgrade.tsx to contain "${expectedText}"`,
      );
    }
  },
);
