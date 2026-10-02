#!/usr/bin/env bun
/**
 * Intercepts network-touching git subcommands (push, fetch, clone, pull,
 * ls-remote) and no-ops them, while delegating all other subcommands to
 * the real git binary. Place this script's directory on PATH before the
 * real git directory.
 *
 * Environment variables:
 *   REAL_GIT_PATH — absolute path to the real git binary (required when this
 *                   script is itself named "git" on PATH, to avoid recursion).
 *   MOCK_GIT_LOG  — path of a JSONL log. When set, one { subcommand, args, cwd }
 *                   line is appended for each intercepted subcommand; delegated
 *                   ones are not logged (see gitMockLog.ts).
 */

import { spawnSync } from 'child_process';
import { execSync } from 'child_process';
import { appendGitMockInvocation } from './gitMockLog.ts';

const REMOTE_COMMANDS = new Set(['push', 'fetch', 'clone', 'pull', 'ls-remote']);

const MOCK_OUTPUTS: Record<string, string> = {
  push: 'Everything up-to-date\n',
  fetch: '\n',
  clone: "Cloning into '.'...\ndone.\n",
  pull: 'Already up to date.\n',
  'ls-remote': '\n',
};

/** Resolves the real git binary path, avoiding infinite recursion. */
function resolveRealGit(): string {
  const fromEnv = process.env['REAL_GIT_PATH'];
  if (fromEnv) return fromEnv;

  // Fall back to which git — may return this script if on PATH first.
  try {
    const result = execSync('which -a git', { encoding: 'utf-8' }).trim();
    const paths = result.split('\n').map((p) => p.trim()).filter(Boolean);
    const thisScript = process.argv[1] ?? '';
    for (const p of paths) {
      if (p !== thisScript) return p;
    }
  } catch {
    // which unavailable — use bare 'git' and hope for the best
  }

  return '/usr/bin/git';
}

/** Returns the git subcommand (first non-flag argument after argv[2]). */
function getSubcommand(args: string[]): string {
  for (const arg of args) {
    if (!arg.startsWith('-')) return arg;
  }
  return '';
}

/** Best-effort: a log the harness cannot write must never change what the phase under test sees from git. */
function logInvocation(subcommand: string, args: string[]): void {
  const logPath = process.env['MOCK_GIT_LOG'];
  if (!logPath) return;
  try {
    appendGitMockInvocation(logPath, { subcommand, args, cwd: process.cwd() });
  } catch {
    // Never abort git for a logging failure.
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const subcommand = getSubcommand(args);

  if (REMOTE_COMMANDS.has(subcommand)) {
    logInvocation(subcommand, args);
    const mockOutput = MOCK_OUTPUTS[subcommand] ?? '\n';
    process.stdout.write(mockOutput);
    process.exit(0);
  }

  const realGit = resolveRealGit();
  const result = spawnSync(realGit, args, {
    stdio: 'inherit',
    env: process.env,
  });

  process.exit(result.status ?? 0);
}

main();
