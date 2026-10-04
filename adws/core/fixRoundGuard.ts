import { posix } from 'path';
import { parseUnifiedDiff, touchedPaths, type DiffFile } from './unifiedDiff';
import {
  FRAMEWORK_SUPPRESSION_PATTERNS,
  PROTECTED_PATH_RULES,
  PathScope,
  type ProtectedPathCategory,
  type ProtectedPathRule,
} from './fixRoundGuardTable';
import type { StackLanguage } from './stackCoherenceCheck';

export enum PatternSource {
  Framework = 'framework',
  Repository = 'repository',
}

export interface GuardPattern {
  readonly pattern: string;
  readonly source: PatternSource;
  /** Set for a framework pattern: the language whose table it comes from. */
  readonly language?: StackLanguage;
}

export interface FixRoundGuardConfig {
  readonly suppressionPatterns: readonly GuardPattern[];
  readonly protectedPaths: readonly ProtectedPathRule[];
  /** Entries of `## Suppression Patterns` that tried to remove a pattern. They had no effect. */
  readonly ignoredAdditions: readonly string[];
}

export type GuardRejection =
  | { readonly kind: 'suppression'; readonly path: string; readonly pattern: GuardPattern }
  | { readonly kind: 'protected_path'; readonly path: string; readonly category: ProtectedPathCategory };

export type FixRoundVerdict =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reasons: readonly GuardRejection[] };

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const FENCE_MARKER = /^(?:```|~~~)/;
const LIST_MARKER = /^[-*+](?:\s+|$)/;
const SURROUNDING_BACKTICKS = /^`+|`+$/g;
const NOT_APPLICABLE = 'n/a';
const REMOVAL_PREFIX = '!';
const UNKNOWN_PATH = '(unknown file)';

/** Patterns and lines are compared through this, so neither case nor spacing hides a suppression. */
function normalise(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

function entryOf(line: string): string {
  return line.trim().replace(LIST_MARKER, '').replace(SURROUNDING_BACKTICKS, '').trim();
}

/** One entry per line of a `## Suppression Patterns` body; an entry that starts with `!` is a removal attempt and is only reported. */
export function parseSuppressionPatternAdditions(section: string): { readonly added: readonly string[]; readonly ignored: readonly string[] } {
  const entries = section
    .replace(HTML_COMMENT, '')
    .split('\n')
    .filter(line => !FENCE_MARKER.test(line.trim()))
    .map(entryOf)
    .filter(entry => entry !== '' && entry.toLowerCase() !== NOT_APPLICABLE);
  return {
    added: entries.filter(entry => !entry.startsWith(REMOVAL_PREFIX)),
    ignored: entries.filter(entry => entry.startsWith(REMOVAL_PREFIX)),
  };
}

function frameworkPatterns(languages: Iterable<StackLanguage>): GuardPattern[] {
  return [...new Set(languages)].flatMap(language =>
    FRAMEWORK_SUPPRESSION_PATTERNS[language].map(({ pattern }) => ({ pattern, source: PatternSource.Framework, language })),
  );
}

/** The first of two patterns that read the same wins, so a framework pattern keeps its source. */
function withoutDuplicates(patterns: readonly GuardPattern[]): GuardPattern[] {
  const seen = new Set<string>();
  return patterns.filter(({ pattern }) => {
    const key = normalise(pattern);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildFixRoundGuardConfig(languages: Iterable<StackLanguage>, repositorySection: string): FixRoundGuardConfig {
  const { added, ignored } = parseSuppressionPatternAdditions(repositorySection);
  const repository = added.map(pattern => ({ pattern, source: PatternSource.Repository }));
  // A union and nothing else: a repository can add a pattern, and cannot remove or weaken a framework one.
  return {
    suppressionPatterns: withoutDuplicates([...frameworkPatterns(languages), ...repository]),
    protectedPaths: PROTECTED_PATH_RULES,
    ignoredAdditions: ignored,
  };
}

function isProtectedBy(rule: ProtectedPathRule, path: string): boolean {
  return rule.matches.test(rule.scope === PathScope.Basename ? posix.basename(path) : path);
}

function protectedPathRejections(file: DiffFile, config: FixRoundGuardConfig): GuardRejection[] {
  return touchedPaths(file).flatMap((path): GuardRejection[] => {
    const rule = config.protectedPaths.find(candidate => isProtectedBy(candidate, path));
    return rule ? [{ kind: 'protected_path', path, category: rule.category }] : [];
  });
}

/** Literal substring counting: nothing from the repository is ever compiled into a regular expression. */
function occurrences(normalisedLines: readonly string[], pattern: string): number {
  const needle = normalise(pattern);
  if (needle === '') return 0;
  return normalisedLines.reduce((count, line) => count + line.split(needle).length - 1, 0);
}

/** Per file, and by net count: a line edited in place that keeps its suppression adds none, and a second one does. */
function suppressionRejections(file: DiffFile, config: FixRoundGuardConfig): GuardRejection[] {
  const path = file.newPath ?? file.oldPath ?? UNKNOWN_PATH;
  const added = file.addedLines.map(normalise);
  const removed = file.removedLines.map(normalise);
  return config.suppressionPatterns
    .filter(entry => occurrences(added, entry.pattern) > occurrences(removed, entry.pattern))
    .map((pattern): GuardRejection => ({ kind: 'suppression', path, pattern }));
}

export function evaluateFixRound(diff: string, config: FixRoundGuardConfig): FixRoundVerdict {
  const reasons = parseUnifiedDiff(diff).flatMap(file => [
    ...protectedPathRejections(file, config),
    ...suppressionRejections(file, config),
  ]);
  return reasons.length === 0 ? { accepted: true } : { accepted: false, reasons };
}

function describePatternSource({ source, language }: GuardPattern): string {
  return source === PatternSource.Repository ? 'suppression pattern from .adw/commands.md' : `${language ?? 'framework'} suppression pattern`;
}

function onOneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

export function describeGuardRejection(rejection: GuardRejection): string {
  const path = onOneLine(rejection.path);
  if (rejection.kind === 'protected_path') return `\`${path}\` is ${rejection.category}, which a fix round may not change`;
  return `\`${path}\` adds \`${onOneLine(rejection.pattern.pattern)}\` (${describePatternSource(rejection.pattern)})`;
}
