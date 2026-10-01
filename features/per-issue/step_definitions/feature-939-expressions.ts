/**
 * The expression language of a workflow file, as far as the scenario runner needs it: literals,
 * `!`, `==`, `!=`, `&&`, `||`, parentheses, `success()`, `failure()`, `always()` and `cancelled()`,
 * and the `env`, `github`, `secrets`, `steps` and `vars` contexts, with GitHub's rules for equality
 * and truthiness. Anything else throws, so an unexpected edit fails loudly instead of being misread.
 */

export type Value = string | number | boolean | null;
type Lookup = (path: readonly string[]) => Value;

/** The places of a workflow file where an expression is evaluated, each of which offers its own contexts. */
export type Place = 'workflow env' | 'job if' | 'job env' | 'step if' | 'step env' | 'step run';

/** `secrets` reaches `env` and `run`, never an `if:`; a step's own `env` is not yet set in its `if:` or its `env`. */
const CONTEXTS_AT: Readonly<Record<Place, readonly string[]>> = {
  'workflow env': ['github', 'secrets', 'vars'],
  'job if': ['github', 'vars'],
  'job env': ['github', 'secrets', 'vars'],
  'step if': ['github', 'env', 'vars', 'steps'],
  'step env': ['github', 'env', 'secrets', 'steps', 'vars'],
  'step run': ['github', 'env', 'secrets', 'steps', 'vars'],
};

const KNOWN_CONTEXTS = ['env', 'github', 'secrets', 'steps', 'vars'];
const STATUS_FUNCTIONS = ['success', 'failure', 'always', 'cancelled'] as const;
type StatusFunction = (typeof STATUS_FUNCTIONS)[number];
type BinaryOperator = '==' | '!=' | '&&' | '||';

type Node =
  | { readonly kind: 'literal'; readonly value: Value }
  | { readonly kind: 'reference'; readonly path: readonly string[] }
  | { readonly kind: 'status'; readonly name: StatusFunction }
  | { readonly kind: 'not'; readonly operand: Node }
  | { readonly kind: 'binary'; readonly operator: BinaryOperator; readonly left: Node; readonly right: Node };

export interface Status {
  readonly success: boolean;
  readonly failure: boolean;
}

export interface Scope {
  readonly contexts: ReadonlyMap<string, Lookup>;
  readonly status: Status;
}

export interface StepRecord {
  readonly outcome: string;
  readonly conclusion: string;
  readonly outputs: ReadonlyMap<string, string>;
}

export interface ContextValues {
  readonly env: ReadonlyMap<string, string>;
  readonly secrets: ReadonlyMap<string, string>;
  readonly steps: ReadonlyMap<string, StepRecord>;
  readonly workspace: string;
}

const unsupported = (detail: string): Error => new Error(`Unsupported workflow expression: ${detail}`);

const TOKEN = /\s*('(?:[^']|'')*'|==|!=|&&|\|\||[!(),]|-?\d+(?:\.\d+)?|[A-Za-z_][\w-]*(?:\.[\w-]+)*)\s*/gy;
const LITERALS = new Map<string, Value>([['true', true], ['false', false], ['null', null]]);

function tokenize(text: string): string[] {
  const matches = [...text.matchAll(TOKEN)];
  const consumed = matches.reduce((total, match) => total + match[0].length, 0);
  if (matches.length === 0 || consumed !== text.length) throw unsupported(text.trim());
  return matches.map(match => match[1]);
}

const isOperatorOf = (token: string | undefined, operators: readonly BinaryOperator[]): token is BinaryOperator =>
  operators.some(operator => operator === token);

