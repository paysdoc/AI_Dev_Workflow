#!/usr/bin/env bun
/**
 * Stands in for the `gh` CLI behind a `/bin/sh` wrapper named `gh`, built like the git wrapper in
 * test-harness.ts. Reads are answered from the forge state file; each write is applied to that file,
 * so a later read in the same run sees it, and appended to the log as the REST request it stands
 * for. The Cucumber process replays the log against the mock GitHub API after the child has exited:
 * a call that waited on that in-process server while the process holding it blocked on this one
 * would deadlock. The shadow reads no token, no host and no network.
 *
 * Environment variables:
 *   ADW_GH_STATE     — path of the forge state JSON (see ghShadowState.ts)
 *   ADW_GH_LOG       — path of the NDJSON log of writes, GraphQL calls and refused calls
 *   ADW_GH_LAND_PATH — optional: the repository a merged pull request is landed in (see ghShadowLanding.ts)
 */

import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { runGhCommand } from './ghShadowCommands.ts';
import { gitIn, landMergedPullRequest } from './ghShadowLanding.ts';
import type { ForgeState } from './ghShadowState.ts';

function main(): void {
  const statePath = process.env['ADW_GH_STATE'];
  const logPath = process.env['ADW_GH_LOG'];
  if (!statePath || !logPath) {
    process.stderr.write('gh shadow: ADW_GH_STATE and ADW_GH_LOG must be set\n');
    process.exitCode = 1;
    return;
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8')) as ForgeState;
  const ran = runGhCommand(process.argv.slice(2), () => readFileSync(0, 'utf-8'), state);
  const landPath = process.env['ADW_GH_LAND_PATH'];
  const outcome = landPath ? landMergedPullRequest(ran, gitIn(landPath)) : ran;

  if (outcome.state) {
    // Renamed into place, so a reader never sees a half-written state.
    writeFileSync(`${statePath}.tmp`, JSON.stringify(outcome.state), 'utf-8');
    renameSync(`${statePath}.tmp`, statePath);
  }
  // One appendFileSync per line, so a process group killed mid-run can cut at most the last line.
  if (outcome.log) appendFileSync(logPath, `${JSON.stringify(outcome.log)}\n`, 'utf-8');

  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  process.exitCode = outcome.exitCode;
}

main();
