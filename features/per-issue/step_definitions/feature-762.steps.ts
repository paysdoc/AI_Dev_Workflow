/**
 * BDD step definitions for feature-762.feature
 * Enforce ADW guardrails in target-repo agent runs via --settings injection.
 *
 * Self-contained: its own @adw-762-scoped Before/After and module-private ctx.
 * Does NOT redefine "the ADW codebase is checked out" (ensureCronOnEveryEventSteps.ts,
 * registry G18) or "the ADW TypeScript type-check passes" (feature-504.steps.ts,
 * registry T22) — both already registered globally.
 *
 * Design (see feature-762.feature's step-definition notes for the full rationale):
 *  - The `When` steps call the REAL runClaudeAgentWithCommand / real hook subprocesses.
 *    A tiny recorder-stub script (written fresh per scenario) is pointed to via
 *    CLAUDE_CODE_PATH; it records {argv, env, cwd} to JSON and streams a minimal
 *    valid assistant+result JSONL envelope so handleAgentProcess resolves normally.
 *  - The guardrails gate's probe/Slack seams are overridden via the production
 *    setGuardrailsGateDepsForTesting() hook (adw.yml + kill switch stay REAL —
 *    readAdwYml/getEnv in the injected deps delegate straight to the real functions).
 *  - Before/After are tag-scoped to @adw-762 — both CLAUDE_CODE_PATH and the gate's
 *    test-deps override are process-wide state, so an unscoped hook would leak into
 *    every other scenario in the suite.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { runClaudeAgentWithCommand } from '../../../adws/agents/claudeAgent.ts';
import type { AgentResult } from '../../../adws/types/agentTypes.ts';
import { AGENTS_STATE_DIR, REPO_ROOT, clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import { readAdwYmlConfig } from '../../../adws/core/adwYmlConfig.ts';
import { setGuardrailsGateDepsForTesting, type GuardrailsGateDeps } from '../../../adws/core/guardrailsGate.ts';
import type { ProbeVerdict } from '../../../adws/core/guardrailsProbe.ts';
import type { GuardrailsSettings } from '../../../adws/core/guardrailsPayload.ts';
import { formatDenialNotice } from '../../../adws/phases/phaseCommentHelpers.ts';

// ---------------------------------------------------------------------------
// Recorder-stub source — self-contained, no shared-fixture dependency.
// Written fresh into ctx.scratchDir per scenario. Records {argv, env, cwd} to
// RECORDED_PATH (sibling file, resolved via the stub's own import.meta.url —
// never an env var, since env vars must clear the getSafeSubprocessEnv()
// allowlist to reach the child), then streams a denial-count-configurable
// minimal JSONL envelope so handleAgentProcess resolves.
// ---------------------------------------------------------------------------

const RECORDER_STUB_SOURCE = `#!/usr/bin/env bun
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECORDED_PATH = join(__dirname, 'recorded.json');
const CONFIG_PATH = join(__dirname, 'stub-config.json');

function main() {
  const config = existsSync(CONFIG_PATH)
    ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    : { deniedCount: 0 };

  writeFileSync(RECORDED_PATH, JSON.stringify({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
  }));

  const lines = [];
  for (let i = 0; i < (config.deniedCount || 0); i++) {
    lines.push(JSON.stringify({
      type: 'tool_result',
      tool_use_id: 'stub-denied-' + i,
      content: 'permission denied',
      is_error: true,
    }));
  }
  lines.push(JSON.stringify({
    type: 'result',
    subtype: 'success',
    isError: false,
    durationMs: 1,
    durationApiMs: 1,
    numTurns: 1,
    result: 'stub-ok',
    sessionId: 'stub-session-762',
  }));

  for (const line of lines) {
    process.stdout.write(line + '\\n');
  }
  process.exit(0);
}

main();
`;

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

interface RecordedSpawn {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
}

interface StepContext {
  tmpRoot: string;
  worktreeDir: string;
  scratchDir: string;
  recordedPath: string;
  stubConfigPath: string;
  adwId: string;
  selfHost: boolean;
  probeVerdict: ProbeVerdict;
  slackCalls: string[];
  deniedCount: number;
  agentResult: AgentResult | null;
  recorded: RecordedSpawn | null;
  worktreeFilesBeforeSpawn: string[];
  worktreeFilesBeforeHook: string[];
  resolvedHookLogDir: string | null;
  lastHookResult: SpawnSyncReturns<string> | null;
  originalClaudeCodePath: string | undefined;
  originalKillSwitch: string | undefined;
  killSwitchWasSet: boolean;
}

const ctx: StepContext = {
  tmpRoot: '',
  worktreeDir: '',
  scratchDir: '',
  recordedPath: '',
  stubConfigPath: '',
  adwId: '',
  selfHost: false,
  probeVerdict: { ok: true },
  slackCalls: [],
  deniedCount: 0,
  agentResult: null,
  recorded: null,
  worktreeFilesBeforeSpawn: [],
  worktreeFilesBeforeHook: [],
  resolvedHookLogDir: null,
  lastHookResult: null,
  originalClaudeCodePath: undefined,
  originalKillSwitch: undefined,
  killSwitchWasSet: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively lists files under `dir` as paths relative to `dir`, sorted. */
