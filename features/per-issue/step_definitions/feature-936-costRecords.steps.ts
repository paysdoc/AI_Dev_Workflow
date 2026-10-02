/**
 * Cost-record scenarios of feature-936: a fake Claude CLI child feeds the real
 * `handleAgentProcess`, the phase's records are built from its result(s) the way the phases
 * build them, and the divergence check and the completion comment's cost section are read
 * off those records. The section is rendered by a child process, because
 * `SHOW_COST_IN_COMMENTS` is bound when adws/core/config.ts is imported (see
 * features/per-issue/support/feature-936-cost-section-driver.ts).
 */

import { Given, When, Then, Before, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { spawnSync } from 'child_process';

import { checkDivergence, type PhaseCostRecord } from '../../../adws/cost/index.ts';
import {
  buildPhaseCostRecords,
  type AgentRunSpec,
  type AssistantTurn,
  type ReportedModelUsage,
} from './feature-936-costRun.ts';
import { assertUsd } from './feature-936-usd.ts';

const DRIVER_PATH = 'features/per-issue/support/feature-936-cost-section-driver.ts';
const ESTIMATE_VS_ACTUAL_HEADING = '**Estimate vs Actual Tokens**';

interface CostRecordsState {
  readonly costCommentsEnabled: boolean;
  readonly runs: readonly AgentRunSpec[];
  readonly records: readonly PhaseCostRecord[];
  readonly section: string | undefined;
}

const INITIAL_STATE: CostRecordsState = { costCommentsEnabled: false, runs: [], records: [], section: undefined };

let state: CostRecordsState = INITIAL_STATE;

Before({ tags: '@adw-936' }, function () {
  state = INITIAL_STATE;
});

function reportedModels(table: DataTable): ReportedModelUsage[] {
  return table.hashes().map(row => ({
    model: row['model'],
    input: Number(row['input']),
    output: Number(row['output']),
    cacheRead: Number(row['cache_read']),
    cacheWrite: Number(row['cache_write']),
    costUSD: Number(row['costUSD']),
  }));
}

function assistantTurns(table: DataTable): AssistantTurn[] {
  return table.hashes().map(row => ({
    messageId: row['message id'],
    input: Number(row['input']),
    cacheWrite: Number(row['cache_write']),
    cacheRead: Number(row['cache_read']),
    textCharacters: Number(row['text characters']),
  }));
}

function tokenCounts(table: DataTable): Record<string, number> {
  const [row] = table.hashes();
  return Object.fromEntries(Object.entries(row).map(([tokenType, count]) => [tokenType, Number(count)]));
}

function addRun(run: AgentRunSpec): void {
  state = { ...state, runs: [...state.runs, run] };
}

function lastRun(): AgentRunSpec {
  const run = state.runs[state.runs.length - 1];
  assert.ok(run, 'Expected an agent run to have been described first');
  return run;
}

function replaceLastRun(run: AgentRunSpec): void {
  state = { ...state, runs: [...state.runs.slice(0, -1), run] };
}

export function builtRecords(phase: string): readonly PhaseCostRecord[] {
  return state.records.filter(r => r.phase === phase);
}

function recordFor(phase: string, model: string): PhaseCostRecord {
  const record = state.records.find(r => r.phase === phase && r.model === model);
  assert.ok(record, `Expected a "${phase}" cost record for model "${model}". Records: ${JSON.stringify(state.records.map(r => [r.phase, r.model]))}`);
  return record;
}

function isDivergent(record: PhaseCostRecord): boolean {
  return checkDivergence(record.computedCostUsd, record.reportedCostUsd).isDivergent;
}

function costSection(): string {
  if (state.section !== undefined) return state.section;
  const result = spawnSync('bunx', ['tsx', DRIVER_PATH], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    input: JSON.stringify(state.records),
    // Set even when disabled: dotenv never overrides a variable that is already set.
    env: { ...process.env, NODE_OPTIONS: '', COST_REPORT_CURRENCIES: 'USD', SHOW_COST_IN_COMMENTS: state.costCommentsEnabled ? 'true' : '' },
  });
  assert.strictEqual(result.status, 0, `Expected the cost-section driver to exit 0. stderr:\n${result.stderr}`);
  state = { ...state, section: result.stdout };
  return result.stdout;
}

function estimateVsActualRows(section: string): string[] {
  const [, table = ''] = section.split(ESTIMATE_VS_ACTUAL_HEADING);
  return table.split('\n').filter(line => line.startsWith('| '));
}

Given('cost comments are enabled', function () {
  state = { ...state, costCommentsEnabled: true };
});

Given('an agent run of the {string} phase whose Claude CLI result message reports:', function (phase: string, table: DataTable) {
  addRun({ phase, turns: [], result: { models: reportedModels(table) } });
});

Given('a first/second agent run of the {string} phase whose Claude CLI result message reports:', function (phase: string, table: DataTable) {
  addRun({ phase, turns: [], result: { models: reportedModels(table) } });
});

Given('that result message reports a total cost of ${float}', function (totalCostUsd: number) {
  const run = lastRun();
  assert.ok(run.result, 'Expected the agent run to end with a result message');
  replaceLastRun({ ...run, result: { ...run.result, totalCostUsd } });
});