function parse(text: string): Node {
  const tokens = tokenize(text);
  let position = 0;

  const peek = (): string | undefined => tokens[position];
  const take = (): string => {
    const token = tokens[position++];
    if (token === undefined) throw unsupported(text.trim());
    return token;
  };
  const expect = (token: string): void => {
    if (take() !== token) throw unsupported(text.trim());
  };

  function parseLevel(operators: readonly BinaryOperator[], parseOperand: () => Node): Node {
    let left = parseOperand();
    for (let token = peek(); isOperatorOf(token, operators); token = peek()) {
      take();
      left = { kind: 'binary', operator: token, left, right: parseOperand() };
    }
    return left;
  }

  function parseCall(name: string): Node {
    expect('(');
    expect(')');
    const status = STATUS_FUNCTIONS.find(candidate => candidate === name);
    if (status === undefined) throw unsupported(`${name}()`);
    return { kind: 'status', name: status };
  }

  function parsePrimary(): Node {
    const token = take();
    if (token === '(') {
      const inner = parseOr();
      expect(')');
      return inner;
    }
    if (token.startsWith("'")) return { kind: 'literal', value: token.slice(1, -1).replace(/''/g, "'") };
    if (/^-?\d/.test(token)) return { kind: 'literal', value: Number(token) };
    if (LITERALS.has(token)) return { kind: 'literal', value: LITERALS.get(token) ?? null };
    if (peek() === '(') return parseCall(token);
    if (!/^[A-Za-z_]/.test(token)) throw unsupported(text.trim());
    return { kind: 'reference', path: token.split('.') };
  }

  function parseUnary(): Node {
    if (peek() !== '!') return parsePrimary();
    take();
    return { kind: 'not', operand: parseUnary() };
  }

  function parseEquality(): Node {
    return parseLevel(['==', '!='], parseUnary);
  }

  function parseAnd(): Node {
    return parseLevel(['&&'], parseEquality);
  }

  function parseOr(): Node {
    return parseLevel(['||'], parseAnd);
  }

  const node = parseOr();
  if (position !== tokens.length) throw unsupported(text.trim());
  return node;
}

function nodesOf(node: Node): readonly Node[] {
  switch (node.kind) {
    case 'not': return [node, ...nodesOf(node.operand)];
    case 'binary': return [node, ...nodesOf(node.left), ...nodesOf(node.right)];
    default: return [node];
  }
}

function rootsOf(node: Node): string[] {
  const roots = nodesOf(node).flatMap(each => (each.kind === 'reference' ? [each.path[0].toLowerCase()] : []));
  const unknown = roots.find(root => !KNOWN_CONTEXTS.includes(root));
  if (unknown !== undefined) throw unsupported(`the ${unknown} context`);
  return roots;
}

export function isTruthy(value: Value): boolean {
  return !(value === null || value === false || value === 0 || value === '' || Number.isNaN(value));
}

function toNumber(value: Value): number {
  if (value === null) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (value.trim() === '') return 0;
  return /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value.trim()) ? Number(value) : Number.NaN;
}

/** GitHub's loose equality: strings compare without regard to case, operands of different types compare as numbers. */
function looselyEqual(left: Value, right: Value): boolean {
  if (left === null && right === null) return true;
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase();
  if (typeof left === typeof right && left !== null) return left === right;
  return toNumber(left) === toNumber(right);
}

export function stringify(value: Value): string {
  return value === null ? '' : String(value);
}

function statusValue(name: StatusFunction, status: Status): boolean {
  switch (name) {
    case 'success': return status.success;
    case 'failure': return status.failure;
    case 'always': return true;
    case 'cancelled': return false;
  }
}

function evaluateBinary(node: Extract<Node, { kind: 'binary' }>, scope: Scope): Value {
  const left = evaluateNode(node.left, scope);
  switch (node.operator) {
    case '&&': return isTruthy(left) ? evaluateNode(node.right, scope) : left;
    case '||': return isTruthy(left) ? left : evaluateNode(node.right, scope);
    case '==': return looselyEqual(left, evaluateNode(node.right, scope));
    case '!=': return !looselyEqual(left, evaluateNode(node.right, scope));
  }
}

