/**
 * `SHOW_COST_IN_COMMENTS` (adws/core/config.ts) is bound at import time, so rendering the
 * completion comment's cost section in-process would always see the host's setting rather
 * than the scenario's. This script is spawned as a child instead, with the variable
 * overridden in its env. It lives under `features/regression/drivers/`, outside every
 * `cucumber.js` `import` glob, so it is never auto-loaded as a step definition module.
 *
 * Usage: bunx tsx feature-936-cost-section-driver.ts < records.json
 * Reads a JSON array of PhaseCostRecord from stdin and writes the section
 * `formatCostCommentSection` returns for them to stdout.
 */

import { formatCostCommentSection } from '../../../adws/cost/reporting/commentFormatter.ts';
import type { PhaseCostRecord } from '../../../adws/cost/types.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

const records = JSON.parse(await readStdin()) as PhaseCostRecord[];
process.stdout.write(await formatCostCommentSection(records));
