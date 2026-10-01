/**
 * Cost-API scenarios of feature-936. For the first, the scenario's cost API is a local HTTP
 * server that records what is posted to it; the phase runner's `CostTracker` posts to it from a
 * child process (features/per-issue/support/feature-936-commit-driver.ts), because
 * `COST_API_URL` is bound when adws/core/environment.ts is imported. For the second, the
 * Worker's own handlers answer from an in-memory database (feature-936-costApiWorker.ts).
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { spawn } from 'child_process';
import * as http from 'http';
import type { AddressInfo } from 'net';

import { builtRecords } from './feature-936-costRecords.steps.ts';
import { createWorkerCostApi, type BreakdownEntry, type IssueCosts, type WorkerCostApi } from './feature-936-costApiWorker.ts';
import { assertUsd } from './feature-936-usd.ts';

const COMMIT_DRIVER_PATH = 'features/per-issue/support/feature-936-commit-driver.ts';
const COST_API_TOKEN = 'scenario-cost-api-token';
const PROJECT = 'acme-widgets';

interface PostedPayload {
  readonly project: string;
  readonly records: readonly Record<string, unknown>[];
}

interface RecordedPost {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly payload: PostedPayload;
}

interface CostApiRecorder {
  readonly url: string;
  readonly posts: readonly RecordedPost[];
  stop(): Promise<void>;
}

let recorder: CostApiRecorder | undefined;
let workerApi: WorkerCostApi | undefined;
let breakdown: readonly BreakdownEntry[] = [];
let issueCosts: readonly IssueCosts[] = [];

After({ tags: '@adw-936' }, async function () {
  await recorder?.stop();
  recorder = undefined;
  workerApi = undefined;
  breakdown = [];
  issueCosts = [];
});

function startCostApiRecorder(): Promise<CostApiRecorder> {
  const posts: RecordedPost[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as PostedPayload;
      posts.push({ method: req.method ?? '', path: req.url ?? '', authorization: req.headers.authorization, payload });
      res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ inserted: payload.records.length }));
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        posts,
        stop: () => new Promise<void>(done => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

function runCommitDriver(records: readonly unknown[], costApiUrl: string): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bunx', ['tsx', COMMIT_DRIVER_PATH, PROJECT], {
      cwd: process.cwd(),
      // Set explicitly: dotenv never overrides a variable that is already set.
      env: { ...process.env, NODE_OPTIONS: '', COST_API_URL: costApiUrl, COST_API_TOKEN },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stderr }));
    child.stdin.end(JSON.stringify(records));
  });
}

Given('a cost API that records the cost records posted to it', async function () {
  recorder = await startCostApiRecorder();
});

When("the phase runner posts the {string} phase's cost records to the cost API", async function (phase: string) {
  assert.ok(recorder, 'Expected a cost API to have been started first');
  const records = builtRecords(phase);
  assert.ok(records.length > 0, `Expected "${phase}" cost records to have been built first`);
  const { status, stderr } = await runCommitDriver(records, recorder.url);
  assert.strictEqual(status, 0, `Expected the commit driver to exit 0. stderr:\n${stderr}`);
});

Then(
  'the cost API received a {string} record for model {string} with reported_cost_usd {float} and computed_cost_usd {float}',
  function (phase: string, model: string, reported: number, computed: number) {
    assert.ok(recorder, 'Expected a cost API to have been started first');
    const received = recorder.posts
      .filter(post => post.method === 'POST' && post.path === '/api/cost')
      .flatMap(post => post.payload.records);
    const record = received.find(r => r['phase'] === phase && r['model'] === model);
    assert.ok(record, `Expected a "${phase}" record for ${model}. Received: ${JSON.stringify(received)}`);
    assert.strictEqual(record['reported_cost_usd'], reported, `reported_cost_usd of ${JSON.stringify(record)}`);
    assert.ok(Math.abs(Number(record['computed_cost_usd']) - computed) < 1e-9, `computed_cost_usd of ${JSON.stringify(record)}`);
  },
);

Given(
  'the cost API stores for project {string} a {string} record of issue {int} for model {string} with computed_cost_usd {float} and reported_cost_usd {float}',
  async function (project: string, phase: string, issueNumber: number, model: string, computed: number, reported: number) {
    workerApi ??= await createWorkerCostApi();
    const response = await workerApi.ingest({
      project,
      records: [{
        issue_number: issueNumber,
        phase,
        model,
        provider: 'anthropic',
        token_usage: { input: 10000, output: 2000, cache_read: 50000, cache_write: 4000 },
        computed_cost_usd: computed,
        reported_cost_usd: reported,
      }],
    });
    assert.strictEqual(response.status, 201, `Expected the cost API to accept the record, got ${response.status}: ${await response.text()}`);
  },
);

When('the cost breakdown and the per-issue costs of project {string} are requested from the cost API', async function (project: string) {
  assert.ok(workerApi, 'Expected the cost API to store a record first');
  breakdown = await workerApi.breakdownOf(project);
  issueCosts = await workerApi.issuesOf(project);
});

Then("the cost API's cost breakdown gives model {string} a cost of ${float}", function (model: string, expected: number) {
  const entry = breakdown.find(e => e.model === model);
  assert.ok(entry, `Expected the cost breakdown to list ${model}. Breakdown: ${JSON.stringify(breakdown)}`);
  assertUsd(entry.totalCost, expected, `the cost breakdown's total for ${model}`);
});

Then("the cost API's per-issue costs give the {string} phase of issue {int} a cost of ${float}", function (phase: string, issueNumber: number, expected: number) {
  const issue = issueCosts.find(i => i.issueNumber === issueNumber);
  assert.ok(issue, `Expected the per-issue costs to list issue ${issueNumber}. Costs: ${JSON.stringify(issueCosts)}`);
  const phaseCost = issue.phases.find(p => p.phase === phase);
  assert.ok(phaseCost, `Expected issue ${issueNumber} to list the "${phase}" phase. Phases: ${JSON.stringify(issue.phases)}`);
  assertUsd(phaseCost.cost, expected, `the "${phase}" phase's cost of issue ${issueNumber}`);
});
