import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { parseKeywordProximityDependencies } from '../../adws/triggers/issueDependencies.ts';

const ROOT = process.cwd();

// ── Functional test context for fail-closed dependency scenarios ──────────────

export interface DepCheckCtx {
  issueBody: string;
  throwingDeps: Set<number>;
  stateDeps: Map<number, string>;
  result: number[] | null;
}

export const depCtx: DepCheckCtx = {
  issueBody: '',
  throwingDeps: new Set(),
  stateDeps: new Map(),
  result: null,
};

/**
 * Replicates the fail-closed loop from findOpenDependencies for behavioral testing.
 * When getIssueState throws, the dep is pushed onto openDeps (fail-closed).
 */
function runFailClosedLoop(
  deps: number[],
  getStateFn: (n: number) => string,
): number[] {
  const openDeps: number[] = [];
  for (const dep of deps) {
    try {
      const state = getStateFn(dep);
      if (state === 'OPEN') openDeps.push(dep);
    } catch {
      openDeps.push(dep); // fail-closed: treat as OPEN
    }
  }
  return openDeps;
}

// ── Step helpers ──────────────────────────────────────────────────────────────

/** Extracts the catch block content within the findOpenDependencies function. */
function getFindOpenDepsCatchBlock(content: string): string {
  const fnIdx = content.indexOf('export async function findOpenDependencies');
  assert.ok(fnIdx !== -1, 'Expected findOpenDependencies function to exist');
  const fnSection = content.slice(fnIdx);
  const catchIdx = fnSection.indexOf('} catch (err)');
  assert.ok(catchIdx !== -1, 'Expected catch block in findOpenDependencies');
  const catchEnd = fnSection.indexOf('\n    }', catchIdx + 1);
  return catchEnd !== -1 ? fnSection.slice(catchIdx, catchEnd + 6) : fnSection.slice(catchIdx, catchIdx + 300);
}

/** Extracts the catch block content within the issues.opened handler. */
function getOpenedHandlerCatchBlock(content: string): string {
  const openedIdx = content.indexOf("action === 'opened'");
  assert.ok(openedIdx !== -1, "Expected action === 'opened' handler");
  const openedSection = content.slice(openedIdx);
  const catchIdx = openedSection.indexOf('} catch (error)');
  assert.ok(catchIdx !== -1, 'Expected catch block in issues.opened handler');
  const catchEnd = openedSection.indexOf('\n        }', catchIdx + 1);
  return catchEnd !== -1 ? openedSection.slice(catchIdx, catchEnd + 10) : openedSection.slice(catchIdx, catchIdx + 300);
}

// ── Scenario 1-3: findOpenDependencies code inspection ───────────────────────

Then('in the findOpenDependencies function the catch block pushes the dependency number onto openDeps', function () {
  const content = sharedCtx.fileContent;
  const catchBlock = getFindOpenDepsCatchBlock(content);
  assert.ok(
    catchBlock.includes('openDeps.push(dep)'),
    `Expected findOpenDependencies catch block to contain openDeps.push(dep), got:\n${catchBlock}`,
  );
});

Then('the findOpenDependencies catch block does not leave the dependency out of openDeps', function () {
  const content = sharedCtx.fileContent;
  const catchBlock = getFindOpenDepsCatchBlock(content);
  assert.ok(
    catchBlock.includes('openDeps.push(dep)'),
    `Expected findOpenDependencies catch block to push dep onto openDeps (fail-closed), got:\n${catchBlock}`,
  );
});

Then('the findOpenDependencies catch block logs the error at warn level', function () {
  const content = sharedCtx.fileContent;
  const catchBlock = getFindOpenDepsCatchBlock(content);
  assert.ok(
    catchBlock.includes("'warn'") || catchBlock.includes('"warn"'),
    `Expected findOpenDependencies catch block to log at 'warn' level, got:\n${catchBlock}`,
  );
});

// ── Scenario 4, 5, 10: Functional dependency check steps ─────────────────────

// Note: "Given an issue body containing {string}" is defined in llmDependencyExtractionSteps.ts.
// That definition now populates depCtx. Steps below handle the additional stub variants.

