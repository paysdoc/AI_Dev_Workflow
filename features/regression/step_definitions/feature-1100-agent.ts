/**
 * The `/resolve_conflict` agent of the feature-1100 scenarios is the repository's Claude CLI stub, which ADW starts exactly as it
 * starts the real agent: through `runClaudeAgentWithCommand`, in the workflow's worktree, with the merge from the base branch
 * already begun and its conflict markers in place. The manifest that programs the stub is a marker above every worktree.
 * When it resolves, the stub writes the resolved file and commits everything, which concludes the merge; when it fails, it
 * answers with an error and touches nothing.
 *
 * Each run of the agent leaves one `resolve-conflict-<ms>.jsonl` in the workflow's logs directory, which is how runs are counted.
 */

import assert from 'assert';
import { existsSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { LOGS_DIR } from '../../../adws/core/config.ts';
import { STUB_MANIFEST_MARKER } from '../../../test/mocks/stubMarker.ts';
import { pointClaudeCodeAtStub } from '../../regression/support/claudeCliStub.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { RESOLVED_SHARED_CONTENTS } from './feature-1100-repo.ts';

export type AgentBehaviour = 'resolves' | 'fails';

const CONFLICT_AGENT = '/resolve_conflict';

/** A merge starts no other agent, so a step that names another one is a mistake in the scenario. */
export function assertIsTheConflictAgent(agent: string): void {
  assert.strictEqual(agent, CONFLICT_AGENT, `Only the "${CONFLICT_AGENT}" agent is ever started by a merge, but the step names "${agent}"`);
}

/** The subject of the merge commit the stub makes, which is how a branch on `origin` is seen to hold the agent's commit. */
export const AGENT_COMMIT_SUBJECT = 'Resolve the conflicts with the base branch (stand-in agent)';

const PAYLOAD = resolve(REPO_ROOT, 'test/fixtures/jsonl/payloads/build-agent.json');
const RUN_OUTPUT = /^resolve-conflict-\d+\.jsonl$/;

function manifestFor(behaviour: AgentBehaviour): Record<string, unknown> {
  if (behaviour === 'fails') return { jsonlPath: PAYLOAD, edits: [], response: { kind: 'error' } };
  return {
    jsonlPath: PAYLOAD,
    edits: [{ path: 'src/shared.ts', contents: RESOLVED_SHARED_CONTENTS }],
    commitAll: { subject: AGENT_COMMIT_SUBJECT },
  };
}

/** `targetReposDir` is above every worktree ADW adds to the workspace, so the stub finds the marker from any of them. */
export function installConflictAgent(world: RegressionWorld, targetReposDir: string, behaviour: AgentBehaviour): void {
  pointClaudeCodeAtStub(world);
  writeFileSync(join(targetReposDir, STUB_MANIFEST_MARKER), JSON.stringify(manifestFor(behaviour)), 'utf-8');
}

export function conflictAgentRuns(adwId: string): number {
  const logsDir = join(LOGS_DIR, adwId);
  return existsSync(logsDir) ? readdirSync(logsDir).filter((name) => RUN_OUTPUT.test(name)).length : 0;
}
