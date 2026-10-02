/**
 * The tools a regression workflow run finds on its PATH instead of the real ones. NEVER THE REAL
 * DOCKER (feature-962-docker.ts), and nothing is ever installed: the `bun` shadow turns
 * `bun install`, whatever its arguments, into a link from `node_modules` to the ADW checkout's own,
 * which is what a run with no installed dependencies of its own can do, and hands every other
 * command to the real bun.
 */

import * as path from 'path';

import { shellQuote, writeExecutable } from './feature-939-standIns.ts';
import { dockerStandInSource, type DockerStandInPaths } from './feature-962-docker.ts';

export interface StandIns extends DockerStandInPaths {
  readonly binDir: string;
  readonly realBun: string;
  /** The ADW checkout's `node_modules`, which `bun install` links into the checkout it runs in. */
  readonly modules: string;
  /** The exit status of a `docker run` that is not refused. */
  readonly dockerExitStatus: number;
}

function bunShadowSource(realBun: string, modules: string): string {
  return [
    '#!/bin/sh',
    'if [ "$1" = "install" ]; then',
    `  [ -e node_modules ] || [ -L node_modules ] || ln -s ${shellQuote(modules)} node_modules`,
    '  exit 0',
    'fi',
    `exec ${shellQuote(realBun)} "$@"`,
    '',
  ].join('\n');
}

export function writeStandIns(standIns: StandIns): void {
  writeExecutable(path.join(standIns.binDir, 'bun'), bunShadowSource(standIns.realBun, standIns.modules));
  writeExecutable(path.join(standIns.binDir, 'docker'), dockerStandInSource(standIns, standIns.dockerExitStatus));
}
