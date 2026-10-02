/**
 * Module doc ↔ ADR mapping checks. An index entry's `Decisions:` block is authoritative; the
 * doc's `## Decisions` section mirrors it. Pure: doc text arrives through the caller's `readDoc`,
 * and a repository with no `specs/adr/`, no blocks and no sections yields nothing.
 */

import * as path from 'path';
import type { ConditionalDocEntry, ConditionalDocsRegistry } from './conditionalDocsRegistry';

export interface DecisionLink {
  readonly adr: string;
  readonly target: string;
  readonly resolvedPath: string;
}

export type DecisionViolation =
  | { readonly kind: 'decisions-mismatch'; readonly docPath: string; readonly onlyInBlock: readonly string[]; readonly onlyInSection: readonly string[] }
  | { readonly kind: 'unknown-decision'; readonly docPath: string; readonly adr: string }
  | { readonly kind: 'dead-decision-link'; readonly docPath: string; readonly target: string };

const ADR_FILE_RE = /^specs\/adr\/(\d{4})-[^/]+\.md$/;
const ADR_LINK_TARGET_RE = /(?:^|\/)specs\/adr\/(\d{4})-[^/]+\.md$/;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const FENCE_RE = /^\s*(`{3,}[^`]*|~{3,}.*)$/;
const SECTION_BOUNDARY_RE = /^#{1,2} /;
const DECISIONS_HEADING_RE = /^## Decisions\s*$/;

/** The numbers whose record file sits directly under `specs/adr/`; the index and nested paths are not records. */
export function findAdrNumbers(files: readonly string[]): ReadonlySet<string> {
  const numbers = files.map((file) => ADR_FILE_RE.exec(file)?.[1]);
  return new Set(numbers.filter((adr): adr is string => adr !== undefined));
}

/** A fence closes only on its own character, so a `~~~` line inside a backtick fence stays content. */
function nextFence(open: string | null, line: string): string | null {
  const match = FENCE_RE.exec(line);
  if (!match) return open;
  const marker = match[1][0];
  if (open === null) return marker;
  return open === marker ? null : open;
}

/** Lines of every `## Decisions` section, skipping fenced code so a doc that quotes the template is not misread. */
function decisionSectionLines(docContent: string): string[] {
  const collected: string[] = [];
  let fence: string | null = null;
  let inSection = false;
  for (const line of docContent.split(/\r?\n/)) {
    const wasFenced = fence !== null;
    fence = nextFence(fence, line);
    if (wasFenced || fence !== null) continue;
    if (SECTION_BOUNDARY_RE.test(line)) inSection = DECISIONS_HEADING_RE.test(line);
    else if (inSection) collected.push(line);
  }
  return collected;
}

/** Links resolve against the doc's own directory, as the doc's reader sees them; a leading `/` is the repository root. */
function resolveTarget(docPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(docPath), target));
}

function toDecisionLink(docPath: string, rawTarget: string): DecisionLink[] {
  const target = rawTarget.split('#')[0];
  const adr = ADR_LINK_TARGET_RE.exec(target)?.[1];
  return adr === undefined ? [] : [{ adr, target, resolvedPath: resolveTarget(docPath, target) }];
}

function linkTargetsIn(line: string): string[] {
  return [...line.matchAll(LINK_RE)].map((match) => match[1]);
}

/** Inline links in the doc's `## Decisions` sections that end in a record path. A URL or a mis-rooted target keeps its number and resolves to a path that is no file. */
export function parseDecisionLinks(docPath: string, docContent: string): DecisionLink[] {
  return decisionSectionLines(docContent)
    .flatMap(linkTargetsIn)
    .flatMap((target) => toDecisionLink(docPath, target));
}

function findMismatch(docPath: string, block: ReadonlySet<string>, section: ReadonlySet<string>): DecisionViolation[] {
  const onlyInBlock = [...block].filter((adr) => !section.has(adr)).sort();
  const onlyInSection = [...section].filter((adr) => !block.has(adr)).sort();
  if (onlyInBlock.length === 0 && onlyInSection.length === 0) return [];
  return [{ kind: 'decisions-mismatch', docPath, onlyInBlock, onlyInSection }];
}

function checkEntry(
  entry: ConditionalDocEntry,
  adrNumbers: ReadonlySet<string>,
  fileSet: ReadonlySet<string>,
  readDoc: (docPath: string) => string | null,
): DecisionViolation[] {
  const doc = readDoc(entry.docPath);
  const links = doc === null ? [] : parseDecisionLinks(entry.docPath, doc);
  const block = new Set(entry.decisions);
  const unknown = [...block]
    .filter((adr) => !adrNumbers.has(adr))
    .map((adr): DecisionViolation => ({ kind: 'unknown-decision', docPath: entry.docPath, adr }));
  const dead = links
    .filter((link) => !fileSet.has(link.resolvedPath))
    .map((link): DecisionViolation => ({ kind: 'dead-decision-link', docPath: entry.docPath, target: link.target }));
  return [...unknown, ...dead, ...findMismatch(entry.docPath, block, new Set(links.map((link) => link.adr)))];
}

/**
 * Every entry's doc is read, entries without a block included: a section with no block is a
 * mismatch too. Never skipped when `specs/adr/` is missing — a block there names records that
 * do not exist, and `/document` must not invent records in a target repo.
 */
export function findDecisionViolations(
  registry: ConditionalDocsRegistry,
  files: readonly string[],
  readDoc: (docPath: string) => string | null,
): DecisionViolation[] {
  const adrNumbers = findAdrNumbers(files);
  const fileSet = new Set(files);
  return registry.entries.flatMap((entry) => checkEntry(entry, adrNumbers, fileSet, readDoc));
}
