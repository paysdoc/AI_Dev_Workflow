/**
 * §3 THE RETRY IS A SLASH COMMAND. The real `runCommandAgent` runs against the recording
 * stand-in, which answers its first run with output that fails validation and every later
 * run with valid output. The retry is the second record the stand-in wrote.
 */

import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import type { GitContext } from '@paysdoc/devplatform/git';
import { runCommandAgent, type CommandAgentResult, type ExtractionResult } from '../../../adws/agents/commandAgent.ts';
import { getModelForCommand, getEffortForCommand } from '../../../adws/core/modelRouting.ts';
import { copyClaudeAssetsToWorktree } from '../../../adws/phases/worktreeSetup.ts';
import type { SlashCommand } from '../../../adws/types/issueTypes.ts';
import {
  BODY_CLAUSE, INVALID_TEXT, OUTPUT_SCHEMA, VALID_TEXT, VALIDATION_ERROR,
  flagValue, issueBodyFor, makeTempDir, readRecords, type StandInRecord,
} from './feature-928-harness.ts';

const SLASH_COMMAND_WITH_QUOTED_ARGUMENTS = /^\/[\w-]+(?: '(?:[^']|'\\'')*')*$/;

const CORRECTIVE_INSTRUCTIONS: readonly string[] = [
  'You were invoked with',
  'You returned the following output',
  'failed validation against the expected JSON schema',
  'Return ONLY valid JSON',
];

const retry: { worktree: string | null; result: CommandAgentResult<number[]> | null } = { worktree: null, result: null };

Before({ tags: '@adw-928' }, function () {
  retry.worktree = null;
  retry.result = null;
});

function validateIntegerArray(output: string): ExtractionResult<number[]> {
  const trimmed = output.trim();
  if (trimmed !== VALID_TEXT) return { success: false, error: VALIDATION_ERROR };
  return { success: true, data: JSON.parse(trimmed) as number[] };
}

async function runValidatedAgent(command: string, issueBody: string, cwd: string | undefined): Promise<void> {
  retry.result = await runCommandAgent<number[]>(
    {
      command: command as SlashCommand,
      agentName: 'feature-928-agent',
      outputFileName: 'agent.jsonl',
      extractOutput: validateIntegerArray,
      outputSchema: OUTPUT_SCHEMA,
    },
    { args: ['928'], logsDir: makeTempDir('agent-logs'), issueBody, cwd },
  );
}

When(
  new RegExp(`^a command agent with output validation runs "([^"]*)" for an issue whose body ${BODY_CLAUSE}$`),
  async function (command: string, clause: string) {
    await runValidatedAgent(command, issueBodyFor(clause), undefined);
  },
);

When(
  new RegExp(`^a command agent with output validation runs "([^"]*)" in that worktree for an issue whose body ${BODY_CLAUSE}$`),
  async function (command: string, clause: string) {
    assert.ok(retry.worktree, 'Expected a prepared target repository worktree first');
    await runValidatedAgent(command, issueBodyFor(clause), retry.worktree);
  },
);

function retryRecord(): StandInRecord {
  const records = readRecords();
  assert.ok(records.length >= 2, `Expected the Claude CLI to be started a second time for the retry, but it was started ${records.length} time(s)`);
  return records[1];
}

function promptOf(record: StandInRecord): string {
  return record.argv[record.argv.length - 1] ?? '';
}

function retrySlashCommand(): SlashCommand {
  const record = retryRecord();
  assert.ok(record.slashCommand !== null, `Expected the retry's prompt to start with a slash command. Prompt:\n${promptOf(record)}`);
  return record.slashCommand as SlashCommand;
}

function jsonHolds(document: unknown, target: unknown): boolean {
  if (isDeepStrictEqual(document, target)) return true;
  if (document === null || typeof document !== 'object') return false;
  return Object.values(document).some((child) => jsonHolds(child, target));
}

function textHoldsJson(text: string, target: unknown): boolean {
  try {
    return jsonHolds(JSON.parse(text), target);
  } catch {
    return false;
  }
}

Then('the Claude CLI was started {int} times', function (count: number) {
  assert.strictEqual(readRecords().length, count);
});