function evaluateNode(node: Node, scope: Scope): Value {
  switch (node.kind) {
    case 'literal': return node.value;
    case 'status': return statusValue(node.name, scope.status);
    case 'not': return !isTruthy(evaluateNode(node.operand, scope));
    case 'binary': return evaluateBinary(node, scope);
    case 'reference': {
      const [name, ...rest] = node.path;
      const lookup = scope.contexts.get(name.toLowerCase());
      if (lookup === undefined) throw unsupported(node.path.join('.'));
      return lookup(rest);
    }
  }
}

const insensitive = (map: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
  new Map([...map].map(([name, value]): [string, string] => [name.toLowerCase(), value]));

/** A missing name is the empty string, as it is for a secret the repository lacks. */
function namedLookup(context: string, values: ReadonlyMap<string, string>): Lookup {
  const byName = insensitive(values);
  return path => {
    if (path.length !== 1) throw unsupported(`${context}.${path.join('.')}`);
    return byName.get(path[0].toLowerCase()) ?? '';
  };
}

function githubLookup(workspace: string): Lookup {
  return path => {
    if (path.length === 1 && path[0] === 'event_name') return 'pull_request';
    if (path.length === 1 && path[0] === 'workspace') return workspace;
    throw unsupported(`github.${path.join('.')}`);
  };
}

function stepsLookup(steps: ReadonlyMap<string, StepRecord>): Lookup {
  return path => {
    const [id, field, name] = path;
    const record = steps.get(id);
    if (path.length === 2 && (field === 'outcome' || field === 'conclusion')) return record?.[field] ?? null;
    if (path.length === 3 && field === 'outputs') return record?.outputs.get(name) ?? '';
    throw unsupported(`steps.${path.join('.')}`);
  };
}

/** The contexts that `place` offers, over `values`; naming any other context is an error. */
export function scopeAt(place: Place, values: ContextValues, status: Status): Scope {
  const lookups: Readonly<Record<string, Lookup>> = {
    env: namedLookup('env', values.env),
    github: githubLookup(values.workspace),
    secrets: namedLookup('secrets', values.secrets),
    steps: stepsLookup(values.steps),
    vars: namedLookup('vars', new Map()),
  };
  return { contexts: new Map(CONTEXTS_AT[place].map((name): [string, Lookup] => [name, lookups[name]])), status };
}

const TEMPLATE = /\$\{\{([\s\S]*?)\}\}/g;
const WRAPPED = /^\s*\$\{\{([\s\S]*)\}\}\s*$/;

/** The expression of an `if:`, which may or may not be wrapped in `${{ }}`. */
function conditionNode(text: string): Node {
  const wrapped = WRAPPED.exec(text);
  if (wrapped === null && text.includes('${{')) throw unsupported(`an if: that mixes text and an expression: ${text}`);
  return parse(wrapped === null ? text : wrapped[1]);
}

/** Replaces each `${{ }}` in `text` with the value of its expression; a boolean becomes `true` or `false`. */
export function expand(text: string, scope: Scope): string {
  return text.replace(TEMPLATE, (_match, body: string) => stringify(evaluateNode(parse(body), scope)));
}

/** An `if:` holds on GitHub's rules, and unless it names a status function it also needs `success()`. */
export function conditionHolds(text: string | undefined, scope: Scope): boolean {
  if (text === undefined) return scope.status.success;
  const node = conditionNode(text);
  const result = isTruthy(evaluateNode(node, scope));
  return nodesOf(node).some(each => each.kind === 'status') ? result : scope.status.success && result;
}

export function contextsOfTemplate(text: string): string[] {
  return [...text.matchAll(TEMPLATE)].flatMap(match => rootsOf(parse(match[1])));
}

export function contextsOfCondition(text: string): string[] {
  return rootsOf(conditionNode(text));
}

export function contextsNotOfferedAt(place: Place, contexts: readonly string[]): string[] {
  return contexts.filter(context => !CONTEXTS_AT[place].includes(context));
}
