/**
 * The I/O around the boundary list. It reads the worktree's list and feature files as they are at each call, so a list the
 * scenario agent created after the workflow loaded its configuration, or an entry the fix agent added, counts. A violation
 * comes back as a failing proof of the issue's tag, which the scenario fix loop hands to the fix agent like any failing scenario.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  BOUNDARY_TAG_PREFIX,
  REAL_BOUNDARIES_HEADING,
  checkBoundaryTags,
  describeBoundaryViolation,
  parseBoundaryList,
  type Boundary,
  type BoundaryViolation,
  type DeclaredBoundaryList,
} from '../core/boundaryList';
import { readScenariosMd } from '../core/projectConfig';
import { readFeatureFiles } from '../proof/featureFileReader';
import { ScenarioTagRole, fixedScenarioTags, type FixedScenarioTag } from '../proof/proofAssembler';
import { renderProofDocument } from '../proof/proofDocument';
import type { ScenarioProofResult, TagProofResult } from '../proof/types';

const NO_SCENARIO_RAN = 'The boundary-tag check failed, so no scenario ran';
const PROOF_FILE = 'scenario_proof.md';
const ARTIFACTS_DIR = 'artifacts';
const SECTION = `## ${REAL_BOUNDARIES_HEADING}`;
const TAG_FORMAT = `${BOUNDARY_TAG_PREFIX}<name>`;

export interface BoundaryTagGateInput {
  readonly worktreePath: string;
  /** Relative to the worktree, as the scenario runner's. */
  readonly featureDirectory: string;
  readonly issueNumber: number;
  /** Where the phase writes `scenario_proof.md`. */
  readonly proofDir: string;
}

export type BoundaryTagGate =
  | { readonly kind: 'skipped' }
  | { readonly kind: 'passed'; readonly boundaries: readonly Boundary[] }
  | { readonly kind: 'failed'; readonly violations: readonly BoundaryViolation[]; readonly proof: ScenarioProofResult };

function perIssueTagOf(issueNumber: number): FixedScenarioTag {
  const perIssue = fixedScenarioTags(issueNumber).find(({ role }) => role === ScenarioTagRole.PerIssue);
  if (!perIssue) throw new Error('ADW defines no per-issue scenario tag');
  return perIssue;
}

function namesOf(boundaries: readonly Boundary[]): string {
  return boundaries.length === 0 ? 'none' : boundaries.map(({ name }) => name).join(', ');
}

export function boundaryTagFailureResult(list: DeclaredBoundaryList, violations: readonly BoundaryViolation[], issueNumber: number): TagProofResult {
  const { pattern, tag } = perIssueTagOf(issueNumber);
  const output = [
    `Every scenario tagged ${tag} must carry the tag ${TAG_FORMAT} of a Real Boundary declared under ${SECTION} in .adw/scenarios.md.`,
    `Declared boundaries: ${namesOf(list.boundaries)}`,
    ...list.malformedEntries.map((entry) => `Entry under ${SECTION} that names no boundary: ${entry}`),
    ...violations.map(describeBoundaryViolation),
    `Fix: add or correct the ${TAG_FORMAT} tag on the scenario's tag line to the declared boundary its step code drives; add an entry under ${SECTION} only when the issue itself creates that boundary.`,
  ].join('\n');
  return { tag: pattern, resolvedTag: tag, severity: 'blocker', optional: true, passed: false, skipped: false, exitCode: null, output, warning: NO_SCENARIO_RAN };
}

function writeFailureProof(result: TagProofResult, proofDir: string): ScenarioProofResult {
  const document = renderProofDocument({ generatedAt: new Date().toISOString(), notice: NO_SCENARIO_RAN, tagResults: [result], evidence: null });
  fs.mkdirSync(proofDir, { recursive: true });
  const resultsFilePath = path.resolve(proofDir, PROOF_FILE);
  fs.writeFileSync(resultsFilePath, document, 'utf-8');
  return { tagResults: [result], hasBlockerFailures: true, perIssueImages: [], resultsFilePath, artifactsDir: path.resolve(proofDir, ARTIFACTS_DIR) };
}

/** Skipped when the worktree's `.adw/scenarios.md` declares no list: no feature file is read then. */
export function runBoundaryTagGate({ worktreePath, featureDirectory, issueNumber, proofDir }: BoundaryTagGateInput): BoundaryTagGate {
  const list = parseBoundaryList(readScenariosMd(worktreePath));
  if (list.kind === 'absent') return { kind: 'skipped' };

  const featureFiles = readFeatureFiles(path.resolve(worktreePath, featureDirectory));
  const violations = checkBoundaryTags(list, featureFiles, perIssueTagOf(issueNumber).tag);
  if (violations.length === 0) return { kind: 'passed', boundaries: list.boundaries };

  const proof = writeFailureProof(boundaryTagFailureResult(list, violations, issueNumber), proofDir);
  return { kind: 'failed', violations, proof };
}

export function describeBoundaryTagGate(gate: BoundaryTagGate, issueNumber: number): string {
  switch (gate.kind) {
    case 'skipped':
      return `Scenario test phase: .adw/scenarios.md has no ${SECTION} list — boundary-tag check skipped`;
    case 'passed':
      return `Scenario test phase: the boundary tags of the ${perIssueTagOf(issueNumber).tag} scenarios name declared boundaries (${namesOf(gate.boundaries)})`;
    case 'failed':
      return `Scenario test phase: boundary-tag check failed with ${gate.violations.length} violation(s); no scenario ran`;
  }
}
