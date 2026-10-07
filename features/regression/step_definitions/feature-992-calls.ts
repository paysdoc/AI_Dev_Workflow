/** Reads what the stand-in `npm`, `npx` and scenario command recorded, in the words the scenarios use for a command. */

import assert from 'assert';

import { commandLine, realPath, recordedCalls, type RecordedCall } from './feature-992-standins.ts';

/** A command is written as the program and the leading words of its arguments: `npx playwright test --grep`. */
export function commandMatches(call: RecordedCall, command: string): boolean {
  const [tool, ...words] = command.split(' ');
  return call.tool === tool && words.every((word, index) => call.argv[index] === word);
}

function resolved(directory: string): string {
  try {
    return realPath(directory);
  } catch {
    return directory;
  }
}

export function ranIn(call: RecordedCall, directory: string): boolean {
  return call.cwd === resolved(directory);
}

export function withoutAtSign(tag: string): string {
  return tag.replace(/^@/, '');
}

export function describeCalls(): string {
  return JSON.stringify(recordedCalls().map(commandLine));
}

/** The run of a command for a tag: the stand-ins record the tag a run was asked for. */
export function runForTag(command: string, tag: string): RecordedCall {
  const run = recordedCalls().find(call => commandMatches(call, command) && call.tag === withoutAtSign(tag));
  assert.ok(run, `Expected a run of "${command}" for the tag "${tag}", but the stand-ins recorded: ${describeCalls()}`);
  return run;
}
