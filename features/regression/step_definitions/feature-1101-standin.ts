/**
 * The scenario runner of a feature-1101 repository: a shell script that ADW's run-by-tag command calls, kept beside the
 * data it reads and outside the worktree, so that nothing it does changes the tree. It records the tag and the commit it ran
 * on. It then reports the scenarios of the tag as the scenarios table says they end on a checkout that holds a commit landed
 * on the base branch, every commit landed there and every file the scenarios require, and as passing on one that does not; a
 * failing scenario passes once its fix is in the checkout. It lives under the root of whatever holds the scenario's temporary
 * files: a repository fixture, or the subprocess harness.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const FEATURE_NAME = 'Orders';

export type ScenarioResult = { readonly kind: 'passes' } | { readonly kind: 'fails'; readonly error: string };

export interface ScenarioRow {
  /** With its "@": `@regression` or `@adw-<issue>`. */
  readonly tag: string;
  readonly scenario: string;
  readonly result: ScenarioResult;
}

export interface StandInRun {
  readonly tag: string;
  readonly commit: string;
}

/** Anything with a temporary root: a `RepoFixture`, or the subprocess harness. */
export interface StandInHome {
  readonly root: string;
}

const SCRIPT = 'run-by-tag.sh';
const RUNS = 'runs.log';
const LANDED = 'landed';
const FAILS_WITH = /^fails with "(.*)"$/;

export function parseResult(text: string): ScenarioResult {
  if (text === 'passes') return { kind: 'passes' };
  const error = FAILS_WITH.exec(text)?.[1];
  if (error === undefined) throw new Error(`Expected a scenario result written as "passes" or 'fails with "<error>"', but got "${text}"`);
  return { kind: 'fails', error };
}

export function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The file whose presence in a checkout is the fix of a failing scenario. */
export function fixPathFor(scenario: string): string {
  return `fixes/${slugOf(scenario)}.txt`;
}

function directoryOf(home: StandInHome): string {
  return join(home.root, 'stand-in');
}

export function runByTagCommand(home: StandInHome): string {
  return `sh "${join(directoryOf(home), SCRIPT)}" {tag}`;
}

const scriptText = (gitBinary: string): string => String.raw`#!/bin/sh
set -u
git_bin='${gitBinary}'
tag=$1
dir=$(dirname "$0")
head=$("$git_bin" rev-parse HEAD)
printf '%s %s\n' "@$tag" "$head" >> "$dir/${RUNS}"

holds_every_landed_commit() {
  landed_any=1
  while read -r sha; do
    [ -n "$sha" ] || continue
    landed_any=0
    "$git_bin" merge-base --is-ancestor "$sha" HEAD || return 1
  done < "$dir/${LANDED}"
  return $landed_any
}

holds_required_files() {
  [ -f "$dir/$tag.requires" ] || return 0
  while read -r required; do
    [ -z "$required" ] || [ -e "$required" ] || return 1
  done < "$dir/$tag.requires"
  return 0
}

is_fixed() {
  [ -s "$dir/$tag.fixed-by" ] || return 1
  while read -r fix; do [ -e "$fix" ] || return 1; done < "$dir/$tag.fixed-by"
  return 0
}

report="$dir/$tag.pass.xml"
code=0
if [ -f "$dir/$tag.result.xml" ] && holds_every_landed_commit && holds_required_files && ! is_fixed; then
  report="$dir/$tag.result.xml"
  code=1
fi
if [ ! -f "$report" ]; then echo "The stand-in runner holds no scenarios for @$tag" >&2; exit 2; fi
cp "$report" "$ADW_JUNIT_REPORT_PATH"
echo "stand-in: @$tag on $head ended with exit code $code"
exit $code
`;

function xmlEscaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function testCase(scenario: string, error: string | null): string {
  const attributes = `classname="${xmlEscaped(FEATURE_NAME)}" name="${xmlEscaped(scenario)}"`;
  if (error === null) return `    <testcase ${attributes}/>`;
  return `    <testcase ${attributes}><failure message="${xmlEscaped(error)}" type="AssertionError"/></testcase>`;
}