Then('the retry started the Claude CLI with a slash command followed only by its arguments', function () {
  const prompt = promptOf(retryRecord());
  assert.match(prompt, SLASH_COMMAND_WITH_QUOTED_ARGUMENTS, `Expected the retry's prompt to be a slash command followed only by quoted arguments. Prompt:\n${prompt}`);
});

Then("the retry's prompt carries none of the corrective instructions the retry used to write in code", function () {
  const record = retryRecord();
  const found = CORRECTIVE_INSTRUCTIONS.filter((phrase) => record.argv.some((entry) => entry.includes(phrase)));
  assert.deepStrictEqual(found, [], `Expected no corrective instruction in the retry's argv. Found: ${JSON.stringify(found)}`);
});

Then('the command agent returns the output the retry produced', function () {
  const expected = validateIntegerArray(VALID_TEXT);
  assert.ok(expected.success, 'The validator must accept the stand-in\'s valid text');
  assert.ok(retry.result, 'Expected the command agent to have run');
  assert.deepStrictEqual(retry.result.parsed, expected.data);
});

Then(
  'the retry handed its command the validation error, the expected output schema and the output that failed validation, each inline or in a file it names',
  function () {
    const record = retryRecord();
    const texts = [...record.promptArgs, ...Object.values(record.files)];
    const handedOver = {
      'the validation error': texts.some((text) => text.includes(VALIDATION_ERROR)),
      'the expected output schema': texts.some((text) => textHoldsJson(text, OUTPUT_SCHEMA)),
      'the output that failed validation': texts.some((text) => text.includes(INVALID_TEXT)),
    };
    const missing = Object.entries(handedOver).filter(([, handed]) => !handed).map(([what]) => what);
    assert.deepStrictEqual(missing, [], `Expected the retry's command to be handed ${missing.join(', ')}. Prompt: ${promptOf(record)}; files: ${JSON.stringify(Object.keys(record.files))}`);
  },
);

Then(
  new RegExp(`^the routing tables give the retry's slash command a model for an issue whose body ${BODY_CLAUSE}$`),
  function (clause: string) {
    const command = retrySlashCommand();
    assert.ok(getModelForCommand(command, issueBodyFor(clause)) !== undefined, `The routing tables give "${command}" no model`);
  },
);

Then(
  new RegExp(`^the retry started the Claude CLI with the model and the effort the routing tables give its slash command for an issue whose body ${BODY_CLAUSE}$`),
  function (clause: string) {
    const command = retrySlashCommand();
    const body = issueBodyFor(clause);
    const { argv } = retryRecord();
    assert.strictEqual(flagValue(argv, '--model'), getModelForCommand(command, body), `argv: ${JSON.stringify(argv)}`);
    assert.strictEqual(flagValue(argv, '--effort'), getEffortForCommand(command, body), `argv: ${JSON.stringify(argv)}`);
  },
);

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
}

function trackedFilesContext(): GitContext {
  const lsFiles = (cwd: string, prefix = ''): string[] =>
    execFileSync('git', ['ls-files', '--', prefix], { cwd, encoding: 'utf-8' }).split('\n').filter(Boolean);
  return { lsFiles } as unknown as GitContext;
}

Given("a target repository worktree that ADW's worktree setup has prepared", function () {
  const worktree = makeTempDir('target-worktree');
  git(worktree, 'init');
  git(worktree, 'config', 'user.email', 'test@adw.local');
  git(worktree, 'config', 'user.name', 'ADW Test');
  fs.writeFileSync(path.join(worktree, 'README.md'), '# target repository\n');
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-m', 'baseline');
  copyClaudeAssetsToWorktree(worktree, trackedFilesContext());
  retry.worktree = worktree;
});

Then('the retry started the Claude CLI in that worktree', function () {
  assert.ok(retry.worktree, 'Expected a prepared target repository worktree first');
  assert.strictEqual(fs.realpathSync(retryRecord().cwd), fs.realpathSync(retry.worktree));
});

Then("the Claude CLI found a command file for the retry's slash command in the directory it ran in", function () {
  const command = retrySlashCommand();
  const { cwd, commandFileExists } = retryRecord();
  assert.strictEqual(commandFileExists, true, `Expected ${cwd}/.claude/commands/${command.slice(1)}.md to exist`);
});
