/**
 * BDD step definitions for feature-579.feature
 * Polymorphic step-def generation on the descriptor — descriptor parse,
 * framework-name → step-def runtime resolution, end-to-end descriptor-driven
 * detection, and the Gherkin scenario-format invariant.
 *
 * Steps NOT defined here (already registered — reused verbatim):
 *  - Given 'the ADW codebase is checked out'        → features/step_definitions/ensureCronOnEveryEventSteps.ts (registry G18)
 *  - Then  'the ADW TypeScript type-check passes'   → features/per-issue/step_definitions/feature-504.steps.ts (registry T22)
 *
 * Novel phrases introduced here (no registered phrase covers these):
 *  - When  'the scenarios descriptor is parsed' (+ docstring)
 *  - Then  'the resolved BDD framework is {string}'
 *  - Then  'the resolved step-def directory is {string}'
 *  - When  'the step-def runtime extension is resolved for BDD framework {string}'
 *  - Then  'the resolved step-def extensions include {string}'
 *  - Given 'the scenarios descriptor is provided' (+ docstring)
 *  - Given 'a step-def file {string} exists in the target worktree'
 *  - When  'step-def presence is resolved from the parsed descriptor over the worktree'
 *  - Then  'the descriptor-driven step-def presence is {string}'
 *  - When  'the promotion scenario parser parses the Gherkin feature' (+ docstring)
 *  - Then  'the promotion parser resolves {int} Gherkin scenario(s)'
 *  - Then  'the resolved Gherkin scenario is named {string}'
 *  - Then  'the resolved Gherkin scenario carries the tag {string}'
 *
 * Every assertion targets a value the system PRODUCES at runtime over INPUT the step
 * constructs (a descriptor string, a temp step-def fixture, a Gherkin feature string).
 * No step reads, substring-matches, or AST-parses any source file of this repo.
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseScenariosMd } from '../../../adws/core/projectConfig.ts';
import type { ScenariosConfig } from '../../../adws/core/projectConfig.ts';
import { stepDefExtensionsFor, hasStepDefinitions } from '../../../adws/core/stepDefDetection.ts';
import { parse as parseGherkinScenarios } from '../../../adws/promotion/scenarioParser.ts';
import type { Scenario as PromotionScenario } from '../../../adws/promotion/types.ts';

// Shared context for this feature's scenarios.
const ctx: {
  parsedDescriptor: ScenariosConfig | null;
  resolvedExtensions: string[] | null;
  descriptorContent: string | null;
  worktreeCwd: string | null;
  descriptorPresence: string | null;
  parsedGherkin: PromotionScenario[] | null;
  tmpDirs: string[];
} = {
  parsedDescriptor: null,
  resolvedExtensions: null,
  descriptorContent: null,
  worktreeCwd: null,
  descriptorPresence: null,
  parsedGherkin: null,
  tmpDirs: [],
};

After(function () {
  ctx.parsedDescriptor = null;
  ctx.resolvedExtensions = null;
  ctx.descriptorContent = null;
  ctx.worktreeCwd = null;
  ctx.descriptorPresence = null;
  ctx.parsedGherkin = null;
  for (const dir of ctx.tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── §1 Descriptor parse ──────────────────────────────────────────────────────

When('the scenarios descriptor is parsed', function (descriptor: string) {
  ctx.parsedDescriptor = parseScenariosMd(descriptor);
});

Then('the resolved BDD framework is {string}', function (expected: string) {
  assert.ok(ctx.parsedDescriptor !== null, 'Expected the descriptor to have been parsed');
  assert.strictEqual(ctx.parsedDescriptor.bddFramework, expected);
});

Then('the resolved step-def directory is {string}', function (expected: string) {
  assert.ok(ctx.parsedDescriptor !== null, 'Expected the descriptor to have been parsed');
  assert.strictEqual(ctx.parsedDescriptor.stepDefDirectory, expected);
});

// ── §2–§3 Framework name → step-def runtime extension ─────────────────────────

When(
  'the step-def runtime extension is resolved for BDD framework {string}',
  function (framework: string) {
    ctx.resolvedExtensions = stepDefExtensionsFor(framework);
  },
);

Then('the resolved step-def extensions include {string}', function (ext: string) {
  assert.ok(ctx.resolvedExtensions !== null, 'Expected step-def extensions to have been resolved');
  assert.ok(
    ctx.resolvedExtensions.includes(ext),
    `Expected resolved extensions ${JSON.stringify(ctx.resolvedExtensions)} to include "${ext}"`,
  );
});

// ── §4 End-to-end descriptor-driven detection ─────────────────────────────────

Given('the scenarios descriptor is provided', function (descriptor: string) {
  ctx.descriptorContent = descriptor;
});

Given(
  'a step-def file {string} exists in the target worktree',
  function (relPath: string) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'descriptor-579-'));
    ctx.tmpDirs.push(tmp);
    const full = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
    ctx.worktreeCwd = tmp;
  },
);

When('step-def presence is resolved from the parsed descriptor over the worktree', function () {
  assert.ok(ctx.descriptorContent !== null, 'Expected a descriptor to have been provided');
  assert.ok(ctx.worktreeCwd !== null, 'Expected a worktree fixture to have been created');
  // The full descriptor-driven path: parse the descriptor, derive the step-def
  // runtime from the framework NAME, then detect over the CONFIGURED directory.
  const config = parseScenariosMd(ctx.descriptorContent);
  const extensions = stepDefExtensionsFor(config.bddFramework);
  const present = hasStepDefinitions(config.stepDefDirectory, extensions, ctx.worktreeCwd);
  ctx.descriptorPresence = present ? 'present' : 'absent';
});

Then('the descriptor-driven step-def presence is {string}', function (expected: string) {
  assert.ok(ctx.descriptorPresence !== null, 'Expected step-def presence to have been resolved');
  assert.strictEqual(ctx.descriptorPresence, expected);
});

// ── §5 Gherkin scenario-format invariant ──────────────────────────────────────

When('the promotion scenario parser parses the Gherkin feature', function (feature: string) {
  ctx.parsedGherkin = parseGherkinScenarios(feature);
});

Then('the promotion parser resolves {int} Gherkin scenario(s)', function (count: number) {
  assert.ok(ctx.parsedGherkin !== null, 'Expected the Gherkin feature to have been parsed');
  assert.strictEqual(ctx.parsedGherkin.length, count);
});

Then('the resolved Gherkin scenario is named {string}', function (name: string) {
  assert.ok(ctx.parsedGherkin !== null && ctx.parsedGherkin.length > 0, 'Expected at least one parsed scenario');
  assert.ok(
    ctx.parsedGherkin.some(s => s.name === name),
    `Expected a parsed scenario named "${name}"`,
  );
});

Then('the resolved Gherkin scenario carries the tag {string}', function (tag: string) {
  assert.ok(ctx.parsedGherkin !== null && ctx.parsedGherkin.length > 0, 'Expected at least one parsed scenario');
  assert.ok(
    ctx.parsedGherkin.some(s => s.tags.includes(tag)),
    `Expected a parsed scenario carrying the tag "${tag}"`,
  );
});
