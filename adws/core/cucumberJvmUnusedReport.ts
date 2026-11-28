/**
 * Pure. cucumber-jvm's `unused` plugin report, as a dry run writes it: the `<n> unused step definition(s)` line, then a
 * `Location`/`Expression` table with one row per definition no feature file uses. A row names an annotated definition by its
 * method, `<class>.<method>(<parameter types>)`, never by file and line, so it is located in the step-definition sources by
 * package, class and method, and left unlocated whenever that does not resolve to exactly one declaration.
 */

import type { StepDefinitionSource } from './unusedStepReport';

export interface CucumberJvmUnusedRow {
  readonly location: string;
  /** As the report prints it: a cucumber expression as written, a regular expression without slashes. */
  readonly pattern: string;
}

export type CucumberJvmUnusedParse =
  | { readonly kind: 'parsed'; readonly rows: readonly CucumberJvmUnusedRow[] }
  | { readonly kind: 'unreadable'; readonly detail: string };

export interface JvmStepDefinitionLocation {
  readonly file: string;
  readonly line: number;
}

interface ReportLine {
  readonly number: number;
  readonly text: string;
}

type RowParse = { readonly kind: 'row'; readonly row: CucumberJvmUnusedRow } | { readonly kind: 'bad'; readonly detail: string };

interface MethodReference {
  readonly packageName: string;
  /** The binary name's top-level part: `Outer` for `Outer$Inner`. */
  readonly topLevelType: string;
  readonly method: string;
}

const ESCAPE = '\u001b';
const COLOUR_CODE = /^\[[0-9;]*m/;
const COUNT_LINE = /^(\d+) unused step definition\(s\)$/;
const HEADER_ROW = /^Location\s+Expression$/;
const ROW = /^\s*(\S.*?)\s+# (.*)$/;
/** A binary class name, then a method name that may hold spaces (a Kotlin backtick name) but never a dot or a parenthesis. */
const METHOD_REFERENCE = /^((?:[\p{L}_$][\p{L}\p{N}_$]*\.)*[\p{L}_$][\p{L}\p{N}_$]*)\.([^.()]+)\(([^():]*)\)$/u;
const PACKAGE_DECLARATION = /^[ \t]*package[ \t]+([\p{L}\p{N}_$.]+)/mu;
/** A nested type is indented, so a type declared at the start of a line, after its modifiers, is a top-level one. */
const TOP_LEVEL_TYPE =
  /^(?:(?:public|protected|private|internal|abstract|final|open|sealed|data|enum|annotation|value|inline|static|strictfp|fun)[ \t]+)*(?:class|interface|object|enum|record|@interface)[ \t]+([\p{L}_$][\p{L}\p{N}_$]*)/gmu;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function unreadable(detail: string): CucumberJvmUnusedParse {
  return { kind: 'unreadable', detail };
}

function withoutColour(text: string): string {
  return text
    .split(ESCAPE)
    .map((part, index) => (index === 0 ? part : part.replace(COLOUR_CODE, '')))
    .join('');
}

/** The non-blank lines, without trailing padding, each with its 1-based number in the report. */
function reportLines(report: string): ReportLine[] {
  return withoutColour(report)
    .split(/\r?\n/)
    .map((text, index) => ({ number: index + 1, text: text.trimEnd() }))
    .filter((line) => line.text.trim() !== '');
}

function parseRow(line: ReportLine): RowParse {
  const match = ROW.exec(line.text);
  if (!match) return { kind: 'bad', detail: `line ${line.number} of the unused report has no "# " expression: "${line.text}"` };
  return { kind: 'row', row: { location: match[1], pattern: match[2] } };
}

export function parseCucumberJvmUnusedReport(report: string): CucumberJvmUnusedParse {
  const [countLine, ...rest] = reportLines(report);
  if (countLine === undefined) return unreadable('the unused report is empty, although cucumber-jvm writes its "<n> unused step definition(s)" line even when nothing is unused');
  const count = COUNT_LINE.exec(countLine.text.trim());
  if (!count) return unreadable(`line ${countLine.number} of the unused report is not its "<n> unused step definition(s)" line: "${countLine.text}"`);

  const rowLines = HEADER_ROW.test(rest[0]?.text.trim() ?? '') ? rest.slice(1) : rest;
  const parsed = rowLines.map(parseRow);
  const bad = parsed.find((row) => row.kind === 'bad');
  if (bad?.kind === 'bad') return unreadable(bad.detail);

  const rows = parsed.flatMap((row) => (row.kind === 'row' ? [row.row] : []));
  if (rows.length !== Number(count[1])) {
    return unreadable(`line ${countLine.number} of the unused report counts ${count[1]} unused step definition(s), but ${rows.length} row(s) follow it`);
  }
  return { kind: 'parsed', rows };
}

/** Null for anything but `<class>.<method>(<parameter types>)`: a lambda's `(Steps.kt:12)`, a URI, an empty location. */
function parseMethodReference(location: string): MethodReference | null {
  const match = METHOD_REFERENCE.exec(location.trim());
  if (!match) return null;
  const [, binaryName, method] = match;
  const lastDot = binaryName.lastIndexOf('.');
  const [topLevelType] = binaryName.slice(lastDot + 1).split('$');
  return { packageName: lastDot === -1 ? '' : binaryName.slice(0, lastDot), topLevelType, method };
}

function packageOf(text: string): string {
  return PACKAGE_DECLARATION.exec(text)?.[1] ?? '';
}

function declaresTopLevelType(source: StepDefinitionSource, reference: MethodReference): boolean {
  if (packageOf(source.text) !== reference.packageName) return false;
  return [...source.text.matchAll(TOP_LEVEL_TYPE)].some((match) => match[1] === reference.topLevelType);
}

/** Kotlin `fun <name>(` or ``fun `<name>`(``, or Java `<type> <name>(`; a call such as `return <name>(` is no declaration. */
function methodDeclaration(method: string): RegExp {
  const name = method.replace(REGEXP_SPECIAL, '\\$&');
  const kotlin = `\\bfun[ \\t]+(?:<[^>]*>[ \\t]*)?(?:${name}|\`${name}\`)[ \\t]*\\(`;
  const java = `(?:^|[ \\t])(?!(?:return|new|throw|else|case)[ \\t])[\\p{L}\\p{N}_$.<>\\[\\],?]+[ \\t]+${name}[ \\t]*\\(`;
  return new RegExp(`${kotlin}|${java}`, 'u');
}

function declarationLines(text: string, method: string): number[] {
  const declaration = methodDeclaration(method);
  return text.split(/\r?\n/).flatMap((line, index) => (!COMMENT_LINE.test(line) && declaration.test(line) ? [index + 1] : []));
}

/** The file and line of the definition at `location`, or null unless exactly one source declares its class and that holds exactly one declaration of its method. */
export function locateJvmStepDefinition(location: string, sources: readonly StepDefinitionSource[]): JvmStepDefinitionLocation | null {
  const reference = parseMethodReference(location);
  if (reference === null) return null;

  const declarers = sources.filter((source) => declaresTopLevelType(source, reference));
  if (declarers.length !== 1) return null;
  const [declarer] = declarers;
  const lines = declarationLines(declarer.text, reference.method);
  return lines.length === 1 ? { file: declarer.file, line: lines[0] } : null;
}
