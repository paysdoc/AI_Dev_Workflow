/**
 * BDD step definitions for feature-584.feature
 * Remove /adw_init from VALID_ISSUE_TYPES so the classifier can never assign it.
 *
 * Steps NOT defined here (already registered):
 *   - Given 'the ADW codebase is checked out'                   → ensureCronOnEveryEventSteps.ts (G18)
 *   - Given 'the claude-cli-stub is loaded with fixture {string}' → givenSteps.ts (G9)
 *   - Then  'the orchestrator subprocess exited {int}'           → thenSteps.ts (T5)
 *   - Then  'the ADW TypeScript type-check passes'               → feature-504.steps.ts (T22)
 *
 * Novel vocabulary introduced here:
 *   - When  'the issue classifier resolves the type for issue {int}'
 *   - Then  'the resolved issue type for issue {int} is {string}'
 *   - Then  'the resolved issue type for issue {int} is not {string}'
 *   - When  'the {string} orchestrator CLI is invoked with the pre-classified issue type {string}'
 *   - Then  "the orchestrator's standard error reports {string} as an invalid issue type"
 *
 * §1/§2 drive the classifier's own last-match logic directly:
 *   The fixture text is parsed with the same regex that classifyWithIssueCommand builds
 *   from the live VALID_ISSUE_TYPES.  Because /adw_init is absent from that array after
 *   the fix, the regex cannot capture it — the result flips exactly when the fix lands.
 *
 * §3 spawns the orchestrator CLI with --issue-type /adw_init and asserts exit 1 + stderr.
 *   Since the validation fires before any workflow/network/auth, it is fast and deterministic.
 *
 * §4 delegates to the pre-existing T22 (tsc --noEmit -p adws/tsconfig.json).
 */

import { Before, After, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { VALID_ISSUE_TYPES } from '../../../adws/types/issueTypes.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { MockContext } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// ── Per-scenario state ────────────────────────────────────────────────────────

interface Ctx584 {
  resolvedTypes: Map<number, string>;
  lastStderr: string;
}

const ctx: Ctx584 = {
  resolvedTypes: new Map(),
  lastStderr: '',
};

function resetCtx(): void {
  ctx.resolvedTypes = new Map();
  ctx.lastStderr = '';
}

// ── Synthetic MockContext ─────────────────────────────────────────────────────
//
// Non-null mockContext is required so T5 checks this.lastExitCode rather than
// falling back to source-inspection of authPause.ts.

function createSyntheticMockContext(): MockContext {
  return {
    serverUrl: 'http://localhost:0',
    port: 0,
    getRecordedRequests: () => [],
    setState: async () => {},
    teardown: async () => {},
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-584' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = createSyntheticMockContext();
});

After({ tags: '@adw-584' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = null;
  this.harnessEnv = {};
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Applies the same last-match regex as classifyWithIssueCommand, built from
 * the live VALID_ISSUE_TYPES.  This is the observable behaviour we want to pin:
 * when /adw_init is absent from the array, the regex cannot capture it.
 */
function inferTypeFromFixture(fixturePath: string): string {
  if (!fixturePath || !existsSync(fixturePath)) return '/feature';
  try {
    const payload = JSON.parse(
      readFileSync(fixturePath, 'utf-8'),
    ) as Array<{ type: string; text?: string }>;
    const text = payload
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const commandPattern = VALID_ISSUE_TYPES.map((cmd) => cmd.replace('/', '\\/')).join('|');
    const regex = new RegExp(`(${commandPattern})(?!.*(?:${commandPattern}))`, 's');
    const match = text.match(regex);
    if (match?.[1]) return match[1];
  } catch {
    /* fall through to default */
  }
  return '/feature';
}

// ── §1/§2 When/Then — classifier resolution ──────────────────────────────────

When(
  'the issue classifier resolves the type for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const fixturePath = this.harnessEnv['MOCK_FIXTURE_PATH'] ?? '';
    const resolved = inferTypeFromFixture(fixturePath);
    ctx.resolvedTypes.set(issueNumber, resolved);
  },
);

Then(
  'the resolved issue type for issue {int} is {string}',
  function (issueNumber: number, expectedType: string) {
    const actual = ctx.resolvedTypes.get(issueNumber);
    assert.ok(
      actual !== undefined,
      `No resolved type for issue ${issueNumber} — did the When step run?`,
    );
    assert.strictEqual(
      actual,
      expectedType,
      `Expected resolved type "${expectedType}" for issue ${issueNumber} but got "${actual}"`,
    );
  },
);

Then(
  'the resolved issue type for issue {int} is not {string}',
  function (issueNumber: number, forbiddenType: string) {
    const actual = ctx.resolvedTypes.get(issueNumber);
    assert.ok(
      actual !== undefined,
      `No resolved type for issue ${issueNumber} — did the When step run?`,
    );
    assert.notStrictEqual(
      actual,
      forbiddenType,
      `Expected resolved type for issue ${issueNumber} to NOT be "${forbiddenType}" but it was`,
    );
  },
);

// ── §3 When/Then — orchestrator CLI /adw_init rejection ──────────────────────

const ORCHESTRATOR_FILES: Record<string, string> = {
  sdlc: 'adwSdlc.tsx',
};

When(
  'the {string} orchestrator CLI is invoked with the pre-classified issue type {string}',
  function (this: RegressionWorld, orchestratorName: string, issueType: string) {
    const orchestratorFile = ORCHESTRATOR_FILES[orchestratorName];
    assert.ok(
      orchestratorFile,
      `Unknown orchestrator name: "${orchestratorName}". Known: ${Object.keys(ORCHESTRATOR_FILES).join(', ')}`,
    );

    const result = spawnSync(
      'bun',
      [resolve(ROOT, `adws/${orchestratorFile}`), '--issue-type', issueType, '1'],
      {
        encoding: 'utf-8',
        timeout: 30_000,
        env: { ...process.env },
      },
    );
    this.lastExitCode = result.status ?? -1;
    ctx.lastStderr = result.stderr ?? '';
  },
);

Then(
  "the orchestrator's standard error reports {string} as an invalid issue type",
  function (rejectedType: string) {
    assert.ok(
      ctx.lastStderr.includes('Invalid issue type') && ctx.lastStderr.includes(rejectedType),
      `Expected stderr to contain "Invalid issue type" and "${rejectedType}" but got:\n${ctx.lastStderr}`,
    );
  },
);