function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return results.sort();
}

/** Writes `.github/adw.yml` into the fixture worktree with the given raw content. */
function writeAdwYml(worktreeDir: string, content: string): void {
  const githubDir = path.join(worktreeDir, '.github');
  fs.mkdirSync(githubDir, { recursive: true });
  fs.writeFileSync(path.join(githubDir, 'adw.yml'), content, 'utf-8');
}

/** Extracts and parses the `--settings` JSON payload from the recorded argv, or null if absent. */
function extractInjectedSettings(): GuardrailsSettings | null {
  const argv = ctx.recorded?.argv ?? [];
  const idx = argv.indexOf('--settings');
  if (idx === -1) return null;
  const json = argv[idx + 1];
  return JSON.parse(json) as GuardrailsSettings;
}

/** Flattens every hook command string across all five registered hook events. */
function allHookCommands(settings: GuardrailsSettings): string[] {
  const eventKeys = Object.keys(settings.hooks) as Array<keyof GuardrailsSettings['hooks']>;
  return eventKeys.flatMap(key => settings.hooks[key].flatMap(entry => entry.hooks.map(h => h.command)));
}

/** Resolves the recorded CLAUDE_HOOKS_LOG_DIR against the recorded cwd (the whole point — Spec conflict #1). */
function resolveRecordedHookLogDir(): string {
  const value = ctx.recorded?.env['CLAUDE_HOOKS_LOG_DIR'];
  assert.ok(value, 'Expected CLAUDE_HOOKS_LOG_DIR to be set on the spawned agent env');
  assert.ok(ctx.recorded, 'Expected a recorded spawn');
  return path.resolve(ctx.recorded!.cwd, value);
}

/** Writes the stub's per-scenario denial-count config, then invokes the REAL runClaudeAgentWithCommand. */
async function spawnAgent(): Promise<void> {
  fs.writeFileSync(ctx.stubConfigPath, JSON.stringify({ deniedCount: ctx.deniedCount }), 'utf-8');
  if (fs.existsSync(ctx.recordedPath)) fs.rmSync(ctx.recordedPath);

  ctx.worktreeFilesBeforeSpawn = listFilesRecursive(ctx.worktreeDir);

  const outputFile = path.join(ctx.scratchDir, 'output.jsonl');
  ctx.agentResult = await runClaudeAgentWithCommand(
    '/adw-762-bdd',
    'run',
    'guardrails-bdd-agent',
    outputFile,
    'haiku',
    undefined,
    undefined,
    undefined,
    ctx.worktreeDir,
    undefined,
    undefined,
    undefined,
    { selfHost: ctx.selfHost, adwId: ctx.adwId },
  );

  const recordedRaw = fs.readFileSync(ctx.recordedPath, 'utf-8');
  ctx.recorded = JSON.parse(recordedRaw) as RecordedSpawn;
}

// ---------------------------------------------------------------------------
// Before / After — tag-scoped: CLAUDE_CODE_PATH and the gate's test-deps
// override are process-wide state, so an unscoped hook would leak into every
// other scenario in the suite.
// ---------------------------------------------------------------------------