function junitReport(cases: readonly { readonly scenario: string; readonly error: string | null }[]): string {
  const failures = cases.filter((each) => each.error !== null).length;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `  <testsuite name="${FEATURE_NAME}" tests="${cases.length}" failures="${failures}">`,
    ...cases.map((each) => testCase(each.scenario, each.error)),
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

function failureOf(row: ScenarioRow): string | null {
  return row.result.kind === 'fails' ? row.result.error : null;
}

function ensureFile(path: string): void {
  if (!existsSync(path)) writeFileSync(path, '', 'utf-8');
}

/** What a step describes first may be the commits that land on the base branch or the runner itself, so both leave the other's records alone. */
export function installStandIn(home: StandInHome): void {
  const directory = directoryOf(home);
  mkdirSync(directory, { recursive: true });
  const script = join(directory, SCRIPT);
  writeFileSync(script, scriptText(process.env['REAL_GIT_PATH'] ?? 'git'), 'utf-8');
  chmodSync(script, 0o755);
  ensureFile(join(directory, RUNS));
  ensureFile(join(directory, LANDED));
}

export interface ScenarioOptions {
  /** Files, relative to the checkout, that it must hold before a failing scenario fails there: what the workflow's own build adds. */
  readonly requires?: readonly string[];
}

/** One passing report per tag, and for a tag with a failing scenario the report of the table's results and the files that fix them. */
export function describeScenarios(home: StandInHome, rows: readonly ScenarioRow[], { requires = [] }: ScenarioOptions = {}): void {
  const directory = directoryOf(home);
  for (const tag of new Set(rows.map((row) => row.tag))) {
    const name = tag.slice(1);
    const own = rows.filter((row) => row.tag === tag);
    writeFileSync(join(directory, `${name}.pass.xml`), junitReport(own.map((row) => ({ scenario: row.scenario, error: null }))), 'utf-8');

    const failing = own.filter((row) => row.result.kind === 'fails');
    if (failing.length === 0) continue;
    writeFileSync(join(directory, `${name}.result.xml`), junitReport(own.map((row) => ({ scenario: row.scenario, error: failureOf(row) }))), 'utf-8');
    writeFileSync(join(directory, `${name}.fixed-by`), `${failing.map((row) => fixPathFor(row.scenario)).join('\n')}\n`, 'utf-8');
    if (requires.length > 0) writeFileSync(join(directory, `${name}.requires`), `${requires.join('\n')}\n`, 'utf-8');
  }
}

export function recordLandedCommit(home: StandInHome, sha: string): void {
  mkdirSync(directoryOf(home), { recursive: true });
  appendFileSync(join(directoryOf(home), LANDED), `${sha}\n`, 'utf-8');
}

/** The paths, relative to a checkout, that the files of one kind (`fixed-by`, `requires`) of every tag list. */
function pathsListedIn(home: StandInHome, extension: 'fixed-by' | 'requires'): string[] {
  const directory = directoryOf(home);
  if (!existsSync(directory)) return [];
  const lines = readdirSync(directory)
    .filter((name) => name.endsWith(`.${extension}`))
    .flatMap((name) => readFileSync(join(directory, name), 'utf-8').split('\n'));
  return [...new Set(lines.filter((line) => line !== ''))];
}

/** What a checkout must hold for the failing scenarios to fail there, and what puts them right. */
export function standInRequirements(home: StandInHome): { readonly requires: string[]; readonly fixes: string[] } {
  return { requires: pathsListedIn(home, 'requires'), fixes: pathsListedIn(home, 'fixed-by') };
}

export function standInRuns(home: StandInHome): StandInRun[] {
  const runs = join(directoryOf(home), RUNS);
  if (!existsSync(runs)) return [];
  return readFileSync(runs, 'utf-8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [tag, commit] = line.split(' ');
      return { tag, commit };
    });
}
