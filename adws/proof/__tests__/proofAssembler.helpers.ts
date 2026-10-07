import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import type { TestCaseResult, TestReport } from '../../core/testReportParser';
import { indexFeatureScenarios } from '../featureScenarioIndex';
import {
  assembleScenarioProof,
  fixedScenarioTags,
  type FixedScenarioTag,
  type ProofAssemblyInput,
  type TagRun,
  type TagRunRecord,
} from '../proofAssembler';
import type { ProofArtifact } from '../types';

export const ISSUE = 42;
export const PROOF_DIR = '/work/proof';
export const GENERATED_AT = '2026-10-07T00:00:00.000Z';
export const [REGRESSION, PER_ISSUE] = fixedScenarioTags(ISSUE);

export function indexOf(...contents: string[]) {
  return indexFeatureScenarios(contents.map((content, position) => ({ path: `features/f${position}.feature`, content })));
}

export function artifact(relPath: string): ProofArtifact {
  return { absPath: `${PROOF_DIR}/artifacts/${relPath}`, relPath };
}

/** An attachment path as the report writes it: relative to the directory of the report, which is the proof directory. */
export function attachment(relPath: string): string {
  return `artifacts/${relPath}`;
}

export function testCase(name: string, attachments: readonly string[] = [], status: TestCaseResult['status'] = 'passed'): TestCaseResult {
  return { name, status, attachments: [...attachments] };
}

export function reportOf(...cases: TestCaseResult[]): TestReport {
  const failed = cases.filter(c => c.status === 'failed').length;
  const skipped = cases.filter(c => c.status === 'skipped').length;
  return { total: cases.length, passed: cases.length - failed - skipped, failed, skipped, cases };
}

export function runOf(tag: FixedScenarioTag, report: TestReport | null, overrides: Partial<TagRun> = {}): TagRunRecord {
  const reportPath = `${PROOF_DIR}/junit-${tag.tag.replace('@', '')}.xml`;
  return { tag, run: { exitCode: 0, stdout: 'ok', report, reportPath, ...overrides } };
}

export const NOT_RUN = (tag: FixedScenarioTag): TagRunRecord => ({ tag, run: null });

export function assemble(overrides: Partial<ProofAssemblyInput>) {
  return assembleScenarioProof({
    runs: [],
    scenarioIndex: indexOf(),
    artifacts: [],
    applicationProfile: APPLICATION_TYPE_PROFILES.web,
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

export const PER_ISSUE_FEATURE = `@adw-42
Feature: Cart

  Scenario: The cart shows the total
    Given a cart
`;

export const REGRESSION_FEATURE = `@regression
Feature: Wish list

  Scenario: The wish list opens
    Given a wish list
`;
