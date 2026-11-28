/**
 * Pure. Declines Nominations in a Per-Issue Scenario file: `@nominated` becomes `@nomination-declined` on each named scenario's
 * own tag lines, and every other byte stays as it was, line endings included, so the edit lands as a one-tag diff. A declined
 * scenario is never offered again, and the Per-Issue Sweep removes it on its normal rule.
 */

import type { FeatureFileSource } from '../proof/featureScenarioIndex.ts';
import { NOMINATION_DECLINED_TAG, NOMINATION_TAG, type NominationKey } from './nominationCollector.ts';
import { parse } from './scenarioParser.ts';
import type { Scenario } from './types.ts';

export interface NominationDecline {
  readonly content: string;
  /** The names of the scenarios whose Nomination this edit declines. */
  readonly declined: readonly string[];
}

/** Whole tags only, so `@nominated-later` is left alone; a CRLF line's `\r` counts as the space after the tag. */
const WHOLE_NOMINATION_TAG = new RegExp(`(^|\\s)${NOMINATION_TAG}(?=\\s|$)`, 'g');

function scenariosOf(content: string): readonly Scenario[] | null {
  try {
    return parse(content);
  } catch {
    return null;
  }
}

/** The 1-based numbers of the lines from the scenario's first tag line up to its `Scenario:` line. */
function ownTagLines({ startLine, headerLine }: Scenario): number[] {
  return Array.from({ length: Math.max(0, headerLine - startLine) }, (_, offset) => startLine + offset);
}

function declinedLine(line: string): string {
  return line.replace(WHOLE_NOMINATION_TAG, `$1${NOMINATION_DECLINED_TAG}`);
}

/** Content the Gherkin parser rejects comes back unchanged, declining nothing. */
export function declineNominations(content: string, scenarioNames: readonly string[]): NominationDecline {
  const nominated = (scenariosOf(content) ?? []).filter((scenario) => scenarioNames.includes(scenario.name) && scenario.tags.includes(NOMINATION_TAG));
  if (nominated.length === 0) return { content, declined: [] };

  const tagLines = new Set(nominated.flatMap(ownTagLines));
  const lines = content.split('\n').map((line, index) => (tagLines.has(index + 1) ? declinedLine(line) : line));
  return { content: lines.join('\n'), declined: nominated.map((scenario) => scenario.name) };
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function holdsScenario(content: string, scenarioName: string): boolean {
  return (scenariosOf(content) ?? []).some((scenario) => scenario.name === scenarioName);
}

/** The Per-Issue Scenario file of the candidate's issue while it still holds a scenario of exactly that name; null otherwise. */
export function featureOfCandidate(features: readonly FeatureFileSource[], { issueNumber, scenarioName }: NominationKey): FeatureFileSource | null {
  const fileName = `feature-${issueNumber}.feature`;
  return features.find((file) => fileNameOf(file.path) === fileName && holdsScenario(file.content, scenarioName)) ?? null;
}
