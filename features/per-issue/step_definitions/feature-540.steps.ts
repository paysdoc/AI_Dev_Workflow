/**
 * BDD step definitions for feature-540.feature
 * labelManager deep module — adw:* label lifecycle and label-based
 * classification.
 *
 * §1–§3 exercise ensureAdwLabelsExist / applyLabel directly with an injected
 * mock exec (the DI boundary). A synthetic MockContext bridges the exec spy's
 * recorded calls into the RecordedRequest shape that vocabulary steps T12/T13
 * assert against, so the registered vocabulary phrases reused in this feature
 * work without a real HTTP server.
 *
 * Vocabulary steps handled by the EXISTING regression step files (no duplicate
 * definitions here):
 *   G4  — an issue {int} exists in the mock issue tracker
 *          → features/regression/step_definitions/givenSteps.ts
 *   G12 — the mock GitHub API is configured to accept label applications
 *          → features/regression/step_definitions/givenSteps.ts
 *   T12 — the mock GitHub API recorded an application of the {string} label on issue {int}
 *          → features/regression/step_definitions/thenSteps.ts
 *
 * Steps NOT defined here (already defined elsewhere):
 *   - Given 'the ADW codebase is checked out'  → ensureCronOnEveryEventSteps.ts
 *   - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import type { GitHubLabel } from '../../../adws/types/issueTypes.ts';
import type { LabelManagerDeps, AdwLabelReading } from '../../../adws/github/labelManager.ts';
import {
  ensureAdwLabelsExist,
  applyLabel,
  readAdwLabels,
} from '../../../adws/github/labelManager.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { MockContext, RecordedRequest } from '../../../test/mocks/types.ts';

// ── Per-scenario state ────────────────────────────────────────────────────────

interface Ctx540 {
  repoInfo: RepoInfo;
  execCalls: string[];
  labelsPresent: Set<string>;
  notFoundUntilCreated: Set<string>;
  alwaysNotFound: Set<string>;
  ensureErrors: Error[];
  applyError: Error | null;
  labelReading: AdwLabelReading | null;
  currentIssueLabels: GitHubLabel[];
}

const ctx: Ctx540 = {
  repoInfo: { owner: 'test-owner', repo: 'test-repo' },
  execCalls: [],
  labelsPresent: new Set(),
  notFoundUntilCreated: new Set(),
  alwaysNotFound: new Set(),
  ensureErrors: [],
  applyError: null,
  labelReading: null,
  currentIssueLabels: [],
};

function resetCtx(): void {
  ctx.repoInfo = { owner: 'test-owner', repo: 'test-repo' };
  ctx.execCalls = [];
  ctx.labelsPresent = new Set();
  ctx.notFoundUntilCreated = new Set();
  ctx.alwaysNotFound = new Set();
  ctx.ensureErrors = [];
  ctx.applyError = null;
  ctx.labelReading = null;
  ctx.currentIssueLabels = [];
}

// ── Synthetic MockContext ─────────────────────────────────────────────────────
//
// Bridges the DI exec spy's recorded commands into the RecordedRequest shape
// that vocabulary steps G4/G12/T12 expect, so those steps work without a real
// HTTP server. The exec spy records gh CLI calls in ctx.execCalls; this context
// translates label-apply calls into synthetic POST /issues/:n/labels entries.

function createSyntheticMockContext(): MockContext {
  return {
    serverUrl: 'http://localhost:0',
    port: 0,
    getRecordedRequests: (): RecordedRequest[] => {
      return ctx.execCalls
        .filter(cmd => cmd.includes('gh issue edit') && cmd.includes('--add-label'))
        .map(cmd => {
          const issueMatch = cmd.match(/issue edit (\d+)/);
          const labelMatch = cmd.match(/--add-label '([^']+)'/);
          const issueNum = issueMatch ? (issueMatch[1] ?? '0') : '0';
          const labelName = labelMatch ? (labelMatch[1] ?? '') : '';
          return {
            method: 'POST',
            url: `/repos/${ctx.repoInfo.owner}/${ctx.repoInfo.repo}/issues/${issueNum}/labels`,
            headers: {},
            body: JSON.stringify({ labels: [labelName] }),
            timestamp: new Date().toISOString(),
          };
        });
    },
    setState: async () => {},
    teardown: async () => {},
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-540' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = createSyntheticMockContext();
});

After({ tags: '@adw-540' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = null;
  this.harnessEnv = {};
});

// ── Build mock deps (closes over ctx) ────────────────────────────────────────

function buildMockDeps(): LabelManagerDeps {
  return {
    exec: (command: string) => {
      ctx.execCalls.push(command);

      const createMatch = command.match(/gh label create '([^']+)'/);
      if (createMatch) {
        const labelName = createMatch[1]!;
        ctx.notFoundUntilCreated.delete(labelName);
        ctx.labelsPresent.add(labelName);
        return '';
      }

      const addLabelMatch = command.match(/gh issue edit \d+ .* --add-label '([^']+)'/);
      if (addLabelMatch) {
        const labelName = addLabelMatch[1]!;
        if (ctx.alwaysNotFound.has(labelName)) {
          throw new Error(`Label '${labelName}' not found`);
        }
        if (ctx.notFoundUntilCreated.has(labelName)) {
          throw new Error(`Label '${labelName}' not found`);
        }
        return '';
      }

      return '';
    },
    logger: () => {},
  };
}

// ── §1 Given steps ────────────────────────────────────────────────────────────

Given('a target repo with none of the adw:* labels present', function () {
  ctx.labelsPresent = new Set();
});

Given('the mock GitHub API is configured to accept label creation', function () {
  // Default behavior — mock exec succeeds for gh label create calls.
});

// ── §2/§3 Given steps ────────────────────────────────────────────────────────
// Note: 'an issue {int} exists in the mock issue tracker' (G4) and
//       'the mock GitHub API is configured to accept label applications' (G12)
//       are handled by the regression vocabulary step files.

Given('the target repo already has the {string} label', function (labelName: string) {
  ctx.labelsPresent.add(labelName);
});

Given('the target repo is missing the {string} label', function (labelName: string) {
  ctx.labelsPresent.delete(labelName);
  ctx.notFoundUntilCreated.add(labelName);
});

Given(
  'the mock GitHub API rejects applying the {string} label with a not-found error until the label is created',
  function (labelName: string) {
    ctx.notFoundUntilCreated.add(labelName);
  },
);

Given(
  'the mock GitHub API rejects every application of the {string} label with a not-found error',
  function (labelName: string) {
    ctx.alwaysNotFound.add(labelName);
  },
);

// ── §4 Given steps ────────────────────────────────────────────────────────────

Given('an issue carrying no adw:* labels', function () {
  ctx.currentIssueLabels = [];
});

Given('an issue carrying the labels {string}', function (labelsStr: string) {
  const names = labelsStr.split(',').map((s: string) => s.trim()).filter(Boolean);
  ctx.currentIssueLabels = names.map((name: string) => ({
    id: name,
    name,
    color: 'cccccc',
    description: null,
  }));
});

// ── §1 When steps ─────────────────────────────────────────────────────────────

When('ADW ensures the adw:* labels exist on the target repo', function () {
  try {
    ensureAdwLabelsExist(ctx.repoInfo, buildMockDeps());
  } catch (error) {
    ctx.ensureErrors.push(error as Error);
  }
});

When('ADW ensures the adw:* labels exist on the target repo again', function () {
  try {
    ensureAdwLabelsExist(ctx.repoInfo, buildMockDeps());
  } catch (error) {
    ctx.ensureErrors.push(error as Error);
  }
});

// ── §2/§3 When steps ─────────────────────────────────────────────────────────

When('ADW applies the {string} label to issue {int}', function (labelName: string, issueNumber: number) {
  try {
    applyLabel(issueNumber, labelName, ctx.repoInfo, buildMockDeps());
  } catch (error) {
    ctx.applyError = error as Error;
  }
});

// ── §4 When step ──────────────────────────────────────────────────────────────

When('ADW reads the adw labels on the issue', function () {
  ctx.labelReading = readAdwLabels({ labels: ctx.currentIssueLabels });
});

// ── §1 Then steps ─────────────────────────────────────────────────────────────

Then('the mock GitHub API recorded a creation of the {string} label', function (labelName: string) {
  const found = ctx.execCalls.some(
    cmd => cmd.includes('gh label create') && cmd.includes(`'${labelName}'`),
  );
  assert.ok(
    found,
    `Expected a label creation for "${labelName}" but none was recorded.\nCalls:\n${ctx.execCalls.join('\n')}`,
  );
});

Then('ADW ensuring the adw:* labels exist completed without error', function () {
  assert.strictEqual(
    ctx.ensureErrors.length,
    0,
    `Expected no ensure errors, got: ${ctx.ensureErrors.map(e => e.message).join(', ')}`,
  );
});

Then('both adw:* label-ensure passes completed without error', function () {
  assert.strictEqual(
    ctx.ensureErrors.length,
    0,
    `Expected no ensure errors across both runs, got: ${ctx.ensureErrors.map(e => e.message).join(', ')}`,
  );
});

Then('the target repo carries all six adw:* labels', function () {
  const sixLabels = ['adw:chore', 'adw:bug', 'adw:feature', 'adw:pr_review', 'adw:upgrade', 'adw:none'];
  for (const labelName of sixLabels) {
    assert.ok(
      ctx.labelsPresent.has(labelName),
      `Expected label "${labelName}" to be present on the repo`,
    );
  }
});

// ── §2 Then steps ─────────────────────────────────────────────────────────────
// Note: 'the mock GitHub API recorded an application of the {string} label on issue {int}' (T12)
//       is handled by the regression vocabulary step file.
//       The synthetic MockContext above provides the RecordedRequest data it expects.

Then(
  'the mock GitHub API recorded no creation of the {string} label',
  function (labelName: string) {
    const found = ctx.execCalls.some(
      cmd => cmd.includes('gh label create') && cmd.includes(`'${labelName}'`),
    );
    assert.ok(
      !found,
      `Expected NO label creation for "${labelName}" but one was recorded.\nCalls:\n${ctx.execCalls.join('\n')}`,
    );
  },
);

Then('ADW applying the {string} label completed without error', function (labelName: string) {
  assert.strictEqual(
    ctx.applyError,
    null,
    `Expected no error applying "${labelName}", got: ${ctx.applyError?.message}`,
  );
});

// ── §3 Then steps ─────────────────────────────────────────────────────────────

Then(
  'the mock GitHub API recorded exactly one creation of the {string} label',
  function (labelName: string) {
    const createCalls = ctx.execCalls.filter(
      cmd => cmd.includes('gh label create') && cmd.includes(`'${labelName}'`),
    );
    assert.strictEqual(
      createCalls.length,
      1,
      `Expected exactly 1 creation of "${labelName}", got ${createCalls.length}.\nCalls:\n${ctx.execCalls.join('\n')}`,
    );
  },
);

Then(
  'the {string} label was created before it was applied to issue {int}',
  function (labelName: string, issueNumber: number) {
    const createIdx = ctx.execCalls.findIndex(
      cmd => cmd.includes('gh label create') && cmd.includes(`'${labelName}'`),
    );
    const editCalls = ctx.execCalls
      .map((cmd, i) => ({ cmd, i }))
      .filter(({ cmd }) =>
        cmd.includes('issue edit') &&
        cmd.includes(String(issueNumber)) &&
        cmd.includes(`'${labelName}'`),
      );
    const lastApplyIdx = editCalls.length > 0 ? editCalls[editCalls.length - 1]!.i : -1;
    assert.ok(createIdx !== -1, `Expected a creation call for "${labelName}"`);
    assert.ok(lastApplyIdx !== -1, `Expected an application call for "${labelName}" on issue ${issueNumber}`);
    assert.ok(
      createIdx < lastApplyIdx,
      `Expected create (index ${createIdx}) before last apply (index ${lastApplyIdx})`,
    );
  },
);

Then('ADW applying the {string} label reported a failure', function (labelName: string) {
  assert.ok(
    ctx.applyError !== null,
    `Expected applyLabel("${labelName}") to throw but it completed without error`,
  );
});

// ── §4 Then steps ─────────────────────────────────────────────────────────────

Then('the adw label reading reports no opt-out', function () {
  assert.ok(ctx.labelReading !== null, 'Expected labelReading to be set');
  assert.strictEqual(ctx.labelReading.optOut, false, `Expected optOut=false, got ${ctx.labelReading.optOut}`);
});

Then('the adw label reading reports an opt-out', function () {
  assert.ok(ctx.labelReading !== null, 'Expected labelReading to be set');
  assert.strictEqual(ctx.labelReading.optOut, true, `Expected optOut=true, got ${ctx.labelReading.optOut}`);
});

Then('the adw label reading reports no classification', function () {
  assert.ok(ctx.labelReading !== null, 'Expected labelReading to be set');
  assert.strictEqual(
    ctx.labelReading.classification,
    null,
    `Expected classification=null, got "${ctx.labelReading.classification}"`,
  );
});

Then('the adw label reading reports classification {string}', function (expectedType: string) {
  assert.ok(ctx.labelReading !== null, 'Expected labelReading to be set');
  const expectedCmd = `/${expectedType}`;
  assert.strictEqual(
    ctx.labelReading.classification,
    expectedCmd,
    `Expected classification="${expectedCmd}", got "${ctx.labelReading.classification}"`,
  );
});

Then('the adw label reading reports no conflict', function () {
  assert.ok(ctx.labelReading !== null, 'Expected labelReading to be set');
  assert.strictEqual(ctx.labelReading.conflict, false, `Expected conflict=false, got ${ctx.labelReading.conflict}`);
});

Then('the adw label reading reports a conflict', function () {
  assert.ok(ctx.labelReading !== null, 'Expected labelReading to be set');
  assert.strictEqual(ctx.labelReading.conflict, true, `Expected conflict=true, got ${ctx.labelReading.conflict}`);
});
