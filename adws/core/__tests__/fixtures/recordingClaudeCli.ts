import { chmodSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface RecordedInvocation {
  memory: string;
  hooksLogDir: string;
  sentinel: string;
}

export interface RecordingClaudeCli {
  cliPath: string;
  readInvocations: () => RecordedInvocation[];
  cleanup: () => void;
}

/** Sets each variable (`undefined` removes it) and returns a function that restores the originals. */
export function overrideEnv(overrides: Record<string, string | undefined>): () => void {
  const apply = (values: Record<string, string | undefined>): void => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const originals = Object.fromEntries(Object.keys(overrides).map((name) => [name, process.env[name]]));
  apply(overrides);
  return () => apply(originals);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * An executable stand-in for the `claude` CLI that records the environment it was started
 * with. The record path is baked into the script: a path handed over through the
 * environment would be dropped by the launch allowlist.
 */
export function createRecordingClaudeCli(options: { stdout?: string } = {}): RecordingClaudeCli {
  const dir = mkdtempSync(join(tmpdir(), 'adw-recording-claude-'));
  const recordPath = join(dir, 'invocations.tsv');
  const stdoutPath = join(dir, 'stdout.txt');
  const cliPath = join(dir, 'claude');

  writeFileSync(stdoutPath, options.stdout ?? '');
  writeFileSync(cliPath, [
    '#!/bin/sh',
    `printf '%s\\t%s\\t%s\\n' "$CLAUDE_CODE_DISABLE_AUTO_MEMORY" "$CLAUDE_HOOKS_LOG_DIR" "$ADW_RECORDING_SENTINEL" >> ${shellQuote(recordPath)}`,
    `cat ${shellQuote(stdoutPath)}`,
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(cliPath, 0o755);

  const readInvocations = (): RecordedInvocation[] => {
    if (!existsSync(recordPath)) return [];
    return readFileSync(recordPath, 'utf-8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [memory = '', hooksLogDir = '', sentinel = ''] = line.split('\t');
        return { memory, hooksLogDir, sentinel };
      });
  };

  return { cliPath, readInvocations, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
