/**
 * Pure. The unused step report: a scenario runner's usage report, written by a dry run, read into the step definitions it
 * holds, each with the feature files that use it. One reader per BDD framework, looked up from `## BDD Framework`; only
 * cucumber-js has one, and any other framework is not supported rather than guessed at.
 */

export const REPORT_PATH_PLACEHOLDER = '{report}';

/** `file` and `usedBy` are repository-relative, with `/` separators and no leading `./`; `usedBy` is sorted and holds each file once. */
export interface StepDefinitionUsage {
  readonly file: string;
  readonly line: number;
  /** A regular expression is shown between slashes, as cucumber's usage formatter shows it. */
  readonly pattern: string;
  readonly usedBy: readonly string[];
}

export interface UnusedStepDefinition {
  readonly file: string;
  readonly line: number;
  readonly pattern: string;
}

export type StepUsageRead =
  | { readonly kind: 'read'; readonly usages: readonly StepDefinitionUsage[] }
  | { readonly kind: 'unreadable'; readonly detail: string };

export interface StepUsageReader {
  readonly framework: string;
  /** The run-by-tag command turned into a dry run that writes the usage report to `{report}`; null when it cannot be. */
  dryRunCommand(runByTagCommand: string): string | null;
  read(report: string): StepUsageRead;
}

export type StepUsageReaderLookup =
  | { readonly kind: 'supported'; readonly reader: StepUsageReader }
  | { readonly kind: 'not_supported'; readonly framework: string };

interface UsageJsonEntry {
  readonly uri: string;
  readonly line: number;
  readonly pattern: string;
  readonly patternType: string;
  readonly matches: readonly { readonly uri: string }[];
}

type EntryCheck = { readonly kind: 'entry'; readonly entry: UsageJsonEntry } | { readonly kind: 'problem'; readonly problem: string };

type JsonParse = { readonly kind: 'parsed'; readonly value: unknown } | { readonly kind: 'invalid'; readonly error: string };

