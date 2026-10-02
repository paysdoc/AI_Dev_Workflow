/**
 * The git-mock's invocation log: one JSON object per line, appended by test/mocks/git-remote-mock.ts
 * for each network subcommand it intercepts and read back by the steps that assert on pushes.
 */

import { appendFileSync, existsSync, readFileSync } from 'fs';
import type { GitMockInvocation } from './types.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isGitMockInvocation(v: unknown): v is GitMockInvocation {
  return isRecord(v) && typeof v['subcommand'] === 'string' && typeof v['cwd'] === 'string' && isStringArray(v['args']);
}

export function appendGitMockInvocation(logPath: string, invocation: GitMockInvocation): void {
  appendFileSync(logPath, `${JSON.stringify(invocation)}\n`, 'utf-8');
}

function parseInvocation(line: string): GitMockInvocation[] {
  try {
    const parsed: unknown = JSON.parse(line);
    return isGitMockInvocation(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
}

/** A line that is blank, is not JSON or is not an invocation is skipped, so one bad line never hides the rest. */
export function readGitMockLog(logPath: string): GitMockInvocation[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap(parseInvocation);
}
