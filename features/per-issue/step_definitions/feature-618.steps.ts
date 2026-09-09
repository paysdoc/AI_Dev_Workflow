/**
 * BDD step definitions for feature-618.feature
 * adw:* label override enforced at the classification chokepoint.
 *
 * Design
 * ------
 * classifyIssueForTrigger (adws/core/issueClassifier.ts) now accepts an optional
 * ClassifyIssueForTriggerDeps parameter. We inject:
 *   - fetchIssue: returns a pre-seeded GitHubIssue (avoids gh CLI)
 *   - classifyWith: records invocations and returns a fixture-driven type
 *
 * This mirrors the feature-542/545 recording-deps pattern and exercises the
 * chokepoint's real logic (readAdwLabels is live) while keeping tests hermetic.
 *
 * Steps reused from existing files (NOT redefined here):
 *   - Given 'the ADW codebase is checked out'             → ensureCronOnEveryEventSteps.ts
 *   - Given 'the claude-cli-stub is loaded with fixture {string}' → givenSteps.ts (G9)
 *   - Then  'the ADW TypeScript type-check passes'         → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  classifyIssueForTrigger,
  type ClassifyIssueForTriggerDeps,
  type ClassifiableIssue,
  type IssueClassificationResult,
} from '../../../adws/core/issueClassifier.ts';
import { VALID_ISSUE_TYPES } from '../../../adws/types/issueTypes.ts';
import type { IssueClassSlashCommand } from '../../../adws/types/issueTypes.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PAYLOAD_DIR = resolve(ROOT, 'test/fixtures/jsonl/payloads');

// ── Per-scenario state ────────────────────────────────────────────────────────

interface Ctx618 {
  issues: Map<number, ClassifiableIssue>;
  classificationResults: Map<number, IssueClassificationResult>;
  classifierInvocations: Set<number>;
}

const ctx: Ctx618 = {
  issues: new Map(),
  classificationResults: new Map(),
  classifierInvocations: new Set(),
};

function resetCtx(): void {
  ctx.issues.clear();
  ctx.classificationResults.clear();
  ctx.classifierInvocations.clear();
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-618' }, function () {
  resetCtx();
});

After({ tags: '@adw-618' }, function () {
  resetCtx();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeIssue(number: number, labelNames: string[]): ClassifiableIssue {
  return {
    number,
    title: `Issue ${number}`,
    body: 'Test issue body for feature-618.',
    labels: labelNames,
    comments: [],
  };
}

/**
 * Parses the classification from the loaded claude-cli-stub fixture file.
 * Uses the same last-match regex as classifyWithIssueCommand (feature-542 pattern).
 */
function parseClassificationFromFixture(fixturePath: string): IssueClassSlashCommand {
  if (existsSync(fixturePath)) {
    try {
      const payload = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<{ type: string; text?: string }>;
      const text = payload.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
      const pattern = VALID_ISSUE_TYPES.map(c => c.replace('/', '\\/')).join('|');
      const re = new RegExp(`(${pattern})(?!.*(?:${pattern}))`, 's');
      const match = text.match(re);
      if (match) return match[1] as IssueClassSlashCommand;
    } catch { /* fall through */ }
    const nameMatch = fixturePath.match(/classify-as-([a-z_]+)\./);
    if (nameMatch) return `/${nameMatch[1]}` as IssueClassSlashCommand;
  }
  return '/feature';
}

/**
 * Runs classifyIssueForTrigger with recording deps injected.
 * The fetchIssue dep returns the pre-seeded issue; classifyWith records the
 * invocation and returns the fixture-driven type (or '/feature' if no fixture).
 */
async function runClassifier(world: RegressionWorld, issueNumber: number): Promise<void> {
  const issue = ctx.issues.get(issueNumber);
  assert.ok(issue, `No issue seeded for issue ${issueNumber} — call the Given step first`);

  const fixturePath = world.harnessEnv?.['MOCK_FIXTURE_PATH'] ?? resolve(PAYLOAD_DIR, 'classify-as-feature.json');
  const inferredType = parseClassificationFromFixture(fixturePath);

  const deps: ClassifyIssueForTriggerDeps = {
    fetchIssue: async () => issue,
    classifyWith: async (_context, _num, _agent, _output, _body) => {
      ctx.classifierInvocations.add(issueNumber);
      return { issueType: inferredType, success: true };
    },
  };

  const result = await classifyIssueForTrigger(issueNumber, deps);
  ctx.classificationResults.set(issueNumber, result);
}

// ── Given steps ────────────────────────────────────────────────────────────────

Given('an issue {int} carrying the labels {string}', function (issueNumber: number, labelsCsv: string) {
  const labelNames = labelsCsv.split(',').map(s => s.trim()).filter(Boolean);
  ctx.issues.set(issueNumber, makeIssue(issueNumber, labelNames));
});

Given('an issue {int} carrying no labels', function (issueNumber: number) {
  ctx.issues.set(issueNumber, makeIssue(issueNumber, []));
});

// ── When steps ─────────────────────────────────────────────────────────────────

When(
  'the trigger classifier runs for issue {int}',
  async function (this: RegressionWorld, issueNumber: number) {
    await runClassifier(this, issueNumber);
  },
);

When(
  'the {string} trigger path classifies issue {int}',
  async function (this: RegressionWorld, _path: string, issueNumber: number) {
    // _path names the caller (issue_comment / dependency-closure) — documents which
    // label-unaware trigger is exercised, but both paths now share the same chokepoint.
    await runClassifier(this, issueNumber);
  },
);

// ── Then steps ─────────────────────────────────────────────────────────────────

Then(
  'the trigger classification for issue {int} resolves to {string}',
  function (issueNumber: number, expectedType: string) {
    const result = ctx.classificationResults.get(issueNumber);
    assert.ok(result, `No classification result recorded for issue ${issueNumber}`);
    const expected: IssueClassSlashCommand = `/${expectedType}` as IssueClassSlashCommand;
    assert.strictEqual(
      result.issueType,
      expected,
      `Expected issueType "${expected}" for issue ${issueNumber}, got "${result.issueType}"`,
    );
  },
);

Then(
  'the trigger classification for issue {int} reports success',
  function (issueNumber: number) {
    const result = ctx.classificationResults.get(issueNumber);
    assert.ok(result, `No classification result recorded for issue ${issueNumber}`);
    assert.strictEqual(
      result.success,
      true,
      `Expected success=true for issue ${issueNumber}, got ${result.success}`,
    );
  },
);

Then(
  'the AI classification heuristic was not invoked for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      !ctx.classifierInvocations.has(issueNumber),
      `Expected AI heuristic NOT to be invoked for issue ${issueNumber} but it was (classifierInvocations: [${[...ctx.classifierInvocations].join(', ')}])`,
    );
  },
);

Then(
  'the AI classification heuristic was invoked for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      ctx.classifierInvocations.has(issueNumber),
      `Expected AI heuristic to be invoked for issue ${issueNumber} but it was not (classifierInvocations: [${[...ctx.classifierInvocations].join(', ')}])`,
    );
  },
);
