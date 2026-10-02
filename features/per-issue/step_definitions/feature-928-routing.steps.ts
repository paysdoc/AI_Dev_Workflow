/**
 * §1 ROUTING and §2 HAIKU TAKES NO EFFORT. The spawn rows drive the production seams —
 * the `runInitCommand` of `buildDefaultUpgradeDeps`, `mergeWithConflictResolution` and
 * `runCommandAgent` — against the recording stand-in, and read the model and effort the
 * Claude CLI received. The table rows read the real routing module.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';
import type { BoundProviders, CodeHost } from '@paysdoc/devplatform';
import type { GitContext } from '@paysdoc/devplatform/git';
import { buildDefaultUpgradeDeps } from '../../../adws/adwUpgrade.tsx';
import { runCommandAgent } from '../../../adws/agents/commandAgent.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import {
  SLASH_COMMAND_MODEL_MAP,
  SLASH_COMMAND_MODEL_MAP_FAST,
  SLASH_COMMAND_EFFORT_MAP,
  SLASH_COMMAND_EFFORT_MAP_FAST,
  getModelForCommand,
  getEffortForCommand,
} from '../../../adws/core/modelRouting.ts';
import { mergeWithConflictResolution } from '../../../adws/triggers/autoMergeHandler.ts';
import type { SlashCommand } from '../../../adws/types/issueTypes.ts';
import { BODY_CLAUSE, flagValue, issueBodyFor, makeTempDir, recordsStartedFor } from './feature-928-harness.ts';

const routingQuery: { commands: string[]; body: string } = { commands: [], body: '' };

function routedCommands(): string[] {
  const tables = [SLASH_COMMAND_MODEL_MAP, SLASH_COMMAND_MODEL_MAP_FAST, SLASH_COMMAND_EFFORT_MAP, SLASH_COMMAND_EFFORT_MAP_FAST];
  return [...new Set(tables.flatMap((table) => Object.keys(table)))];
}

function asSlashCommand(command: string): SlashCommand {
  return command as SlashCommand;
}

When(
  new RegExp(`^the routing tables are consulted for "([^"]*)" for an issue whose body ${BODY_CLAUSE}$`),
  function (command: string, clause: string) {
    routingQuery.commands = [command];
    routingQuery.body = issueBodyFor(clause);
  },
);

When(
  new RegExp(`^the routing tables are consulted for every slash command for an issue whose body ${BODY_CLAUSE}$`),
  function (clause: string) {
    routingQuery.commands = routedCommands();
    routingQuery.body = issueBodyFor(clause);
  },
);

Then('the routing tables give {string} a model', function (command: string) {
  const model = getModelForCommand(asSlashCommand(command), routingQuery.body);
  assert.ok(model !== undefined, `Expected the routing tables to give "${command}" a model for the issue body "${routingQuery.body}", but they give none`);
});

Then('no slash command the routing tables send to {string} is given an effort', function (tier: string) {
  const offenders = routingQuery.commands
    .filter((command) => getModelForCommand(asSlashCommand(command), routingQuery.body) === tier)
    .map((command) => ({ command, effort: getEffortForCommand(asSlashCommand(command), routingQuery.body) }))
    .filter(({ effort }) => effort !== undefined)
    .map(({ command, effort }) => `${command} -> ${effort}`);
  assert.deepStrictEqual(offenders, [], `Expected no command routed to "${tier}" to carry an effort for the issue body "${routingQuery.body}". Offenders:\n${offenders.join('\n')}`);
});

When(
  "the upgrade orchestrator runs {string} to regenerate a target repository's ADW configuration",
  async function (command: string) {
    assert.strictEqual(command, '/adw_init', 'The upgrade orchestrator regenerates configuration through /adw_init');
    const deps = buildDefaultUpgradeDeps({} as BoundProviders, { mainRepoPath: REPO_ROOT } as unknown as GitContext);
    await deps.runInitCommand({
      worktreePath: makeTempDir('upgrade-worktree'),
      logPath: path.join(makeTempDir('upgrade-logs'), 'adw-upgrade.jsonl'),
      issueNumber: 928,
      adwId: 'adw-928-upgrade',
      issueJson: '{}',
      frameworkRepoRoot: REPO_ROOT,
    });
  },
);

function conflictingGitContext(): GitContext {
  const conflict = (): never => {
    throw new Error('CONFLICT (content): Merge conflict in README.md');
  };
  return {
    selfHost: true,
    mainRepoPath: REPO_ROOT,
    fetchAndResetToRemote: () => undefined,
    fetchRemote: () => undefined,
    mergeBranch: conflict,
    abortMerge: () => undefined,
    pushBranch: () => undefined,
  } as unknown as GitContext;
}

When('the auto-merge handler meets a merge conflict and runs {string}', async function (command: string) {
  assert.strictEqual(command, '/resolve_conflict', 'The auto-merge handler resolves conflicts through /resolve_conflict');
  const codeHost: Pick<CodeHost, 'mergePullRequest'> = { mergePullRequest: () => ({ success: true }) };
  await mergeWithConflictResolution(
    928, codeHost, 'bugfix-issue-928', 'main',
    makeTempDir('merge-worktree'), 'adw-928-merge', makeTempDir('merge-logs'), '', conflictingGitContext(),
  );
});

When(
  new RegExp(`^a command agent runs "([^"]*)" for an issue whose body ${BODY_CLAUSE}$`),
  async function (command: string, clause: string) {
    await runCommandAgent(
      { command: asSlashCommand(command), agentName: 'feature-928-agent', outputFileName: 'agent.jsonl' },
      { args: ['928'], logsDir: makeTempDir('agent-logs'), issueBody: issueBodyFor(clause) },
    );
  },
);

function expectedRouting(command: string): { model: string | undefined; effort: string | undefined } {
  return {
    model: getModelForCommand(asSlashCommand(command)),
    effort: getEffortForCommand(asSlashCommand(command)),
  };
}

Then(
  'the Claude CLI was started for {string} with the model and the effort the default routing tables give it',
  function (command: string) {
    const { model, effort } = expectedRouting(command);
    assert.ok(model !== undefined, `The default routing tables give "${command}" no model, so no spawn can take its model from them`);
    for (const record of recordsStartedFor(command)) {
      assert.strictEqual(flagValue(record.argv, '--model'), model, `Expected --model ${model} for "${command}". argv: ${JSON.stringify(record.argv)}`);
      assert.strictEqual(flagValue(record.argv, '--effort'), effort, `Expected ${effort === undefined ? 'no --effort flag' : `--effort ${effort}`} for "${command}". argv: ${JSON.stringify(record.argv)}`);
    }
  },
);

Then('the Claude CLI was started for {string} with the model {string}', function (command: string, model: string) {
  for (const record of recordsStartedFor(command)) {
    assert.strictEqual(flagValue(record.argv, '--model'), model, `Expected --model ${model} for "${command}". argv: ${JSON.stringify(record.argv)}`);
  }
});

Then('the Claude CLI was started for {string} with no effort flag', function (command: string) {
  for (const record of recordsStartedFor(command)) {
    assert.ok(!record.argv.includes('--effort'), `Expected no --effort flag for "${command}". argv: ${JSON.stringify(record.argv)}`);
  }
});
