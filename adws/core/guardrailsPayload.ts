/**
 * Pure builder for the guardrails `--settings` payload injected into
 * target-repo agent spawns (issue #762). The deny list is sourced from the
 * canonical `templates/claude-settings-starter.json` template — the single
 * source of truth also copied verbatim into target repos by `/adw_init`
 * (follow-up issue). Hooks are added here, at spawn time, because they must
 * resolve to ABSOLUTE framework paths: `$CLAUDE_PROJECT_DIR` resolves to the
 * target worktree, where the framework's own hook scripts do not exist.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AGENTS_STATE_DIR } from './environment';

const TEMPLATE_RELATIVE_PATH = path.join('templates', 'claude-settings-starter.json');
const HOOKS_RELATIVE_DIR = path.join('.claude', 'hooks');

/** A single hook registration entry in Claude Code's `settings.json` hooks shape. */
export interface GuardrailsHookEntry {
  readonly matcher: string;
  readonly hooks: ReadonlyArray<{ readonly type: 'command'; readonly command: string }>;
}

/** The full `--settings` payload injected on target-repo agent spawns. Declares no `permissions.allow`. */
export interface GuardrailsSettings {
  readonly permissions: { readonly deny: readonly string[] };
  readonly hooks: {
    readonly PreToolUse: readonly GuardrailsHookEntry[];
    readonly PostToolUse: readonly GuardrailsHookEntry[];
    readonly Notification: readonly GuardrailsHookEntry[];
    readonly Stop: readonly GuardrailsHookEntry[];
    readonly SubagentStop: readonly GuardrailsHookEntry[];
  };
}

interface HookSpec {
  readonly event: keyof GuardrailsSettings['hooks'];
  readonly script: string;
  readonly flags: string;
}

/** Mirrors the framework's own `.claude/settings.json` hook commands and per-hook flags. */
const HOOK_SPECS: readonly HookSpec[] = [
  { event: 'PreToolUse', script: 'pre-tool-use.ts', flags: '' },
  { event: 'PostToolUse', script: 'post-tool-use.ts', flags: '' },
  { event: 'Notification', script: 'notification.ts', flags: '--notify' },
  { event: 'Stop', script: 'stop.ts', flags: '--chat' },
  { event: 'SubagentStop', script: 'subagent-stop.ts', flags: '' },
];

function buildHookEntry(frameworkRepoRoot: string, spec: HookSpec): GuardrailsHookEntry {
  const absHookPath = path.join(frameworkRepoRoot, HOOKS_RELATIVE_DIR, spec.script);
  const flagsSuffix = spec.flags ? ` ${spec.flags}` : '';
  // NOT `bunx tsx` — target repos are not guaranteed to have tsx available.
  const command = `bun ${absHookPath}${flagsSuffix} || true`;
  return { matcher: '', hooks: [{ type: 'command', command }] };
}

function readDenyList(frameworkRepoRoot: string): readonly string[] {
  const templatePath = path.join(frameworkRepoRoot, TEMPLATE_RELATIVE_PATH);
  const raw = fs.readFileSync(templatePath, 'utf-8');
  const parsed = JSON.parse(raw) as { permissions?: { deny?: unknown } };
  const deny = parsed.permissions?.deny;
  if (!Array.isArray(deny)) {
    throw new Error(`guardrailsPayload: "${templatePath}" is missing a permissions.deny array`);
  }
  return deny.map(String);
}

/**
 * Builds the guardrails settings object injected via `--settings` on
 * target-repo agent spawns: the template's deny list, plus all five
 * framework hooks registered at absolute paths. Declares no
 * `permissions.allow` — verified a no-op under `--dangerously-skip-permissions`.
 * Reading the template file is the only side effect.
 */
export function buildGuardrailsSettings({ frameworkRepoRoot }: { frameworkRepoRoot: string }): GuardrailsSettings {
  const deny = readDenyList(frameworkRepoRoot);
  const [PreToolUse, PostToolUse, Notification, Stop, SubagentStop] = HOOK_SPECS.map(
    spec => buildHookEntry(frameworkRepoRoot, spec),
  );

  return {
    permissions: { deny },
    hooks: {
      PreToolUse: [PreToolUse!],
      PostToolUse: [PostToolUse!],
      Notification: [Notification!],
      Stop: [Stop!],
      SubagentStop: [SubagentStop!],
    },
  };
}

/** Serializes a {@link GuardrailsSettings} object for the `--settings` CLI argument. */
export function serializeGuardrailsSettings(settings: GuardrailsSettings): string {
  return JSON.stringify(settings);
}

/**
 * Resolves the ABSOLUTE hook-log directory for a run, under the framework's
 * own agent-state tree — never inside the target worktree. A relative
 * `CLAUDE_HOOKS_LOG_DIR` resolves against the hook process's cwd, which on a
 * target run IS the worktree, leaking untracked session logs into it; this
 * must stay absolute to avoid that leak (see feature-762.feature §8/§13).
 */
export function resolveHookLogDir(adwId: string): string {
  return path.join(AGENTS_STATE_DIR, adwId, 'hook-logs');
}
