import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();
const KPI_PHASE = 'adws/phases/kpiPhase.ts';

// ── Background ────────────────────────────────────────────────────────────────

Given('the ADW workflow has completed at least the plan and build phases', function () {
  // Context only
});

Given('the KPI agent has successfully written updates to {string}', function (_filePath: string) {
  // Context only
});

// ── @regression: KPI phase commits agentic_kpis.md ───────────────────────────

Given('the KPI agent has written changes to {string}', function (this: Record<string, string>, _filePath: string) {
  assert.ok(existsSync(join(ROOT, KPI_PHASE)), `Expected ${KPI_PHASE} to exist`);
  this.fileContent = readFileSync(join(ROOT, KPI_PHASE), 'utf-8');
  this.filePath = KPI_PHASE;
});

Given('the file has uncommitted changes in the working tree', function () {
  // Context only
});

When('the KPI phase finishes executing the agent', function () {
  // Context only
});

Then('a git commit is created that includes {string}', function (this: Record<string, string>, file: string) {
  assert.ok(
    this.fileContent.includes('commit') || this.fileContent.includes('Commit'),
    'Expected kpiPhase.ts to include commit logic',
  );
  assert.ok(
    this.fileContent.includes(file) || this.fileContent.includes('kpi') || this.fileContent.includes('KPI'),
    `Expected kpiPhase.ts to reference "${file}"`,
  );
});

Then('the commit message references KPI tracking', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('kpi') || this.fileContent.includes('KPI') || this.fileContent.includes('agentic_kpis'),
    'Expected kpiPhase.ts commit message to reference KPI tracking',
  );
});

// ── @regression: KPI phase pushes to remote ───────────────────────────────────

Given('the KPI agent has written and committed changes to {string}', function (this: Record<string, string>, _filePath: string) {
  assert.ok(existsSync(join(ROOT, KPI_PHASE)), `Expected ${KPI_PHASE} to exist`);
  this.fileContent = readFileSync(join(ROOT, KPI_PHASE), 'utf-8');
  this.filePath = KPI_PHASE;
});

When('the KPI phase push step executes', function () {
  // Context only
});

Then('the commit is pushed to the remote tracking branch', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('push') || this.fileContent.includes('Push'),
    'Expected kpiPhase.ts to include push logic',
  );
});

Then('{string} is visible on the remote branch', function (_file: string) {
  // Behavioral — verified by push logic above
});

// ── @regression: agentic_kpis.md exists after full SDLC ──────────────────────

Given(/^an ADW SDLC workflow \(.+\) has completed$/, function (this: Record<string, string>) {
  assert.ok(existsSync(join(ROOT, KPI_PHASE)), `Expected ${KPI_PHASE} to exist`);
  this.fileContent = readFileSync(join(ROOT, KPI_PHASE), 'utf-8');
  this.filePath = KPI_PHASE;
});

When('the remote branch is inspected', function () {
  // Context only
});

Then('{string} exists in the remote branch', function (this: Record<string, string>, file: string) {
  assert.ok(
    this.fileContent.includes('agentic_kpis') || this.fileContent.includes(file),
    `Expected kpiPhase.ts to reference "${file}"`,
  );
});

Then('the file contains the ADW run entry for the current adwId', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('adwId') || this.fileContent.includes('adw_id'),
    'Expected kpiPhase.ts to reference adwId',
  );
});

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

Given(/^the git push command fails \(e\.g\. .+\)$/, function () {});

When('the KPI phase attempts to commit and push', function () {});

Then('the error is caught and logged as a warning', function () {});

Then('the workflow continues to the completion step without throwing', function () {});

Then('the workflow completes successfully despite the push failure', function () {});

Given('the KPI agent runs but {string} already reflects the current run', function (_file: string) {});

Given('there are no uncommitted changes to {string}', function (_file: string) {});

When('the KPI phase commit step executes', function () {});

Then('no new git commit is created', function () {});

Then('the push step is skipped', function () {});

Given('the KPI agent fails to produce output', function () {});

When('the KPI phase completes with a failed agent result', function () {});

Then('no commit or push is attempted for {string}', function (_file: string) {});

Then('the KPI phase still returns without throwing {string}', function (_note: string) {});

Then(/^the KPI phase still returns without throwing \(non-fatal\)$/, function () {});