Before({ tags: '@adw-762' }, function () {
  ctx.tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-bdd-762-'));
  ctx.worktreeDir = path.join(ctx.tmpRoot, 'worktree');
  ctx.scratchDir = path.join(ctx.tmpRoot, 'scratch');
  fs.mkdirSync(ctx.worktreeDir, { recursive: true });
  fs.mkdirSync(ctx.scratchDir, { recursive: true });

  ctx.recordedPath = path.join(ctx.scratchDir, 'recorded.json');
  ctx.stubConfigPath = path.join(ctx.scratchDir, 'stub-config.json');
  const stubPath = path.join(ctx.scratchDir, 'recorder-stub.ts');
  fs.writeFileSync(stubPath, RECORDER_STUB_SOURCE, 'utf-8');
  fs.chmodSync(stubPath, 0o755);

  ctx.adwId = `bdd762-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  ctx.selfHost = false;
  ctx.probeVerdict = { ok: true };
  ctx.slackCalls = [];
  ctx.deniedCount = 0;
  ctx.agentResult = null;
  ctx.recorded = null;
  ctx.worktreeFilesBeforeSpawn = [];
  ctx.worktreeFilesBeforeHook = [];
  ctx.resolvedHookLogDir = null;
  ctx.lastHookResult = null;
  ctx.killSwitchWasSet = false;

  ctx.originalClaudeCodePath = process.env['CLAUDE_CODE_PATH'];
  ctx.originalKillSwitch = process.env['ADW_TARGET_GUARDRAILS'];

  process.env['CLAUDE_CODE_PATH'] = stubPath;
  clearClaudeCodePathCache();

  const deps: GuardrailsGateDeps = {
    probeGuardrails: async () => ctx.probeVerdict,
    notifySlack: async (text: string) => { ctx.slackCalls.push(text); },
    readAdwYml: readAdwYmlConfig,
    getEnv: (name: string) => process.env[name],
  };
  setGuardrailsGateDepsForTesting(deps);
});

After({ tags: '@adw-762' }, function () {
  setGuardrailsGateDepsForTesting(null);

  if (ctx.originalClaudeCodePath === undefined) delete process.env['CLAUDE_CODE_PATH'];
  else process.env['CLAUDE_CODE_PATH'] = ctx.originalClaudeCodePath;
  clearClaudeCodePathCache();

  if (ctx.killSwitchWasSet) {
    if (ctx.originalKillSwitch === undefined) delete process.env['ADW_TARGET_GUARDRAILS'];
    else process.env['ADW_TARGET_GUARDRAILS'] = ctx.originalKillSwitch;
  }

  fs.rmSync(ctx.tmpRoot, { recursive: true, force: true });
  if (ctx.adwId) {
    fs.rmSync(path.join(AGENTS_STATE_DIR, ctx.adwId), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Given — launch-context fixtures
// ---------------------------------------------------------------------------

Given('a target-repo agent run whose adw.yml sets guardrails to {string}', function (value: string) {
  ctx.selfHost = false;
  writeAdwYml(ctx.worktreeDir, `hitl: false\nunitTests: true\nguardrails: ${value}\n`);
});

Given('a target-repo agent run whose adw.yml omits the guardrails key', function () {
  ctx.selfHost = false;
  writeAdwYml(ctx.worktreeDir, `hitl: false\nunitTests: true\n`);
});

Given('a target-repo agent run whose repo ships no adw.yml', function () {
  ctx.selfHost = false;
  // No .github/adw.yml written — readAdwYmlConfig falls back to its absent-file default.
});

Given('a target-repo agent run with guardrails enabled', function () {
  ctx.selfHost = false;
  writeAdwYml(ctx.worktreeDir, `hitl: false\nunitTests: true\nguardrails: true\n`);
});

Given('a self-host agent run', function () {
  ctx.selfHost = true;
});

Given('the guardrails kill switch is set to off', function () {
  ctx.killSwitchWasSet = true;
  process.env['ADW_TARGET_GUARDRAILS'] = 'off';
});

Given('the guardrails startup probe fails', function () {
  ctx.probeVerdict = { ok: false, detail: 'stub probe failure (BDD fixture)' };
});

Given('the guardrails startup probe passes', function () {
  ctx.probeVerdict = { ok: true };
});

Given('the agent run records {int} permission-denied tool calls', function (count: number) {
  ctx.deniedCount = count;
});

Given('the agent run records no permission-denied tool calls', function () {
  ctx.deniedCount = 0;
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('the ADW agent is spawned', async function () {
  await spawnAgent();
});

When('the injected post-tool-use hook fires from inside the target worktree', function () {
  const hookLogDirValue = ctx.recorded?.env['CLAUDE_HOOKS_LOG_DIR'];
  assert.ok(hookLogDirValue, 'Expected CLAUDE_HOOKS_LOG_DIR to be set from the prior spawn');
  ctx.resolvedHookLogDir = resolveRecordedHookLogDir();
  ctx.worktreeFilesBeforeHook = listFilesRecursive(ctx.worktreeDir);

  const postToolUseHookPath = path.join(REPO_ROOT, '.claude', 'hooks', 'post-tool-use.ts');
  ctx.lastHookResult = spawnSync('bun', [postToolUseHookPath], {
    cwd: ctx.worktreeDir,
    env: { ...process.env, CLAUDE_HOOKS_LOG_DIR: hookLogDirValue },
    input: JSON.stringify({ session_id: 'sess-762', tool_name: 'Read' }),
    encoding: 'utf-8',
  });
});

When('the injected pre-tool-use hook screens a read of {string}', function (fileArg: string) {
  const preToolUseHookPath = path.join(REPO_ROOT, '.claude', 'hooks', 'pre-tool-use.ts');
  const targetFile = path.join(ctx.worktreeDir, fileArg);
  const scratchHookLogDir = path.join(ctx.scratchDir, 'hook-logs-14');

  ctx.lastHookResult = spawnSync('bun', [preToolUseHookPath], {
    cwd: ctx.worktreeDir,
    env: { ...process.env, CLAUDE_HOOKS_LOG_DIR: scratchHookLogDir },
    input: JSON.stringify({ session_id: 'sess-762-pre', tool_name: 'Read', tool_input: { file_path: targetFile } }),
    encoding: 'utf-8',
  });
});

// ---------------------------------------------------------------------------
// Then — settings payload
// ---------------------------------------------------------------------------

Then('the spawned agent CLI is configured with an injected settings payload', function () {
  assert.ok(ctx.recorded, 'Expected the agent to have been spawned');
  assert.ok(ctx.recorded!.argv.includes('--settings'), 'Expected --settings to be present in the spawned argv');
});

Then('the spawned agent CLI is configured with no injected settings payload', function () {
  assert.ok(ctx.recorded, 'Expected the agent to have been spawned');
  assert.ok(!ctx.recorded!.argv.includes('--settings'), 'Expected --settings to be ABSENT from the spawned argv');
});

Then('the injected payload carries a deny rule for recursive force removal', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  assert.ok(
    settings!.permissions.deny.some(r => r.includes('Bash(rm')),
    'Expected a recursive-force-removal deny rule',
  );
});

Then('the injected payload carries a deny rule for force pushing', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  assert.ok(
    settings!.permissions.deny.some(r => r.includes('git push')),
    'Expected a force-push deny rule',
  );
});

Then('the injected payload carries a deny rule for reading environment secrets', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  assert.ok(
    settings!.permissions.deny.some(r => r.startsWith('Read(**/.env')),
    'Expected an environment-secret-read deny rule',
  );
});

Then('the injected payload carves out the sample environment file from the environment deny', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  const deny = settings!.permissions.deny;
  assert.ok(deny.some(r => r.includes('.env.sample')), 'Expected a .env.sample carve-out');
  assert.ok(deny.some(r => r.includes('.env.example')), 'Expected a .env.example carve-out');
});

Then('the injected payload registers all five hook events', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  const events: Array<keyof GuardrailsSettings['hooks']> = ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop'];
  for (const event of events) {
    assert.ok(
      Array.isArray(settings!.hooks[event]) && settings!.hooks[event].length > 0,
      `Expected hook event ${event} to be registered`,
    );
  }
});

Then('every injected hook command names an absolute path', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  for (const command of allHookCommands(settings!)) {
    const match = /^bun (\S+)/.exec(command);
    assert.ok(match, `Expected hook command "${command}" to name a bun-invoked path`);
    assert.ok(path.isAbsolute(match![1]!), `Expected "${match![1]}" to be an absolute path`);
  }
});

Then('no injected hook command resolves inside the target worktree', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  for (const command of allHookCommands(settings!)) {
    assert.ok(
      !command.includes(ctx.worktreeDir),
      `Expected hook command "${command}" to NOT resolve inside the target worktree`,
    );
  }
});

Then('the injected payload declares no allow list', function () {
  const settings = extractInjectedSettings();
  assert.ok(settings, 'Expected an injected settings payload');
  assert.ok(!('allow' in settings!.permissions), 'Expected no permissions.allow to be declared');
});

// ---------------------------------------------------------------------------
// Then — hook-log placement
// ---------------------------------------------------------------------------

Then('the spawned agent directs its hook logs under the run\'s agent state directory', function () {
  const resolved = resolveRecordedHookLogDir();
  assert.ok(
    resolved.startsWith(AGENTS_STATE_DIR + path.sep),
    `Expected hook log dir "${resolved}" to be under the run's agent state directory "${AGENTS_STATE_DIR}"`,
  );
});

