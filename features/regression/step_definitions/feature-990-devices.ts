/**
 * The device tools of a feature-990 orchestrator run: stand-ins for `avdmanager`, `emulator`, `adb` and `xcrun` that lead the
 * process's `PATH`, so that the real device lifecycle of a repository with platforms brings up devices that exist nowhere and
 * no run reaches a real SDK. Each is a POSIX shell script: a Node child would inherit the harness's `NODE_OPTIONS`, whose loader
 * a repository that is not this one cannot resolve. The emulator is a process that stays until `adb emu kill` ends it, as the
 * lifecycle's teardown expects. No hooks and no steps: any step file may import it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { STAND_IN_UDID } from '../../regression/support/standInDevices.ts';
import type { ScratchPaths } from './feature-990-scripts.ts';

const DEVICE_TOOLS_DIRECTORY = 'device-tools';
/** A run that is killed leaves its emulator for no longer than this; a run that ends well has `adb emu kill` end it at once. */
const EMULATOR_LIFETIME_SECONDS = 120;

const shellQuoted = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

/** The pid of each emulator is kept beside the scripts, under its serial, for `adb emu kill` to find. */
function toolBodies(directory: string): Readonly<Record<string, string>> {
  const pidFile = (serial: string): string => `${directory}/${serial}.pid`;
  return {
    avdmanager: '',
    xcrun: `
case "$2" in
  create) echo ${STAND_IN_UDID} ;;
  list) echo '{"devices":{}}' ;;
esac`,
    adb: `
if [ "$1" = -s ]; then serial=$2; shift 2; fi
case "$*" in
  devices) echo 'List of devices attached' ;;
  get-state) echo device ;;
  'shell getprop sys.boot_completed') echo 1 ;;
  'emu kill')
    [ -f ${pidFile('"$serial"')} ] && kill "$(cat ${pidFile('"$serial"')})" 2>/dev/null
    rm -f ${pidFile('"$serial"')}
    echo OK ;;
esac`,
    emulator: `
while [ $# -gt 0 ]; do
  [ "$1" = -port ] && port=$2
  shift
done
echo $$ > ${pidFile('emulator-"$port"')}
exec sleep ${EMULATOR_LIFETIME_SECONDS}`,
  };
}

/** Writes the stand-ins into the scenario's scratch directory, and returns the directory that is to lead the `PATH`. */
export function writeDeviceTools(scratch: ScratchPaths): string {
  const directory = path.join(scratch.dir, DEVICE_TOOLS_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  Object.entries(toolBodies(shellQuoted(directory))).forEach(([tool, body]) => {
    fs.writeFileSync(path.join(directory, tool), `#!/bin/sh\n${body}\nexit 0\n`, { mode: 0o755 });
  });
  return directory;
}
