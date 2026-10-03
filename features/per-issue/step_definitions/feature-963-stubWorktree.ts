/**
 * The throwaway worktree the stub runs in for feature-963.feature, and the stub run itself. The
 * stub is spawned the way an agent spawns it: the file as the executable, the worktree as cwd and
 * the launch environment as env. No MOCK_* name reaches it, so only the marker manifest programs it.
 */

import assert from 'assert';
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildClaudeLaunchEnv, getEffortForCommand, getModelForCommand, SLASH_COMMAND_MODEL_MAP } from '../../../adws/core/config.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { buildGuardrailsSettings, serializeGuardrailsSettings } from '../../../adws/core/guardrailsPayload.ts';
import type { SlashCommand } from '../../../adws/types/issueTypes.ts';
import type { Manifest } from '../../../test/mocks/manifestSchema.ts';
import { CLAUDE_CLI_STUB } from '../../regression/support/claudeCliStub.ts';
import { initialiseRepository } from '../../regression/support/fixtureWorktree.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { StubRun, StubWorktree } from './feature-963-state.ts';

export function writePayload(directory: string, name: string, answer: string): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify([{ type: 'text', text: answer }]), 'utf-8');
  return path;
}

/** Written again after every change to the manifest: the stub reads the file, not the object. */
export function flushManifest(worktree: StubWorktree): void {
  writeFileSync(join(worktree.path, '.adw-stub-manifest.json'), JSON.stringify(worktree.manifest), 'utf-8');
}

/** A repository under the system's temporary directory, which the scenario's cleanup removes. */
export function makeThrowawayRepository(world: RegressionWorld): { path: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'adw-963-stub-'));
  world.cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'worktree');
  mkdirSync(path);
  initialiseRepository(path);
  return { path, root };
}

export function makeStubWorktree(world: RegressionWorld, buildManifest: (payloadDir: string) => Manifest): StubWorktree {
  const { path, root } = makeThrowawayRepository(world);
  const payloadDir = join(root, 'payloads');
  mkdirSync(payloadDir);
  const worktree: StubWorktree = { path, payloadDir, manifest: buildManifest(payloadDir) };
  flushManifest(worktree);
  return worktree;
}

/** Every path the manifest declares an edit for, at the top level and in every entry. */
export function declaredEditPaths(manifest: Manifest): string[] {
  const entries = Object.values(manifest.byCommand ?? {});
  return [...manifest.edits, ...entries.flatMap((entry) => entry.edits ?? [])].map((edit) => edit.path);
}

export function asSlashCommand(command: string): SlashCommand {
  assert.ok(command in SLASH_COMMAND_MODEL_MAP, `"${command}" is not a slash command ADW routes to a model`);
  return command as SlashCommand;
}

/** The vector `runClaudeAgentWithCommand` builds; for a guarded target repository `--settings <json>` is unshifted first. */
export function agentArguments(command: string, guardrailsInjected: boolean): string[] {
  const slashCommand = asSlashCommand(command);
  const effort = getEffortForCommand(slashCommand);
  const args = [
    '--print',
    '--verbose',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--model', getModelForCommand(slashCommand),
    ...(effort ? ['--effort', effort] : []),
    `${command} '7'`,
  ];
  if (guardrailsInjected) args.unshift('--settings', serializeGuardrailsSettings(buildGuardrailsSettings({ frameworkRepoRoot: REPO_ROOT })));
  return args;
}

export function runStubIn(cwd: string, args: string[]): StubRun {
  const result = spawnSync(CLAUDE_CLI_STUB, args, { cwd, env: buildClaudeLaunchEnv(), encoding: 'utf-8' });
  assert.ok(!result.error, `Could not run the Claude CLI stub: ${result.error?.message}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function runStubAsAgent(worktree: StubWorktree, args: string[]): StubRun {
  return runStubIn(worktree.path, args);
}

/** The stub's last stdout line, which must be a `result` message. */
export function finalResult(run: StubRun): Record<string, unknown> {
  const lines = run.stdout.trim().split('\n');
  const last = lines[lines.length - 1] ?? '';
  const parsed: unknown = last ? JSON.parse(last) : null;
  const isResult = typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>)['type'] === 'result';
  assert.ok(isResult, `Expected the stub's output to end with a result message, but it ends with: ${last || '(nothing)'}\nstderr:\n${run.stderr}`);
  return parsed as Record<string, unknown>;
}