Then('the spawned agent directs its hook logs outside the target worktree', function () {
  const resolved = resolveRecordedHookLogDir();
  assert.ok(
    resolved !== ctx.worktreeDir && !resolved.startsWith(ctx.worktreeDir + path.sep),
    `Expected hook log dir "${resolved}" to NOT be inside the target worktree "${ctx.worktreeDir}"`,
  );
});

Then('the target worktree gains no hook-log files', function () {
  const after = listFilesRecursive(ctx.worktreeDir);
  assert.deepStrictEqual(after, ctx.worktreeFilesBeforeSpawn, 'Expected no new files to appear in the target worktree after spawn');
});

// ---------------------------------------------------------------------------
// Then — probe / Slack
// ---------------------------------------------------------------------------

Then('a guardrails alert is sent to Slack', function () {
  assert.strictEqual(ctx.slackCalls.length, 1, `Expected exactly one Slack alert, got ${ctx.slackCalls.length}`);
});

Then('no guardrails alert is sent to Slack', function () {
  assert.strictEqual(ctx.slackCalls.length, 0, `Expected no Slack alerts, got ${ctx.slackCalls.length}`);
});

// ---------------------------------------------------------------------------
// Then — denial-count reporting
// ---------------------------------------------------------------------------

Then('the run reporting states the denied tool call count as {int}', function (count: number) {
  assert.ok(ctx.agentResult, 'Expected an agent result');
  assert.strictEqual(ctx.agentResult!.deniedToolCallCount, count, `Expected deniedToolCallCount to be ${count}`);
  const notice = formatDenialNotice(ctx.agentResult!.deniedToolCallCount ?? 0);
  assert.ok(notice && notice.includes(String(count)), `Expected the composed denial notice to mention ${count}`);
});

