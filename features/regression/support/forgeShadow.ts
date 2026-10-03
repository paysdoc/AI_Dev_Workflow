/**
 * The Cucumber side of the `gh` shadow (test/mocks/gh-cli-shadow.ts): the wrapper a child's `PATH`
 * leads with, the forge state the shadow answers from, and the replay of what the shadow logged.
 * The replay runs after the child has exited, never while it runs: the child's `gh` calls are
 * synchronous, and one that waited on the mock server in this process would deadlock it.
 * No hooks and no import-time side effects, so any step file may import it.
 */

import type { RepoIdentifier } from '@paysdoc/devplatform';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { dispatchMockRequest } from '../../../test/mocks/github-api-server.ts';
import type { GhLogEntry, GhRequest } from '../../../test/mocks/ghShadowCommands.ts';
import { forgeStateFrom } from '../../../test/mocks/ghShadowState.ts';
import type { MockServerState } from '../../../test/mocks/types.ts';

const GH_SHADOW = resolve(REPO_ROOT, 'test/mocks/gh-cli-shadow.ts');
const DEFAULT_BRANCH = 'main';

export interface ForgeReplay {
  /** The writes and GraphQL calls sent to the mock. */
  readonly replayed: number;
  /** The argv of every call the shadow refused, space-joined as its message names it. */
  readonly unsupported: readonly string[];
}

/** Returns the directory to put first on a child's `PATH`. The Cucumber process's own `PATH` is never touched. */
export function installGhShadow(rootDir: string): string {
  const binDir = join(rootDir, 'gh-bin');
  mkdirSync(binDir, { recursive: true });
  const wrapper = join(binDir, 'gh');
  writeFileSync(wrapper, ['#!/bin/sh', `exec bun "${GH_SHADOW}" "$@"`, ''].join('\n'));
  chmodSync(wrapper, 0o755);
  return binDir;
}

/** The mock server's issues, pull requests and comments, as the shadow serves them for `repository`. */
export function writeForgeState(statePath: string, mock: MockServerState, repository: RepoIdentifier): void {
  const forge = forgeStateFrom(mock, { owner: repository.owner, repo: repository.repo, defaultBranch: DEFAULT_BRANCH });
  writeFileSync(statePath, JSON.stringify(forge), 'utf-8');
}

/** A killed process group can cut the last line mid-write, so a final line with no newline is dropped. */
function completeLines(log: string): string[] {
  return log.split('\n').slice(0, -1).filter((line) => line.trim().length > 0);
}

function requestsOf(entries: readonly GhLogEntry[]): GhRequest[] {
  return entries.flatMap((entry) => (entry.kind !== 'unsupported' && entry.request ? [entry.request] : []));
}

/** Sends each logged write and GraphQL call to the mock as the REST request it stands for, then empties the log. */
export function replayForgeLog(logPath: string): ForgeReplay {
  const entries = existsSync(logPath) ? completeLines(readFileSync(logPath, 'utf-8')).map((line) => JSON.parse(line) as GhLogEntry) : [];
  const requests = requestsOf(entries);
  requests.forEach(({ method, path, body }) => dispatchMockRequest(method, path, JSON.stringify(body)));
  writeFileSync(logPath, '', 'utf-8');
  return { replayed: requests.length, unsupported: entries.filter((entry) => entry.kind === 'unsupported').map((entry) => entry.argv.join(' ')) };
}
