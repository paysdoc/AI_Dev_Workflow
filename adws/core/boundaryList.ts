/**
 * Pure. A target declares its Real Boundaries under `## Real Boundaries` in `.adw/scenarios.md`, one top-level list item each,
 * and a scenario names the one it drives with the tag `@boundary-<name>`. The prefix is what tells a tag that names no declared
 * boundary apart from an unrelated tag such as `@subprocess`.
 */

import { parseMarkdownSections, stripHtmlComments } from './markdownSections';
import { indexFeatureScenarios, type FeatureFileSource, type IndexedScenario } from '../proof/featureScenarioIndex';

export const REAL_BOUNDARIES_HEADING = 'Real Boundaries';
export const BOUNDARY_TAG_PREFIX = '@boundary-';

export interface Boundary {
  readonly name: string;
  readonly description: string;
}

export type DeclaredBoundaryList = {
  readonly kind: 'declared';
  readonly boundaries: readonly Boundary[];
  /** Top-level items that name no boundary, as written. */
  readonly malformedEntries: readonly string[];
};

/** An absent list is a target that has not declared its boundaries; a declared list may be empty. */
export type BoundaryList = { readonly kind: 'absent' } | DeclaredBoundaryList;

export enum BoundaryViolationKind {
  MissingTag = 'missing_tag',
  UndeclaredTag = 'undeclared_tag',
}

/** `scenario` is the scenario's title, as the feature index gives it. */
export type BoundaryViolation =
  | { readonly kind: BoundaryViolationKind.MissingTag; readonly featurePath: string; readonly scenario: string }
  | { readonly kind: BoundaryViolationKind.UndeclaredTag; readonly featurePath: string; readonly scenario: string; readonly tag: string };

const TOP_LEVEL_ITEM = /^[-*]\s+/;
const BOUNDARY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEPARATOR = /^(?:—|–|-|:)\s*/;
const BACKTICKED = /^`([^`]*)`$/;

export function boundaryTag(name: string): string {
  return `${BOUNDARY_TAG_PREFIX}${name}`;
}

interface EntryName {
  readonly name: string;
  /** Set off by backticks or a colon, so whatever follows is its description. */
  readonly marked: boolean;
}

function entryNameOf(token: string): EntryName {
  const colon = token.endsWith(':');
  const withoutColon = colon ? token.slice(0, -1) : token;
  const backticked = BACKTICKED.exec(withoutColon);
  return backticked ? { name: backticked[1], marked: true } : { name: withoutColon, marked: colon };
}

// A bare name must be followed by a separator or nothing: otherwise the item is a sentence, whose first word is no name.
function boundaryOf(item: string): Boundary | null {
  const text = item.replace(TOP_LEVEL_ITEM, '');
  const [token = ''] = text.split(/\s+/);
  const rest = text.slice(token.length).trim();
  const { name, marked } = entryNameOf(token);
  if (!BOUNDARY_NAME.test(name)) return null;
  if (!marked && rest !== '' && !SEPARATOR.test(rest)) return null;
  return { name, description: rest.replace(SEPARATOR, '').trim() };
}

function topLevelItems(sectionBody: string): string[] {
  return stripHtmlComments(sectionBody)
    .split('\n')
    .filter((line) => TOP_LEVEL_ITEM.test(line))
    .map((line) => line.trim());
}

function firstOfEachName(boundaries: readonly Boundary[]): Boundary[] {
  return boundaries.filter((boundary, position) => boundaries.findIndex((other) => other.name === boundary.name) === position);
}

export function parseBoundaryList(scenariosMd: string): BoundaryList {
  const sections = parseMarkdownSections(scenariosMd);
  const key = REAL_BOUNDARIES_HEADING.toLowerCase();
  if (!(key in sections)) return { kind: 'absent' };

  const entries = topLevelItems(sections[key]).map((item) => ({ item, boundary: boundaryOf(item) }));
  return {
    kind: 'declared',
    boundaries: firstOfEachName(entries.flatMap(({ boundary }) => (boundary ? [boundary] : []))),
    malformedEntries: entries.filter(({ boundary }) => boundary === null).map(({ item }) => item),
  };
}

function violationsAgainst(declaredNames: ReadonlySet<string>): (scenario: IndexedScenario) => BoundaryViolation[] {
  return ({ featurePath, title, tags }) => {
    const boundaryTags = tags.filter((tag) => tag.startsWith(BOUNDARY_TAG_PREFIX));
    if (boundaryTags.length === 0) return [{ kind: BoundaryViolationKind.MissingTag, featurePath, scenario: title }];
    return boundaryTags
      .filter((tag) => !declaredNames.has(tag.slice(BOUNDARY_TAG_PREFIX.length)))
      .map((tag) => ({ kind: BoundaryViolationKind.UndeclaredTag, featurePath, scenario: title, tag }));
  };
}

/**
 * Only the scenarios that carry `perIssueTag`, compared whole, are checked: the scenarios of other issues and the Regression
 * Suite, written before boundaries were declared, carry no boundary tag. A file the Gherkin parser rejects is skipped; the
 * scenario runner reports its parse error.
 */
export function checkBoundaryTags(
  list: DeclaredBoundaryList,
  featureFiles: readonly FeatureFileSource[],
  perIssueTag: string,
): readonly BoundaryViolation[] {
  const violationsOf = violationsAgainst(new Set(list.boundaries.map((boundary) => boundary.name)));
  const scenarios = indexFeatureScenarios(featureFiles).scenarios.filter((scenario) => scenario.tags.includes(perIssueTag));
  return scenarios.flatMap(violationsOf);
}

export function describeBoundaryViolation(violation: BoundaryViolation): string {
  const subject = `\`${violation.featurePath}\`: scenario "${violation.scenario}"`;
  if (violation.kind === BoundaryViolationKind.MissingTag) return `${subject} carries no boundary tag`;
  return `${subject} carries ${violation.tag}, which names no boundary under ## ${REAL_BOUNDARIES_HEADING}`;
}

/** A tag line keeps its indentation and its other tags, one space apart; a line that held only boundary tags is dropped. */
function withoutBoundaryTagsOnLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return [line];
  const kept = trimmed.split(/\s+/).filter((token) => !token.startsWith(BOUNDARY_TAG_PREFIX));
  if (kept.length === 0) return [];
  const indentation = line.slice(0, line.length - line.trimStart().length);
  return [`${indentation}${kept.join(' ')}`];
}

/** The feature text with its boundary tags removed, so that two texts differing only in boundary tags compare equal. */
export function withoutBoundaryTags(featureText: string): string {
  return featureText.split('\n').flatMap(withoutBoundaryTagsOnLine).join('\n');
}
