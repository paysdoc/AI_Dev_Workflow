/**
 * What a `gh` shadow does with one call: reads are answered from the forge state, writes change it
 * and name the REST request they stand for, GraphQL is logged and answered with an empty data
 * object, and every other call is refused with `gh shadow: unsupported: <argv>` and exit 1, so a
 * call the shadow does not model can never be taken for one it answered. Pure: stdin, the clock and
 * the forge state are handed in, and the outcome says what to print, what to persist and what to log.
 */

import {
  allValues,
  lastValue,
  parseArgs,
  succeed,
  unsupported,
  type FlagSpec,
  type GhContext,
  type GhHandler,
  type GhOutcome,
  type ParsedArgs,
} from './ghShadowArgs.ts';
import { READ_HANDLERS, apiRead } from './ghShadowReads.ts';
import type { ForgeState } from './ghShadowState.ts';
import { WRITE_HANDLERS } from './ghShadowWrites.ts';

export type { GhLogEntry, GhOutcome, GhRequest } from './ghShadowArgs.ts';

const API_FLAGS: FlagSpec = { values: ['-X', '--method', '-f', '-F', '--input', '--jq'], switches: ['--paginate'] };
const API_WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const HANDLERS: Readonly<Record<string, GhHandler>> = { ...READ_HANDLERS, ...WRITE_HANDLERS };

/** `-F` types its value as `gh api` does; `-f` keeps a string. */
function typedValue(value: string): unknown {
  if (value === 'true' || value === 'false') return value === 'true';
  if (value === 'null') return null;
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

function fieldPairs(values: readonly string[], convert: (value: string) => unknown): [string, unknown][] {
  return values.map((pair): [string, unknown] => {
    const at = pair.indexOf('=');
    return at === -1 ? [pair, ''] : [pair.slice(0, at), convert(pair.slice(at + 1))];
  });
}

function stdinObject(stdin: () => string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stdin());
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The body from the `-f`/`-F` fields, or the JSON on stdin; both at once is a call the shadow does not model. */
function apiBody(parsed: ParsedArgs, stdin: () => string): Record<string, unknown> | undefined {
  const fields = [...fieldPairs(allValues(parsed, '-f'), (value) => value), ...fieldPairs(allValues(parsed, '-F'), typedValue)];
  const input = lastValue(parsed, '--input');
  if (input === undefined) return Object.fromEntries(fields);
  return input === '-' && fields.length === 0 ? stdinObject(stdin) : undefined;
}

function graphQl(parsed: ParsedArgs, { argv, stdin }: GhContext): GhOutcome | undefined {
  const body = apiBody(parsed, stdin);
  if (!body) return undefined;

  const { query, ...variables } = body;
  const request = { method: 'POST', path: '/graphql', body: parsed.values.has('--input') ? body : { query, variables } };
  return succeed('{"data":{}}\n', { log: { kind: 'graphql', argv, request } });
}

function apiWrite(method: string, path: string, parsed: ParsedArgs, { argv, stdin }: GhContext): GhOutcome | undefined {
  const body = apiBody(parsed, stdin);
  if (!body) return undefined;
  return succeed('{}\n', { log: { kind: 'write', argv, request: { method, path: `/${path.replace(/^\//, '')}`, body } } });
}

function api(args: readonly string[], context: GhContext): GhOutcome | undefined {
  const parsed = parseArgs(args, API_FLAGS);
  if (!parsed || parsed.positionals.length !== 1) return undefined;

  const [path] = parsed.positionals;
  const method = (lastValue(parsed, '-X') ?? lastValue(parsed, '--method') ?? 'GET').toUpperCase();
  if (path === 'graphql') return method === 'POST' || method === 'GET' ? graphQl(parsed, context) : undefined;
  if (API_WRITE_METHODS.has(method)) return apiWrite(method, path, parsed, context);
  return method === 'GET' && !parsed.values.has('--jq') ? apiRead(path, context) : undefined;
}

function route(argv: readonly string[], context: GhContext): GhOutcome | undefined {
  const [command, subcommand, ...rest] = argv;
  if (command === 'api') return api(argv.slice(1), context);
  return HANDLERS[`${command} ${subcommand}`]?.(rest, context);
}

/** An error inside a handler is a call the shadow cannot answer, and is reported as one, with the cause after the usual line. */
export function runGhCommand(
  argv: readonly string[],
  stdin: () => string,
  state: ForgeState,
  now: () => string = () => new Date().toISOString(),
): GhOutcome {
  try {
    return route(argv, { argv, stdin, state, now }) ?? unsupported(argv);
  } catch (error) {
    const refused = unsupported(argv);
    return { ...refused, stderr: `${refused.stderr}gh shadow: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}