Given('an agent run of the {string} phase that streams these assistant turns for model {string}:', function (phase: string, model: string, table: DataTable) {
  addRun({ phase, turnModel: model, turns: assistantTurns(table) });
});

Given(
  'an agent run of the {string} phase that streams these assistant turns for model {string} and is stopped before the Claude CLI writes its result message:',
  function (phase: string, model: string, table: DataTable) {
    addRun({ phase, turnModel: model, turns: assistantTurns(table) });
  },
);

Given('the agent run ends with a Claude CLI result message that reports:', function (table: DataTable) {
  replaceLastRun({ ...lastRun(), result: { models: reportedModels(table) } });
});

When('the {string} phase builds its cost records from its agent run(s)', async function (phase: string) {
  state = { ...state, records: await buildPhaseCostRecords(phase, state.runs) };
});

Then('the {string} cost record for model {string} holds a reported cost of ${float}', function (phase: string, model: string, expected: number) {
  assertUsd(recordFor(phase, model).reportedCostUsd, expected, `the reported cost of the "${phase}" record for ${model}`);
});

Then('the {string} cost record for model {string} holds a computed cost of ${float}', function (phase: string, model: string, expected: number) {
  assertUsd(recordFor(phase, model).computedCostUsd, expected, `the computed cost of the "${phase}" record for ${model}`);
});

Then('the {string} cost record for model {string} holds no reported cost', function (phase: string, model: string) {
  assert.strictEqual(recordFor(phase, model).reportedCostUsd, undefined);
});

Then('the {string} cost record for model {string} carries estimated tokens:', function (phase: string, model: string, table: DataTable) {
  assert.deepStrictEqual(recordFor(phase, model).estimatedTokens, tokenCounts(table));
});

Then('the {string} cost record for model {string} carries actual tokens:', function (phase: string, model: string, table: DataTable) {
  assert.deepStrictEqual(recordFor(phase, model).actualTokens, tokenCounts(table));
});

Then('the {string} cost record for model {string} carries no actual tokens', function (phase: string, model: string) {
  assert.strictEqual(recordFor(phase, model).actualTokens, undefined);
});

Then('the divergence check fires for the {string} cost record for model {string}', function (phase: string, model: string) {
  const record = recordFor(phase, model);
  assert.ok(isDivergent(record), `Expected the divergence check to fire (computed ${record.computedCostUsd}, reported ${record.reportedCostUsd})`);
});

Then('the divergence check does not fire for the {string} cost record for model {string}', function (phase: string, model: string) {
  const record = recordFor(phase, model);
  assert.ok(!isDivergent(record), `Expected the divergence check to stay silent (computed ${record.computedCostUsd}, reported ${record.reportedCostUsd})`);
});

Then('the divergence check fires for no {string} cost record', function (phase: string) {
  const phaseRecords = state.records.filter(r => r.phase === phase);
  assert.ok(phaseRecords.length > 0, `Expected "${phase}" cost records to exist`);
  assert.deepStrictEqual(phaseRecords.filter(isDivergent).map(r => r.model), []);
});

Then(
  "the completion comment's cost section warns that {string} on {string} computed ${float} against a reported ${float}, a {float}% difference",
  function (phase: string, model: string, computed: number, reported: number, percentDiff: number) {
    const section = costSection();
    const item = `**${phase}** (${model}): computed $${computed.toFixed(4)} vs reported $${reported.toFixed(4)} (${percentDiff.toFixed(1)}% diff)`;
    assert.ok(section.includes('Cost Divergence Detected'), `Expected a divergence warning. Section:\n${section}`);
    assert.ok(section.includes(item), `Expected the warning to carry "${item}". Section:\n${section}`);
  },
);

Then("the completion comment's cost section carries no cost divergence warning", function () {
  const section = costSection();
  assert.ok(section.includes('Cost Breakdown'), `Expected the cost section to be rendered at all. Section:\n${section}`);
  assert.ok(!section.includes('Cost Divergence Detected'), `Expected no divergence warning. Section:\n${section}`);
});

Then(
  "the completion comment's cost section reports estimated against actual tokens for {string} on {string}:",
  function (phase: string, model: string, table: DataTable) {
    const rows = estimateVsActualRows(costSection());
    for (const row of table.hashes()) {
      const expected = `| ${phase} | ${model} | ${row['token type']} | ${row['estimated']} | ${row['actual']} | ${row['delta']} | ${row['delta %']} |`;
      assert.ok(rows.includes(expected), `Expected the estimate-vs-actual table to hold "${expected}". Rows:\n${rows.join('\n')}`);
    }
  },
);

Then(
  "the completion comment's cost section reports no estimated against actual tokens for {string} on {string}",
  function (phase: string, model: string) {
    const section = costSection();
    assert.ok(section.includes('Cost Breakdown'), `Expected the cost section to be rendered at all. Section:\n${section}`);
    const rows = estimateVsActualRows(section).filter(row => row.startsWith(`| ${phase} | ${model} | `));
    assert.deepStrictEqual(rows, []);
  },
);
