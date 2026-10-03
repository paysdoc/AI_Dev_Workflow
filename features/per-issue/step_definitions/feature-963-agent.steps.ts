/**
 * Step definitions for the two scenarios of feature-963.feature that run the stub's code
 * in-process: an agent run against the stub, as the production agent runner makes it, and the
 * manifest interpreter applied to every committed manifest.
 */

import { Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { readdirSync } from 'fs';
import { basename, join } from 'path';

import { runClaudeAgentWithCommand } from '../../../adws/agents/claudeAgent.ts';
import { getEffortForCommand, getModelForCommand } from '../../../adws/core/config.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { AuthRequiredError, RateLimitError } from '../../../adws/types/agentTypes.ts';
import { applyManifest, ManifestRefusalError } from '../../../test/mocks/manifestInterpreter.ts';
import { pointClaudeCodeAtStub } from '../../regression/support/claudeCliStub.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { requireStubWorktree, stateOf, type AgentRunOutcome, type ManifestRefusal } from './feature-963-state.ts';
import { asSlashCommand, makeThrowawayRepository } from './feature-963-stubWorktree.ts';

function requireAgentRun(world: RegressionWorld): AgentRunOutcome {
  const { agentRun } = stateOf(world);
  assert.ok(agentRun, 'Expected an agent to have been run against the Claude CLI stub first');
  return agentRun;
}

/** No launch context, so nothing is injected; the agent runner drops every MOCK_* name, so only the marker manifest programs the stub. */
When('an agent runs {string} in that worktree against the Claude CLI stub', async function (this: RegressionWorld, command: string) {
  const worktree = requireStubWorktree(this);
  const slashCommand = asSlashCommand(command);
  pointClaudeCodeAtStub(this);

  try {
    const result = await runClaudeAgentWithCommand(
      command, '7', 'Feature963Agent', join(worktree.payloadDir, 'agent-output.jsonl'),
      getModelForCommand(slashCommand), getEffortForCommand(slashCommand), undefined, undefined, worktree.path,
    );
    stateOf(this).agentRun = { result };
  } catch (error) {
    stateOf(this).agentRun = { error };
  }
});

Then('the agent run reports failure', function (this: RegressionWorld) {
  const { result, error } = requireAgentRun(this);
  assert.ok(!error, `Expected the agent run to report a failure, but it threw: ${String(error)}`);
  assert.strictEqual(result?.success, false, `Expected the agent run to report a failure, but it reports: ${JSON.stringify(result)}`);
});

Then('the agent run reports neither a rate limit nor an expired login', function (this: RegressionWorld) {
  const { result, error } = requireAgentRun(this);
  assert.ok(
    !(error instanceof RateLimitError) && !(error instanceof AuthRequiredError),
    `Expected neither a rate limit nor an expired login, but the agent run threw ${String(error)}`,
  );
  assert.ok(result, `Expected the agent run to return a result, but it threw: ${String(error)}`);
  assert.ok(!result.rateLimited, 'Expected the agent run not to report a rate limit');
  assert.ok(!result.authExpired, 'Expected the agent run not to report an expired login');
});

/** Any other failure, such as a `stage` path the throwaway worktree lacks, is not a refusal. */
function refusalOf(world: RegressionWorld, manifestPath: string): ManifestRefusal[] {
  const { path: worktree } = makeThrowawayRepository(world);
  try {
    applyManifest(manifestPath, worktree, "/feature '7'");
  } catch (error) {
    if (error instanceof ManifestRefusalError) return [{ manifest: basename(manifestPath), error }];
  }
  return [];
}

When(
  "the stub's manifest interpreter applies every manifest committed under {string}, each in a throwaway git worktree",
  function (this: RegressionWorld, directory: string) {
    const names = readdirSync(join(REPO_ROOT, directory)).filter((name) => name.endsWith('.json')).sort();
    assert.ok(names.length > 0, `Expected manifests committed under ${directory}`);

    stateOf(this).manifestRefusals = names.flatMap((name) => refusalOf(this, join(REPO_ROOT, directory, name)));
  },
);

Then('the refusal guard refused none of them', function (this: RegressionWorld) {
  const { manifestRefusals } = stateOf(this);
  assert.ok(manifestRefusals, 'Expected the manifest interpreter to have been applied to the committed manifests first');
  assert.deepStrictEqual(
    manifestRefusals.map(({ manifest, error }) => `${manifest}: ${error.message}`),
    [],
    'Expected the refusal guard to refuse none of the committed manifests',
  );
});