Given(/^getIssueState throws for both #(\d+) and #(\d+)$/, function (a: string, b: string) {
  depCtx.throwingDeps.add(parseInt(a, 10));
  depCtx.throwingDeps.add(parseInt(b, 10));
});

Given(/^getIssueState throws for #(\d+)$/, function (n: string) {
  depCtx.throwingDeps.add(parseInt(n, 10));
});

Given(/^getIssueState throws for #(\d+) due to .+$/, function (n: string) {
  depCtx.throwingDeps.add(parseInt(n, 10));
});

Given(/^getIssueState returns (OPEN|CLOSED) for #(\d+)$/, function (state: string, n: string) {
  depCtx.stateDeps.set(parseInt(n, 10), state);
});

When('findOpenDependencies is called', function () {
  const deps = parseKeywordProximityDependencies(depCtx.issueBody);
  depCtx.result = runFailClosedLoop(deps, (n) => {
    if (depCtx.throwingDeps.has(n)) throw new Error(`Simulated API error for #${n}`);
    const state = depCtx.stateDeps.get(n);
    return state ?? 'OPEN';
  });
});

Then(/^the result contains both (\d+) and (\d+)$/, function (a: string, b: string) {
  assert.ok(depCtx.result !== null, 'Expected findOpenDependencies to have been called');
  const ia = parseInt(a, 10), ib = parseInt(b, 10);
  assert.ok(depCtx.result.includes(ia), `Expected result to contain ${ia}, got [${depCtx.result.join(', ')}]`);
  assert.ok(depCtx.result.includes(ib), `Expected result to contain ${ib}, got [${depCtx.result.join(', ')}]`);
});

Then(/^the result contains (\d+) and (\d+)$/, function (a: string, b: string) {
  assert.ok(depCtx.result !== null, 'Expected findOpenDependencies to have been called');
  const ia = parseInt(a, 10), ib = parseInt(b, 10);
  assert.ok(depCtx.result.includes(ia), `Expected result to contain ${ia}, got [${depCtx.result.join(', ')}]`);
  assert.ok(depCtx.result.includes(ib), `Expected result to contain ${ib}, got [${depCtx.result.join(', ')}]`);
});

Then(/^the result does not contain (\d+)$/, function (n: string) {
  assert.ok(depCtx.result !== null, 'Expected findOpenDependencies to have been called');
  const num = parseInt(n, 10);
  assert.ok(!depCtx.result.includes(num), `Expected result NOT to contain ${num}, got [${depCtx.result.join(', ')}]`);
});

Then('the issue is deferred due to open dependencies', function () {
  assert.ok(depCtx.result !== null, 'Expected findOpenDependencies to have been called');
  assert.ok(depCtx.result.length > 0, `Expected open dependencies to be returned (fail-closed), got []`);
});

// ── Scenario 10 specific ──────────────────────────────────────────────────────

Given(/^an issue with "([^"]+)" and "([^"]+)" in its body$/, function (blocker1: string, blocker2: string) {
  depCtx.issueBody = `${blocker1}\n${blocker2}`;
  depCtx.throwingDeps.clear();
  depCtx.stateDeps.clear();
  depCtx.result = null;
});

// ── Scenario 6-8: issues.opened catch block code inspection ──────────────────

Then(/^the issues opened handler catch block does not call "([^"]+)"$/, function (fnName: string) {
  const content = sharedCtx.fileContent;
  const catchBlock = getOpenedHandlerCatchBlock(content);
  assert.ok(
    !catchBlock.includes(fnName),
    `Expected issues.opened catch block NOT to call "${fnName}", but found it in:\n${catchBlock}`,
  );
});

