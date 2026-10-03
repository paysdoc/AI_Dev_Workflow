/**
 * The flags ADW passes to `claude` that take a value. The stub must skip the value as well: with
 * `--settings <json>` unshifted first for a guarded target repository, or `--max-turns 1` in the
 * probes, the value would otherwise be read as the prompt.
 */
export const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--output-format',
  '--model',
  '--effort',
  '--settings',
  '--max-turns',
]);

/** Skips known flags and their values; returns the first non-flag argument. */
export function extractPrompt(argv: readonly string[]): string {
  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('-')) {
      return arg;
    }
    if (VALUE_FLAGS.has(arg)) {
      i += 2;
    } else {
      i += 1;
    }
  }
  return '';
}