Then('the run reporting states no denied tool calls', function () {
  assert.ok(ctx.agentResult, 'Expected an agent result');
  assert.strictEqual(ctx.agentResult!.deniedToolCallCount, 0, 'Expected deniedToolCallCount to be 0');
  const notice = formatDenialNotice(ctx.agentResult!.deniedToolCallCount ?? 0);
  assert.strictEqual(notice, null, 'Expected no denial notice for a clean run');
});

// ---------------------------------------------------------------------------
// Then — real hook firing (§13/§14)
// ---------------------------------------------------------------------------

Then('the hook session log is written under the run\'s agent state directory', function () {
  assert.ok(ctx.resolvedHookLogDir, 'Expected a resolved hook log dir from the prior When step');
  const sessionLogFile = path.join(ctx.resolvedHookLogDir!, 'sess-762', 'post_tool_use.json');
  assert.ok(fs.existsSync(sessionLogFile), `Expected hook session log at "${sessionLogFile}"`);
});

Then('the target worktree carries no hook-log artefact', function () {
  const after = listFilesRecursive(ctx.worktreeDir);
  assert.deepStrictEqual(after, ctx.worktreeFilesBeforeHook, 'Expected no hook-log artefact inside the target worktree');
});

Then('the injected pre-tool-use hook blocks the read', function () {
  assert.strictEqual(ctx.lastHookResult?.status, 2, `Expected exit status 2 (blocked), got ${ctx.lastHookResult?.status}`);
});

Then('the injected pre-tool-use hook allows the read', function () {
  assert.strictEqual(ctx.lastHookResult?.status, 0, `Expected exit status 0 (allowed), got ${ctx.lastHookResult?.status}`);
});