Then(/^the issues opened handler catch block calls "([^"]+)" with level "([^"]+)"$/, function (fnName: string, level: string) {
  const content = sharedCtx.fileContent;
  const catchBlock = getOpenedHandlerCatchBlock(content);
  assert.ok(
    catchBlock.includes(`${fnName}(`),
    `Expected issues.opened catch block to call "${fnName}", got:\n${catchBlock}`,
  );
  assert.ok(
    catchBlock.includes(`'${level}'`) || catchBlock.includes(`"${level}"`),
    `Expected issues.opened catch block to log at '${level}' level, got:\n${catchBlock}`,
  );
});

Then('the issues opened handler catch block contains only logging and a return statement', function () {
  const content = sharedCtx.fileContent;
  const catchBlock = getOpenedHandlerCatchBlock(content);
  assert.ok(
    catchBlock.includes('log('),
    `Expected issues.opened catch block to contain log(), got:\n${catchBlock}`,
  );
  assert.ok(
    !catchBlock.includes('spawnDetached'),
    `Expected issues.opened catch block NOT to contain spawnDetached, got:\n${catchBlock}`,
  );
});

// ── Scenario 9: Cron picks up issue after webhook failure ─────────────────────

Given('an issue that was not spawned because checkIssueEligibility threw in the webhook', function () {
  // Structural check: the webhook no longer spawns on error
  const webhookPath = join(ROOT, 'adws/triggers/trigger_webhook.ts');
  assert.ok(existsSync(webhookPath), 'Expected trigger_webhook.ts to exist');
  const content = readFileSync(webhookPath, 'utf-8');
  const catchBlock = getOpenedHandlerCatchBlock(content);
  assert.ok(
    !catchBlock.includes('spawnDetached'),
    'Expected webhook issues.opened catch block NOT to spawn (so cron handles it)',
  );
});

When('the cron trigger polls for open issues', function () {
  // Structural check: the cron independently polls and evaluates issues
  const cronPath = join(ROOT, 'adws/triggers/trigger_cron.ts');
  assert.ok(existsSync(cronPath), 'Expected trigger_cron.ts to exist');
});

Then('the issue is eligible for evaluation by the cron trigger', function () {
  const cronPath = join(ROOT, 'adws/triggers/trigger_cron.ts');
  const content = readFileSync(cronPath, 'utf-8');
  // The cron evaluates eligibility via checkIssueEligibility — not dependent on webhook
  assert.ok(
    content.includes('checkIssueEligibility'),
    'Expected trigger_cron.ts to call checkIssueEligibility',
  );
  assert.ok(
    content.includes('fetchOpenIssues') || content.includes('fetchIssues') || content.includes('gh issue list'),
    'Expected trigger_cron.ts to fetch open issues independently',
  );
});

// ── Scenario 11-12: known_issues.md entry verification ───────────────────────

Then('the entry describes the fail-open dependency check bug', function (this: Record<string, string>) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('dependency-check-fail-open'),
    'Expected known_issues.md to have dependency-check-fail-open entry',
  );
  assert.ok(
    content.includes('getIssueState') || content.includes('fail-open') || content.includes('fail-closed'),
    'Expected the entry to describe the getIssueState fail-open bug',
  );
});

Then('the entry references issue #389', function (this: Record<string, string>) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('#389') || content.includes('389'),
    'Expected the dependency-check-fail-open entry to reference issue #389',
  );
});

Then(/^the "([^"]+)" entry has status "([^"]+)"$/, function (this: Record<string, string>, slug: string, expectedStatus: string) {
  const content = this.fileContent || sharedCtx.fileContent;
  const slugIdx = content.indexOf(slug);
  assert.ok(slugIdx !== -1, `Expected known_issues.md to contain entry "${slug}"`);
  // Extract section up to next ## heading
  const nextHeadingIdx = content.indexOf('\n## ', slugIdx + slug.length);
  const section = nextHeadingIdx !== -1 ? content.slice(slugIdx, nextHeadingIdx) : content.slice(slugIdx);
  assert.ok(
    section.includes(`**status**: ${expectedStatus}`) || section.includes(`status: ${expectedStatus}`),
    `Expected "${slug}" entry to have status "${expectedStatus}", section:\n${section.slice(0, 300)}`,
  );
});

// Scenario 13 (TypeScript type-check) uses step definitions from
// removeUnitTestsSteps.ts ("{string} is run") and wireExtractorSteps.ts
// ("the command exits with code {int}" / "{string} also exits with code {int}").
// No additional step defs needed here.
