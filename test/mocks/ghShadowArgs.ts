/**
 * What a `gh` shadow handler returns and how it reads its argv. The argv is exactly what the
 * caller's argv array held: devplatform spawns `gh` without a shell, and the `/bin/sh` wrapper
 * forwards it verbatim through `"$@"`, so a value arrives with its quotes, `$(...)` and backticks
 * intact. A flag a handler does not name makes the whole call unsupported: the shadow
 * answers only the calls ADW makes, and refuses the rest rather than guess. Pure: no I/O.
 */

import type { ForgeState } from './ghShadowState.ts';

export interface GhRequest {
  method: string;
  path: string;
  body: unknown;
}

/** One line of the shadow's log: a write or GraphQL call as the REST request it stands for, or a call it refused. */
export interface GhLogEntry {
  kind: 'write' | 'graphql' | 'unsupported';
  argv: readonly string[];
  request?: GhRequest;
}

export interface GhOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Present when the call changed the forge, so a later read in the same run sees it. */
  state?: ForgeState;
  log?: GhLogEntry;
}

export interface GhContext {
  /** The whole argv, which a write's log entry carries. */
  argv: readonly string[];
  /** Read only when a handler needs the body: `execFileSync` gives a call with no input an empty pipe. */
  stdin: () => string;
  state: ForgeState;
  now: () => string;
}

/** `undefined` is a call the handler does not support. */
export type GhHandler = (args: readonly string[], context: GhContext) => GhOutcome | undefined;

export function succeed(stdout = '', extra: Pick<GhOutcome, 'state' | 'log'> = {}): GhOutcome {
  return { stdout, stderr: '', exitCode: 0, ...extra };
}

export function fail(stderr: string): GhOutcome {
  return { stdout: '', stderr: stderr.endsWith('\n') ? stderr : `${stderr}\n`, exitCode: 1 };
}

export function unsupported(argv: readonly string[]): GhOutcome {
  return { ...fail(`gh shadow: unsupported: ${argv.join(' ')}`), log: { kind: 'unsupported', argv } };
}

export interface FlagSpec {
  /** Flags that take the argument after them, or after an `=`. */
  readonly values?: readonly string[];
  readonly switches?: readonly string[];
}

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly values: ReadonlyMap<string, readonly string[]>;
  readonly switches: ReadonlySet<string>;
}

const ALIASES: Readonly<Record<string, string>> = { '-q': '--jq', '-R': '--repo' };

/** A lone `-` is a value (stdin), never a flag. */
function isFlag(arg: string): boolean {
  return arg.startsWith('-') && arg.length > 1;
}

function splitFlag(arg: string): [string, string | undefined] {
  const at = arg.startsWith('--') ? arg.indexOf('=') : -1;
  const [name, inline] = at === -1 ? [arg, undefined] : [arg.slice(0, at), arg.slice(at + 1)];
  return [ALIASES[name] ?? name, inline];
}

/** `undefined` when an argument is a flag the spec does not name, or a value flag has no value. */
export function parseArgs(args: readonly string[], spec: FlagSpec): ParsedArgs | undefined {
  const valueFlags = new Set(spec.values ?? []);
  const switchFlags = new Set(spec.switches ?? []);
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  const switches = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!isFlag(arg)) {
      positionals.push(arg);
      continue;
    }
    const [name, inline] = splitFlag(arg);
    if (switchFlags.has(name) && inline === undefined) {
      switches.add(name);
      continue;
    }
    if (!valueFlags.has(name)) return undefined;
    const value = inline ?? args[++index];
    if (value === undefined) return undefined;
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  return { positionals, values, switches };
}

/** The last value given for a flag. */
export function lastValue(parsed: ParsedArgs, flag: string): string | undefined {
  return parsed.values.get(flag)?.slice(-1)[0];
}

export function allValues(parsed: ParsedArgs, flag: string): readonly string[] {
  return parsed.values.get(flag) ?? [];
}

export function sameRepository(state: ForgeState, ownerAndRepo: string): boolean {
  return ownerAndRepo.toLowerCase() === `${state.repository.owner}/${state.repository.repo}`.toLowerCase();
}

/** What gh answers for a repository it cannot find. */
export function unknownRepository(ownerAndRepo: string): GhOutcome {
  return fail(`GraphQL: Could not resolve to a Repository with the name '${ownerAndRepo}'. (repository)`);
}

export function notAnIssue(number: number | string): GhOutcome {
  return fail(`GraphQL: Could not resolve to an issue or pull request with the number of ${number}. (repository.issue)`);
}

export function notAPullRequest(number: number | string): GhOutcome {
  return fail(`GraphQL: Could not resolve to a PullRequest with the number of ${number}. (repository.pullRequest)`);
}

export function isNumber(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value);
}
