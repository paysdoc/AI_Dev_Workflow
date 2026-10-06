/**
 * `COST_API_URL` (adws/core/environment.ts) is bound at import time, so posting records to a
 * scenario's cost API in-process would always use the host's setting. This script is spawned as
 * a child instead, with `COST_API_URL` and `COST_API_TOKEN` overridden in its env. It lives under
 * `features/regression/drivers/`, outside every `cucumber.js` `import` glob, so it is never
 * auto-loaded as a step definition module.
 *
 * Usage: COST_API_URL=... COST_API_TOKEN=... bunx tsx feature-936-commit-driver.ts <repo> < records.json
 * Reads a JSON array of PhaseCostRecord from stdin and commits it through `CostTracker`, the phase
 * runner's sink for a phase's cost records. `commit` does not await the post, so the process
 * exits once the request has settled.
 */

import { CostTracker } from '../../../adws/core/phaseRunner.ts';
import type { PhaseCostRecord } from '../../../adws/cost/types.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

const [repo] = process.argv.slice(2);
const records = JSON.parse(await readStdin()) as PhaseCostRecord[];
const config = { targetRepo: { owner: 'acme', repo, cloneUrl: `https://github.com/acme/${repo}.git` } } as unknown as WorkflowConfig;

await new CostTracker().commit(config, records);