const CUCUMBER_JS = 'cucumber-js';
const NOT_APPLICABLE = 'n/a';
const REGULAR_EXPRESSION = 'RegularExpression';
const USAGE_JSON_ARGUMENTS = `--dry-run --format usage-json:${REPORT_PATH_PLACEHOLDER}`;
/** `--tags` or `-t`, then a space or `=`, then a value holding `{tag}`: double-quoted, single-quoted or bare. */
const TAG_FILTER = /(?<=^|\s)(?:--tags|-t)(?:\s+|=)(?:"[^"]*\{tag\}[^"]*"|'[^']*\{tag\}[^']*'|[^\s'"]*\{tag\}[^\s'"]*)(?=\s|$)/;

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function byFileAndLine(a: { readonly file: string; readonly line: number }, b: { readonly file: string; readonly line: number }): number {
  return compareText(a.file, b.file) || a.line - b.line;
}

function normalizeReportPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasStringUri(match: unknown): match is { readonly uri: string } {
  return isRecord(match) && typeof match.uri === 'string';
}

function checkEntry(raw: unknown): EntryCheck {
  if (!isRecord(raw)) return { kind: 'problem', problem: 'is not an object' };
  const { uri, line, pattern, patternType, matches } = raw;
  if (typeof uri !== 'string') return { kind: 'problem', problem: 'has no string "uri"' };
  if (!isNonNegativeInteger(line)) return { kind: 'problem', problem: 'has no non-negative integer "line"' };
  if (typeof pattern !== 'string') return { kind: 'problem', problem: 'has no string "pattern"' };
  if (typeof patternType !== 'string') return { kind: 'problem', problem: 'has no string "patternType"' };
  if (!Array.isArray(matches)) return { kind: 'problem', problem: 'has no "matches" array' };
  if (!matches.every(hasStringUri)) return { kind: 'problem', problem: 'has a match without a string "uri"' };
  return { kind: 'entry', entry: { uri, line, pattern, patternType, matches } };
}

function parseJson(text: string): JsonParse {
  try {
    return { kind: 'parsed', value: JSON.parse(text) };
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : String(error) };
  }
}

function toUsage(entry: UsageJsonEntry): StepDefinitionUsage {
  const usedBy = [...new Set(entry.matches.map((match) => normalizeReportPath(match.uri)))].sort(compareText);
  const pattern = entry.patternType === REGULAR_EXPRESSION ? `/${entry.pattern}/` : entry.pattern;
  return { file: normalizeReportPath(entry.uri), line: entry.line, pattern, usedBy };
}

function unreadable(detail: string): StepUsageRead {
  return { kind: 'unreadable', detail };
}

function readCucumberJsUsage(report: string): StepUsageRead {
  const parsed = parseJson(report);
  if (parsed.kind === 'invalid') return unreadable(`the usage report is not JSON: ${parsed.error}`);
  if (!Array.isArray(parsed.value)) return unreadable('the usage report is not a JSON array');

  const checks = parsed.value.map(checkEntry);
  const firstBad = checks.findIndex((check) => check.kind === 'problem');
  const bad = checks[firstBad];
  if (bad?.kind === 'problem') return unreadable(`entry ${firstBad} of the usage report ${bad.problem}`);

  const entries = checks.flatMap((check) => (check.kind === 'entry' ? [check.entry] : []));
  return { kind: 'read', usages: entries.map(toUsage).sort(byFileAndLine) };
}

function cucumberJsDryRunCommand(runByTagCommand: string): string | null {
  const command = runByTagCommand.trim();
  if (command === '' || command.toLowerCase() === NOT_APPLICABLE || !TAG_FILTER.test(command)) return null;
  return command.replace(TAG_FILTER, () => USAGE_JSON_ARGUMENTS);
}

const CUCUMBER_JS_READER: StepUsageReader = {
  framework: CUCUMBER_JS,
  dryRunCommand: cucumberJsDryRunCommand,
  read: readCucumberJsUsage,
};

const READERS: ReadonlyMap<string, StepUsageReader> = new Map([[CUCUMBER_JS, CUCUMBER_JS_READER]]);

export function resolveStepUsageReader(bddFramework: string): StepUsageReaderLookup {
  const framework = bddFramework.trim();
  const reader = READERS.get(framework.toLowerCase());
  return reader ? { kind: 'supported', reader } : { kind: 'not_supported', framework };
}

/**
 * Cucumber counts a step that matches two definitions toward neither, so a definition that shares its pattern can show no
 * use although a feature file uses it.
 */
function sharedPatterns(usages: readonly StepDefinitionUsage[]): ReadonlySet<string> {
  const counts = usages.reduce((tally, usage) => tally.set(usage.pattern, (tally.get(usage.pattern) ?? 0) + 1), new Map<string, number>());
  return new Set([...counts].filter(([, count]) => count > 1).map(([pattern]) => pattern));
}

/** The definitions no feature file uses once `removed` (feature and step files) is gone, sorted by file and then line. */
export function unusedStepDefinitions(usages: readonly StepDefinitionUsage[], removed: readonly string[] = []): readonly UnusedStepDefinition[] {
  const gone = new Set(removed.map(normalizeReportPath));
  const shared = sharedPatterns(usages);
  return usages
    .filter((usage) => !gone.has(usage.file) && !shared.has(usage.pattern))
    .filter((usage) => usage.usedBy.every((feature) => gone.has(feature)))
    .map(({ file, line, pattern }) => ({ file, line, pattern }))
    .sort(byFileAndLine);
}

/** The candidate step files that hold a definition a feature file outside `removedFeatures` uses, or one whose pattern is shared. */
export function stepFilesStillUsed(
  usages: readonly StepDefinitionUsage[],
  candidates: readonly string[],
  removedFeatures: readonly string[],
): readonly string[] {
  const gone = new Set(removedFeatures.map(normalizeReportPath));
  const shared = sharedPatterns(usages);
  const live = usages.filter((usage) => shared.has(usage.pattern) || usage.usedBy.some((feature) => !gone.has(feature)));
  const liveFiles = new Set(live.map((usage) => usage.file));
  return candidates.filter((candidate) => liveFiles.has(normalizeReportPath(candidate)));
}
