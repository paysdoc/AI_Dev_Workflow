/**
 * BDD step definitions for feature-582.feature
 * Hermeticity, resolve app-code editing & goal-fidelity guards —
 * Gherkin freeze guard and resolve verdict pure decision cores.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 *
 * Novel phrases introduced here:
 *  - Given 'a resolve attempt changed the app-code file {string}'
 *  - Given 'a resolve attempt changed the step-def file {string}'
 *  - Given 'a resolve attempt changed the Gherkin feature file {string}'
 *  - When  'the resolve freeze guard evaluates the attempt'
 *  - Then  'the resolve freeze guard permits the attempt'
 *  - Then  'the resolve freeze guard rejects the attempt'
 *  - Then  'the resolve freeze guard flags the frozen Gherkin file {string}'
 *  - Given 'the resolve re-run\'s target scenarios {string}'
 *  - Given 'the resolve re-run\'s @regression suite {string}'
 *  - Given 'the post-resolve re-validation against the issue {string}'
 *  - Given 'the resolve retry budget {string}'
 *  - When  'the resolve verdict is computed'
 *  - Then  'the resolve verdict is {string}'
 *
 * Every assertion targets a value the system PRODUCES at runtime over INPUT the step
 * constructs (path strings, canned signal booleans). No step reads, substring-matches,
 * or AST-parses any source file of this repo.
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { evaluateResolveEdit } from '../../../adws/core/resolveFreezeGuard.ts';
import type { ResolveEditVerdict } from '../../../adws/core/resolveFreezeGuard.ts';
import { computeResolveVerdict } from '../../../adws/core/resolveVerdict.ts';
import type { ResolveVerdictOutcome, ResolveVerdictSignals } from '../../../adws/core/resolveVerdict.ts';

// ── Shared context ────────────────────────────────────────────────────────────

const ctx: {
  changedPaths: string[];
  freezeVerdict: ResolveEditVerdict | null;
  verdictSignals: Partial<ResolveVerdictSignals>;
  resolveVerdictOutcome: ResolveVerdictOutcome | null;
} = {
  changedPaths: [],
  freezeVerdict: null,
  verdictSignals: {},
  resolveVerdictOutcome: null,
};

After(function () {
  ctx.changedPaths = [];
  ctx.freezeVerdict = null;
  ctx.verdictSignals = {};
  ctx.resolveVerdictOutcome = null;
});

// ── §1 Freeze guard — resolve edit boundary ───────────────────────────────────

Given('a resolve attempt changed the app-code file {string}', function (filePath: string) {
  ctx.changedPaths.push(filePath);
});

Given('a resolve attempt changed the step-def file {string}', function (filePath: string) {
  ctx.changedPaths.push(filePath);
});

Given('a resolve attempt changed the Gherkin feature file {string}', function (filePath: string) {
  ctx.changedPaths.push(filePath);
});

When('the resolve freeze guard evaluates the attempt', function () {
  ctx.freezeVerdict = evaluateResolveEdit(ctx.changedPaths);
});

Then('the resolve freeze guard permits the attempt', function () {
  assert.ok(ctx.freezeVerdict !== null, 'Expected freeze guard verdict to have been computed');
  assert.strictEqual(ctx.freezeVerdict.permitted, true, `Expected permitted:true but got ${JSON.stringify(ctx.freezeVerdict)}`);
});

Then('the resolve freeze guard rejects the attempt', function () {
  assert.ok(ctx.freezeVerdict !== null, 'Expected freeze guard verdict to have been computed');
  assert.strictEqual(ctx.freezeVerdict.permitted, false, `Expected permitted:false but got ${JSON.stringify(ctx.freezeVerdict)}`);
});

Then('the resolve freeze guard flags the frozen Gherkin file {string}', function (expectedPath: string) {
  assert.ok(ctx.freezeVerdict !== null, 'Expected freeze guard verdict to have been computed');
  assert.strictEqual(
    ctx.freezeVerdict.flaggedFeature,
    expectedPath,
    `Expected flaggedFeature:"${expectedPath}" but got ${JSON.stringify(ctx.freezeVerdict.flaggedFeature)}`,
  );
});

// ── §2–§3 Resolve verdict — cap + @regression gate + re-validation ───────────

Given('the resolve re-run\'s target scenarios {string}', function (state: string) {
  ctx.verdictSignals.targetPass = state === 'pass';
});

Given('the resolve re-run\'s @regression suite {string}', function (state: string) {
  ctx.verdictSignals.regressionPass = state === 'pass';
});

Given('the post-resolve re-validation against the issue {string}', function (state: string) {
  ctx.verdictSignals.postResolveAligned = state === 'aligned';
});

Given('the resolve retry budget {string}', function (state: string) {
  ctx.verdictSignals.budgetRemaining = state === 'remaining';
});

When('the resolve verdict is computed', function () {
  const { targetPass, regressionPass, postResolveAligned, budgetRemaining } = ctx.verdictSignals;
  assert.ok(targetPass !== undefined, 'Expected targetPass to be set');
  assert.ok(regressionPass !== undefined, 'Expected regressionPass to be set');
  assert.ok(budgetRemaining !== undefined, 'Expected budgetRemaining to be set');
  ctx.resolveVerdictOutcome = computeResolveVerdict({
    targetPass,
    regressionPass,
    postResolveAligned,
    budgetRemaining,
  });
});

Then('the resolve verdict is {string}', function (expected: string) {
  assert.ok(ctx.resolveVerdictOutcome !== null, 'Expected resolve verdict to have been computed');
  assert.strictEqual(
    ctx.resolveVerdictOutcome,
    expected,
    `Expected verdict:"${expected}" but got "${ctx.resolveVerdictOutcome}"`,
  );
});
